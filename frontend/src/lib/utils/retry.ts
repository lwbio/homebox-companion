/**
 * Retry utility with exponential backoff
 */

export interface RetryOptions {
	maxAttempts?: number;
	baseDelay?: number;
	onRetry?: (attempt: number, error: Error) => void;
	signal?: AbortSignal;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw signal.reason instanceof Error
			? signal.reason
			: new DOMException('The operation was aborted', 'AbortError');
	}
}

function abortableDelay(delay: number, signal?: AbortSignal): Promise<void> {
	if (!signal) return new Promise((resolve) => setTimeout(resolve, delay));

	throwIfAborted(signal);
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal.removeEventListener('abort', onAbort);
			resolve();
		}, delay);
		const onAbort = () => {
			clearTimeout(timer);
			reject(
				signal.reason instanceof Error
					? signal.reason
					: new DOMException('The operation was aborted', 'AbortError')
			);
		};
		signal.addEventListener('abort', onAbort, { once: true });
	});
}

/**
 * Retry an async function with exponential backoff
 * @param fn - The async function to retry
 * @param options - Retry configuration
 * @returns The result of the function
 * @throws The last error if all retries are exhausted
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
	const { maxAttempts = 3, baseDelay = 1000, onRetry, signal } = options;

	let lastError: Error | undefined;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		throwIfAborted(signal);
		try {
			return await fn();
		} catch (error) {
			if (
				typeof error === 'object' &&
				error !== null &&
				'name' in error &&
				error.name === 'AbortError'
			) {
				throw error;
			}
			lastError = error instanceof Error ? error : new Error(String(error));
			throwIfAborted(signal);

			// Don't delay after the last attempt
			if (attempt < maxAttempts) {
				// Exponential backoff: 1s, 2s, 4s
				const delay = baseDelay * Math.pow(2, attempt - 1);

				if (onRetry) {
					onRetry(attempt, lastError);
				}

				await abortableDelay(delay, signal);
			}
		}
	}

	// All retries exhausted
	throw lastError || new Error('All retry attempts failed');
}
