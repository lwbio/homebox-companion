import { describe, expect, it, vi } from 'vitest';

import { withRetry } from './retry';

describe('withRetry', () => {
	it('does not retry AbortError failures', async () => {
		const fn = vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'));
		const onRetry = vi.fn();

		const error = await withRetry(fn, { maxAttempts: 3, baseDelay: 1, onRetry }).catch(
			(caught: unknown) => caught
		);
		expect((error as Error).name).toBe('AbortError');
		expect(fn.mock.calls.length).toBe(1);
		expect(onRetry.mock.calls.length).toBe(0);
	});

	it('stops exponential backoff as soon as the signal aborts', async () => {
		const controller = new AbortController();
		const fn = vi.fn().mockRejectedValue(new Error('offline'));
		const retrying = withRetry(fn, {
			maxAttempts: 3,
			baseDelay: 60_000,
			signal: controller.signal,
		});

		await Promise.resolve();
		controller.abort();

		const error = await retrying.catch((caught: unknown) => caught);
		expect((error as Error).name).toBe('AbortError');
		expect(fn.mock.calls.length).toBe(1);
	});
});
