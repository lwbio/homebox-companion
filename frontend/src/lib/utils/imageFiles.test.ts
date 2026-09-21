import { describe, expect, it, vi } from 'vitest';

vi.mock('heic2any', () => ({
	default: vi.fn().mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' })),
}));

import { normalizeImageFile } from './imageFiles';

describe('normalizeImageFile', () => {
	it('returns supported image files unchanged', async () => {
		const file = new File(['png'], 'item.png', { type: 'image/png' });
		expect(await normalizeImageFile(file)).toBe(file);
	});

	it('converts HEIC files to JPEG', async () => {
		const file = new File(['heic'], 'item.HEIC', { type: 'image/heic' });
		const converted = await normalizeImageFile(file);
		expect(converted.name).toBe('item.jpg');
		expect(converted.type).toBe('image/jpeg');
	});
});
