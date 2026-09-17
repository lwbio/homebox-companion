<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount, onDestroy } from 'svelte';
	import { items as itemsApi, locations as locationsApi, tags as tagsApi } from '$lib/api';
	import type { BlobUrlResult } from '$lib/api';
	import { getInitPromise } from '$lib/services/tokenRefresh';
	import { routeGuards } from '$lib/utils/routeGuard';
	import Loader from '$lib/components/Loader.svelte';
	import { getLocale, t } from '$lib/i18n/reactive.svelte';
	import { Package, MapPin, Tag, ArrowLeft } from 'lucide-svelte';
	import type { ItemListItem } from '$lib/types';

	const PAGE_SIZE = 10;

	let allItems = $state<ItemListItem[]>([]);
	let isLoading = $state(true);
	let isLoadingMore = $state(false);
	let error = $state<string | null>(null);
	let filterName = $state<string | null>(null);
	let thumbnailResults = $state(new Map<string, BlobUrlResult>());
	let currentPage = $state(1);
	let total = $state(0);
	let sentinel = $state<HTMLElement | null>(null);
	let observer = $state<IntersectionObserver | null>(null);
	let loadMoreError = $state<string | null>(null);

	const locationId = $derived(page.url.searchParams.get('location_id'));
	const tagId = $derived(page.url.searchParams.get('tag'));
	const returnTo = $derived(page.url.searchParams.get('return_to'));
	const hasMore = $derived(allItems.length < total);
	const dateFormatter = $derived(
		new Intl.DateTimeFormat(getLocale() === 'zh' ? 'zh-CN' : 'en-US', {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
		})
	);

	function formatCreatedDate(value: string | null | undefined): string | null {
		if (!value) return null;
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? null : dateFormatter.format(date);
	}

	onMount(async () => {
		await getInitPromise();
		if (!routeGuards.success()) return;
		await loadFilterName();
		await loadFirstPage();
		setupObserver();
	});

	onDestroy(() => {
		observer?.disconnect();
		for (const result of thumbnailResults.values()) {
			result.revoke();
		}
	});

	function setupObserver() {
		observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting && hasMore && !isLoadingMore && !isLoading) {
					loadNextPage();
				}
			},
			{ rootMargin: '200px' }
		);
	}

	$effect(() => {
		if (sentinel && observer) {
			observer.observe(sentinel);
		}
	});

	let prevLocationId = $state<string | null>(null);
	let prevTagId = $state<string | null>(null);
	let filtersInitialized = false;

	$effect(() => {
		if (!filtersInitialized) {
			prevLocationId = locationId;
			prevTagId = tagId;
			filtersInitialized = true;
			return;
		}

		if (locationId !== prevLocationId || tagId !== prevTagId) {
			prevLocationId = locationId;
			prevTagId = tagId;
			// Reset and reload
			observer?.disconnect();
			for (const result of thumbnailResults.values()) {
				result.revoke();
			}
			allItems = [];
			thumbnailResults = new Map();
			loadFilterName();
			loadFirstPage().then(() => setupObserver());
		}
	});

	async function loadFilterName() {
		try {
			if (locationId) {
				const loc = await locationsApi.get(locationId);
				filterName = loc.name;
			} else if (tagId) {
				const tags = await tagsApi.list();
				const tag = tags.find((t) => t.id === tagId);
				filterName = tag?.name ?? null;
			}
		} catch {
			filterName = null;
		}
	}

	async function loadFirstPage() {
		isLoading = true;
		error = null;
		currentPage = 1;

		try {
			const response = await itemsApi.list(
				locationId ?? undefined,
				tagId ?? undefined,
				1,
				PAGE_SIZE
			);
			allItems = response?.items ?? [];
			total = response?.total ?? 0;
			await loadThumbnails(allItems);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load items';
		} finally {
			isLoading = false;
		}
	}

	async function loadNextPage() {
		if (!hasMore || isLoadingMore) return;

		isLoadingMore = true;
		loadMoreError = null;
		currentPage++;

		try {
			const response = await itemsApi.list(
				locationId ?? undefined,
				tagId ?? undefined,
				currentPage,
				PAGE_SIZE
			);
			const newItems = response?.items ?? [];
			allItems = [...allItems, ...newItems];
			total = response?.total ?? total;
			await loadThumbnails(newItems);
		} catch (e) {
			loadMoreError = e instanceof Error ? e.message : 'Failed to load more items';
			currentPage--;
		} finally {
			isLoadingMore = false;
		}
	}

	async function loadThumbnails(newItems: ItemListItem[]) {
		const itemsWithThumbs = newItems.filter((item) => item.thumbnailId);
		if (itemsWithThumbs.length === 0) return;

		await Promise.allSettled(
			itemsWithThumbs.map(async (item) => {
				try {
					const result = await itemsApi.getThumbnail(item.id, item.thumbnailId!);
					const newMap = new Map(thumbnailResults);
					newMap.set(item.id, result);
					thumbnailResults = newMap;
				} catch {
					// Thumbnail load failed - non-critical
				}
			})
		);
	}

	function goToItem(itemId: string) {
		goto(resolve('/items/[id]', { id: itemId }));
	}

	function goBack() {
		if (window.history.length > 1) {
			window.history.back();
			return;
		}

		if (returnTo) {
			const returnUrl = new URL(returnTo, window.location.origin);
			if (
				returnUrl.origin === window.location.origin &&
				returnUrl.pathname === resolve('/location')
			) {
				goto(`${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`);
				return;
			}
		}

		goto('/');
	}
