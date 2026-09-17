/** Browser-side image processing used before vision uploads. */

const VISION_MAX_DIMENSION = 2048;
const VISION_JPEG_QUALITY = 0.85;

/** Resize and encode an image for vision APIs without upscaling it. */
export async function compressImageForVision(file: File): Promise<File> {
	try {
		const bitmap = await createImageBitmap(file);
		const scale = Math.min(1, VISION_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
		const canvas = document.createElement('canvas');
		canvas.width = Math.max(1, Math.round(bitmap.width * scale));
		canvas.height = Math.max(1, Math.round(bitmap.height * scale));
		const context = canvas.getContext('2d');
		if (!context) return file;
		// JPEG has no alpha channel, so transparent PNGs would render black.
		// Fill white first to match the backend's `_normalize_image` behavior.
		context.fillStyle = '#ffffff';
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		bitmap.close();

		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, 'image/jpeg', VISION_JPEG_QUALITY)
		);
		return blob
			? new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })
			: file;
	} catch {
		// Let the backend handle unusual or unsupported image formats.
		return file;
	}
}

export async function compressImagesForVision(files: File[]): Promise<File[]> {
	return Promise.all(files.map(compressImageForVision));
}
