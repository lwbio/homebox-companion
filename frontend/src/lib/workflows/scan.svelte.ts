/**
 * ScanWorkflow - Coordinates the entire scan-to-submit workflow
 *
 * This class acts as a facade/coordinator that:
 * - Manages overall workflow status and transitions
 * - Manages location state
 * - Delegates to specialized services for each phase
 * - Maintains backward compatibility for existing page components
 *
 * Services:
 * - CaptureService: Image management
 * - AnalysisService: AI detection
 * - ReviewService: Item review and confirmation
 * - SubmissionService: Homebox submission
 */

import { tick } from 'svelte';
import { workflowLogger as log } from '$lib/utils/logger';
import { CaptureService } from './capture.svelte';
import { AnalysisService } from './analysis.svelte';
import { ReviewService } from './review.svelte';
import { SubmissionService } from './submission.svelte';
import type {
	ScanState,
	ScanStatus,
	CapturedImage,
	ReviewItem,
	ConfirmedItem,
	Progress,
	SubmissionResult,
} from '$lib/types';
import {
	type StoredSession,
	type StoredReviewItem,
	serializeImage,
	serializeReviewItem,
	serializeConfirmedItem,
	deserializeImage,
	deserializeReviewItem,
	deserializeConfirmedItem,
} from '$lib/services/serialize';
import * as sessionPersistence from '$lib/services/sessionPersistence';
import { createUuid } from '$lib/utils/uuid';

// =============================================================================
// CONSTANTS
// =============================================================================

/** Debounce delay for auto-persist in milliseconds */
const AUTO_PERSIST_DEBOUNCE_MS = 1000;
const CAPTURE_CONTEXT_KEY = 'hbc-capture-context';
const CAPTURE_CONTEXT_TTL_MS = 24 * 60 * 60 * 1000;

interface CaptureContext {
	updatedAt: number;
	locationId: string;
	locationName: string;
	locationPath: string;
	parentItemId: string | null;
	parentItemName: string | null;
}

function unwrapStoredReviewItem(item: StoredReviewItem): StoredReviewItem {
	const { originalBlob, additionalBlobs } = item;
	return {
		...JSON.parse(JSON.stringify(item)),
		originalBlob,
		additionalBlobs: additionalBlobs ? Array.from(additionalBlobs) : undefined,
	};
}

// =============================================================================
// SCAN WORKFLOW CLASS
// =============================================================================

class ScanWorkflow {
	// =========================================================================
	// SERVICES
	// =========================================================================

	private captureService = new CaptureService();
	private analysisService = new AnalysisService();
	private reviewService = new ReviewService();
	private submissionService = new SubmissionService();

	// =========================================================================
	// WORKFLOW STATE
	// =========================================================================

	/** Current workflow status */
	private _status = $state<ScanStatus>('idle');

	/** Selected location ID */
	private _locationId = $state<string | null>(null);

	/** Selected location name */
	private _locationName = $state<string | null>(null);

	/** Selected location path */
	private _locationPath = $state<string | null>(null);

	/** Selected parent item ID (for sub-item relationships) */
	private _parentItemId = $state<string | null>(null);

	/** Selected parent item name */
	private _parentItemName = $state<string | null>(null);

	/** Current error message */
	private _error = $state<string | null>(null);

	/** Cached createdAt from persisted session (avoids loading full session on each persist) */
	private _persistedCreatedAt: number | null = null;

	/** Cached session ID (stable across saves) */
	private _persistedSessionId: string | null = null;

	/** Debounce timer for auto-persist */
	private _persistTimeout: ReturnType<typeof setTimeout> | null = null;
	private _persistPromise: Promise<void> | null = null;
	private _persistDirty = false;
	/** Invalidates in-flight writes when the workflow is reset. */
	private _persistGeneration = 0;
	/** Detects capture-context changes while analysis startup is awaiting persistence. */
	private _captureRevision = 0;
	/** Capture revision included in the last successful IndexedDB write. */
	private _persistedCaptureRevision = -1;
	/** Capture revision currently being serialized, if a write is active. */
	private _activePersistCaptureRevision: number | null = null;
	private _lastPersistSucceeded = true;
	private _recoverPromise: Promise<boolean> | null = null;

	/** Flag to skip the initial effect run (avoids persist on construction) */
	private _isFirstEffectRun = true;
	private contextGeneration = 0;

	/** Confirmed-item index currently being edited after a failed submission. */
	private failedItemEditIndex = $state<number | null>(null);

	// =========================================================================
	// CONSTRUCTOR (auto-persist setup)
	// =========================================================================

	constructor() {
		if (typeof window !== 'undefined') {
			this.setupAutoPersist();
		}
	}

	/**
	 * Setup automatic persistence using Svelte 5 effects.
	 * State changes are debounced (1s) and persisted to IndexedDB.
	 */
	private setupAutoPersist(): void {
		// Use $effect.root to create effect outside component lifecycle
		// Note: For a singleton, we don't need to store/call the cleanup function
		$effect.root(() => {
			$effect(() => {
				// == Dependency tracking ==
				// Must explicitly read all state we want to track
				const status = this._status;
				const locationId = this._locationId;
				const locationName = this._locationName;
				const locationPath = this._locationPath;
				const parentItemId = this._parentItemId;
				const parentItemName = this._parentItemName;
				const images = this.captureService.images;
				const detectedItems = this.reviewService.detectedItems;
				const confirmedItems = this.reviewService.confirmedItems;
				const currentReviewIndex = this.reviewService.currentReviewIndex;
				const imageStatuses = this.analysisService.imageStatuses;
				const isEditingFailedItem = this.failedItemEditIndex !== null;

				// DEPENDENCY TRACKING:
				// Svelte 5's $effect tracks reads automatically. The void statements below
				// ensure we re-run when these values change, even though we don't use
				// them directly in this effect body. This is necessary because:
				// 1. Array lengths - Svelte tracks array references, not lengths
				// 2. Location/parent names - we persist them but don't act on them here
				// 3. Scalar values need void to satisfy ESLint unused-vars rule
				void images.length;
				void detectedItems.length;
				void confirmedItems.length;
				void Object.keys(imageStatuses).length;
				void locationId;
				void locationName;
				void locationPath;
				void parentItemName;
				void parentItemId;
				void currentReviewIndex;
				void isEditingFailedItem;

				// Skip the very first effect run (avoids persisting on construction)
				if (this._isFirstEffectRun) {
					this._isFirstEffectRun = false;
					return;
				}

				// Don't persist terminal/transient states
				if (
					isEditingFailedItem ||
					status === 'idle' ||
					status === 'complete' ||
					status === 'analyzing' ||
					status === 'submitting'
				) {
					this.cancelScheduledPersist();
					return;
				}

				// Schedule debounced persist
				this.schedulePersist();
			});
		});

		// Flush pending persist on tab close.
		// NOTE: beforeunload has very limited time for async operations.
		// Modern browsers may not wait for IndexedDB writes to complete.
		// This is a best-effort attempt - critical persists should use persistAsync().
		window.addEventListener('beforeunload', () => this.flushPendingPersist());
	}

