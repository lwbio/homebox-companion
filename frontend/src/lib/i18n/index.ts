/**
 * Lightweight i18n module for multi-language support.
 *
 * Usage:
 *   import { t, setLocale, getLocale } from '$lib/i18n';
 *
 *   // In component
 *   <h1>{t('login.welcome')}</h1>
 *   <p>{t('location.items', { count: 5 })}</p>
 */

import en from './en';
import zh from './zh';

type TranslationDict = Record<string, string>;

const locales: Record<string, TranslationDict> = { en, zh };

// Current locale state
let currentLocale = 'en';
// Subscribers for reactivity
let subscribers: Array<() => void> = [];

/**
 * Subscribe to locale changes (call from component setup).
 */
export function onLocaleChange(fn: () => void): () => void {
	subscribers.push(fn);
	return () => {
		subscribers = subscribers.filter((s) => s !== fn);
	};
}

function notifySubscribers() {
	for (const fn of subscribers) fn();
}

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
	if (locales[locale] && currentLocale !== locale) {
		currentLocale = locale;
		notifySubscribers();
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
