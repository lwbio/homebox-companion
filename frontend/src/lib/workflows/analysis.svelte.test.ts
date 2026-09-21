import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	acquireWakeLock: vi.fn<() => Promise<void>>(),
	releaseWakeLock: vi.fn<() => Promise<void>>(),
	detect: vi.fn(),
	cancel: vi.fn().mockResolvedValue(undefined),
	getPreferences: vi.fn(),
	fetchTags: vi.fn().mockResolvedValue([]),
	tags: [] as Array<{ id: string; name: string }>,
	uuid: vi.fn(),
}));

vi.mock('$lib/api/index', () => ({
	vision: { detect: mocks.detect, cancel: mocks.cancel },
	fieldPreferences: { get: mocks.getPreferences },
}));
vi.mock('$lib/stores/tags.svelte', () => ({
	tagStore: {
		fetchTags: mocks.fetchTags,
		get tags() {
			return mocks.tags;
		},
	},
}));
vi.mock('$lib/utils/wakeLock', () => ({
	acquireWakeLock: mocks.acquireWakeLock,
	releaseWakeLock: mocks.releaseWakeLock,
}));
vi.mock('$lib/utils/uuid', () => ({ createUuid: mocks.uuid }));
vi.mock('$lib/i18n', () => ({ t: (key: string) => key }));
vi.mock('$lib/utils/logger', () => ({
	workflowLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import type { CapturedImage } from '$lib/types';
import { AnalysisService } from './analysis.svelte';

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

function image(name: string): CapturedImage {
	return {
		file: { name, size: 1 } as File,
		dataUrl: '',
		separateItems: false,
		extraInstructions: '',
	};
}

function detection(name: string) {
	return { items: [{ name }], compressed_images: [] };
}

describe('AnalysisService operation ownership', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.releaseWakeLock.mockResolvedValue(undefined);
		mocks.cancel.mockResolvedValue(undefined);
		mocks.fetchTags.mockResolvedValue([]);
		mocks.tags = [];
		mocks.uuid.mockReturnValueOnce('old-session').mockReturnValueOnce('new-session');
	});

	it('does not let an operation cancelled during wake-lock acquisition clear a restart', async () => {
		const oldWakeLock = deferred<void>();
		const newWakeLock = deferred<void>();
		const newDetection = deferred<ReturnType<typeof detection>>();
		mocks.acquireWakeLock
			.mockReturnValueOnce(oldWakeLock.promise)
			.mockReturnValueOnce(newWakeLock.promise);
		mocks.getPreferences.mockResolvedValue({ default_tag_id: null });
		mocks.detect.mockReturnValue(newDetection.promise);

		const service = new AnalysisService();
		const oldResult = service.analyze([image('old.jpg')]);
		service.cancel('test');
		const newResult = service.analyze([image('new.jpg')]);

		newWakeLock.resolve();
		await vi.waitFor(() => expect(mocks.detect.mock.calls.length).toBe(1));
		oldWakeLock.resolve();
		expect((await oldResult).error).toBe('Analysis cancelled');
		expect(service.isAnalyzing).toBe(true);
		expect(mocks.detect.mock.calls[0][1].sessionId).toBe('new-session');

		newDetection.resolve(detection('new item'));
		expect((await newResult).success).toBe(true);
	});

	it('does not apply preferences returned after cancellation to a restarted operation', async () => {
		const oldPreferences = deferred<{ default_tag_id: string | null }>();
		const newPreferences = deferred<{ default_tag_id: string | null }>();
		mocks.acquireWakeLock.mockResolvedValue(undefined);
		mocks.getPreferences
			.mockReturnValueOnce(oldPreferences.promise)
			.mockReturnValueOnce(newPreferences.promise);
		mocks.detect.mockResolvedValue(detection('new item'));
		mocks.tags = [
			{ id: 'old-tag', name: 'Old' },
			{ id: 'new-tag', name: 'New' },
		];

		const service = new AnalysisService();
		const oldResult = service.analyze([image('old.jpg')]);
		await vi.waitFor(() => expect(mocks.getPreferences.mock.calls.length).toBe(1));
		service.cancel('test');
		const newResult = service.analyze([image('new.jpg')]);

		newPreferences.resolve({ default_tag_id: 'new-tag' });
		await vi.waitFor(() => expect(mocks.detect.mock.calls.length).toBe(1));
		oldPreferences.resolve({ default_tag_id: 'old-tag' });

		expect((await oldResult).error).toBe('Analysis cancelled');
		const result = await newResult;
		expect(result.success).toBe(true);
		expect(result.items[0].tag_ids).toEqual(['new-tag']);
	});

	it('restores failed image statuses when a retry is cancelled', async () => {
		const retryDetection = deferred<ReturnType<typeof detection>>();
		mocks.acquireWakeLock.mockResolvedValue(undefined);
		mocks.getPreferences.mockResolvedValue({ default_tag_id: null });
		mocks.detect.mockReturnValue(retryDetection.promise);
		mocks.uuid.mockReset().mockReturnValue('retry-session');
		const service = new AnalysisService();
		service.imageStatuses = { 0: 'failed', 1: 'success' };

		const retrying = service.retryFailed([image('failed.jpg'), image('ok.jpg')], []);
		await vi.waitFor(() => expect(mocks.detect).toHaveBeenCalledTimes(1));
		service.cancel('test');
		expect(service.imageStatuses).toEqual({ 0: 'failed', 1: 'success' });

		retryDetection.resolve(detection('ignored'));
		await retrying;
		expect(service.imageStatuses).toEqual({ 0: 'failed', 1: 'success' });
	});
});
