<script lang="ts">
	/**
	 * Compact warning icon with tooltip for the Summary page.
	 *
	 * Displays a warning icon next to items that may be duplicates.
	 * Hovering or focusing the icon shows tooltip with duplicate details.
	 */
	import type { DuplicateMatch } from '$lib/types';
	import WarningTriangleIcon from './icons/WarningTriangleIcon.svelte';
	import { t } from '$lib/i18n/reactive.svelte';

	interface Props {
		match: DuplicateMatch;
	}

	let { match }: Props = $props();
	let showTooltip = $state(false);
</script>

<div class="relative">
	<!-- Warning icon button -->
	<button
		type="button"
		class="text-warning-400 transition-colors hover:text-warning-300"
		onmouseenter={() => (showTooltip = true)}
		onmouseleave={() => (showTooltip = false)}
		onfocus={() => (showTooltip = true)}
		onblur={() => (showTooltip = false)}
		aria-label={t('review.duplicateWarning')}
	>
		<WarningTriangleIcon class="h-5 w-5" />
	</button>

	<!-- Tooltip -->
	{#if showTooltip}
		<div class="absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2">
			<div class="rounded-lg border border-neutral-700 bg-neutral-800 p-3 text-body-sm shadow-lg">
				<p class="mb-1 font-semibold text-warning-300">{t('review.duplicateWarning')}</p>
				<p class="text-neutral-300">
					{t('duplicate.serialExists', { serial: match.serial_number })}
				</p>
				<p class="mt-1 font-medium text-neutral-100">
					"{match.item_name}"
					{#if match.location_name}
						<span class="font-normal text-neutral-400"
							>{t('duplicate.inLocation', { location: match.location_name })}</span
						>
					{/if}
				</p>
			</div>
			<!-- Tooltip arrow -->
			<div
				class="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-neutral-700 bg-neutral-800"
			></div>
		</div>
	{/if}
</div>
