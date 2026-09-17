<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import {
		Package,
		MapPin,
		Tag,
		Hash,
		Building2,
		Barcode,
		DollarSign,
		ShoppingCart,
		FileText,
		ShieldCheck,
		ArrowLeft,
		CalendarClock,
	} from 'lucide-svelte';
	import { items as itemsApi, type BlobUrlResult } from '$lib/api';
	import type { ItemDetail } from '$lib/types';
	import { routeGuards } from '$lib/utils/routeGuard';
	import { getInitPromise } from '$lib/services/tokenRefresh';
	import Loader from '$lib/components/Loader.svelte';
	import { getLocale, t } from '$lib/i18n/reactive.svelte';

	let item = $state<ItemDetail | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let thumbnailResult = $state<BlobUrlResult | null>(null);

	const itemId = $derived(page.params.id);
	const dateTimeFormatter = $derived(
		new Intl.DateTimeFormat(getLocale() === 'zh' ? 'zh-CN' : 'en-US', {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
		})
	);
	const createdTime = $derived.by(() => {
		if (!item?.createdAt) return null;
		const date = new Date(item.createdAt);
		return Number.isNaN(date.getTime()) ? null : dateTimeFormatter.format(date);
	});

	const hasExtendedFields = $derived(
		item &&
			(item.manufacturer ||
				item.modelNumber ||
				item.serialNumber ||
				item.purchasePrice ||
				item.purchaseFrom ||
				item.notes ||
				item.assetId ||
				item.insured)
	);

	onMount(async () => {
		await getInitPromise();
		if (!routeGuards.success()) return;
		await loadItem();
	});

	onDestroy(() => {
		thumbnailResult?.revoke();
	});

	async function loadItem() {
		if (!itemId) return;

		isLoading = true;
		error = null;

		try {
			item = await itemsApi.get(itemId);

			// Load thumbnail if available
			if (item.thumbnailId) {
				try {
					thumbnailResult = await itemsApi.getThumbnail(item.id, item.thumbnailId);
				} catch {
					// Thumbnail load failed - non-critical
				}
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load item';
		} finally {
			isLoading = false;
		}
	}

	function goBack() {
		if (window.history.length > 1) {
			window.history.back();
		} else {
			goto('/');
		}
	}
</script>

<svelte:head>
	<title>{item?.name ?? t('common.loading')} - Homebox Companion</title>
</svelte:head>

<div class="mx-auto max-w-2xl">
	<!-- Back button -->
	<button
		type="button"
		class="group mb-4 inline-flex items-center gap-1.5 rounded-full border border-transparent bg-neutral-700/50 px-3 py-1.5 text-sm text-neutral-400 transition-all duration-200 hover:border-neutral-700/50 hover:bg-neutral-700 hover:text-neutral-200"
		onclick={goBack}
	>
		<ArrowLeft class="transition-transform duration-200 group-hover:-translate-x-0.5" size={16} />
		<span>{t('common.back')}</span>
	</button>

	{#if isLoading}
		<div class="flex min-h-[40vh] items-center justify-center">
			<Loader size="lg" message={t('common.loading')} />
		</div>
	{:else if error}
		<div class="flex min-h-[40vh] flex-col items-center justify-center gap-4">
			<p class="text-error-400 text-body">{error}</p>
			<button
				type="button"
				class="rounded-lg bg-neutral-700 px-4 py-2 text-sm text-neutral-200 transition-colors hover:bg-neutral-600"
				onclick={loadItem}
			>
				{t('common.retry')}
			</button>
		</div>
	{:else if item}
		<!-- Item card -->
		<div class="overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-900">
			<!-- Thumbnail -->
			{#if thumbnailResult?.url}
				<div class="aspect-video w-full overflow-hidden bg-neutral-800">
					<img src={thumbnailResult.url} alt={item.name} class="h-full w-full object-contain" />
				</div>
			{:else}
				<div class="flex aspect-video w-full items-center justify-center bg-neutral-800">
					<Package class="text-neutral-600" size={64} strokeWidth={1} />
				</div>
			{/if}

			<!-- Content -->
			<div class="space-y-4 p-4">
				<!-- Name & Quantity -->
				<div class="flex items-start justify-between gap-3">
					<h1 class="text-h2 text-neutral-100">{item.name}</h1>
					{#if item.quantity > 1}
						<span
							class="flex shrink-0 items-center gap-1 rounded-lg border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-300"
						>
							<Hash size={14} strokeWidth={1.5} />
							{item.quantity}
						</span>
					{/if}
				</div>

				<!-- Description -->
				{#if item.description}
					<p class="text-body text-neutral-400">{item.description}</p>
				{/if}

				<!-- Tags -->
				{#if item.tags.length > 0}
					<div class="flex flex-wrap gap-2">
						{#each item.tags as tag (tag.id)}
							<span
								class="inline-flex items-center gap-1 rounded-lg border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-300"
							>
								<Tag size={12} strokeWidth={1.5} />
								{tag.name}
							</span>
						{/each}
					</div>
				{/if}

				<!-- Location breadcrumb -->
				{#if item.path.length > 0}
					<div class="flex items-center gap-2 text-sm text-neutral-400">
						<MapPin size={16} strokeWidth={1.5} class="shrink-0 text-neutral-500" />
						<span class="truncate">
							{item.path.map((p) => p.name).join(' / ')}
						</span>
					</div>
				{/if}

				<!-- Extended fields -->
				{#if hasExtendedFields}
					<div class="space-y-3 border-t border-neutral-700 pt-4">
						{#if item.assetId}
							<div class="flex items-center gap-3">
								<Barcode size={16} strokeWidth={1.5} class="shrink-0 text-neutral-500" />
								<div>
									<span class="text-caption text-neutral-500">{t('itemDetail.assetId')}</span>
									<p class="text-body-sm text-neutral-200">{item.assetId}</p>
								</div>
							</div>
						{/if}

						{#if item.manufacturer}
							<div class="flex items-center gap-3">
								<Building2 size={16} strokeWidth={1.5} class="shrink-0 text-neutral-500" />
								<div>
									<span class="text-caption text-neutral-500">{t('itemDetail.manufacturer')}</span>
									<p class="text-body-sm text-neutral-200">{item.manufacturer}</p>
								</div>
							</div>
						{/if}

						{#if item.modelNumber}
							<div class="flex items-center gap-3">
								<Package size={16} strokeWidth={1.5} class="shrink-0 text-neutral-500" />
								<div>
									<span class="text-caption text-neutral-500">{t('itemDetail.modelNumber')}</span>
									<p class="text-body-sm text-neutral-200">{item.modelNumber}</p>
								</div>
							</div>
						{/if}

						{#if item.serialNumber}
							<div class="flex items-center gap-3">
								<Barcode size={16} strokeWidth={1.5} class="shrink-0 text-neutral-500" />
								<div>
									<span class="text-caption text-neutral-500">{t('itemDetail.serialNumber')}</span>
									<p class="text-body-sm text-neutral-200">{item.serialNumber}</p>
								</div>
							</div>
						{/if}

						{#if item.purchasePrice}
							<div class="flex items-center gap-3">
								<DollarSign size={16} strokeWidth={1.5} class="shrink-0 text-neutral-500" />
								<div>
									<span class="text-caption text-neutral-500">{t('itemDetail.purchasePrice')}</span>
									<p class="text-body-sm text-neutral-200">
										{item.purchasePrice.toLocaleString()}
									</p>
								</div>
							</div>
						{/if}

						{#if item.purchaseFrom}
							<div class="flex items-center gap-3">
								<ShoppingCart size={16} strokeWidth={1.5} class="shrink-0 text-neutral-500" />
								<div>
									<span class="text-caption text-neutral-500">{t('itemDetail.purchaseFrom')}</span>
									<p class="text-body-sm text-neutral-200">{item.purchaseFrom}</p>
								</div>
							</div>
						{/if}

						{#if item.notes}
							<div class="flex items-start gap-3">
								<FileText size={16} strokeWidth={1.5} class="mt-0.5 shrink-0 text-neutral-500" />
								<div>
									<span class="text-caption text-neutral-500">{t('itemDetail.notes')}</span>
									<p class="whitespace-pre-wrap text-body-sm text-neutral-200">{item.notes}</p>
								</div>
							</div>
						{/if}

						{#if item.insured}
							<div class="flex items-center gap-3">
								<ShieldCheck size={16} strokeWidth={1.5} class="text-success-400 shrink-0" />
								<span class="text-success-400 text-body-sm">{t('itemDetail.insured')}</span>
							</div>
						{/if}
					</div>
				{/if}

				{#if createdTime}
					<div class="flex items-center gap-3 border-t border-neutral-700 pt-4">
						<CalendarClock size={16} strokeWidth={1.5} class="shrink-0 text-neutral-500" />
						<div>
							<span class="text-caption text-neutral-500">{t('itemDetail.createdTime')}</span>
							<time
								datetime={item.createdAt ?? undefined}
								class="block text-body-sm text-neutral-200"
							>
								{createdTime}
							</time>
						</div>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
