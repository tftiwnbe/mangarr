import { browser } from '$app/environment';
import { init, register, getLocaleFromNavigator, locale, _, waitLocale } from 'svelte-i18n';

// Supported locales
export const SUPPORTED_LOCALES = ['en', 'ru'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

// Locale metadata
export const LOCALE_META: Record<
	SupportedLocale,
	{ name: string; nativeName: string; flag: string }
> = {
	en: { name: 'English', nativeName: 'English', flag: '🇺🇸' },
	ru: { name: 'Russian', nativeName: 'Русский', flag: '🇷🇺' }
};

// Default locale
export const DEFAULT_LOCALE: SupportedLocale = 'en';

// Storage key for user's locale preference
const LOCALE_STORAGE_KEY = 'mangarr-locale';

// Register all locales with lazy loading
register('en', () => import('./locales/en.json'));
register('ru', () => import('./locales/ru.json'));

/**
 * Get the stored locale preference from localStorage
 */
function getStoredLocale(): SupportedLocale | null {
	if (!browser) return null;

	const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
	if (stored && SUPPORTED_LOCALES.includes(stored as SupportedLocale)) {
		return stored as SupportedLocale;
	}
	return null;
}

/**
 * Save locale preference to localStorage
 */
export function setStoredLocale(newLocale: SupportedLocale): void {
	if (browser) {
		localStorage.setItem(LOCALE_STORAGE_KEY, newLocale);
	}
	locale.set(newLocale);
}

/**
 * Detect the best initial locale
 */
function detectInitialLocale(): SupportedLocale {
	// 1. Check stored preference
	const stored = getStoredLocale();
	if (stored) return stored;

	// 2. Check browser language
	if (browser) {
		const browserLocale = getLocaleFromNavigator();
		if (browserLocale) {
			// Extract language code (e.g., 'en-US' -> 'en')
			const langCode = browserLocale.split('-')[0];
			if (SUPPORTED_LOCALES.includes(langCode as SupportedLocale)) {
				return langCode as SupportedLocale;
			}
		}
	}

	// 3. Fallback to default
	return DEFAULT_LOCALE;
}

/**
 * Initialize the i18n system
 * Call this once in your root layout
 */
export function initI18n(): void {
	init({
		fallbackLocale: DEFAULT_LOCALE,
		initialLocale: detectInitialLocale()
	});
}

/**
 * Wait for the locale to be loaded
 * Useful for SSR or when you need translations before rendering
 */
export async function loadLocale(): Promise<void> {
	await waitLocale();
}

/**
 * Get current locale value (reactive)
 */
export { locale, _ };

/**
 * Type-safe translation function wrapper
 * Use this for better autocomplete in your IDE
 */
export type TranslationKey = string; // Will be replaced with generated types later

/**
 * Check if a locale is supported
 */
export function isSupported(localeCode: string): localeCode is SupportedLocale {
	return SUPPORTED_LOCALES.includes(localeCode as SupportedLocale);
}

/**
 * Get locale display info
 */
export function getLocaleInfo(localeCode: SupportedLocale) {
	return LOCALE_META[localeCode];
}
