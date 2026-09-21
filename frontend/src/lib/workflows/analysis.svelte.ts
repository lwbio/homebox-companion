/**
 * AnalysisService - Handles AI detection and analysis operations
 *
 * Responsibilities:
 * - Running AI detection on images
 * - Managing analysis progress
 * - Cancellation support
 * - Default tag loading
 */

import { vision, fieldPreferences } from '$lib/api/index';
import { tagStore } from '$lib/stores/tags.svelte';
import { workflowLogger as log } from '$lib/utils/logger';
import { createUuid } from '$lib/utils/uuid';
import { acquireWakeLock, releaseWakeLock } from '$lib/utils/wakeLock';
import { t } from '$lib/i18n';
import type { CapturedImage, ReviewItem, Progress, ImageAnalysisStatus } from '$lib/types';

// =============================================================================
// CONCURRENCY CONTROL
// =============================================================================

/**
 * Maximum concurrent API requests to prevent overwhelming browser/server.
 * - Browser HTTP/2 multiplexing allows many requests over fewer connections
 * - Backend rate limiter handles 400 req/min with burst capacity
 * - 30 concurrent keeps UI responsive while maximizing throughput
 */
const MAX_CONCURRENT_REQUESTS = 30;

/** How long (ms) to wait before showing a "still working" message to the user. */
const SLOW_NETWORK_THRESHOLD_MS = 15_000;

/**
 * Process items with limited concurrency using a worker pool pattern.
 *
 * Creates N worker "threads" that pull items from a shared queue.
 * Safe in JavaScript because index increment is synchronous before each await.
 *
 * @param items - Array of items to process
 * @param processor - Async function to process each item (may throw to abort all)
 * @param concurrency - Maximum concurrent operations
 * @returns Array of results in original order
 * @throws If any processor throws (other workers will complete their current task)
 */
async function mapWithConcurrency<T, R>(
	items: T[],
	processor: (item: T, index: number) => Promise<R>,
	concurrency: number
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let nextIndex = 0;

	async function worker(): Promise<void> {
		// Each iteration: grab next index synchronously, then await processing
		// This is safe because nextIndex++ completes before any await yields
		while (nextIndex < items.length) {
			const index = nextIndex++;
			results[index] = await processor(items[index], index);
		}
	}

	// Start worker pool (capped at item count for small batches)
	const workerCount = Math.min(concurrency, items.length);
	const workers = Array.from({ length: workerCount }, () => worker());

	await Promise.all(workers);
	return results;
}

// =============================================================================
// TYPES
// =============================================================================

export interface AnalysisResult {
	success: boolean;
	items: ReviewItem[];
	error?: string;
	/** Number of images that failed to process */
	failedCount: number;
}

interface AnalysisOperation {
	controller: AbortController;
	sessionId: string;
	slowNetworkNotified: boolean;
	slowNetworkTimer: ReturnType<typeof setTimeout> | null;
	wakeLockHeld: boolean;
	previousImageStatuses?: Record<number, ImageAnalysisStatus>;
}

// =============================================================================
// ANALYSIS SERVICE CLASS
// =============================================================================

export class AnalysisService {
	/** Progress of current analysis operation */
	progress = $state<Progress | null>(null);

	/** Per-image analysis status for UI feedback */
	imageStatuses = $state<Record<number, ImageAnalysisStatus>>({});

	/** Identity and resources owned by the current analyze() call. */
	private activeOperation: AnalysisOperation | null = null;

	/** Cache for default tag (loaded once per session) */
	private defaultTagId: string | null = null;
	private defaultTagLoaded = false;

	// =========================================================================
	// ANALYSIS OPERATIONS
	// =========================================================================

	/** Load default tag ID if not already loaded */
	async loadDefaultTag(signal?: AbortSignal): Promise<void> {
		if (this.defaultTagLoaded) {
			log.debug('[ANALYSIS TIMING] loadDefaultTag: already loaded, skipping');
			return;
		}
		const startedAt = performance.now();
		try {
			const prefs = await fieldPreferences.get();
			this.throwIfAborted(signal);
			log.info(
				`[ANALYSIS TIMING] loadDefaultTag completed | duration=${((performance.now() - startedAt) / 1000).toFixed(2)}s`
			);
			this.defaultTagId = prefs.default_tag_id;
			this.defaultTagLoaded = true; // Only mark as loaded on success
		} catch (error) {
			if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
			// Silently ignore - will retry on next analysis
			log.warn(
				`[ANALYSIS TIMING] loadDefaultTag failed | duration=${((performance.now() - startedAt) / 1000).toFixed(2)}s`,
				error
			);
		}
	}

