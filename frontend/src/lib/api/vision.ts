/**
 * Vision AI API endpoints
 */

import { request, requestFormData } from './client';
import { getIsDemoMode, fieldPreferences } from './settings';
import { apiLogger as log } from '../utils/logger';
import type {
	DetectionResponse,
	AdvancedItemDetails,
	MergedItemResponse,
	CorrectionResponse,
	MergeItem,
} from '../types';

export interface DetectOptions {
	singleItem?: boolean;
	extraInstructions?: string;
	extractExtendedFields?: boolean;
	additionalImages?: File[];
	signal?: AbortSignal;
	sessionId?: string;
}

export interface AnalyzeOptions {
	signal?: AbortSignal;
}

export interface MergeOptions {
	signal?: AbortSignal;
}

export interface CorrectOptions {
	signal?: AbortSignal;
}

/**
 * Build headers for vision API requests.
 * In demo mode, includes field preferences for AI customization.
 */
async function buildVisionHeaders(): Promise<Record<string, string>> {
	const headers: Record<string, string> = {};

	// Add field preferences header in demo mode
	if (getIsDemoMode()) {
		try {
			const prefs = await fieldPreferences.get();
			headers['X-Field-Preferences'] = JSON.stringify(prefs);
			log.debug('Added field preferences header for demo mode');
		} catch (error) {
			// Silently ignore - preferences are optional
			log.debug('Failed to load field preferences for header:', error);
		}
	}

	return headers;
}

export const vision = {
	/**
	 * Cancel active vision detection tasks for a specific session on the backend.
	 * Called when the user clicks "Cancel Analysis".
	 */
	cancel: async (sessionId: string): Promise<void> => {
		try {
			await request<{ cancelled: number; message: string }>(
				`/tools/vision/cancel?session_id=${encodeURIComponent(sessionId)}`,
				{
					method: 'POST',
				}
			);
			log.info(`Backend vision tasks cancelled for session ${sessionId}`);
		} catch (error) {
			// Non-fatal — the frontend already aborted its fetch requests.
			// This is best-effort to stop the backend LLM call.
			log.warn('Failed to cancel backend vision tasks:', error);
		}
	},

	/**
	 * Detect items from a single image
	 */
	detect: async (image: File, options: DetectOptions = {}): Promise<DetectionResponse> => {
		log.debug(`Preparing detection request: file=${image.name}, size=${image.size} bytes`);
		log.debug(
			`Options: singleItem=${options.singleItem ?? false}, extractExtendedFields=${options.extractExtendedFields ?? true}, additionalImages=${options.additionalImages?.length ?? 0}`
		);

		const formDataStartedAt = performance.now();
		const formData = new FormData();
		formData.append('image', image);

		if (options.singleItem !== undefined) {
			formData.append('single_item', String(options.singleItem));
		}
		if (options.extraInstructions) {
			formData.append('extra_instructions', options.extraInstructions);
			log.debug(
				`Extra instructions: ${options.extraInstructions.substring(0, 100)}${options.extraInstructions.length > 100 ? '...' : ''}`
			);
		}
		if (options.extractExtendedFields !== undefined) {
			formData.append('extract_extended_fields', String(options.extractExtendedFields));
		}
		if (options.additionalImages) {
			for (const img of options.additionalImages) {
				formData.append('additional_images', img);
			}
		}
		if (options.sessionId) {
			formData.append('session_id', options.sessionId);
		}
		log.debug(
			`[DETECT TIMING] FormData built | duration=${((performance.now() - formDataStartedAt) / 1000).toFixed(2)}s | images=${1 + (options.additionalImages?.length ?? 0)}`
		);

		const headersStartedAt = performance.now();
		const headers = await buildVisionHeaders();
		const headersMs = performance.now() - headersStartedAt;
		log.debug(`[DETECT TIMING] headers built | duration=${(headersMs / 1000).toFixed(2)}s`);
		log.info('Sending vision/detect request to backend');
		const requestStartedAt = performance.now();
		const response = await requestFormData<DetectionResponse>('/tools/vision/detect', formData, {
			errorMessage: 'Detection failed',
			signal: options.signal,
			headers,
		});
		log.info(
			`[DETECT TIMING] backend request completed | duration=${((performance.now() - requestStartedAt) / 1000).toFixed(2)}s`
		);
		log.debug(
			`[DETECT TIMING] detect returning | items=${response.items.length} | compressed=${response.compressed_images?.length ?? 0}`
		);
		return response;
	},

	/**
	 * Analyze multiple images to extract detailed item information
	 */
	analyze: async (
		images: File[],
		itemName: string,
		itemDescription?: string,
		options: AnalyzeOptions = {}
	): Promise<AdvancedItemDetails> => {
		log.debug(`Preparing analysis request: item="${itemName}", images=${images.length}`);

		const formData = new FormData();
		for (const img of images) {
			formData.append('images', img);
		}
		formData.append('item_name', itemName);
		if (itemDescription) {
			formData.append('item_description', itemDescription);
		}

		const headers = await buildVisionHeaders();
		log.info(`Sending vision/analyze request for "${itemName}" to backend`);
		return requestFormData<AdvancedItemDetails>('/tools/vision/analyze', formData, {
			errorMessage: 'Analysis failed',
			signal: options.signal,
			headers,
		});
	},

	/**
	 * Merge multiple items into a single consolidated item using AI
	 */
	merge: async (
		itemsToMerge: MergeItem[],
		options: MergeOptions = {}
	): Promise<MergedItemResponse> => {
		log.debug(`Preparing merge request: ${itemsToMerge.length} items`);

		const headers = await buildVisionHeaders();
		log.info(`Sending vision/merge request for ${itemsToMerge.length} items to backend`);
		return request<MergedItemResponse>('/tools/vision/merge', {
			method: 'POST',
			body: JSON.stringify({ items: itemsToMerge }),
			signal: options.signal,
			headers,
		});
	},

	/**
	 * Correct an item based on user feedback
	 */
	correct: async (
		image: File,
		currentItem: MergeItem,
		correctionInstructions: string,
		options: CorrectOptions = {}
	): Promise<CorrectionResponse> => {
		log.debug(`Preparing correction request: item="${currentItem.name}"`);
		log.debug(
			`Correction instructions: ${correctionInstructions.substring(0, 100)}${correctionInstructions.length > 100 ? '...' : ''}`
		);

		const formData = new FormData();
		formData.append('image', image);
		formData.append('current_item', JSON.stringify(currentItem));
		formData.append('correction_instructions', correctionInstructions);

		const headers = await buildVisionHeaders();
		log.info(`Sending vision/correct request for "${currentItem.name}" to backend`);
		return requestFormData<CorrectionResponse>('/tools/vision/correct', formData, {
			errorMessage: 'Correction failed',
			signal: options.signal,
			headers,
		});
	},
};
