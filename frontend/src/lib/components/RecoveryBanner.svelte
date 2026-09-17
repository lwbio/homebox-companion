<script lang="ts">
	/**
	 * RecoveryBanner - Prompts user to recover a crashed session
	 *
	 * Shown when a recoverable session is detected (e.g., after page reload mid-workflow).
	 * Provides options to resume the session or start fresh.
	 */
	import { RefreshCw, ImageIcon, CheckSquare, Play } from 'lucide-svelte';
	import type { SessionSummary } from '$lib/services/sessionPersistence';
	import { t } from '$lib/i18n/reactive.svelte';
	import Button from './Button.svelte';

	interface Props {
		/** Summary of the recoverable session */
		summary: SessionSummary;
		/** Callback when user chooses to resume the session */
		onResume: () => void;
		/** Callback when user chooses to dismiss and start fresh */
		onDismiss: () => void;
		/** Whether a recovery operation is in progress */
		loading?: boolean;
	}

	let { summary, onResume, onDismiss, loading = false }: Props = $props();

	// Human-readable status
	function getStatusText(status: string): string {
		switch (status) {
			case 'location':
				return t('recovery.status.location');
			case 'capturing':
				return t('recovery.status.capturing');
			case 'analyzing':
			case 'partial_analysis':
				return t('recovery.status.analyzing');
			case 'reviewing':
				return t('recovery.status.reviewing');
			case 'confirming':
				return t('recovery.status.confirming');
			case 'submitting':
				return t('recovery.status.submitting');
			default:
				return t('recovery.status.inProgress');
		}
	}
</script>

<div
	class="mb-4 overflow-hidden rounded-xl border border-primary-500/30 bg-primary-500/10 shadow-lg"
	role="alert"
	aria-live="polite"
>
	<div class="p-4">
		<!-- Header -->
		<div class="mb-3 flex items-start gap-3">
			<!-- Recovery icon -->
			<div
				class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-500/20"
			>
				<RefreshCw class="text-primary-400" size={20} strokeWidth={1.5} />
			</div>

			<div class="flex-1">
				<h3 class="text-body font-semibold text-primary-100">{t('recovery.heading')}</h3>
				<p class="mt-1 text-body-sm text-primary-200/80">
					{#if summary.locationName}
						{t('recovery.description', {
							status: getStatusText(summary.status),
							location: summary.locationName,
							age: summary.ageText,
						})}
					{:else}
						{t('recovery.description', {
							status: getStatusText(summary.status),
							location: '',
							age: summary.ageText,
						}).replace(' at ', ' ')}
					{/if}
				</p>
			</div>
		</div>

		<!-- Session details -->
		<div class="mb-4 flex flex-wrap gap-x-4 gap-y-2 text-caption text-primary-200/70">
			{#if summary.imageCount > 0}
				<div class="flex items-center gap-1.5">
					<ImageIcon size={14} strokeWidth={1.5} />
					<span>{t('recovery.photos', { count: summary.imageCount })}</span>
				</div>
			{/if}
			{#if summary.confirmedCount > 0}
				<div class="flex items-center gap-1.5">
					<CheckSquare size={14} strokeWidth={1.5} />
					<span>{t('recovery.itemsConfirmed', { count: summary.confirmedCount })}</span>
				</div>
			{/if}
		</div>

		<div class="flex flex-col gap-2 sm:flex-row">
			<Button variant="primary" onclick={onResume} disabled={loading}>
				{#if loading}
					<div
						class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
					></div>
					<span>{t('recovery.recovering')}</span>
				{:else}
					<Play size={16} strokeWidth={1.5} />
					<span>{t('recovery.resumeSession')}</span>
				{/if}
			</Button>
			<Button variant="ghost" onclick={onDismiss} disabled={loading}>
				<span>{t('recovery.startFresh')}</span>
			</Button>
		</div>
	</div>
</div>
