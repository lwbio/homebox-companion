<script lang="ts">
	import Button from './Button.svelte';
	import Card from './Card.svelte';
	import { t } from '$lib/i18n/reactive.svelte';

	interface Props {
		open: boolean;
		title: string;
		message: string;
		confirmLabel?: string;
		cancelLabel?: string;
		confirmVariant?: 'primary' | 'danger';
		onConfirm: () => void;
		onCancel: () => void;
	}

	let {
		open = false,
		title,
		message,
		confirmLabel = t('confirm.accept'),
		cancelLabel = t('confirm.cancel'),
		confirmVariant = 'primary',
		onConfirm,
		onCancel,
	}: Props = $props();

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			onCancel();
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (open && event.key === 'Escape') {
			onCancel();
		}
	}
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="animate-in fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/60 backdrop-blur-sm"
		onclick={handleBackdropClick}
		role="presentation"
	>
		<div
			class="mx-4 w-full max-w-sm"
			role="dialog"
			aria-modal="true"
			aria-labelledby="dialog-title"
			aria-describedby="dialog-message"
		>
			<Card padding="lg">
				<h2 id="dialog-title" class="mb-2 text-h3 text-neutral-100">
					{title}
				</h2>
				<p id="dialog-message" class="mb-6 text-body text-neutral-400">
					{message}
				</p>
				<div class="flex gap-3">
					<Button variant="secondary" full onclick={onCancel}>
						{cancelLabel}
					</Button>
					<Button variant={confirmVariant} full onclick={onConfirm}>
						{confirmLabel}
					</Button>
				</div>
			</Card>
		</div>
	</div>
{/if}
