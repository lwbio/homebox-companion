/**
 * LocationNavigator - Handles location tree navigation and data fetching
 *
 * This service encapsulates all navigation logic for the location tree:
 * - Loading and refreshing location data from the API
 * - Managing navigation state (current location, loading state)
 * - Handling breadcrumb navigation
 * - Location selection and deselection
 *
 * Uses Svelte 5 runes for fine-grained reactivity.
 */
import { locations as locationsApi } from '$lib/api';
import { locationStore, type PathItem } from '$lib/stores/locations.svelte';
import { scanWorkflow } from '$lib/workflows/scan.svelte';
import { showToast } from '$lib/stores/ui.svelte';
import { t } from '$lib/i18n';
import { createLogger } from '$lib/utils/logger';
import type { Location } from '$lib/types';

const log = createLogger({ prefix: 'LocationNavigator' });
type NavigationResult = 'success' | 'not-found' | 'failed' | 'stale';

// =============================================================================
// LOCATION NAVIGATOR CLASS
// =============================================================================

class LocationNavigator {
	// =========================================================================
	// STATE
	// =========================================================================

	/** Loading state for navigation operations */
	private _isLoading = $state(false);

	/** Currently navigated location (the location we're viewing children of) */
	private _currentLocation = $state<Location | null>(null);

	/** Latest URL-driven navigation request; older responses must not overwrite it. */
	private _navigationRequestId = 0;

	// =========================================================================
	// GETTERS
	// =========================================================================

	/** Get loading state */
	get isLoading(): boolean {
		return this._isLoading;
	}

	/** Get the currently navigated location */
	get currentLocation(): Location | null {
		return this._currentLocation;
	}

	/** Drop navigation state when the verified Homebox scope changes. */
	reset(): void {
		this._navigationRequestId++;
		this._currentLocation = null;
		this._isLoading = false;
	}

	/** Invalidate an older URL request when cached state already satisfies a newer URL. */
	cancelPendingNavigation(): void {
		this._navigationRequestId++;
		this._isLoading = false;
	}

	// =========================================================================
	// LOADING OPERATIONS
	// =========================================================================

	/**
	 * Load the location tree from the API.
	 * Sets the tree and current level to the root locations.
	 */
	async loadTree(): Promise<void> {
		log.debug('Loading location tree');
		this._isLoading = true;
		this._currentLocation = null;
		try {
			const tree = await locationsApi.tree();
			log.debug('Loaded location tree, top-level count:', tree.length);
			locationStore.setTree(tree);
			locationStore.setPath([]);
			locationStore.setCurrentLevel(tree);

			// Build flat list for search from the tree (preserves hierarchy for disambiguation)
			locationStore.setFlatList(tree);
		} catch (error) {
			log.error('Failed to load locations', error);
			showToast('Failed to load locations', 'error');
		} finally {
			this._isLoading = false;
		}
	}

	/**
	 * Refresh the current navigation level.
	 * If parentId is provided, refreshes that location's children.
	 * If parentId is null, refreshes the root level.
	 */
	async refreshCurrentLevel(parentId: string | null): Promise<void> {
		log.debug('Refreshing current level, parentId:', parentId);
		this._isLoading = true;
		try {
			if (parentId) {
				// Refresh children of the parent location
				const details = await locationsApi.get(parentId);
				locationStore.setCurrentLevel(details.children || []);
				// Update the current navigated location with fresh data
				this._currentLocation = {
					id: details.id,
					name: details.name,
					description: details.description || '',
					itemCount: details.itemCount ?? 0,
					children: details.children || [],
				};

				// Also refresh the global tree cache to keep it in sync
				const tree = await locationsApi.tree();
				locationStore.setTree(tree);
			} else {
				// Refresh top-level locations (tree fetch covers both tree cache and current level)
				const tree = await locationsApi.tree();
				locationStore.setTree(tree);
				locationStore.setCurrentLevel(tree);
				this._currentLocation = null;
			}

			// Also refresh flat list for search from the refreshed tree
			locationStore.setFlatList(locationStore.tree);
		} catch (error) {
			log.error('Failed to refresh current level', error);
			showToast(t('location.refreshFailed'), 'error');
		} finally {
			this._isLoading = false;
		}
	}

	/**
	 * Update breadcrumb names by fetching fresh data for each path item.
	 * This is useful after a refresh to pick up any renamed locations.
	 */
	async updateBreadcrumbNames(): Promise<void> {
		const path = locationStore.path;
		if (path.length === 0) return;

		try {
			// Fetch all locations in path to check for name changes
			const updates = await Promise.all(
				path.map(async (item) => {
					const details = await locationsApi.get(item.id);
					return { id: item.id, name: details.name };
				})
			);

			// Only update if names changed
			const hasChanges = updates.some((u, i) => u.name !== path[i].name);
			if (hasChanges) {
				locationStore.setPath(updates);
				log.debug('Updated breadcrumb names after refresh');
			}
		} catch (error) {
			log.warn('Failed to update breadcrumb names', error);
			// Don't show error toast - this is a non-critical enhancement
		}
	}

	// =========================================================================
	// NAVIGATION OPERATIONS
	// =========================================================================

