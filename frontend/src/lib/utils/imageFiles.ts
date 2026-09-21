/** Convert HEIC/HEIF files into browser- and backend-compatible JPEG files. */
export async function normalizeImageFile(file: File): Promise<File> {
	const lowerName = file.name.toLowerCase();
	const isHeic =
		file.type === 'image/heic' ||
		file.type === 'image/heif' ||
		lowerName.endsWith('.heic') ||
		lowerName.endsWith('.heif');
	if (!isHeic) return file;

	const { default: heic2any } = await import('heic2any');
	const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
	const blob = Array.isArray(converted) ? converted[0] : converted;
	const baseName = file.name.replace(/\.(heic|heif)$/i, '') || 'image';
	return new File([blob], `${baseName}.jpg`, {
		type: 'image/jpeg',
		lastModified: file.lastModified,
	});
}
