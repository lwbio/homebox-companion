/**
 * Frontend log transport - forwards buffered logs to the backend.
 *
 * Frontend logs are batched and POSTed to `/api/logs/frontend` so they can be
 * written into the unified server log file for central analysis. The transport
 * uses raw `fetch` (not the `request()` client) to avoid recursion through the
 * logger, and reads the auth token lazily via dynamic import to avoid a
 * circular dependency with the auth store.
 */

import { browser } from '$app/environment';
import type { LogEntry } from './logger';

const ENDPOINT = '/api/logs/frontend';
const FLUSH_INTERVAL_MS = 5000;
const MAX_BATCH_SIZE = 50;
const MAX_QUEUED_LOGS = 200;

// `keepalive` requests have a ~64KB body limit in most browsers. The unload
// flush uses a smaller cap to stay safely under that limit.

let queue: LogEntry[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let flushing = false;

/**
 * Queue a log entry for delivery to the backend.
 * No-op outside the browser environment.
 */
export function enqueueLog(entry: LogEntry): void {
	if (!browser) return;

	queue.push(entry);
	if (queue.length > MAX_QUEUED_LOGS) queue.shift();
	ensureTimer();

	// Flush eagerly once a reasonable batch size is reached
	if (queue.length >= MAX_BATCH_SIZE) {
		void flush(false);
	}
}

function ensureTimer(): void {
	if (timer !== null) return;
	timer = setInterval(() => {
		void flush(false);
	}, FLUSH_INTERVAL_MS);
}

async function getToken(): Promise<string | null> {
	try {
		const { authStore } = await import('$lib/stores/auth.svelte');
		return authStore.token;
	} catch {
		return null;
	}
}

/**
 * Send queued logs to the backend. Removes the batch from the queue first so
 * new logs arriving during a flush are not lost or dropped on failure.
 */
async function flush(keepalive: boolean): Promise<void> {
	if (!browser || (flushing && !keepalive)) return;

	const batch = queue.splice(0, MAX_BATCH_SIZE);
	if (batch.length === 0) return;

	if (!keepalive) flushing = true;
	try {
		const token = await getToken();
		if (!token) {
			// Drop unauthenticated diagnostics; the local buffer remains available.
			return;
		}

		const response = await fetch(ENDPOINT, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ logs: batch }),
			keepalive,
		});
		if (!response.ok) throw new Error('Log delivery failed');
	} catch {
		// Retain failed diagnostics without recursing through the logger.
		if (!keepalive) queue = [...batch, ...queue].slice(0, MAX_QUEUED_LOGS);
	} finally {
		if (!keepalive) flushing = false;
	}
}

/**
 * Flush remaining logs on page unload using keepalive.
 */
function flushOnUnload(): void {
	while (queue.length > 0) void flush(true);
}

if (browser) {
	window.addEventListener('pagehide', flushOnUnload);
}
