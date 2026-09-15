<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import QrScanner from 'qr-scanner';
	// heic2any is lazy-loaded in convertHeicIfNeeded() to save ~350KB initial bundle
	import { X, TriangleAlert, Camera } from 'lucide-svelte';
	import { qrLogger as log } from '$lib/utils/logger';
	import { t } from '$lib/i18n/reactive.svelte';

	interface Props {
		onScan: (decodedText: string) => void;
		onClose: () => void;
		onError?: (error: string) => void;
		/** Title shown in the scanner header (default: "Scan QR Code") */
		title?: string;
	}

	let { onScan, onClose, onError, title = t('qr.title') }: Props = $props();

	let videoElement = $state<HTMLVideoElement>();
	let fileInput: HTMLInputElement;
	let qrScanner: QrScanner | null = null;
	let error = $state<string | null>(null);
	let isStarting = $state(true);
	let hasScanned = $state(false);
	let cameraFailed = $state(false);
	let isInsecureContext = $state(false);
	let errorDebugCode = $state<string | null>(null);
	let isProcessingFile = $state(false);

	async function startCamera() {
		error = null;
		errorDebugCode = null;
		isStarting = true;
		cameraFailed = false;
		hasScanned = false;

		try {
			// Check for secure context - camera APIs require HTTPS
			if (!window.isSecureContext) {
				isInsecureContext = true;
				error = t('qr.error.httpsRequired');
				isStarting = false;
				cameraFailed = true;
				onError?.(error);
				return;
			}

			if (!videoElement) {
				error = t('qr.error.videoNotReady');
				isStarting = false;
				cameraFailed = true;
				onError?.(error);
				return;
			}

			// Use library's official method to check camera availability
			const hasCamera = await QrScanner.hasCamera();
			if (!hasCamera) {
				error = t('qr.error.noCamera');
				errorDebugCode = 'NOCAMERA';
				isStarting = false;
				cameraFailed = true;
				onError?.(error);
				return;
			}

			// Get list of available cameras to help with selection
			const cameras = await QrScanner.listCameras(true);
			log.info(
				'Available cameras:',
				cameras.map((c) => ({ id: c.id, label: c.label }))
			);

			// Determine which camera to use:
			// - Prefer 'environment' (back camera) for QR scanning
			// - Fall back to first available camera if no environment camera found
			let preferredCamera: string | undefined = 'environment';

			// Check if we have an environment/back camera
			const hasEnvironmentCamera = cameras.some(
				(c) =>
					c.label.toLowerCase().includes('back') ||
					c.label.toLowerCase().includes('rear') ||
					c.label.toLowerCase().includes('environment')
			);

			if (!hasEnvironmentCamera && cameras.length > 0) {
				// No labeled back camera - use the first available camera by ID
				preferredCamera = cameras[0].id;
				log.info(`No environment camera found, using camera: ${cameras[0].label || cameras[0].id}`);
			}

			qrScanner = new QrScanner(
				videoElement,
				(result: QrScanner.ScanResult) => {
					if (hasScanned) return; // Prevent multiple scans
					hasScanned = true;

					// Stop scanning before calling callback
					stopScanner().then(() => {
						onScan(result.data);
					});
				},
				{
					preferredCamera,
					highlightScanRegion: true,
					highlightCodeOutline: true,
					returnDetailedScanResult: true,
				}
			);

			await qrScanner.start();
			isStarting = false;
			log.info('Camera started successfully');
		} catch (err) {
			isStarting = false;
			cameraFailed = true;

			// Gather diagnostic info
			const errorName = err instanceof Error ? err.name : 'Unknown';
			const errorMessage = err instanceof Error ? err.message : String(err);
			const userAgent = navigator.userAgent;

			// Log detailed diagnostic info for debugging
			log.error('Camera initialization failed:', {
				errorName,
				errorMessage,
				errorStack: err instanceof Error ? err.stack : undefined,
				userAgent,
				isSecureContext: window.isSecureContext,
				protocol: window.location.protocol,
				hostname: window.location.hostname,
			});

			// Create a short error code for support reference (e.g., "NOTALLOW" from "NotAllowedError")
			errorDebugCode =
				errorName
					.replace(/Error$/, '')
					.toUpperCase()
					.slice(0, 10) || 'UNKNOWN';

			if (err instanceof Error) {
				const msg = err.message || '';
				const name = err.name || '';

				if (
					name === 'NotAllowedError' ||
					msg.includes('Permission') ||
					msg.includes('NotAllowed')
				) {
					error = t('qr.error.permissionDenied');
				} else if (
					name === 'NotFoundError' ||
					msg.includes('NotFound') ||
					msg.includes('DevicesNotFound')
				) {
					error = t('qr.error.noCamera');
				} else if (name === 'NotReadableError' || msg.includes('NotReadable')) {
					error = t('qr.error.inUse');
				} else if (name === 'OverconstrainedError' || msg.includes('Overconstrained')) {
					error = t('qr.error.settingsNotSupported');
				} else if (name === 'NotSupportedError' || msg.includes('NotSupported')) {
					error = t('qr.error.notSupported');
				} else if (name === 'AbortError' || msg.includes('Abort')) {
					error = t('qr.error.aborted');
				} else if (name === 'SecurityError' || msg.includes('Security')) {
					error = t('qr.error.blocked');
				} else {
					error = t('qr.error.generic', { error: msg || 'Unknown error' });
				}
			} else {
				error = t('qr.error.failedToStart');
			}

			onError?.(error);
		}
	}

	onMount(() => {
		startCamera();
	});

	async function stopScanner() {
		if (qrScanner) {
			try {
				qrScanner.stop();
				qrScanner.destroy();
				qrScanner = null;
			} catch (err) {
				log.debug('Error stopping scanner:', err);
			}
		}
	}

	onDestroy(() => {
		stopScanner();
	});

	function handleClose() {
		stopScanner().then(() => {
			onClose();
		});
	}

	async function handleRetryCamera() {
		await stopScanner();
		startCamera();
	}

	function triggerFileUpload() {
		fileInput?.click();
	}

	// Convert HEIC images to JPEG (iOS may send HEIC format)
	// Uses dynamic import to avoid loading ~350KB library unless needed
	async function convertHeicIfNeeded(file: File): Promise<Blob> {
		const isHeic =
			file.type === 'image/heic' ||
			file.type === 'image/heif' ||
			file.name.toLowerCase().endsWith('.heic') ||
			file.name.toLowerCase().endsWith('.heif');

		if (isHeic) {
			// Lazy-load heic2any only when we actually need it
			const { default: heic2any } = await import('heic2any');
			const blob = await heic2any({
				blob: file,
				toType: 'image/jpeg',
				quality: 0.92,
			});
			return Array.isArray(blob) ? blob[0] : blob;
		}
		return file;
	}

	// Scale down large images - qr-scanner fails on images > ~2MP
	const MAX_IMAGE_DIMENSION = 1280;

	async function scaleDownImage(blob: Blob): Promise<Blob> {
		return new Promise((resolve, reject) => {
			const img = new Image();
			const url = URL.createObjectURL(blob);

			img.onload = () => {
				let width = img.naturalWidth;
				let height = img.naturalHeight;

				// Scale down if image is too large
				if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
					const scale = MAX_IMAGE_DIMENSION / Math.max(width, height);
					width = Math.round(width * scale);
					height = Math.round(height * scale);
				}

				const canvas = document.createElement('canvas');
				canvas.width = width;
				canvas.height = height;
				const ctx = canvas.getContext('2d');
				if (!ctx) {
					URL.revokeObjectURL(url);
					reject(new Error('Canvas context not available'));
					return;
				}

				ctx.drawImage(img, 0, 0, width, height);

				canvas.toBlob(
					(resultBlob) => {
						URL.revokeObjectURL(url);
						if (resultBlob) {
							resolve(resultBlob);
						} else {
							reject(new Error('Canvas conversion failed'));
						}
					},
					'image/jpeg',
					0.92
				);
			};
			img.onerror = () => {
				URL.revokeObjectURL(url);
				reject(new Error('Failed to load image'));
			};
			img.src = url;
		});
	}

	async function handleFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		isProcessingFile = true;
		error = null;

		try {
			// Convert HEIC to JPEG if needed (iOS camera photos)
			const converted = await convertHeicIfNeeded(file);

			// Scale down image (qr-scanner fails on large images)
			const scaled = await scaleDownImage(converted);

			// Scan for QR code
			const result = await QrScanner.scanImage(scaled, {
				returnDetailedScanResult: true,
			});

			hasScanned = true;
			await stopScanner();
			onScan(result.data);
		} catch (err) {
			if (err instanceof Error && err.message.includes('No QR code found')) {
				error = t('qr.error.noQrFound');
			} else {
				error = t('qr.error.readFailed');
			}
			onError?.(error);
		} finally {
			isProcessingFile = false;
			// Reset file input so the same file can be selected again
			input.value = '';
		}
	}
