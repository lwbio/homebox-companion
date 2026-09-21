import { describe, expect, it } from 'vitest';

import type { CapturedImage, ReviewItem } from '$lib/types';
import {
	deserializeConfirmedItem,
	deserializeReviewItem,
	serializeConfirmedItem,
	serializeReviewItem,
	type StoredReviewItem,
} from './serialize';

function makeReviewItem(): ReviewItem {
	return {
		name: 'Multimeter',
		quantity: 1,
		description: 'Bench meter',
		tag_ids: ['tools'],
		asset_id: 'ASSET-42',
		custom_fields: { Voltage: '600 V', Calibration: '2026-01-01' },
		sourceImageIndex: 0,
	};
}

describe('review item serialization', () => {
	it('preserves custom fields for review and confirmed items', async () => {
		const reviewItem = makeReviewItem();
		const storedReview = serializeReviewItem(reviewItem);
		const storedConfirmed = serializeConfirmedItem({ ...reviewItem, confirmed: true });

		expect(storedReview.custom_fields).toEqual(reviewItem.custom_fields);
		expect((await deserializeReviewItem(storedReview)).custom_fields).toEqual(
			reviewItem.custom_fields
		);
		expect((await deserializeConfirmedItem(storedConfirmed)).custom_fields).toEqual(
			reviewItem.custom_fields
		);
	});

	it('relinks original and additional files from the restored source image', async () => {
		const originalFile = new File(['original'], 'original.jpg', { type: 'image/jpeg' });
		const additionalFile = new File(['additional'], 'detail.jpg', { type: 'image/jpeg' });
		const images: CapturedImage[] = [
			{
				file: originalFile,
				dataUrl: 'blob:original',
				separateItems: false,
				extraInstructions: '',
				additionalFiles: [additionalFile],
			},
		];
		const stored: StoredReviewItem = {
			...serializeReviewItem(makeReviewItem()),
			originalFilename: 'compressed.jpg',
			compressedDataUrl: 'data:image/jpeg;base64,Y29tcHJlc3NlZA==',
			compressedAdditionalDataUrls: ['data:image/jpeg;base64,Y29tcHJlc3NlZA=='],
		};

		const restored = await deserializeReviewItem(stored, images);

		expect(restored.originalFile).toBe(originalFile);
		expect(restored.additionalImages).toBe(images[0].additionalFiles);
	});

	it('falls back to compressed data for legacy sessions without restored images', async () => {
		const stored: StoredReviewItem = {
			...serializeReviewItem(makeReviewItem()),
			originalFilename: 'legacy.jpg',
			originalMimeType: 'image/jpeg',
			compressedDataUrl: 'data:image/jpeg;base64,bGVnYWN5',
			compressedAdditionalDataUrls: ['data:image/jpeg;base64,ZGV0YWls'],
		};

		const restored = await deserializeReviewItem(stored);

		expect(restored.originalFile?.name).toBe('legacy.jpg');
		expect(await restored.originalFile?.text()).toBe('legacy');
		expect(await restored.additionalImages?.[0].text()).toBe('detail');
	});

	it('stores only review image overrides and restores removals', async () => {
		const sourceFile = new File(['source'], 'source.jpg', { type: 'image/jpeg' });
		const addedFile = new File(['added'], 'added.jpg', { type: 'image/jpeg' });
		const images: CapturedImage[] = [
			{ file: sourceFile, dataUrl: 'blob:source', separateItems: false, extraInstructions: '' },
		];
		const edited = { ...makeReviewItem(), originalFile: addedFile, additionalImages: [] };

		const stored = serializeReviewItem(edited, images[0]);
		expect(stored.imagesEdited).toBe(true);
		expect(stored.originalBlob).toBe(addedFile);
		expect((await deserializeReviewItem(stored, images)).originalFile?.name).toBe('added.jpg');

		const removed = serializeReviewItem(
			{
				...makeReviewItem(),
				originalFile: undefined,
				additionalImages: [],
				compressedDataUrl: 'data:image/jpeg;base64,b2xk',
			},
			images[0]
		);
		expect(removed.imagesEdited).toBe(true);
		expect((await deserializeReviewItem(removed, images)).originalFile).toBeUndefined();
	});
});