	/** Schedule a debounced persist (1 second delay) */
	private schedulePersist(): void {
		this.cancelScheduledPersist();
		if (this._persistPromise) {
			this._persistDirty = true;
			return;
		}
		this._persistTimeout = setTimeout(() => {
			this._persistTimeout = null;
			void this.runPersist();
		}, AUTO_PERSIST_DEBOUNCE_MS);
	}

	private cancelScheduledPersist(): void {
		if (this._persistTimeout !== null) {
			clearTimeout(this._persistTimeout);
			this._persistTimeout = null;
		}
	}

	/** Deduplicate persistence so image serialization never runs concurrently. */
	private runPersist(): Promise<void> {
		if (!this._persistPromise) {
			this._persistDirty = false;
			this._persistPromise = this._doPersist().finally(() => {
				this._persistPromise = null;
				if (this._persistDirty) {
					this._persistDirty = false;
					void this.runPersist();
				}
			});
		} else {
			this._persistDirty = true;
		}
		return this._persistPromise;
	}

	/**
	 * Flush any pending persist immediately (best-effort for beforeunload).
	 *
	 * IMPORTANT: This triggers an async persist but does NOT await it.
	 * Browser may not complete IndexedDB writes during beforeunload.
	 * For guaranteed persistence, call persistAsync() at critical points
	 * (e.g., after analysis completes, before navigation).
	 */
	private flushPendingPersist(): void {
		if (this.failedItemEditIndex !== null) return;

		if (this._persistTimeout !== null) {
			this.cancelScheduledPersist();
			// Fire-and-forget: browser may not wait for this to complete
			void this.runPersist();
		}
	}

	// =========================================================================
	// UNIFIED STATE ACCESSOR (for backward compatibility)
	// =========================================================================

	/**
	 * State proxy that allows both reading and direct property assignment.
	 * This maintains backward compatibility with code like:
	 *   workflow.state.status = 'confirming'
	 *   workflow.state.analysisProgress = null
	 */
	private _stateProxy: ScanState | null = null;

	/** Valid readable state properties */
	private static readonly READABLE_PROPS = new Set<keyof ScanState>([
		'status',
		'locationId',
		'locationName',
		'locationPath',
		'parentItemId',
		'parentItemName',
		'images',
		'analysisProgress',
		'imageStatuses',
		'detectedItems',
		'currentReviewIndex',
		'confirmedItems',
		'submissionProgress',
		'itemStatuses',
		'lastSubmissionResult',
		'submissionErrors',
		'error',
	]);

	/** Writable state properties */
	private static readonly WRITABLE_PROPS = new Set<keyof ScanState>([
		'status',
		'locationId',
		'locationName',
		'locationPath',
		'parentItemId',
		'parentItemName',
		'error',
		'analysisProgress',
	]);

	/**
	 * Unified state object for backward compatibility with existing pages.
	 * Returns a Proxy that intercepts property assignments.
	 *
	 * IMPORTANT: This proxy throws errors for unknown property access to surface bugs.
	 * - Reading unknown properties throws TypeError
	 * - Writing to read-only properties throws TypeError
	 * - Writing to unknown properties throws TypeError
	 */
	get state(): ScanState {
		// Create proxy once and reuse (the proxy handlers access live service state)
		if (!this._stateProxy) {
			// eslint-disable-next-line @typescript-eslint/no-this-alias -- Required for closure in Proxy handlers
			const workflow = this;
			this._stateProxy = new Proxy({} as ScanState, {
				get(_target, prop: string | symbol) {
					// Allow Symbol access (for iteration, etc.)
					if (typeof prop === 'symbol') {
						return undefined;
					}

					const propName = prop as keyof ScanState;

					// Check if property is valid
					if (!ScanWorkflow.READABLE_PROPS.has(propName)) {
						throw new TypeError(
							`Cannot read unknown workflow state property: '${prop}'. ` +
								`Valid properties are: ${[...ScanWorkflow.READABLE_PROPS].join(', ')}`
						);
					}

					switch (propName) {
						case 'status':
							return workflow._status;
						case 'locationId':
							return workflow._locationId;
						case 'locationName':
							return workflow._locationName;
						case 'locationPath':
							return workflow._locationPath;
						case 'parentItemId':
							return workflow._parentItemId;
						case 'parentItemName':
							return workflow._parentItemName;
						case 'images':
							return workflow.captureService.images;
						case 'analysisProgress':
							return workflow.analysisService.progress;
						case 'imageStatuses':
							return workflow.analysisService.imageStatuses;
						case 'detectedItems':
							return workflow.reviewService.detectedItems;
						case 'currentReviewIndex':
							return workflow.reviewService.currentReviewIndex;
						case 'confirmedItems':
							return workflow.reviewService.confirmedItems;
						case 'submissionProgress':
							return workflow.submissionService.progress;
						case 'itemStatuses':
							return workflow.submissionService.itemStatuses;
						case 'lastSubmissionResult':
							return workflow.submissionService.lastResult;
						case 'submissionErrors':
							return workflow.submissionService.lastErrors;
						case 'error':
							return workflow._error;
						default: {
							// TypeScript exhaustiveness check - should never reach here
							const _exhaustive: never = propName;
							throw new TypeError(`Unhandled property: ${_exhaustive}`);
						}
					}
				},
				set(_target, prop: string | symbol, value) {
					// Reject Symbol writes
					if (typeof prop === 'symbol') {
						throw new TypeError(`Cannot set Symbol property on workflow state`);
					}

					const propName = prop as keyof ScanState;

					// Check if property exists at all
					if (!ScanWorkflow.READABLE_PROPS.has(propName)) {
						throw new TypeError(
							`Cannot set unknown workflow state property: '${prop}'. ` +
								`Valid properties are: ${[...ScanWorkflow.READABLE_PROPS].join(', ')}`
						);
					}

					// Check if property is writable
					if (!ScanWorkflow.WRITABLE_PROPS.has(propName)) {
						throw new TypeError(
							`Cannot set read-only workflow state property: '${prop}'. ` +
								`This property can only be modified through workflow methods. ` +
								`Writable properties are: ${[...ScanWorkflow.WRITABLE_PROPS].join(', ')}`
						);
					}

					switch (propName) {
						case 'status':
							workflow._status = value as ScanStatus;
							return true;
						case 'locationId':
							workflow._locationId = value as string | null;
							return true;
						case 'locationName':
							workflow._locationName = value as string | null;
							return true;
						case 'locationPath':
							workflow._locationPath = value as string | null;
							return true;
						case 'parentItemId':
							workflow._parentItemId = value as string | null;
							return true;
						case 'parentItemName':
							workflow._parentItemName = value as string | null;
							return true;
						case 'error':
							workflow._error = value as string | null;
							return true;
						case 'analysisProgress':
							workflow.analysisService.progress = value as Progress | null;
							return true;
						default:
							// TypeScript exhaustiveness check - should never reach here
							// since we validated against WRITABLE_PROPS above
							throw new TypeError(`Unhandled writable property: ${prop}`);
					}
				},
				has(_target, prop: string | symbol) {
					if (typeof prop === 'symbol') {
						return false;
					}
					return ScanWorkflow.READABLE_PROPS.has(prop as keyof ScanState);
				},
				ownKeys() {
					return [...ScanWorkflow.READABLE_PROPS];
				},
				getOwnPropertyDescriptor(_target, prop: string | symbol) {
					if (
						typeof prop === 'symbol' ||
						!ScanWorkflow.READABLE_PROPS.has(prop as keyof ScanState)
					) {
						return undefined;
					}
					return {
						enumerable: true,
						configurable: true,
						writable: ScanWorkflow.WRITABLE_PROPS.has(prop as keyof ScanState),
					};
				},
			});
		}
		return this._stateProxy;
	}

