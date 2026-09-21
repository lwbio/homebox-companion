/**
 * Serialization utilities for session persistence
 *
 * Handles conversion between runtime types (with File objects and Object URLs)
 * and IndexedDB structured-clone types.
 *
	* Why this is needed:
	* - IndexedDB stores Blob/File objects directly without base64 expansion
	* - Object URLs (blob:...) are session-scoped and become invalid after page reload
	* - Legacy sessions used base64 data URLs and remain recoverable
 */

import type {
	CapturedImage,
	ReviewItem,
	ConfirmedItem,
	ScanStatus,
	ThumbnailTransform,
	ItemCore,
	ItemExtended,
	ImageAnalysisStatus,
	ItemSubmissionStatus,
	DuplicateMatch,
} from '$lib/types';
import { createUuid } from '$lib/utils/uuid';

// =============================================================================
// STORED TYPES (Serializable - no File objects or Object URLs)
// =============================================================================

/** IndexedDB-storable version of CapturedImage */
export interface StoredImage {
	id: string;
	filename: string;
	mimeType: string;
	/** Native image blob for efficient IndexedDB storage. */
	blob?: Blob;
	/** Legacy base64 data URL, retained only for backward-compatible recovery. */
	dataUrl?: string;
	separateItems: boolean;
	extraInstructions: string;
	/** Native additional image blobs. */
	additionalBlobs?: Blob[];
	/** Legacy base64 data URLs for additional images. */
	additionalDataUrls?: string[];
	additionalFilenames?: string[];
	additionalMimeTypes?: string[];
	/** Custom asset ID from pre-printed QR codes */
	assetId?: string | null;
}

/** Serializable version of ReviewItem */
export interface StoredReviewItem extends ItemCore, ItemExtended {
	sourceImageIndex: number;
	custom_fields?: Record<string, string> | null;
	/** Present when review changed the source image set, including removing all images. */
	imagesEdited?: boolean;
	originalBlob?: Blob;
	additionalBlobs?: Blob[];
	additionalFilenames?: string[];
	additionalMimeTypes?: string[];
	/** Original image filename for reconstruction */
	originalFilename?: string;
	originalMimeType?: string;
	customThumbnail?: string;
	thumbnailTransform?: ThumbnailTransform;
	/** Already base64 from backend */
	compressedDataUrl?: string;
	compressedAdditionalDataUrls?: string[];
	/** Duplicate match info if serial matches an existing item */
	duplicate_match?: DuplicateMatch | null;
}

/** Serializable version of ConfirmedItem */
export interface StoredConfirmedItem extends StoredReviewItem {
	confirmed: true;
}

/** Complete session state for IndexedDB storage */
export interface StoredSession {
	// Metadata
	id: string;
	createdAt: number;
	updatedAt: number;
	status: ScanStatus;

	// Location context
	locationId: string | null;
	locationName: string | null;
	locationPath: string | null;
	parentItemId: string | null;
	parentItemName: string | null;

	// Images (fully serializable)
	images: StoredImage[];

	// Review state (fully serializable)
	detectedItems: StoredReviewItem[];
	confirmedItems: StoredConfirmedItem[];
	currentReviewIndex: number;

	// Analysis state (for partial_analysis recovery)
	imageStatuses?: Record<number, ImageAnalysisStatus>;
	// Optional for compatibility with drafts saved before submission recovery.
	submission?: {
		itemStatuses: Record<number, ItemSubmissionStatus>;
		createdItemIds: Record<number, string>;
		lastErrors: string[];
	};
}

// =============================================================================
// FILE CONVERSION UTILITIES
// =============================================================================

/**
 * Convert a File to a base64 data URL.
 * This is the key operation for making Files serializable.
 */
export function fileToDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			if (typeof reader.result === 'string') {
				resolve(reader.result);
			} else {
				reject(new Error('FileReader did not return a string'));
			}
		};
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
}

/**
 * Convert a base64 data URL back to a File object.
 * This reverses the fileToDataUrl operation.
 */
export async function dataUrlToFile(
	dataUrl: string,
	filename: string,
	mimeType?: string
): Promise<File> {
	// Extract mime type from data URL if not provided
	const mimeMatch = dataUrl.match(/^data:([^;]+);/);
	const actualMimeType = mimeType || mimeMatch?.[1] || 'image/jpeg';

	// Log warning if we had to fall back to default MIME type
	if (!mimeType && !mimeMatch?.[1]) {
		console.warn(
			'[serialize] Could not extract MIME type from data URL, falling back to image/jpeg',
			{ filename, dataUrlPrefix: dataUrl.substring(0, 50) }
		);
	}

	// Fetch the data URL to get a blob
	const response = await fetch(dataUrl);
	const blob = await response.blob();

	return new File([blob], filename, { type: actualMimeType });
}

// =============================================================================
// OBJECT URL CLEANUP
// =============================================================================