	/**
	 * Shared image processing logic used by both analyze() and analyzeSubset().
	 * Processes images with concurrency control and returns detected items.
	 *
	 * @param images - Images to process
	 * @param indexMapper - Function to map subset index to original index (identity for full analysis)
	 * @returns Detected items with proper source indices
	 */
	private async processImages(
		images: CapturedImage[],
		operation: AnalysisOperation,
		indexMapper: (subsetIndex: number) => number = (i) => i
	): Promise<AnalysisResult> {
		const allDetectedItems: ReviewItem[] = [];
		let completedCount = 0;
		const signal = operation.controller.signal;
		const batchStartedAt = performance.now();

		// Process images with limited concurrency to prevent overwhelming browser/server
		log.debug(
			`Processing ${images.length} images with max ${MAX_CONCURRENT_REQUESTS} concurrent requests`
		);

		this.startSlowNetworkTimer(operation, images.length);
		const results = await mapWithConcurrency(
			images,
			async (image, subsetIndex) => {
				const originalIndex = indexMapper(subsetIndex);
				const detectionStartedAt = performance.now();

				// Check if cancelled before starting
				this.ensureActive(operation);

				// Mark this image as analyzing
				this.imageStatuses = { ...this.imageStatuses, [originalIndex]: 'analyzing' };

				try {
					log.debug(
						`Starting detection for image ${originalIndex + 1}: file="${image.file.name}", size=${image.file.size} bytes`
					);
					log.debug(
						`Image ${originalIndex + 1} options: separateItems=${image.separateItems}, additionalImages=${image.additionalFiles?.length ?? 0}`
					);

					const response = await vision.detect(image.file, {
						singleItem: !image.separateItems,
						extraInstructions: image.extraInstructions || undefined,
						extractExtendedFields: true,
						additionalImages: image.additionalFiles,
						signal,
						sessionId: operation.sessionId,
					});
					this.ensureActive(operation);

					log.debug(
						`Detection complete for image ${originalIndex + 1}, found ${response.items.length} item(s)`
					);
					log.info(
						`[VISION TIMING] Image ${originalIndex + 1} detection completed | duration=${((performance.now() - detectionStartedAt) / 1000).toFixed(2)}s | items=${response.items.length}`
					);

					completedCount++;
					this.progress = {
						current: completedCount,
						total: images.length,
						message: this.analyzingMessage(operation, images.length),
					};

					// Mark this image as success
					this.imageStatuses = { ...this.imageStatuses, [originalIndex]: 'success' };

					return {
						success: true as const,
						imageIndex: originalIndex,
						image,
						items: response.items,
						compressedImages: response.compressed_images || [],
					};
				} catch (error) {
					// Re-throw abort errors to be handled at the top level
					if (error instanceof Error && error.name === 'AbortError') {
						log.debug(`Analysis aborted for image ${originalIndex + 1}`);
						log.info(
							`[VISION TIMING] Image ${originalIndex + 1} detection cancelled | duration=${((performance.now() - detectionStartedAt) / 1000).toFixed(2)}s`
						);
						throw error;
					}

					this.ensureActive(operation);
					completedCount++;
					this.progress = {
						current: completedCount,
						total: images.length,
						message: this.analyzingMessage(operation, images.length),
					};

					// Mark this image as failed
					this.imageStatuses = { ...this.imageStatuses, [originalIndex]: 'failed' };

					log.error(`Failed to analyze image ${originalIndex + 1}`, error);
					log.warn(
						`[VISION TIMING] Image ${originalIndex + 1} detection failed | duration=${((performance.now() - detectionStartedAt) / 1000).toFixed(2)}s`
					);
					return {
						success: false as const,
						imageIndex: originalIndex,
						image,
						error: error instanceof Error ? error.message : 'Unknown error',
					};
				}
			},
			MAX_CONCURRENT_REQUESTS
		);
		this.clearSlowNetworkTimer(operation);

		log.debug(`All detections complete. Processing ${results.length} result(s)...`);
		log.info(
			`[VISION TIMING] Detection batch completed | duration=${((performance.now() - batchStartedAt) / 1000).toFixed(2)}s | images=${images.length}`
		);

		// Check if cancelled
		this.ensureActive(operation);

		// Ensure tags are loaded before validation (best effort - not critical for analysis success)
		try {
			await tagStore.fetchTags();
			this.ensureActive(operation);
		} catch (error) {
			if (signal.aborted || !this.isActive(operation)) throw error;
			log.warn('Failed to fetch tags for default tag validation:', error);
			// Continue without default tag validation - analysis results are still valid
		}

		// Validate default tag exists in current Homebox instance
		const currentTags = tagStore.tags;
		const validDefaultTagId =
			this.defaultTagId && currentTags.some((t) => t.id === this.defaultTagId)
				? this.defaultTagId
				: null;

		// Process results
		for (const result of results) {
			if (result.success) {
				// Get compressed images for this result
				const compressedImages = result.compressedImages || [];

				// First compressed image is the primary, rest are additional
				const primaryCompressed = compressedImages[0];
				const additionalCompressed = compressedImages.slice(1);

				for (const item of result.items) {
					// Add default tag if configured and valid
					let tagIds = item.tag_ids ?? [];
					if (validDefaultTagId && !tagIds.includes(validDefaultTagId)) {
						tagIds = [...tagIds, validDefaultTagId];
					}

					// Convert compressed images to data URLs
					const compressedDataUrl = primaryCompressed
						? `data:${primaryCompressed.mime_type};base64,${primaryCompressed.data}`
						: undefined;

					const compressedAdditionalDataUrls = additionalCompressed.map(
						(img) => `data:${img.mime_type};base64,${img.data}`
					);

					allDetectedItems.push({
						...item,
						tag_ids: tagIds,
						sourceImageIndex: result.imageIndex,
						originalFile: result.image.file,
						additionalImages: result.image.additionalFiles || [],
						compressedDataUrl,
						compressedAdditionalDataUrls:
							compressedAdditionalDataUrls.length > 0 ? compressedAdditionalDataUrls : undefined,
						// Copy asset_id from source image (only for single-item mode)
						asset_id:
							!result.image.separateItems && result.items.length === 1
								? (result.image.assetId ?? undefined)
								: undefined,
					});
				}
			}
		}

		// Handle results
		const failedCount = results.filter((r) => !r.success).length;

		if (failedCount === results.length) {
			return {
				success: false,
				items: [],
				error: 'All images failed to analyze. Please try again.',
				failedCount,
			};
		}

		if (allDetectedItems.length === 0) {
			return {
				success: false,
				items: [],
				error: 'No items detected in the images',
				failedCount,
			};
		}

		// Success
		log.debug(`Analysis complete! Detected ${allDetectedItems.length} item(s)`);
		return {
			success: true,
			items: allDetectedItems,
			failedCount,
		};
	}