	// =========================================================================
	// LOCATION ACTIONS
	// =========================================================================

	/** Set the selected location (clears parent item since items are location-specific) */
	setLocation(id: string, name: string, path: string): void {
		this._captureRevision++;
		// If changing to a different location, clear parent item
		if (this._locationId !== id) {
			this._parentItemId = null;
			this._parentItemName = null;
		}
		this._locationId = id;
		this._locationName = name;
		this._locationPath = path;
		this._status = 'capturing';
		this._error = null;
		this.persistCaptureContext();
	}

	/** Clear location selection (also clears parent item since it's location-specific) */
	clearLocation(): void {
		this._captureRevision++;
		this._locationId = null;
		this._locationName = null;
		this._locationPath = null;
		this._parentItemId = null;
		this._parentItemName = null;
		this._status = 'location';
		this.clearCaptureContext();
	}

	/** Set the parent item (for sub-item relationships) */
	setParentItem(id: string, name: string): void {
		this._captureRevision++;
		this._parentItemId = id;
		this._parentItemName = name;
		this.persistCaptureContext();
	}

	/** Clear parent item selection */
	clearParentItem(): void {
		this._captureRevision++;
		this._parentItemId = null;
		this._parentItemName = null;
		this.persistCaptureContext();
	}

	// =========================================================================
	// IMAGE CAPTURE ACTIONS (delegated to CaptureService)
	// =========================================================================

	/** Add a captured image */
	addImage(image: CapturedImage): void {
		if (this._status !== 'capturing') return;
		this._captureRevision++;
		this.captureService.addImage(image);
	}

	/** Remove an image by index */
	removeImage(index: number): void {
		if (this._status !== 'capturing') return;
		this._captureRevision++;
		this.captureService.removeImage(index);
	}

	/** Update image options (separateItems, extraInstructions, assetId) */
	updateImageOptions(
		index: number,
		options: Partial<Pick<CapturedImage, 'separateItems' | 'extraInstructions' | 'assetId'>>
	): void {
		if (this._status !== 'capturing') return;
		this._captureRevision++;
		this.captureService.updateImageOptions(index, options);
	}

	/** Add additional images to a captured image */
	addAdditionalImages(imageIndex: number, files: File[], dataUrls: string[]): void {
		if (this._status !== 'capturing') return;
		this._captureRevision++;
		this.captureService.addAdditionalImages(imageIndex, files, dataUrls);
	}

	/** Remove an additional image */
	removeAdditionalImage(imageIndex: number, additionalIndex: number): void {
		if (this._status !== 'capturing') return;
		this._captureRevision++;
		this.captureService.removeAdditionalImage(imageIndex, additionalIndex);
	}

	/** Clear all captured images */
	clearImages(): void {
		if (this._status !== 'capturing') return;
		this._captureRevision++;
		this.captureService.clear();
	}

	// =========================================================================
	// ANALYSIS (delegated to AnalysisService)
	// =========================================================================