/**
 * Revoke Object URLs associated with a CapturedImage to prevent memory leaks.
 *
 * Object URLs (blob:...) are created during deserialization for efficient display.
 * They must be revoked when the image is no longer needed (e.g., workflow reset,
 * image removal, or before page unload).
 *
 * @param image - The CapturedImage whose Object URLs should be revoked
 */
export function revokeImageObjectUrls(image: CapturedImage): void {
	// Revoke main image Object URL
	// Only revoke if it's an Object URL (starts with 'blob:')
	if (image.dataUrl?.startsWith('blob:')) {
		URL.revokeObjectURL(image.dataUrl);
	}

	// Revoke additional image Object URLs
	if (image.additionalDataUrls) {
		for (const url of image.additionalDataUrls) {
			if (url?.startsWith('blob:')) {
				URL.revokeObjectURL(url);
			}
		}
	}
}

// =============================================================================
// SERIALIZATION (Runtime → Stored)
// =============================================================================

/**
 * Serialize a CapturedImage to StoredImage using native blobs. IndexedDB can
 * structured-clone blobs without the size and CPU overhead of base64 strings.
 */
export function serializeImage(img: CapturedImage): StoredImage {
	let additionalFilenames: string[] | undefined;
	let additionalMimeTypes: string[] | undefined;

	if (img.additionalFiles && img.additionalFiles.length > 0) {
		additionalFilenames = img.additionalFiles.map((f) => f.name);
		additionalMimeTypes = img.additionalFiles.map((f) => f.type || 'image/jpeg');
	}

	return {
		id: createUuid(),
		filename: img.file.name,
		mimeType: img.file.type || 'image/jpeg',
		blob: img.file,
		separateItems: img.separateItems,
		extraInstructions: img.extraInstructions,
		additionalBlobs: img.additionalFiles ? Array.from(img.additionalFiles) : undefined,
		additionalFilenames,
		additionalMimeTypes,
		assetId: img.assetId,
	};
}

/**
 * Serialize a ReviewItem to StoredReviewItem.
 * Strips out File objects (we rely on compressedDataUrl instead).
 */

function sameFiles(left: readonly File[] | undefined, right: readonly File[] | undefined): boolean {
	const a = left ?? [];
	const b = right ?? [];
	return a.length === b.length && a.every((file, index) => file === b[index]);
}

export function serializeReviewItem(
	item: ReviewItem,
	sourceImage?: CapturedImage
): StoredReviewItem {
	const imagesEdited = sourceImage
		? item.originalFile !== sourceImage.file ||
			!sameFiles(item.additionalImages, sourceImage.additionalFiles)
		: false;
	const editedAdditional = imagesEdited ? (item.additionalImages ?? []) : [];
	return {
		// ItemCore fields
		name: item.name,
		quantity: item.quantity,
		description: item.description,
		tag_ids: item.tag_ids,
		// ItemExtended fields
		manufacturer: item.manufacturer,
		model_number: item.model_number,
		serial_number: item.serial_number,
		purchase_price: item.purchase_price,
		purchase_from: item.purchase_from,
		notes: item.notes,
		asset_id: item.asset_id,
		custom_fields: item.custom_fields,
		imagesEdited: imagesEdited || undefined,
		originalBlob: imagesEdited ? item.originalFile : undefined,
		additionalBlobs: imagesEdited ? editedAdditional : undefined,
		additionalFilenames: imagesEdited ? editedAdditional.map((file) => file.name) : undefined,
		additionalMimeTypes: imagesEdited ? editedAdditional.map((file) => file.type) : undefined,
		// ReviewItem-specific fields
		sourceImageIndex: item.sourceImageIndex,
		originalFilename: item.originalFile?.name,
		originalMimeType: item.originalFile?.type,
		customThumbnail: item.customThumbnail,
		thumbnailTransform: item.thumbnailTransform,
		compressedDataUrl: item.compressedDataUrl,
		compressedAdditionalDataUrls: item.compressedAdditionalDataUrls,
		duplicate_match: item.duplicate_match,
	};
}

/**
 * Serialize a ConfirmedItem to StoredConfirmedItem.
 */
export function serializeConfirmedItem(
	item: ConfirmedItem,
	sourceImage?: CapturedImage
): StoredConfirmedItem {
	return {
		...serializeReviewItem(item, sourceImage),
		confirmed: true,
	};
}

// =============================================================================
// DESERIALIZATION (Stored → Runtime)
// =============================================================================

/**
 * Deserialize a StoredImage back to CapturedImage.
 * Supports native blobs and legacy base64 sessions.
 */