	/**
	 * Navigate to a parent location by ID, driving the location tree from the URL.
	 *
	 * The location page reflects the current tree position in the URL as
	 * `?loc=<parent-id>` so that the browser back button returns to the
	 * previous level instead of leaving the scan flow entirely.
	 *
	 * @param locId - The parent location ID to browse, or null for the root level.
	 */
	async navigateToId(locId: string | null): Promise<NavigationResult> {
		const requestId = ++this._navigationRequestId;

		if (!locId) {
			this._isLoading = true;
			try {
				const tree = await locationsApi.tree();
				if (requestId !== this._navigationRequestId) return 'stale';
				locationStore.setTree(tree);
				locationStore.setFlatList(tree);
				locationStore.setPath([]);
				locationStore.setCurrentLevel(tree);
				this._currentLocation = null;
				return 'success';
			} catch (error) {
				if (requestId === this._navigationRequestId) {
					log.error('Failed to load locations', error);
					showToast(t('location.refreshFailed'), 'error');
				}
				return 'failed';
			} finally {
				if (requestId === this._navigationRequestId) this._isLoading = false;
			}
		}

		this._isLoading = true;
		try {
			// Ensure the tree is loaded so we can resolve the full breadcrumb path.
			let tree = locationStore.tree;
			if (tree.length === 0) {
				tree = await locationsApi.tree();
				if (requestId !== this._navigationRequestId) return 'stale';
				locationStore.setTree(tree);
				locationStore.setFlatList(tree);
			}

			let path = this.findPathInTree(tree, locId);
			if (!path) {
				// The cached tree may be stale (for example, immediately after a QR
				// scan for a location created by another client). Refresh once.
				tree = await locationsApi.tree();
				if (requestId !== this._navigationRequestId) return 'stale';
				locationStore.setTree(tree);
				locationStore.setFlatList(tree);
				path = this.findPathInTree(tree, locId);
				if (!path) {
					log.warn(`Location ${locId} not found in tree, falling back to root`);
					locationStore.setPath([]);
					locationStore.setCurrentLevel(tree);
					this._currentLocation = null;
					return 'not-found';
				}
			}

			const details = await locationsApi.get(locId);
			if (requestId !== this._navigationRequestId) return 'stale';
			locationStore.setPath(path);
			locationStore.setCurrentLevel(details.children || []);
			this._currentLocation = {
				id: details.id,
				name: details.name,
				description: details.description || '',
				itemCount: details.itemCount ?? 0,
				children: details.children || [],
			};
			return 'success';
		} catch (error) {
			if (requestId === this._navigationRequestId) {
				log.error('Failed to navigate to location', error);
				showToast(t('location.detailsFailed'), 'error');
			}
			return 'failed';
		} finally {
			if (requestId === this._navigationRequestId) this._isLoading = false;
		}
	}

	/**
	 * Find the breadcrumb path (ancestor chain, inclusive of the target) for a
	 * location ID within a location tree.
	 */
	private findPathInTree(
		tree: Location[],
		targetId: string,
		trail: PathItem[] = []
	): PathItem[] | null {
		for (const node of tree) {
			const current = [...trail, { id: node.id, name: node.name }];
			if (node.id === targetId) {
				return current;
			}
			if (node.children && node.children.length > 0) {
				const found = this.findPathInTree(node.children, targetId, current);
				if (found) return found;
			}
		}
		return null;
	}

	// =========================================================================
	// SELECTION OPERATIONS
	// =========================================================================

	/**
	 * Select a location for the scan workflow.
	 */
	selectLocation(location: Location, pathStr: string): void {
		log.debug('Selected location:', location.name, 'itemCount:', location.itemCount ?? 'unknown');
		// Update both the location store (for UI) and the workflow (for scan flow)
		locationStore.setSelected(location);
		scanWorkflow.setLocation(location.id, location.name, pathStr);
	}

	/** Clear the selected location; URL navigation restores the browse level. */
	clearSelectedLocation(): void {
		locationStore.setSelected(null);
		scanWorkflow.clearLocation();
	}

	/**
	 * Refresh the currently selected location's details.
	 */
	async refreshSelected(): Promise<void> {
		if (!locationStore.selected) return;

		this._isLoading = true;
		try {
			const details = await locationsApi.get(locationStore.selected.id);
			locationStore.setSelected({
				id: details.id,
				name: details.name,
				description: details.description || '',
				itemCount: details.itemCount ?? 0,
				children: details.children || [],
			});
			// Update workflow if name changed
			if (details.name !== scanWorkflow.state.locationName) {
				scanWorkflow.setLocation(details.id, details.name, locationStore.selectedPath);
			}
			// Also update breadcrumb names in case parent locations were renamed
			await this.updateBreadcrumbNames();
		} catch (error) {
			log.error('Failed to refresh selected location', error);
			showToast(t('location.refreshDetailFailed'), 'error');
		} finally {
			this._isLoading = false;
		}
	}

	// =========================================================================
	// HELPERS
	// =========================================================================

	/**
	 * Get the current parent location info (for creating child locations).
	 * Returns null if at root level.
	 */
	getCurrentParent(): { id: string; name: string } | null {
		const path = locationStore.path;
		if (path.length === 0) return null;
		const last = path[path.length - 1];
		return { id: last.id, name: last.name };
	}
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const locationNavigator = new LocationNavigator();