</script>

<!-- Hidden file input for camera capture fallback -->
<input
	bind:this={fileInput}
	type="file"
	accept="image/*"
	capture="environment"
	onchange={handleFileSelect}
	class="hidden"
/>

<!-- Full-screen modal overlay -->
<div class="fixed inset-0 z-overlay flex flex-col bg-neutral-950">
	<!-- Header -->
	<div class="flex items-center justify-between bg-neutral-950/80 p-4">
		<h2 class="font-semibold text-neutral-100">{title}</h2>
		<button
			type="button"
			onclick={handleClose}
			class="p-2 text-neutral-400 transition-colors hover:text-neutral-100"
			aria-label={t('qr.closeScanner')}
		>
			<X size={24} />
		</button>
	</div>

	<!-- Scanner area -->
	<div class="flex flex-1 items-center justify-center p-4">
		{#if cameraFailed}
			<div class="max-w-sm p-6 text-center">
				<div
					class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/20"
				>
					<TriangleAlert class="text-amber-400" size={32} />
				</div>
				<p class="mb-2 text-neutral-300">{error}</p>
				{#if errorDebugCode}
					<p class="mb-4 font-mono text-xs text-neutral-500">Error code: {errorDebugCode}</p>
				{/if}

				<!-- Action buttons -->
				<div class="flex flex-col gap-3">
					<!-- File upload button (always available as fallback) -->
					<button
						type="button"
						onclick={triggerFileUpload}
						disabled={isProcessingFile}
						class="flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-3 text-neutral-100 transition-colors hover:bg-primary-500 disabled:opacity-50"
					>
						{#if isProcessingFile}
							<div
								class="h-5 w-5 animate-spin rounded-full border-2 border-neutral-100 border-t-transparent"
							></div>
							<span>{t('qr.processing')}</span>
						{:else}
							<Camera size={20} />
							<span>{t('qr.takePhoto')}</span>
						{/if}
					</button>

					<!-- Retry camera button (not shown for HTTPS issues) -->
					{#if !isInsecureContext}
						<button
							type="button"
							onclick={handleRetryCamera}
							class="rounded-lg bg-neutral-800 px-4 py-2 text-neutral-100 transition-colors hover:bg-neutral-700"
						>
							{t('qr.tryCameraAgain')}
						</button>
					{/if}

					<button
						type="button"
						onclick={handleClose}
						class="px-4 py-2 text-neutral-500 transition-colors hover:text-neutral-100"
					>
						{t('common.cancel')}
					</button>
				</div>
			</div>
		{:else}
			<div class="relative">
				<!-- Video element for QR scanner -->
				<video
					bind:this={videoElement}
					class="rounded-xl bg-neutral-950"
					style="width: min(90vw, 400px); height: min(90vw, 400px); object-fit: cover;"
				>
					<track kind="captions" label="No captions available" />
				</video>

				<!-- Scanning overlay -->
				{#if isStarting}
					<div
						class="absolute inset-0 flex items-center justify-center rounded-xl bg-neutral-950/50"
					>
						<div class="text-center">
							<div
								class="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-2 border-neutral-100 border-t-transparent"
							></div>
							<p class="text-body-sm text-neutral-300">{t('qr.startingCamera')}</p>
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Footer with instructions -->
	<div class="bg-neutral-950/80 p-4 text-center">
		{#if cameraFailed}
			<p class="text-body-sm text-neutral-500">{t('qr.instruction')}</p>
		{:else}
			<p class="text-body-sm text-neutral-500">{t('qr.instructionDetail')}</p>
		{/if}
	</div>
</div>

<style>
	/* Style the qr-scanner overlay - uses CSS custom property for primary color */
	:global(.scan-region-highlight) {
		border: 2px solid theme('colors.primary.500') !important;
		border-radius: 0.5rem;
	}

	:global(.scan-region-highlight-svg) {
		stroke: theme('colors.primary.500') !important;
	}

	:global(.code-outline-highlight) {
		stroke: theme('colors.primary.500') !important;
		stroke-width: 3px;
	}
</style>