	/**
	 * Analyze images and detect items using AI
	 * @param images - Array of captured images to analyze
	 * @returns Analysis result with detected items
	 */
	async analyze(images: CapturedImage[]): Promise<AnalysisResult> {
		if (images.length === 0) {
			return { success: false, items: [], error: 'No images to analyze', failedCount: 0 };
		}

		// Prevent starting a new analysis if one is in progress
		if (this.activeOperation) {
			log.warn('Analysis already in progress, ignoring duplicate request');
			return { success: false, items: [], error: 'Analysis already in progress', failedCount: 0 };
		}

		log.debug(`Starting analysis for ${images.length} image(s)`);
		const analyzeStartedAt = performance.now();

		// Initialize analysis state
		const operation: AnalysisOperation = {
			controller: new AbortController(),
			sessionId: createUuid(),
			slowNetworkNotified: false,
			slowNetworkTimer: null,
			wakeLockHeld: false,
		};
		this.activeOperation = operation;
		this.progress = {
			current: 0,
			total: images.length,
			message: 'Loading preferences...',
		};

		// Keep the screen awake during detection so mobile OS throttling does
		// not delay the pending vision request (see wakeLock.ts).
		try {
			const wakeLockStartedAt = performance.now();
			operation.wakeLockHeld = true;
			await acquireWakeLock();
			this.ensureActive(operation);
			log.debug(
				`[ANALYZE TIMING] wake lock acquired | duration=${((performance.now() - wakeLockStartedAt) / 1000).toFixed(2)}s`
			);

			const initialStatuses: Record<number, ImageAnalysisStatus> = {};
			for (let i = 0; i < images.length; i++) initialStatuses[i] = 'pending';
			this.imageStatuses = initialStatuses;
			log.debug(
				`[ANALYZE TIMING] imageStatuses initialized to pending | t=${((performance.now() - analyzeStartedAt) / 1000).toFixed(2)}s`
			);

			// Load default tag first
			await this.loadDefaultTag(operation.controller.signal);
			this.ensureActive(operation);

			// Update progress message
			this.progress = {
				current: 0,
				total: images.length,
				message: this.analyzingMessage(operation, images.length),
			};

			// Process all images (identity mapping: index -> index)
			const processStartedAt = performance.now();
			const result = await this.processImages(images, operation);
			log.info(
				`[ANALYZE TIMING] processImages() ended | duration=${((performance.now() - processStartedAt) / 1000).toFixed(2)}s | success=${result.success} | items=${result.items.length}`
			);
			return result;
		} catch (error) {
			// Don't set error if cancelled
			if (
				operation.controller.signal.aborted ||
				(error instanceof Error && error.name === 'AbortError')
			) {
				log.debug('Analysis cancelled by user');
				return { success: false, items: [], error: 'Analysis cancelled', failedCount: 0 };
			}

			log.error('Analysis failed', error);
			return {
				success: false,
				items: [],
				error: error instanceof Error ? error.message : 'Analysis failed',
				failedCount: 0,
			};
		} finally {
			if (this.isActive(operation)) this.activeOperation = null;
			this.clearSlowNetworkTimer(operation);
			if (operation.wakeLockHeld) void releaseWakeLock();
			log.debug(
				`[ANALYZE TIMING] analyze() finally (wake lock released) | total=${((performance.now() - analyzeStartedAt) / 1000).toFixed(2)}s`
			);
		}
	}