	/** Start image analysis - coordinates with AnalysisService */
	async startAnalysis(): Promise<void> {
		const flowStartedAt = performance.now();
		log.info('[ANALYZE TIMING] ScanWorkflow.startAnalysis() started');

		// Prevent starting a new analysis if one is already in progress
		if (this._status === 'analyzing') {
			log.warn('Analysis already in progress (status check), ignoring duplicate request');
			this._error = 'Analysis already in progress';
			return;
		}

		if (!this.captureService.hasImages) {
			log.warn('No images to analyze, returning early');
			this._error = 'Please add at least one image';
			return;
		}

		log.info(`Starting analysis for ${this.captureService.count} image(s)`);
		const expectedImages = this.captureService.images;
		const expectedLocationId = this._locationId;
		const expectedCaptureRevision = this._captureRevision;
		this.cancelScheduledPersist();

		const persistenceStartedAt = performance.now();
		const needsCapturePersist = this._persistedCaptureRevision !== expectedCaptureRevision;
		if (needsCapturePersist || this._persistPromise) {
			// Save while still in a persistable state. The auto-save is debounced, so a
			// fast click on Analyze can otherwise cancel the only pending image save.
			log.debug(
				`[ANALYZE TIMING] pre-analysis persist started (status=${this._status}) | t=${((performance.now() - flowStartedAt) / 1000).toFixed(2)}s`
			);
			if (!(await this.persistAsync())) {
				this._error = 'Could not save this scan. Free storage space and try again.';
				return;
			}
			log.info(
				`[ANALYSIS STARTUP] Capture persistence ready | duration=${((performance.now() - persistenceStartedAt) / 1000).toFixed(2)}s | mode=${needsCapturePersist ? 'saved' : 'waited'}`
			);
		} else {
			log.info('[ANALYSIS STARTUP] Capture persistence already current | duration=0.00s');
		}
		if (
			this._status !== 'capturing' ||
			this._locationId !== expectedLocationId ||
			this._captureRevision !== expectedCaptureRevision ||
			this.captureService.images !== expectedImages
		) {
			log.warn('Capture state changed while preparing analysis, aborting');
			return;
		}

		this._status = 'analyzing';
		this._error = null;
		log.debug(
			`[ANALYZE TIMING] status -> "analyzing" (Cancel button should now show) | t=${((performance.now() - flowStartedAt) / 1000).toFixed(2)}s`
		);

		const analyzeStartedAt = performance.now();
		const result = await this.analysisService.analyze(this.captureService.images);
		log.info(
			`[ANALYZE TIMING] analysisService.analyze() ended | duration=${((performance.now() - analyzeStartedAt) / 1000).toFixed(2)}s | success=${result.success}`
		);

		// Check if cancelled (status may have changed)
		if (this._status !== 'analyzing') {
			log.debug('Analysis was cancelled or status changed during processing');
			return;
		}

		if (result.success) {
			this.reviewService.setDetectedItems(result.items);

			// Check if there were partial failures
			if (result.failedCount > 0) {
				this._status = 'partial_analysis';
				log.warn(
					`Analysis complete with partial failures: ${result.items.length} items detected, ${result.failedCount} image(s) failed`
				);
			} else {
				this._status = 'reviewing';
				log.info(
					`[ANALYZE TIMING] status -> "reviewing" (Cancel button should now hide) | t=${((performance.now() - flowStartedAt) / 1000).toFixed(2)}s | ${result.items.length} item(s) detected`
				);
			}
		} else {
			this._error = result.error || 'Analysis failed';
			this._status = 'capturing';
			log.error(`Analysis failed: ${this._error}, returning to capture mode`);
		}

		// Persist after analysis completes (success or partial)
		// IMPORTANT: Await persist to ensure data is saved before user can close tab
		if (this._status !== 'capturing') {
			const postPersistStartedAt = performance.now();
			log.debug(
				`[ANALYZE TIMING] post-analysis persist started (status=${this._status}) | t=${((performance.now() - flowStartedAt) / 1000).toFixed(2)}s`
			);
			if (!(await this.persistAsync())) {
				this._status = 'capturing';
				this._error = 'Analysis completed but could not be saved. Free storage space and retry.';
			}
			log.info(
				`[ANALYZE TIMING] post-analysis persist ended | duration=${((performance.now() - postPersistStartedAt) / 1000).toFixed(2)}s`
			);
		}

		log.info(
			`[ANALYZE TIMING] ScanWorkflow.startAnalysis() ended | total=${((performance.now() - flowStartedAt) / 1000).toFixed(2)}s | status=${this._status}`
		);
	}

	/** Retry analysis for failed images only */
	async retryFailedAnalysis(): Promise<void> {
		log.info('ScanWorkflow.retryFailedAnalysis() called');

		if (this._status !== 'partial_analysis') {
			log.warn('Not in partial_analysis state, ignoring retry request');
			return;
		}

		if (!this.analysisService.hasFailedImages()) {
			log.warn('No failed images to retry');
			await this.continueWithSuccessful();
			return;
		}

		log.info(`Retrying ${this.analysisService.failedCount} failed image(s)`);
		this.cancelScheduledPersist();
		const activePersist = this._persistPromise;
		this._status = 'analyzing';
		this._error = null;
		if (activePersist) {
			await activePersist;
			if (this._status !== 'analyzing') return;
		}

		// Get existing items
		const existingItems = this.reviewService.detectedItems;

		// Retry failed images
		const result = await this.analysisService.retryFailed(
			this.captureService.images,
			existingItems
		);

		// Check if cancelled (status may have changed)
		if (this._status !== 'analyzing') {
			log.debug('Retry was cancelled or status changed during processing');
			return;
		}

		if (result.success) {
			this.reviewService.setDetectedItems(result.items);

			// Check if there are still failures
			if (result.failedCount > 0) {
				this._status = 'partial_analysis';
				log.warn(
					`Retry complete with remaining failures: ${result.items.length} total items, ${result.failedCount} image(s) still failed`
				);
			} else {
				this._status = 'reviewing';
				log.info(
					`Retry complete! All images successfully analyzed, ${result.items.length} total item(s)`
				);
			}
		} else {
			// If retry completely failed, go back to partial_analysis state
			this._error = result.error || 'Retry failed';
			this._status = 'partial_analysis';
			log.error(`Retry failed: ${this._error}`);
		}

		// Persist after retry completes
		// IMPORTANT: Await persist to ensure data is saved before user can close tab
		if (!(await this.persistAsync())) {
			this._status = 'capturing';
			this._error = 'Analysis completed but could not be saved. Free storage space and retry.';
		}
	}

	/** Continue to review with only successfully analyzed items */
	async continueWithSuccessful(): Promise<void> {
		log.info('ScanWorkflow.continueWithSuccessful() called');

		if (this._status !== 'partial_analysis') {
			log.warn('Not in partial_analysis state, ignoring continue request');
			return;
		}

		const itemCount = this.reviewService.detectedItems.length;
		if (itemCount === 0) {
			log.warn('No items to review, returning to capture');
			this._error = 'No items were successfully detected';
			this._status = 'capturing';
			return;
		}

		log.info(`Continuing with ${itemCount} successfully detected item(s)`);
		this._status = 'reviewing';
		this._error = null;

		// Persist immediately after transitioning to reviewing state
		if (!(await this.persistAsync())) {
			this._status = 'partial_analysis';
			this._error = 'Could not save this scan. Free storage space and try again.';
		}
	}

	/** Remove failed images and continue with successful ones */
	async removeFailedImages(): Promise<void> {
		log.info('ScanWorkflow.removeFailedImages() called');

		if (this._status !== 'partial_analysis') {
			log.warn('Not in partial_analysis state, ignoring remove request');
			return;
		}

		const failedIndices = this.analysisService.getFailedIndices();
		if (failedIndices.length === 0) {
			log.warn('No failed images to remove');
			await this.continueWithSuccessful();
			return;
		}

		log.info(`Removing ${failedIndices.length} failed image(s)`);

		// Update sourceImageIndex on detected items before removing images
		// This adjusts indices so they point to the correct images after removal
		this.reviewService.updateSourceImageIndices(failedIndices);

		// Remove images in reverse order to preserve indices during removal
		for (let i = failedIndices.length - 1; i >= 0; i--) {
			const index = failedIndices[i];
			this.captureService.removeImage(index);
		}

		// Re-index imageStatuses to match new image array positions
		const oldStatuses = this.analysisService.imageStatuses;
		const newStatuses: Record<number, (typeof oldStatuses)[number]> = {};

		// Build mapping: for each old index, calculate new index after removals
		const sortedRemovedIndices = [...failedIndices].sort((a, b) => a - b);
		for (const [oldIndexStr, status] of Object.entries(oldStatuses)) {
			const oldIndex = parseInt(oldIndexStr, 10);

			// Skip failed indices (they're being removed)
			if (sortedRemovedIndices.includes(oldIndex)) continue;

			// Calculate new index: subtract count of removed indices below this one
			let newIndex = oldIndex;
			for (const removed of sortedRemovedIndices) {
				if (removed < oldIndex) {
					newIndex--;
				}
			}
			newStatuses[newIndex] = status;
		}
		this.analysisService.imageStatuses = newStatuses;

		log.info(`Removed ${failedIndices.length} failed image(s), continuing with successful items`);
		await this.continueWithSuccessful();
	}

