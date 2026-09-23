import { describe, expect, it } from 'vitest';

import type { ConfirmedItem } from '$lib/types';
import type { ReviewItem } from '$lib/types';
import { ReviewService } from './review.svelte';

describe('ReviewService.editConfirmedItem', () => {
	it('preserves asset ID and custom fields', () => {
		const item: ConfirmedItem = {
			name: 'Oscilloscope',
			quantity: 1,
			asset_id: 'SCOPE-7',
			custom_fields: { Bandwidth: '100 MHz' },
			sourceImageIndex: 0,
			confirmed: true,
		};
		const service = new ReviewService();
		service.setConfirmedItems([item]);

		const editable = service.editConfirmedItem(0);

		expect(editable?.asset_id).toBe(item.asset_id);
		expect(editable?.custom_fields).toEqual(item.custom_fields);
		expect(service.currentItem).toEqual(editable);
	});
});

describe('ReviewService.updateCurrentItem', () => {
	it('does not replace the item when updates are unchanged', () => {
		const additionalImages = [new File(['additional'], 'additional.jpg', { type: 'image/jpeg' })];
		const item: ReviewItem = {
			name: 'Laptop',
			quantity: 1,
			sourceImageIndex: 0,
			originalFile: new File(['original'], 'original.jpg', { type: 'image/jpeg' }),
			additionalImages,
		};
		const service = new ReviewService();
		service.setDetectedItems([item]);
		const currentItem = service.currentItem;

		service.updateCurrentItem({ ...item, additionalImages: [...additionalImages] });

		expect(service.currentItem).toBe(currentItem);
	});
});
