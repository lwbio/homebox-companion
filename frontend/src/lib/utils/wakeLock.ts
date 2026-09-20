/**
 * Screen Wake Lock helper.
 *
 * Keeps the mobile screen awake during long-running operations (e.g. AI image
 * analysis) so the OS does not auto-lock the screen and throttle background
 * timers/network. On mobile, a pending `fetch` can be held for tens of seconds
 * when the page is backgrounded or the screen turns off; holding a wake lock
 * keeps the request resolving promptly.
 *
 * The Screen Wake Lock API is unavailable or ignored on unsupported browsers,
 * so every call degrades gracefully to a no-op.
 */

interface WakeLockSentinel {
	release: () => Promise<void>;
	addEventListener?: (type: string, listener: () => void) => void;
	removeEventListener?: (type: string, listener: () => void) => void;
}

interface WakeLockNavigator {
	wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> };
}

let sentinel: WakeLockSentinel | null = null;
let refCount = 0;
let visibilityListenerAttached = false;
let pendingRequest: Promise<void> | null = null;

function isSupported(): boolean {
	return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

async function requestSentinel(): Promise<WakeLockSentinel | null> {
	try {
		return await (navigator as WakeLockNavigator).wakeLock!.request('screen');
	} catch {
		return null;
	}
}

function handleVisibilityChange(): void {
	if (document.visibilityState === 'visible' && refCount > 0 && !sentinel) {
		void ensureSentinel();
	}
}

function ensureSentinel(): Promise<void> {
	if (sentinel) return Promise.resolve();
	if (pendingRequest) return pendingRequest;
	pendingRequest = (async () => {
		const next = await requestSentinel();
		if (!next) return;
		if (refCount === 0 || sentinel) {
			try {
				await next.release();
			} catch {
				// The browser may already have released it.
			}
			return;
		}
		sentinel = next;
		next.addEventListener?.('release', () => {
			if (sentinel === next) sentinel = null;
		});
	})();
	void pendingRequest.finally(() => {
		pendingRequest = null;
	});
	return pendingRequest;
}

function attachVisibilityListener(): void {
	if (visibilityListenerAttached || typeof document === 'undefined') return;
	visibilityListenerAttached = true;
	document.addEventListener('visibilitychange', handleVisibilityChange);
}

/**
 * Acquire the screen wake lock. Reference-counted so overlapping operations
 * (e.g. analysis + retry) only release when the last one finishes.
 */
export async function acquireWakeLock(): Promise<void> {
	if (!isSupported()) return;
	refCount++;
	attachVisibilityListener();
	await ensureSentinel();
}

/**
 * Release the screen wake lock once all holders are done.
 */
export async function releaseWakeLock(): Promise<void> {
	if (!isSupported()) return;
	refCount = Math.max(0, refCount - 1);
	if (refCount > 0 || !sentinel) return;

	const current = sentinel;
	sentinel = null;
	try {
		await current.release();
	} catch {
		// Already released or unsupported — nothing to do.
	}
}