	/** Cancel ongoing analysis */
	async cancelAnalysis(): Promise<void> {
		log.info(
			`ScanWorkflow.cancelAnalysis() called: status=${this._status}, images=${this.captureService.count}`
		);
		this.analysisService.cancel('user');
		if (this._status === 'analyzing') {
			// If we had some successful items before cancellation, go to partial_analysis
			// Otherwise go back to capturing
			if (this.reviewService.detectedItems.length > 0) {
				this._status = 'partial_analysis';
			} else {
				this._status = 'capturing';
			}
			this.analysisService.clearProgress(this._status === 'partial_analysis');

			// Persist after cancellation to save the current state
			await this.persistAsync();
		}
	}

	/** Clear analysis progress (called when animation completes) */
	clearAnalysisProgress(): void {
		this.analysisService.clearProgress();
	}

	/** Check if analysis is in progress */
	get isAnalyzing(): boolean {
		return this._status === 'analyzing';
	}

	// =========================================================================
	// REVIEW ACTIONS (delegated to ReviewService)
	// =========================================================================

	/** Get current item being reviewed */
	get currentItem(): ReviewItem | null {
		return this.reviewService.currentItem;
	}

	/** Update the current item being reviewed */
	updateCurrentItem(updates: Partial<ReviewItem>): void {
		this.reviewService.updateCurrentItem(updates);
	}

	/** Navigate to previous item */
	previousItem(): void {
		this.reviewService.previousItem();
	}

	/** Navigate to next item */
	nextItem(): void {
		this.reviewService.nextItem();
	}

	/** Skip current item and move to next */
	async skipItem(): Promise<void> {
		const result = this.reviewService.skipCurrentItem();
		if (result === 'empty') {
			await this.backToCapture();
		} else if (result === 'complete') {
			await this.finishReview();
		}
	}

	/** Confirm current item and move to next */
	async confirmItem(item: ReviewItem): Promise<void> {
		if (this.failedItemEditIndex !== null) {
			const editIndex = this.failedItemEditIndex;
			if (this.reviewService.replaceConfirmedItem(editIndex, item)) {
				this.failedItemEditIndex = null;
				this._status = 'confirming';
				await this.persistAsync();
			}
			return;
		}

		const hasMore = this.reviewService.confirmCurrentItem(item);
		if (!hasMore) {
			await this.finishReview();
		}
	}

	/** Confirm all remaining items from current index onwards */
	async confirmAllRemainingItems(currentItemOverride?: ReviewItem): Promise<number> {
		const count = this.reviewService.confirmAllRemainingItems(currentItemOverride);
		await this.finishReview();
		return count;
	}

	/** Finish review and move to confirmation */
	async finishReview(): Promise<void> {
		if (!this.reviewService.hasConfirmedItems) {
			this._error = 'Please confirm at least one item';
			return;
		}
		if (!(await this.persistAsync())) {
			this._error = 'Could not save this scan. Free storage space and try again.';
			return;
		}
		this._status = 'confirming';

		// Persist after moving to confirmation state
		if (!(await this.persistAsync())) {
			this._status = 'reviewing';
			this._error = 'Could not save this scan. Free storage space and try again.';
		}
	}

	/** Return to capture mode from review */
	async backToCapture(): Promise<void> {
		this._status = 'capturing';
		this.reviewService.reset();
		this._error = null;

		// Persist the state change
		await this.persistAsync();
	}

	// =========================================================================
	// CONFIRMATION ACTIONS (delegated to ReviewService)
	// =========================================================================

	/** Remove a confirmed item */
	async removeConfirmedItem(index: number): Promise<void> {
		this.reviewService.removeConfirmedItem(index);
		if (!this.reviewService.hasConfirmedItems) {
			this._status = 'capturing';
		}

		// Persist after removal
		await this.persistAsync();
	}

	/** Edit a confirmed item (move back to review) */
	async editConfirmedItem(index: number): Promise<void> {
		const item = this.reviewService.editConfirmedItem(index);
		if (item) {
			this._status = 'reviewing';

			// Persist the state change
			await this.persistAsync();
		}
	}

	/** Open one failed submission in the existing item editor without changing list indexes. */
	async editFailedItem(index: number): Promise<void> {
		if (this.submissionService.itemStatuses[index] !== 'failed') return;

		const item = this.reviewService.stageConfirmedItemForEdit(index);
		if (!item) return;

		// The focused edit is ephemeral. Keep the last persisted summary as the
		// reload recovery point and prevent an already scheduled autosave from
		// writing the staged review state.
		if (this._persistTimeout) {
			clearTimeout(this._persistTimeout);
			this._persistTimeout = null;
		}
		this.failedItemEditIndex = index;
		this._status = 'reviewing';
	}

	/** Cancel a failed-item edit and return to the unchanged submission summary. */
	async cancelFailedItemEdit(): Promise<void> {
		if (this.failedItemEditIndex === null) return;

		this.failedItemEditIndex = null;
		this._status = 'confirming';
		await this.persistAsync();
	}

	/** Whether review is currently editing an item that failed submission. */
	get isEditingFailedItem(): boolean {
		return this.failedItemEditIndex !== null;
	}

	// =========================================================================
	// SUBMISSION (delegated to SubmissionService)
	// =========================================================================