	/** Cancel ongoing analysis */
	cancel(reason = 'unspecified'): void {
		const operation = this.activeOperation;
		log.info(
			`Analysis cancellation requested: reason=${reason}, active=${operation !== null}, session=${operation?.sessionId ?? 'none'}`
		);
		if (!operation) return;
		if (operation.previousImageStatuses) {
			this.imageStatuses = operation.previousImageStatuses;
		}
		this.activeOperation = null;
		operation.controller.abort();
		this.clearSlowNetworkTimer(operation);
		// Also tell the backend to cancel its LLM call for this session (best-effort)
		vision.cancel(operation.sessionId).catch(() => {});
	}

	/** Clear progress state */
	clearProgress(preserveImageStatuses = false): void {
		this.progress = null;
		if (!preserveImageStatuses) this.imageStatuses = {};
	}

	/** Start the slow-network hint timer for a detection batch. */
	private startSlowNetworkTimer(operation: AnalysisOperation, imageCount: number): void {
		operation.slowNetworkNotified = false;
		if (operation.slowNetworkTimer) {
			clearTimeout(operation.slowNetworkTimer);
			operation.slowNetworkTimer = null;
		}
		operation.slowNetworkTimer = setTimeout(() => {
			operation.slowNetworkTimer = null;
			if (this.isActive(operation) && !operation.controller.signal.aborted) {
				operation.slowNetworkNotified = true;
				this.progress = {
					current: this.progress?.current ?? 0,
					total: imageCount,
					message: t('capture.stillWorking'),
				};
			}
		}, SLOW_NETWORK_THRESHOLD_MS);
	}

	/** Cancel the slow-network hint timer. */
	private clearSlowNetworkTimer(operation: AnalysisOperation): void {
		if (operation.slowNetworkTimer) {
			clearTimeout(operation.slowNetworkTimer);
			operation.slowNetworkTimer = null;
		}
	}

	/** Current progress message, honoring the slow-network hint once shown. */
	private analyzingMessage(operation: AnalysisOperation, imageCount: number): string {
		if (operation.slowNetworkNotified) return t('capture.stillWorking');
		return imageCount === 1 ? 'Analyzing item...' : 'Analyzing items...';
	}

	/**
	 * Retry analysis for failed images only
	 * @param images - All captured images
	 * @param existingItems - Items already detected successfully
	 * @returns Combined result with both existing and newly detected items
	 */
	async retryFailed(images: CapturedImage[], existingItems: ReviewItem[]): Promise<AnalysisResult> {
		const failedIndices = this.getFailedIndices();

		if (failedIndices.length === 0) {
			log.debug('No failed images to retry');
			return {
				success: true,
				items: existingItems,
				failedCount: 0,
			};
		}

		log.info(`Retrying analysis for ${failedIndices.length} failed image(s)`);

		// Analyze only failed images
		const failedImages = failedIndices.map((idx) => images[idx]);
		const result = await this.analyzeSubset(failedImages, failedIndices);

		// Merge with existing items
		const allItems = [...existingItems, ...result.items];

		return {
			success: result.success || allItems.length > 0,
			items: allItems,
			error: result.error,
			failedCount: result.failedCount,
		};
	}