export async function deserializeImage(stored: StoredImage): Promise<CapturedImage> {
	let file: File;
	if (stored.blob) {
		file = new File([stored.blob], stored.filename, { type: stored.mimeType || stored.blob.type });
	} else if (stored.dataUrl) {
		file = await dataUrlToFile(stored.dataUrl, stored.filename, stored.mimeType);
	} else {
		throw new Error(`Stored image ${stored.id} has no blob or legacy data URL`);
	}

	// Convert additional images
	let additionalFiles: File[] | undefined;
	let additionalDataUrls: string[] | undefined;

	if (stored.additionalBlobs && stored.additionalBlobs.length > 0) {
		additionalFiles = stored.additionalBlobs.map((blob, i) => {
			const filename = stored.additionalFilenames?.[i] || `additional_${i}.jpg`;
			const mimeType = stored.additionalMimeTypes?.[i] || blob.type || 'image/jpeg';
			return new File([blob], filename, { type: mimeType });
		});
	} else if (stored.additionalDataUrls && stored.additionalDataUrls.length > 0) {
		additionalFiles = await Promise.all(
			stored.additionalDataUrls.map((url, i) => {
				const filename = stored.additionalFilenames?.[i] || `additional_${i}.jpg`;
				const mimeType = stored.additionalMimeTypes?.[i]; // Let dataUrlToFile extract from URL if missing
				return dataUrlToFile(url, filename, mimeType);
			})
		);
	}
	if (additionalFiles) additionalDataUrls = additionalFiles.map((f) => URL.createObjectURL(f));

	return {
		file,
		// Create fresh Object URL for display (NOT the base64 - Object URLs are more memory efficient for display)
		dataUrl: URL.createObjectURL(file),
		separateItems: stored.separateItems,
		extraInstructions: stored.extraInstructions,
		additionalFiles,
		additionalDataUrls,
		assetId: stored.assetId,
	};
}

/**
 * Deserialize a StoredReviewItem back to ReviewItem.
 * Reconstructs File objects from compressedDataUrl if available.
 */
export async function deserializeReviewItem(
	stored: StoredReviewItem,
	images?: readonly CapturedImage[]
): Promise<ReviewItem> {
	const sourceImage = images?.[stored.sourceImageIndex];

	// Prefer the restored capture files so attachments retain their original quality.
	let originalFile: File | undefined = stored.imagesEdited
		? stored.originalBlob
			? new File([stored.originalBlob], stored.originalFilename || 'image.jpg', {
					type: stored.originalMimeType || stored.originalBlob.type,
				})
			: undefined
		: sourceImage?.file;
	if (
		!stored.imagesEdited &&
		!originalFile &&
		stored.compressedDataUrl &&
		stored.originalFilename
	) {
		originalFile = await dataUrlToFile(
			stored.compressedDataUrl,
			stored.originalFilename,
			stored.originalMimeType
		);
	} else if (
		!stored.imagesEdited &&
		!originalFile &&
		stored.compressedDataUrl &&
		!stored.originalFilename
	) {
		// Log warning when we have image data but no filename to reconstruct with
		console.warn(
			'[serialize] Cannot reconstruct originalFile: compressedDataUrl exists but originalFilename is missing',
			{ name: stored.name }
		);
	}

	// Reconstruct additionalImages from compressedAdditionalDataUrls
	let additionalImages: File[] | undefined = stored.imagesEdited
		? stored.additionalBlobs?.map(
				(blob, index) =>
					new File([blob], stored.additionalFilenames?.[index] || `additional_${index}.jpg`, {
						type: stored.additionalMimeTypes?.[index] || blob.type,
					})
			)
		: sourceImage?.additionalFiles;
	if (
		!stored.imagesEdited &&
		!additionalImages &&
		stored.compressedAdditionalDataUrls &&
		stored.compressedAdditionalDataUrls.length > 0
	) {
		additionalImages = await Promise.all(
			stored.compressedAdditionalDataUrls.map((url, i) =>
				dataUrlToFile(url, `additional_${i}.jpg`, 'image/jpeg')
			)
		);
	}

	return {
		// ItemCore fields
		name: stored.name,
		quantity: stored.quantity,
		description: stored.description,
		tag_ids: stored.tag_ids,
		// ItemExtended fields
		manufacturer: stored.manufacturer,
		model_number: stored.model_number,
		serial_number: stored.serial_number,
		purchase_price: stored.purchase_price,
		purchase_from: stored.purchase_from,
		notes: stored.notes,
		asset_id: stored.asset_id,
		custom_fields: stored.custom_fields,
		// ReviewItem-specific fields
		sourceImageIndex: stored.sourceImageIndex,
		originalFile,
		additionalImages,
		customThumbnail: stored.customThumbnail,
		thumbnailTransform: stored.thumbnailTransform,
		compressedDataUrl: stored.compressedDataUrl,
		compressedAdditionalDataUrls: stored.compressedAdditionalDataUrls,
		duplicate_match: stored.duplicate_match,
	};
}

/**
 * Deserialize a StoredConfirmedItem back to ConfirmedItem.
 */
export async function deserializeConfirmedItem(
	stored: StoredConfirmedItem,
	images?: readonly CapturedImage[]
): Promise<ConfirmedItem> {
	const reviewItem = await deserializeReviewItem(stored, images);
	return {
		...reviewItem,
		confirmed: true,
	};
}