	/**
	 * Submit all confirmed items to Homebox.
	 * @param options.validateAuth - If true, validate auth token before submitting (default: true)
	 * @returns Object with success, counts, and sessionExpired flag
	 */
	async submitAll(options?: { validateAuth?: boolean }): Promise<{
		success: boolean;
		successCount: number;
		partialSuccessCount: number;
		failCount: number;
		sessionExpired: boolean;
	}> {
		const generation = this.contextGeneration;
		if (!sessionPersistence.captureSessionScope()) {
			throw new Error('Cannot submit without a verified Homebox context and collection');
		}
		const items = this.reviewService.confirmedItems;
		const resumeExisting = this._status === 'submitting';

		if (items.length === 0) {
			this._error = 'No items to submit';
			return {
				success: false,
				successCount: 0,
				partialSuccessCount: 0,
				failCount: 0,
				sessionExpired: false,
			};
		}

		this.cancelScheduledPersist();
		this._status = 'submitting';
		this._error = null;
		// Wait for any in-flight persist before uploading images
		if (this._persistPromise) {
			log.debug('Waiting for active session persistence before submission');
			await this._persistPromise;
			if (this._status !== 'submitting')
				return {
					success: false,
					successCount: 0,
					partialSuccessCount: 0,
					failCount: 0,
					sessionExpired: false,
				};
		}

		const result = await this.submissionService.submitAll(
			items,
			this._locationId,
			this._parentItemId,
			{
				...options,
				resumeExisting,
				onCheckpoint: async () => {
					if (!(await this.persistAsync())) throw new Error('Could not save submission progress');
				},
			}
		);
		if (generation !== this.contextGeneration) return result;

		if (result.sessionExpired) {
			await this.persistAsync();
			return result;
		}

		// Handle results
		if (this.submissionService.hasUncertainItems()) {
			this._error = 'Some item creation results are unknown. Verify them in Homebox.';
			this._status = 'confirming';
		} else if (
			result.failCount > 0 &&
			result.successCount === 0 &&
			result.partialSuccessCount === 0
		) {
			this._error = 'All items failed to create';
			this._status = 'confirming';
		} else if (result.failCount > 0) {
			this._error = `Created ${result.successCount + result.partialSuccessCount} items, ${result.failCount} failed`;
			// Keep status as 'submitting' to show per-item status UI
		} else if (result.partialSuccessCount > 0) {
			this._error = `${result.partialSuccessCount} item(s) created with incomplete details or attachments`;
			this.submissionService.saveResult(items, this._locationName, this._locationId);
			this._status = 'complete';
			await this.clearPersistedSession();
		} else if (result.success) {
			this.submissionService.saveResult(items, this._locationName, this._locationId);
			this._status = 'complete';
			await this.clearPersistedSession();
		}

		if (this._status !== 'complete') await this.persistAsync();
		return result;
	}

	/**
	 * Retry only failed items.
	 * @returns Object with success flag, counts, and sessionExpired flag
	 */
	async retryFailed(): Promise<{
		success: boolean;
		successCount: number;
		partialSuccessCount: number;
		failCount: number;
		sessionExpired: boolean;
	}> {
		const generation = this.contextGeneration;
		if (!sessionPersistence.captureSessionScope()) {
			throw new Error('Cannot submit without a verified Homebox context and collection');
		}
		const items = this.reviewService.confirmedItems;

		if (!this.submissionService.hasFailedItems()) {
			return {
				success: true,
				successCount: 0,
				partialSuccessCount: 0,
				failCount: 0,
				sessionExpired: false,
			};
		}

		this.cancelScheduledPersist();
		this._error = null;
		// Wait for any in-flight persist before uploading images
		if (this._persistPromise) {
			log.debug('Waiting for active session persistence before retry');
			await this._persistPromise;
			if (this._status !== 'submitting')
				return {
					success: false,
					successCount: 0,
					partialSuccessCount: 0,
					failCount: 0,
					sessionExpired: false,
				};
		}

		const result = await this.submissionService.retryFailed(
			items,
			this._locationId,
			this._parentItemId,
			async () => {
				if (!(await this.persistAsync())) throw new Error('Could not save submission progress');
			}
		);
		if (generation !== this.contextGeneration) return result;

		if (result.sessionExpired) {
			await this.persistAsync();
			return result;
		}

		// Check if all items are now successful
		if (this.submissionService.allItemsSuccessful()) {
			this.submissionService.saveResult(items, this._locationName, this._locationId);
			this._status = 'complete';
			await this.clearPersistedSession();
		} else if (result.failCount > 0) {
			this._error = `Retried: ${result.successCount + result.partialSuccessCount} succeeded, ${result.failCount} still failing`;
		}

		if (this._status !== 'complete') await this.persistAsync();
		return result;
	}

	/** Check if there are any failed items */
	hasFailedItems(): boolean {
		return this.submissionService.hasFailedItems();
	}

	/** Check whether recovery found a create request with an unknown outcome. */
	hasUncertainItems(): boolean {
		return this.submissionService.hasUncertainItems();
	}

	hasPendingItems(): boolean {
		return this.submissionService.hasPendingItems();
	}

	hasPartialItems(): boolean {
		return this.submissionService.hasPartialItems();
	}

	/** Finish a partial submission without replaying failed or uncertain requests. */
	async completeWithSuccessfulItems(): Promise<void> {
		this.submissionService.saveResult(
			this.reviewService.confirmedItems,
			this._locationName,
			this._locationId
		);
		this._status = 'complete';
		this._error = null;
		await this.clearPersistedSession();
	}

	/** Check if all items were successfully submitted */
	allItemsSuccessful(): boolean {
		return this.submissionService.allItemsSuccessful();
	}

	// =========================================================================
	// SESSION PERSISTENCE (Crash Recovery)
	// =========================================================================

	/**
	 * Persist current workflow state to IndexedDB and wait for completion.
	 *
	 * Use this when the data MUST be saved before continuing
	 * (e.g., after analysis completes before navigation can occur).
	 */
	async persistAsync(): Promise<boolean> {
		// Don't persist terminal states
		if (this._status === 'idle' || this._status === 'complete') {
			return true;
		}

		// Let effects caused by the state transition that requested this save run
		// first. Their debounce is then cancelled instead of marking this same
		// explicit snapshot dirty and causing a duplicate write.
		await tick();
		this.cancelScheduledPersist();
		try {
			if (this._persistPromise) {
				if (
					this._activePersistCaptureRevision !== null &&
					this._activePersistCaptureRevision !== this._captureRevision
				) {
					this._persistDirty = true;
				}
				await this._persistPromise;
			} else {
				await this.runPersist();
			}
			// A state change while the first save was running can queue a dirty
			// follow-up. Drain the entire chain before image upload may begin.
			while (this._persistPromise) {
				await this._persistPromise;
			}
		} finally {
			// State changes during the explicit save may have scheduled a duplicate write.
			this.cancelScheduledPersist();
		}
		return this._lastPersistSucceeded;
	}

