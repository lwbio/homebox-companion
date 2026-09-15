<script lang="ts">
	import { MapPin, Home, Check } from 'lucide-svelte';
	import type { Location } from '$lib/types';
	import Modal from './Modal.svelte';
	import Button from './Button.svelte';
	import { t } from '$lib/i18n/reactive.svelte';

	interface Props {
		open: boolean;
		mode: 'create' | 'edit';
		location?: Location | null;
		parentLocation?: { id: string; name: string } | null;
		onclose?: () => void;
		onsave: (data: { name: string; description: string; parentId: string | null }) => Promise<void>;
	}

	let {
		open = $bindable(),
		mode,
		location = null,
		parentLocation = null,
		onclose,
		onsave,
	}: Props = $props();

	let name = $state('');
	let description = $state('');
	let saveState = $state<'idle' | 'saving' | 'success' | 'error'>('idle');
	let error = $state('');

	// Reset form when modal opens
	$effect(() => {
		if (open) {
			if (mode === 'edit' && location) {
				name = location.name;
				description = location.description || '';
			} else {
				name = '';
				description = '';
			}
			error = '';
			saveState = 'idle';
		}
	});

	async function handleSubmit(e: Event) {
		e.preventDefault();

		if (!name.trim()) {
			error = t('locationModal.error.nameRequired');
			return;
		}

		saveState = 'saving';
		error = '';

		try {
			await onsave({
				name: name.trim(),
				description: description.trim(),
				parentId: mode === 'create' ? parentLocation?.id || null : null,
			});

			// Show success state
			saveState = 'success';

			// Close modal after brief delay to show success
			setTimeout(() => {
				open = false;
			}, 800);
		} catch (err) {
			saveState = 'error';
			error = err instanceof Error ? err.message : t('locationModal.error.saveFailed');
		}
	}

	function handleClose() {
		// Prevent closing while saving or showing success
		if (saveState === 'saving' || saveState === 'success') return;
		open = false;
		onclose?.();
	}

	const title = $derived(mode === 'create' ? t('locationModal.create') : t('locationModal.edit'));
	const isSaving = $derived(saveState === 'saving' || saveState === 'success');
</script>

<Modal bind:open {title} onclose={handleClose}>
	<form onsubmit={handleSubmit} class="space-y-4">
		{#if mode === 'create' && parentLocation}
			<div class="rounded-lg border border-neutral-700 bg-neutral-700 p-3">
				<p class="text-sm text-neutral-400">{t('locationModal.creatingInside')}</p>
				<p class="flex items-center gap-2 font-medium text-neutral-200">
					<MapPin class="text-primary" size={16} />
					{parentLocation.name}
				</p>
			</div>
		{:else if mode === 'create'}
			<div class="rounded-lg border border-neutral-700 bg-neutral-700 p-3">
				<p class="text-sm text-neutral-400">{t('locationModal.creatingAt')}</p>
				<p class="flex items-center gap-2 font-medium text-neutral-200">
					<Home class="text-primary" size={16} />
					{t('locationModal.rootLevel')}
				</p>
			</div>
		{/if}

		<div>
			<label for="location-name" class="mb-1 block text-sm font-medium text-neutral-200">
				{t('locationModal.name')} <span class="text-error">*</span>
			</label>
			<input
				id="location-name"
				type="text"
				bind:value={name}
				placeholder={t('locationModal.namePlaceholder')}
				class="placeholder:text-neutral-200-dim w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-neutral-200 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
				disabled={isSaving}
			/>
		</div>

		<div>
			<label for="location-description" class="mb-1 block text-sm font-medium text-neutral-200">
				{t('locationModal.description')}
			</label>
			<textarea
				id="location-description"
				bind:value={description}
				placeholder={t('locationModal.descriptionPlaceholder')}
				rows="3"
				class="placeholder:text-neutral-200-dim w-full resize-none rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-neutral-200 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
				disabled={isSaving}
			></textarea>
		</div>

		{#if error}
			<div class="rounded-lg border border-error/30 bg-error/10 p-3">
				<p class="text-sm text-error">{error}</p>
			</div>
		{/if}

		<div class="flex gap-3 pt-2">
			<Button variant="secondary" full onclick={handleClose} disabled={isSaving}
				>{t('common.cancel')}</Button
			>
			<Button variant="primary" full type="submit" disabled={isSaving || !name.trim()}>
				{#if saveState === 'saving'}
					<div
						class="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white"
					></div>
					<span>{t('common.saving')}</span>
				{:else if saveState === 'success'}
					<div class="flex h-8 w-8 items-center justify-center rounded-full bg-success-500/20">
						<Check class="text-success-500" size={20} strokeWidth={2.5} />
					</div>
					<span>{t('common.saved')}</span>
				{:else}
					<Check size={20} />
					<span>{mode === 'create' ? t('locationModal.create') : t('locationModal.edit')}</span>
				{/if}
			</Button>
		</div>
	</form>
</Modal>
