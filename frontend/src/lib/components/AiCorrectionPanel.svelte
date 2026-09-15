<script lang="ts">
	import { slide } from 'svelte/transition';
	import { ChevronDown, RefreshCcw } from 'lucide-svelte';
	import Button from './Button.svelte';
	import AnalysisProgressBar from './AnalysisProgressBar.svelte';
	import { t } from '$lib/i18n/reactive.svelte';

	interface Props {
		expanded: boolean;
		loading: boolean;
		onToggle: () => void;
		onCorrect: (prompt: string) => void;
	}

	let { expanded, loading, onToggle, onCorrect }: Props = $props();

	let correctionPrompt = $state('');

	function handleCorrect() {
		if (correctionPrompt.trim()) {
			onCorrect(correctionPrompt);
			correctionPrompt = '';
		}
	}
</script>

<div class="border-t border-neutral-700 pt-4">
	<button
		type="button"
		class="flex w-full items-center gap-2 text-sm text-neutral-400 hover:text-neutral-200"
		onclick={onToggle}
	>
		<ChevronDown class="transition-transform {expanded ? 'rotate-180' : ''}" size={16} />
		<span>{t('aiCorrection.title')}</span>
	</button>

	{#if expanded}
		<div class="mt-3 space-y-3" transition:slide={{ duration: 200 }}>
			{#if loading}
				<AnalysisProgressBar current={0} total={1} message={t('aiCorrection.correcting')} />
			{:else}
				<p class="text-xs text-neutral-500">
					{t('aiCorrection.description')}
				</p>
				<textarea
					bind:value={correctionPrompt}
					placeholder={t('aiCorrection.placeholder')}
					rows="2"
					class="input resize-none"
				></textarea>
				<Button
					variant="secondary"
					full
					onclick={handleCorrect}
					{loading}
					disabled={loading || !correctionPrompt.trim()}
				>
					<RefreshCcw size={16} strokeWidth={2} />
					<span>{t('aiCorrection.button')}</span>
				</Button>
			{/if}
		</div>
	{/if}
</div>