	/**
	 * Internal persist implementation - serializes and saves to IndexedDB.
	 */
	private async _doPersist(): Promise<void> {
		log.debug('_doPersist: Starting session persistence...');
		const scope = sessionPersistence.captureSessionScope();
		const generation = this.contextGeneration;
		if (!scope) return;
		const persistGeneration = this._persistGeneration;
		const captureRevision = this._captureRevision;
		this._activePersistCaptureRevision = captureRevision;
		this._lastPersistSucceeded = false;

		try {
			// Step 1: Serialize images (convert File objects to base64)
			log.debug(`_doPersist: Serializing ${this.captureService.images.length} image(s)...`);
			const images = await Promise.all(this.captureService.images.map(serializeImage));
			log.debug(`_doPersist: Images serialized successfully`);

			// Step 2: Serialize review items (strip File references)
			// Use JSON.parse/stringify to deep-unwrap any Svelte 5 $state proxies
			// that might remain after serialization (proxies are not cloneable by IndexedDB)
			log.debug(
				`_doPersist: Serializing ${this.reviewService.detectedItems.length} detected, ${this.reviewService.confirmedItems.length} confirmed items...`
			);
			const detectedItems = this.reviewService.detectedItems.map((item) =>
				unwrapStoredReviewItem(
					serializeReviewItem(item, this.captureService.images[item.sourceImageIndex])
				)
			);
			const confirmedItems = this.reviewService.confirmedItems.map(
				(item) =>
					unwrapStoredReviewItem(
						serializeConfirmedItem(item, this.captureService.images[item.sourceImageIndex])
					) as ReturnType<typeof serializeConfirmedItem>
			);
			log.debug('_doPersist: Review items serialized successfully');

			// Step 3: Generate or reuse session metadata
			const now = Date.now();
			if (this._persistedCreatedAt === null) {
				this._persistedCreatedAt = now;
			}
			if (this._persistedSessionId === null) {
				this._persistedSessionId = createUuid();
				log.info(`New session created: ${this._persistedSessionId}`);
			}

			// Step 4: Deep-unwrap imageStatuses to ensure no proxies remain
			log.debug(
				`_doPersist: Unwrapping imageStatuses with ${Object.keys(this.analysisService.imageStatuses).length} entries...`
			);
			const imageStatuses = JSON.parse(JSON.stringify(this.analysisService.imageStatuses));
			log.debug('_doPersist: imageStatuses unwrapped successfully');

			// Step 5: Build session object
			const session: StoredSession = {
				id: this._persistedSessionId,
				createdAt: this._persistedCreatedAt,
				updatedAt: now,
				status: this._status,
				locationId: this._locationId,
				locationName: this._locationName,
				locationPath: this._locationPath,
				parentItemId: this._parentItemId,
				parentItemName: this._parentItemName,
				images,
				detectedItems,
				confirmedItems,
				currentReviewIndex: this.reviewService.currentReviewIndex,
				imageStatuses,
				submission: this.submissionService.snapshot(),
			};
			if (persistGeneration !== this._persistGeneration) {
				log.debug('Skipping stale session persistence after workflow reset');
				return;
			}
			log.debug('_doPersist: Session object built, saving to IndexedDB...');

			// Step 6: Save to IndexedDB
			if (generation !== this.contextGeneration) {
				log.debug('_doPersist: Context changed during serialization, discarding stale write');
				return;
			}
			const saved = await sessionPersistence.save(session, scope);
			if (saved && persistGeneration === this._persistGeneration) {
				this._lastPersistSucceeded = true;
				this._persistedCaptureRevision = captureRevision;
				log.debug(
					`_doPersist: SUCCESS - status=${this._status}, images=${images.length}, detected=${detectedItems.length}, confirmed=${confirmedItems.length}`
				);
			} else if (!saved) {
				log.warn('_doPersist: IndexedDB save did not complete successfully');
			}
		} catch (error) {
			// Non-critical - log but don't disrupt workflow
			// Extract meaningful error info for logging (avoids minified stack traces)
			const errorMessage = error instanceof Error ? error.message : String(error);
			const errorName = error instanceof Error ? error.name : 'Unknown';
			const errorStack = error instanceof Error ? error.stack : undefined;
			log.error(`_doPersist: FAILED - [${errorName}] ${errorMessage}`);
			if (errorStack) {
				log.debug(`_doPersist: Stack trace: ${errorStack}`);
			}
		} finally {
			this._activePersistCaptureRevision = null;
		}
	}

	/**
	 * Recover workflow state from IndexedDB.
	 * Returns true if recovery was successful.
	 */
	async recover(): Promise<boolean> {
		if (this._recoverPromise) return this._recoverPromise;
		this._recoverPromise = this.recoverOnce().finally(() => {
			this._recoverPromise = null;
		});
		return this._recoverPromise;
	}

	private async recoverOnce(): Promise<boolean> {
		const scope = sessionPersistence.captureSessionScope();
		const generation = this.contextGeneration;
		if (!scope) return false;
		try {
			const session = await sessionPersistence.load(scope);
			if (!session) {
				return this.recoverCaptureContext();
			}
			if (generation !== this.contextGeneration) return false;

			log.info(`Recovering session: status=${session.status}, images=${session.images.length}`);

			// Restore location state
			this._locationId = session.locationId;
			this._locationName = session.locationName;
			this._locationPath = session.locationPath;
			this._parentItemId = session.parentItemId;
			this._parentItemName = session.parentItemName;

			// Deserialize images (convert base64 back to File objects)
			const images = await Promise.all(session.images.map(deserializeImage));
			if (generation !== this.contextGeneration) return false;
			this.captureService.clear();
			this.captureService.images = images;

			// Deserialize review items
			if (session.detectedItems.length > 0) {
				const detectedItems = await Promise.all(
					session.detectedItems.map((item) => deserializeReviewItem(item, images))
				);
				if (generation !== this.contextGeneration) return false;
				this.reviewService.setDetectedItems(detectedItems);
			}

			if (session.confirmedItems.length > 0) {
				const confirmedItems = await Promise.all(
					session.confirmedItems.map((item) => deserializeConfirmedItem(item, images))
				);
				if (generation !== this.contextGeneration) return false;
				// Restore confirmed items directly (not via confirmCurrentItem which affects navigation)
				this.reviewService.setConfirmedItems(confirmedItems);
			}

			// Restore review index
			if (session.currentReviewIndex > 0) {
				this.reviewService.setCurrentReviewIndex(session.currentReviewIndex);
			}

			// Restore image statuses (for partial_analysis recovery)
			if (session.imageStatuses) {
				this.analysisService.imageStatuses = session.imageStatuses;
			}

			// Restore status - handle mid-analysis state
			if (session.submission) this.submissionService.restore(session.submission);

			if (session.status === 'analyzing') {
				// If crashed during analysis, go back to capturing
				this._status = 'capturing';
			} else if (session.status === 'submitting') {
				// No request is running after recovery. Show the saved row outcomes.
				this._status = 'confirming';
			} else {
				this._status = session.status;
			}

			this._error = null;

			// Cache timestamps and ID for future persist() calls
			this._persistedCreatedAt = session.createdAt;
			this._persistedSessionId = session.id;
			this._persistedCaptureRevision = this._captureRevision;

			log.info('Session recovered successfully');
			return true;
		} catch (error) {
			// Extract meaningful error info for logging (avoids minified stack traces)
			const errorMessage = error instanceof Error ? error.message : String(error);
			const errorName = error instanceof Error ? error.name : 'Unknown';
			log.error(`Failed to recover session: [${errorName}] ${errorMessage}`);
			// Clear corrupted session
			await this.clearPersistedSession();
			return this.recoverCaptureContext();
		}
	}