	/**
	 * Analyze a subset of images (used for retrying failed images)
	 * @param images - Subset of images to analyze
	 * @param originalIndices - Original indices in the full image array
	 * @returns Analysis result with items mapped to original indices
	 */
	private async analyzeSubset(
		images: CapturedImage[],
		originalIndices: number[]
	): Promise<AnalysisResult> {
		if (images.length === 0) {
			return { success: false, items: [], error: 'No images to analyze', failedCount: 0 };
		}

		// Prevent starting a new analysis if one is in progress
		if (this.activeOperation) {
			log.warn('Analysis already in progress, ignoring duplicate request');
			return { success: false, items: [], error: 'Analysis already in progress', failedCount: 0 };
		}

		log.debug(`Starting subset analysis for ${images.length} image(s)`);

		// Initialize analysis state
		const operation: AnalysisOperation = {
			controller: new AbortController(),
			sessionId: createUuid(),
			slowNetworkNotified: false,
			slowNetworkTimer: null,
			wakeLockHeld: false,
			previousImageStatuses: { ...this.imageStatuses },
		};
		this.activeOperation = operation;
		this.progress = {
			current: 0,
			total: images.length,
			message: 'Loading preferences...',
		};

		try {
			// Keep the screen awake during detection (see analyze()).
			operation.wakeLockHeld = true;
			await acquireWakeLock();
			this.ensureActive(operation);

			const updatedStatuses = { ...this.imageStatuses };
			for (const idx of originalIndices) updatedStatuses[idx] = 'pending';
			this.imageStatuses = updatedStatuses;

			// Load default tag first
			await this.loadDefaultTag(operation.controller.signal);
			this.ensureActive(operation);

			// Update progress message
			this.progress = {
				current: 0,
				total: images.length,
				message: this.analyzingMessage(operation, images.length),
			};

			// Process subset with index mapping (subsetIndex -> originalIndex)
			return await this.processImages(
				images,
				operation,
				(subsetIndex) => originalIndices[subsetIndex]
			);
		} catch (error) {
			// Don't set error if cancelled
			if (
				operation.controller.signal.aborted ||
				(error instanceof Error && error.name === 'AbortError')
			) {
				log.debug('Analysis cancelled by user');
				return { success: false, items: [], error: 'Analysis cancelled', failedCount: 0 };
			}

			log.error('Analysis failed', error);
			return {
				success: false,
				items: [],
				error: error instanceof Error ? error.message : 'Analysis failed',
				failedCount: 0,
			};
		} finally {
			if (this.isActive(operation)) this.activeOperation = null;
			this.clearSlowNetworkTimer(operation);
			if (operation.wakeLockHeld) void releaseWakeLock();
		}
	}

	private isActive(operation: AnalysisOperation): boolean {
		return this.activeOperation === operation;
	}

	private ensureActive(operation: AnalysisOperation): void {
		if (!this.isActive(operation) || operation.controller.signal.aborted) {
			throw new DOMException('Aborted', 'AbortError');
		}
	}

	private throwIfAborted(signal?: AbortSignal): void {
		if (signal?.aborted) {
			throw signal.reason instanceof Error
				? signal.reason
				: new DOMException('Aborted', 'AbortError');
		}
	}

	// =========================================================================
	// GETTERS
	// =========================================================================

	/** Check if analysis is in progress */
	get isAnalyzing(): boolean {
		return this.activeOperation !== null;
	}

	/** Get indices of images that failed analysis */
	getFailedIndices(): number[] {
		const failedIndices: number[] = [];
		for (const [indexStr, status] of Object.entries(this.imageStatuses)) {
			if (status === 'failed') {
				failedIndices.push(parseInt(indexStr, 10));
			}
		}
		return failedIndices.sort((a, b) => a - b);
	}

	/** Check if there are any failed images */
	hasFailedImages(): boolean {
		return Object.values(this.imageStatuses).some((status) => status === 'failed');
	}

	/** Get count of failed images */
	get failedCount(): number {
		return Object.values(this.imageStatuses).filter((status) => status === 'failed').length;
	}
}