</script>

<svelte:head>
	<title>{t('common.items')} - Homebox Companion</title>
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

	<!-- Header -->
	<div class="mb-4">
		<h1 class="text-h2 text-neutral-100">
			{#if filterName}
				{filterName}
			{:else}
				{t('common.items')}
			{/if}
		</h1>
		{#if filterName}
			<p class="mt-1 text-body-sm text-neutral-400">{t('common.items')}</p>
		{/if}
	</div>

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
				onclick={loadFirstPage}
			>
				{t('common.retry')}
			</button>
		</div>
	{:else if allItems.length === 0}
		<div class="flex min-h-[40vh] flex-col items-center justify-center gap-2">
			<Package class="text-neutral-600" size={48} strokeWidth={1} />
			<p class="text-body text-neutral-400">No items found</p>
		</div>
	{:else}
		<div class="space-y-2">
			{#each allItems as item (item.id)}
				{@const createdDate = formatCreatedDate(item.createdAt)}
				<button
					type="button"
					class="flex w-full items-center gap-3 rounded-xl border border-neutral-700 bg-neutral-900 p-3 text-left transition-colors hover:border-neutral-600 hover:bg-neutral-800"
					onclick={() => goToItem(item.id)}
				>
					<!-- Thumbnail -->
					{#if thumbnailResults.get(item.id)?.url}
						<div class="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-neutral-800">
							<img
								src={thumbnailResults.get(item.id)!.url}
								alt={item.name}
								class="h-full w-full object-cover"
							/>
						</div>
					{:else}
						<div
							class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-neutral-800"
						>
							<Package class="text-neutral-600" size={20} strokeWidth={1.5} />
						</div>
					{/if}

					<!-- Info -->
					<div class="min-w-0 flex-1">
						<p class="truncate text-body-sm font-medium text-neutral-200">{item.name}</p>
						<div class="mt-0.5 flex flex-wrap items-center gap-2">
							{#if item.quantity > 1}
								<span class="text-caption text-neutral-500">x{item.quantity}</span>
							{/if}
							{#if item.location}
								<span class="inline-flex items-center gap-1 text-caption text-neutral-500">
									<MapPin size={10} strokeWidth={1.5} />
									{item.location.name}
								</span>
							{/if}
							{#each item.tags as tag (tag.id)}
								<span
									class="inline-flex items-center gap-1 rounded-md border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-caption text-neutral-400"
								>
									<Tag size={8} strokeWidth={1.5} />
									{tag.name}
								</span>
							{/each}
						</div>
					</div>

					{#if createdDate}
						<div class="shrink-0 text-right">
							<time
								datetime={item.createdAt ?? undefined}
								class="whitespace-nowrap text-caption text-neutral-400"
							>
								{createdDate}
							</time>
						</div>
					{/if}
				</button>
			{/each}

			<!-- Infinite scroll sentinel -->
			{#if hasMore}
				<div bind:this={sentinel} class="flex justify-center py-4">
					{#if isLoadingMore}
						<Loader size="sm" />
					{/if}
				</div>
			{/if}
			{#if loadMoreError}
				<p class="text-error-400 py-2 text-center text-caption">{loadMoreError}</p>
			{/if}
		</div>
	{/if}
</div>