	/** Save enough state synchronously to survive mobile camera page recreation. */
	private persistCaptureContext(): void {
		if (
			typeof localStorage === 'undefined' ||
			!this._locationId ||
			!this._locationName ||
			this._locationPath === null
		) {
			return;
		}

		const context: CaptureContext = {
			updatedAt: Date.now(),
			locationId: this._locationId,
			locationName: this._locationName,
			locationPath: this._locationPath,
			parentItemId: this._parentItemId,
			parentItemName: this._parentItemName,
		};

		try {
			localStorage.setItem(CAPTURE_CONTEXT_KEY, JSON.stringify(context));
		} catch (error) {
			log.warn('Failed to persist capture context', error);
		}
	}

	/** Restore location context when full IndexedDB session recovery is unavailable. */
	private recoverCaptureContext(): boolean {
		if (typeof localStorage === 'undefined') return false;

		try {
			const stored = localStorage.getItem(CAPTURE_CONTEXT_KEY);
			if (!stored) return false;

			const context = JSON.parse(stored) as CaptureContext;
			if (
				!context.locationId ||
				!context.locationName ||
				typeof context.locationPath !== 'string' ||
				!Number.isFinite(context.updatedAt) ||
				Date.now() - context.updatedAt > CAPTURE_CONTEXT_TTL_MS
			) {
				this.clearCaptureContext();
				return false;
			}

			this._locationId = context.locationId;
			this._locationName = context.locationName;
			this._locationPath = context.locationPath;
			this._parentItemId = context.parentItemId ?? null;
			this._parentItemName = context.parentItemName ?? null;
			this._status = 'capturing';
			this._error = null;
			log.info('Recovered capture location from lightweight context');
			return true;
		} catch (error) {
			log.warn('Failed to recover capture context', error);
			this.clearCaptureContext();
			return false;
		}
	}

	private clearCaptureContext(): void {
		if (typeof localStorage === 'undefined') return;

		try {
			localStorage.removeItem(CAPTURE_CONTEXT_KEY);
		} catch (error) {
			log.warn('Failed to clear capture context', error);
		}
	}

	/**
	 * Check if a recoverable session exists.
	 */
	async hasRecoverableSession(): Promise<boolean> {
		return sessionPersistence.hasRecoverableSession();
	}

	/**
	 * Get summary of recoverable session for UI display.
	 */
	async getRecoverySummary(): Promise<sessionPersistence.SessionSummary | null> {
		return sessionPersistence.getSessionSummary();
	}

	/**
	 * Clear the persisted session from IndexedDB.
	 */
	async clearPersistedSession(): Promise<void> {
		const scope = sessionPersistence.captureSessionScope();
		if (scope) await sessionPersistence.clear(scope);
	}

	/** Discard every recovery source, including the lightweight camera context. */
	async discardRecovery(): Promise<void> {
		await this.clearPersistedSession();
		this.clearCaptureContext();
	}

	// =========================================================================
	// RESET
	// =========================================================================

	/** Reset workflow to initial state */
	reset(clearPersisted = true): void {
		const scope = sessionPersistence.captureSessionScope();
		this.contextGeneration++;
		// Cancel any pending debounced persist to prevent stale writes after reset
		this.cancelScheduledPersist();
		// Do not call cancelAnalysis() here: that method intentionally persists the
		// cancellation state, while reset must invalidate and discard this session.
		this._persistGeneration++;
		this.analysisService.cancel('workflow-reset');
		this.analysisService.clearProgress();
		this._persistDirty = false;
		this.captureService.clear();
		this.reviewService.reset();
		this.submissionService.reset();
		this.failedItemEditIndex = null;
		this._status = 'idle';
		this._locationId = null;
		this._locationName = null;
		this._locationPath = null;
		this._parentItemId = null;
		this._parentItemName = null;
		this._error = null;
		this._persistedCreatedAt = null; // Reset for next session
		this._persistedSessionId = null; // Reset for next session
		this._persistedCaptureRevision = -1;
		this._activePersistCaptureRevision = null;
		this.clearCaptureContext();
		if (clearPersisted && scope) void sessionPersistence.clear(scope);
	}

	/** Drop in-memory work when changing collection while preserving the old scoped draft. */
	switchContext(): void {
		this.reset(false);
	}

	/** Start a new scan (keeps location and parent item if set) */
	startNew(): void {
		const locationId = this._locationId;
		const locationName = this._locationName;
		const locationPath = this._locationPath;
		const parentItemId = this._parentItemId;
		const parentItemName = this._parentItemName;

		this.reset();

		if (locationId && locationName && locationPath) {
			this._locationId = locationId;
			this._locationName = locationName;
			this._locationPath = locationPath;
			this._parentItemId = parentItemId;
			this._parentItemName = parentItemName;
			this._status = 'capturing';
			this.persistCaptureContext();
		} else {
			this._status = 'location';
		}
	}

	// =========================================================================
	// HELPERS
	// =========================================================================

	/** Clear error */
	clearError(): void {
		this._error = null;
	}

	/** Get source image for a review/confirmed item */
	getSourceImage(item: ReviewItem | ConfirmedItem): CapturedImage | null {
		return this.captureService.getImage(item.sourceImageIndex);
	}

	/** Get last submission result (preserved after workflow completion) */
	get submissionResult(): SubmissionResult | null {
		return this.submissionService.lastResult;
	}
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const scanWorkflow = new ScanWorkflow();
