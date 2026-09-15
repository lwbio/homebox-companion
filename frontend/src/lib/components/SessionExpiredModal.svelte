<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { CircleAlert, Lock } from 'lucide-svelte';
	import { auth } from '$lib/api';
	import { authStore } from '$lib/stores/auth.svelte';
	import { showToast } from '$lib/stores/ui.svelte';
	import { resetLocationState } from '$lib/stores/locations.svelte';
	import { scanWorkflow } from '$lib/workflows/scan.svelte';
	import { authLogger as log } from '$lib/utils/logger';
	import { completeLegacyLogin } from '$lib/services/bootstrap';
	import Button from './Button.svelte';
	import Modal from './Modal.svelte';
	import { t } from '$lib/i18n/reactive.svelte';

	let email = $state('');
	let password = $state('');
	let isSubmitting = $state(false);
	let errorMessage = $state('');

	// Derive sessionExpired from authStore for reactive template usage
	let sessionExpired = $derived(authStore.sessionExpired);

	async function handleSubmit(e: Event) {
		e.preventDefault();

		if (!email || !password) {
			errorMessage = t('session.error.emptyFields');
			return;
		}

		isSubmitting = true;
		errorMessage = '';

		try {
			const response = await auth.login(email, password);
			authStore.setAuthenticatedState(response.token, new Date(response.expires_at), email);
			await completeLegacyLogin();
			// Reset form
			email = '';
			password = '';
			// Confirm session restoration to the user
			showToast(t('session.success.restored'), 'success');
			log.info('Re-authentication successful, session restored');
		} catch (error) {
			log.error('Re-authentication failed:', error);
			errorMessage = error instanceof Error ? error.message : t('session.error.failed');
		} finally {
			isSubmitting = false;
		}
	}

	function handleLogout() {
		scanWorkflow.reset();
		resetLocationState();
		authStore.logout();
		goto(resolve('/'));
	}

	// Prevent closing the modal (session expired is non-dismissable)
	function preventClose() {
		// Do nothing - modal should not be closable
	}
</script>

<Modal open={sessionExpired} onclose={preventClose}>
	<!-- Header -->
	<div class="-mx-6 -mt-6 mb-6 border-b border-neutral-700 bg-warning-500/10 px-6 py-4">
		<div class="flex items-center gap-3">
			<div class="rounded-full bg-warning-500/20 p-2">
				<CircleAlert class="text-warning-500" size={20} />
			</div>
			<div>
				<h3 class="text-lg font-semibold text-neutral-200">{t('session.title')}</h3>
				<p class="text-sm text-neutral-400">{t('session.subtitle')}</p>
			</div>
		</div>
	</div>

	<!-- Form -->
	<form class="space-y-4" onsubmit={handleSubmit}>
		{#if errorMessage}
			<div class="rounded-lg border border-error-500/20 bg-error-500/10 p-3 text-sm text-error-500">
				{errorMessage}
			</div>
		{/if}

		<div>
			<label for="reauth-email" class="label">{t('session.email')}</label>
			<input
				type="email"
				id="reauth-email"
				bind:value={email}
				placeholder={t('session.emailPlaceholder')}
				required
				disabled={isSubmitting}
				autocomplete="email"
				class="input"
			/>
		</div>

		<div>
			<label for="reauth-password" class="label">{t('session.password')}</label>
			<input
				type="password"
				id="reauth-password"
				bind:value={password}
				placeholder={t('session.passwordPlaceholder')}
				required
				disabled={isSubmitting}
				autocomplete="current-password"
				class="input"
			/>
		</div>

		<div class="flex flex-col gap-2 pt-2">
			<Button type="submit" variant="primary" full loading={isSubmitting}>
				<Lock size={20} strokeWidth={2} />
				<span>{t('session.signIn')}</span>
			</Button>

			<button
				type="button"
				class="py-2 text-sm text-neutral-400 transition-colors hover:text-neutral-200"
				onclick={handleLogout}
				disabled={isSubmitting}
			>
				{t('session.signOut')}
			</button>
		</div>
	</form>
</Modal>
