import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConfirmedItem } from '$lib/types';

const api = vi.hoisted(() => ({
	create: vi.fn(),
	update: vi.fn(),
	uploadAttachment: vi.fn(),
	delete: vi.fn(),
}));

vi.mock('$lib/api/index', () => ({ items: api }));
vi.mock('$lib/api/client', () => ({
	ApiError: class ApiError extends Error {
		status: number;

		constructor(message: string, status: number) {
			super(message);
			this.status = status;
		}
	},
	NetworkError: class NetworkError extends Error {},
}));
vi.mock('$lib/utils/token', () => ({ hasToken: () => true }));
vi.mock('$lib/utils/logger', () => ({
	workflowLogger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import { SubmissionService } from '$lib/workflows/submission.svelte';
import { NetworkError } from '$lib/api/client';

function item(overrides: Partial<ConfirmedItem> = {}): ConfirmedItem {
	return {
		name: 'Test item',
		quantity: 1,
		sourceImageIndex: 0,
		confirmed: true,
		...overrides,
	} as ConfirmedItem;
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((next) => (resolve = next));
	return { promise, resolve };
}

describe('SubmissionService', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		api.update.mockResolvedValue(undefined);
		api.delete.mockResolvedValue(undefined);
	});

	it('records the created ID when a failed item retry succeeds', async () => {
		const service = new SubmissionService();
		service.restoreProgressSnapshot({ itemStatuses: { 0: 'failed' }, createdItemIds: {} });
		api.create.mockResolvedValue({ created: [{ id: 'item-1' }], errors: [] });

		const result = await service.retryFailed([item()], 'location-1', null);

		expect(result.success).toBe(true);
		expect(result.successCount).toBe(1);
		expect(result.partialSuccessCount).toBe(0);
		expect(service.exportProgressSnapshot()).toEqual({
			itemStatuses: { 0: 'success' },
			createdItemIds: { 0: 'item-1' },
		});
	});

	it('records the created ID when a retry partially succeeds', async () => {
		const service = new SubmissionService();
		service.restoreProgressSnapshot({ itemStatuses: { 0: 'failed' }, createdItemIds: {} });
		api.create.mockResolvedValue({ created: [{ id: 'item-2' }], errors: [] });
		api.uploadAttachment
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error('failed'));

		const result = await service.retryFailed(
			[
				item({
					originalFile: new File(['primary'], 'primary.jpg'),
					additionalImages: [new File(['additional'], 'additional.jpg')],
				}),
			],
			'location-1',
			null
		);

		expect(result.success).toBe(true);
		expect(result.successCount).toBe(0);
		expect(result.partialSuccessCount).toBe(1);
		expect(api.uploadAttachment.mock.calls.length).toBe(2);
		expect(service.exportProgressSnapshot().createdItemIds).toEqual({ 0: 'item-2' });
	});

	it('does not retry a failed attachment POST', async () => {
		const service = new SubmissionService();
		service.restoreProgressSnapshot({ itemStatuses: { 0: 'failed' }, createdItemIds: {} });
		api.create.mockResolvedValue({ created: [{ id: 'item-3' }], errors: [] });
		api.uploadAttachment.mockRejectedValue(new Error('connection lost'));

		const result = await service.retryFailed(
			[item({ originalFile: new File(['primary'], 'primary.jpg') })],
			'location-1',
			null
		);

		expect(result.failCount).toBe(1);
		expect(api.uploadAttachment.mock.calls.length).toBe(1);
		expect(api.delete.mock.calls.length).toBe(1);
		expect(api.delete.mock.calls[0][0]).toBe('item-3');
		expect(api.delete.mock.calls[0][1] instanceof AbortSignal).toBe(true);
	});

	it('revokes result blob URLs when replacing and resetting the result', () => {
		const service = new SubmissionService();
		const createObjectURL = vi
			.spyOn(URL, 'createObjectURL')
			.mockReturnValueOnce('blob:first')
			.mockReturnValueOnce('blob:second');
		const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
		service.restoreProgressSnapshot({
			itemStatuses: { 0: 'success' },
			createdItemIds: { 0: 'item-4' },
		});
		const submittedItem = item({ originalFile: new File(['primary'], 'primary.jpg') });

		service.saveResult([submittedItem], 'Room', 'location-1');
		service.saveResult([submittedItem], 'Room', 'location-1');
		expect(revokeObjectURL.mock.calls[0]).toEqual(['blob:first']);

		service.reset();
		expect(revokeObjectURL.mock.calls[1]).toEqual(['blob:second']);
		expect(createObjectURL.mock.calls.length).toBe(2);
	});

	it('exports and restores detached progress snapshots', () => {
		const service = new SubmissionService();
		const source = {
			itemStatuses: { 0: 'success', 1: 'failed' } as const,
			createdItemIds: { 0: 'item-5' },
		};
		service.restoreProgressSnapshot(source);

		const exported = service.exportProgressSnapshot();
		exported.itemStatuses[0] = 'failed';
		exported.createdItemIds[0] = 'changed';

		expect(service.exportProgressSnapshot()).toEqual(source);
	});

	it('checkpoints creating before the request and success after the response', async () => {
		const service = new SubmissionService();
		const response = deferred<{ created: Array<{ id: string }>; errors: string[] }>();
		api.create.mockReturnValue(response.promise);
		const checkpoints: ReturnType<SubmissionService['exportProgressSnapshot']>[] = [];

		const submitting = service.submitAll([item()], 'location-1', null, {
			onCheckpoint: async () => {
				checkpoints.push(service.exportProgressSnapshot());
			},
		});
		await vi.waitFor(() => expect(checkpoints.length).toBe(1));
		expect(checkpoints[0].itemStatuses).toEqual({ 0: 'creating' });

		response.resolve({ created: [{ id: 'item-6' }], errors: [] });
		await submitting;
		expect(checkpoints.at(-1)).toEqual({
			itemStatuses: { 0: 'success' },
			createdItemIds: { 0: 'item-6' },
		});
	});

	it('does not replay successful or uncertain items when resuming', async () => {
		const service = new SubmissionService();
		service.restoreProgressSnapshot({
			itemStatuses: { 0: 'success', 1: 'unknown', 2: 'pending' },
			createdItemIds: { 0: 'item-7' },
		});
		api.create.mockResolvedValue({ created: [{ id: 'item-9' }], errors: [] });

		await service.submitAll([item(), item(), item()], 'location-1', null, {
			resumeExisting: true,
		});

		expect(api.create).toHaveBeenCalledTimes(1);
		expect(service.exportProgressSnapshot().itemStatuses).toEqual({
			0: 'success',
			1: 'unknown',
			2: 'success',
		});
	});

	it('marks an ambiguous create network failure as unknown instead of retryable', async () => {
		const service = new SubmissionService();
		api.create.mockRejectedValue(new NetworkError('response lost', new Error('lost')));

		await service.submitAll([item()], 'location-1', null);

		expect(service.exportProgressSnapshot().itemStatuses).toEqual({ 0: 'unknown' });
		expect(service.hasFailedItems()).toBe(false);
		expect(service.hasUncertainItems()).toBe(true);
	});

	it('keeps a created item when the primary upload outcome is uncertain', async () => {
		const service = new SubmissionService();
		api.create.mockResolvedValue({ created: [{ id: 'item-10' }], errors: [] });
		api.uploadAttachment.mockRejectedValue(new NetworkError('response lost', new Error('lost')));

		const result = await service.submitAll(
			[item({ originalFile: new File(['primary'], 'primary.jpg') })],
			'location-1',
			null
		);

		expect(result.partialSuccessCount).toBe(1);
		expect(api.delete).not.toHaveBeenCalled();
		expect(service.exportProgressSnapshot()).toEqual({
			itemStatuses: { 0: 'partial_success' },
			createdItemIds: { 0: 'item-10' },
		});
	});
});
