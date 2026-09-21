import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../stores/auth.svelte', () => ({
	authStore: { token: null, expiresAt: null, markSessionExpired: vi.fn() },
}));
vi.mock('../services/tokenRefresh', () => ({ refreshToken: vi.fn() }));
vi.mock('../utils/logger', () => ({
	apiLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { NetworkError, request } from './client';

describe('API request cancellation', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('preserves caller AbortError when a timeout signal is also present', async () => {
		const controller = new AbortController();
		vi.stubGlobal(
			'fetch',
			vi.fn((_url: string, init?: RequestInit) => {
				return new Promise<Response>((_resolve, reject) => {
					const signal = init?.signal;
					signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
				});
			})
		);

		const pending = request('/cancelled', { signal: controller.signal, timeout: 60_000 });
		controller.abort();

		const error = await pending.catch((caught: unknown) => caught);
		expect((error as Error).name).toBe('AbortError');
		expect(error instanceof NetworkError).toBe(false);
	});
});
