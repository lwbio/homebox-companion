/**
 * Reactive i18n module using Svelte 5 runes.
 *
 * This file must have .svelte.ts extension to use $state.
 * Import t from '$lib/i18n/reactive' in Svelte components.
 */

import en from './en';
import zh from './zh';

type TranslationDict = Record<string, string>;

const locales: Record<string, TranslationDict> = { en, zh };

// Reactive locale state — $state works in .svelte.ts files
let currentLocale = $state('en');

/**
 * Get the current locale code.
 */
export function getLocale(): string {
	return currentLocale;
}

/**
 * Set the active locale.
 * @param locale - Language code ('en' or 'zh')
 */
export function setLocale(locale: string): void {
	if (locales[locale]) {
		currentLocale = locale;
	}
}

/**
 * Map language name from backend config to locale code.
 * @param language - Language name like 'English' or 'Chinese'
 */
export function setLocaleFromLanguage(language: string | undefined): void {
	if (!language || language.toLowerCase() === 'english') {
		setLocale('en');
	} else if (language.toLowerCase() === 'chinese') {
		setLocale('zh');
	}
}

/**
 * Get translated text for a key.
 *
 * @param key - Dot-separated translation key (e.g., 'login.welcome')
 * @param params - Optional interpolation parameters (e.g., { count: 5 })
 * @returns Translated string, or key itself if not found
 */
export function t(key: string, params?: Record<string, string | number>): string {
	const dict = locales[currentLocale] || locales.en;
	let text = dict[key] || locales.en[key] || key;

	// Replace {param} placeholders
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
		}
	}

	return text;
}

/**
 * Get all supported locale codes.
 */
export function getSupportedLocales(): string[] {
	return Object.keys(locales);
}
