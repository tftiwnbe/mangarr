import { browser } from '$app/environment';
import type { ConvexClient } from 'convex/browser';

import { convexApi } from '$lib/convex/api';

const INSTALLATION_KEY = 'mangarr:notification-installation-key';
let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

export type NotificationCapability = {
	supported: boolean;
	pushSupported: boolean;
	badgingSupported: boolean;
	installed: boolean;
	iosLike: boolean;
	permission: NotificationPermission | 'unsupported';
};

export type NotificationEventItem = {
	id: string;
	titleId: string;
	titleName: string;
	latestChapterName: string;
	newChapterCount: number;
	path: string;
	icon: string;
	tag: string;
	lastDeliveredAt: number | null;
};

function getStandaloneMediaMatch() {
	return typeof window.matchMedia === 'function'
		? window.matchMedia('(display-mode: standalone)').matches
		: false;
}

export function getNotificationCapability(): NotificationCapability {
	if (!browser) {
		return {
			supported: false,
			pushSupported: false,
			badgingSupported: false,
			installed: false,
			iosLike: false,
			permission: 'unsupported'
		};
	}
	const iosLike = /iPad|iPhone|iPod/i.test(navigator.userAgent);
	const installed =
		getStandaloneMediaMatch() ||
		(window.navigator as Navigator & { standalone?: boolean }).standalone === true;
	const supported = 'Notification' in window && 'serviceWorker' in navigator;
	const pushSupported =
		supported &&
		'PushManager' in window &&
		(typeof ServiceWorkerRegistration !== 'undefined'
			? 'showNotification' in ServiceWorkerRegistration.prototype
			: false);
	const badgingSupported =
		'navigator' in window && ('setAppBadge' in navigator || 'clearAppBadge' in navigator);

	return {
		supported,
		pushSupported,
		badgingSupported,
		installed,
		iosLike,
		permission: supported ? Notification.permission : 'unsupported'
	};
}

export async function registerMangarrServiceWorker() {
	if (!browser || !('serviceWorker' in navigator)) return null;
	if (!registrationPromise) {
		registrationPromise = navigator.serviceWorker
			.register('/service-worker.js')
			.then(async (registration) => {
				await navigator.serviceWorker.ready;
				return registration;
			})
			.catch(() => null);
	}
	return registrationPromise;
}

function toUint8Array(base64: string) {
	const normalized = base64.replace(/-/g, '+').replace(/_/g, '/');
	const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
	const raw = window.atob(padded);
	return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export function getOrCreateNotificationInstallationKey() {
	if (!browser) return '';
	try {
		const existing = localStorage.getItem(INSTALLATION_KEY);
		if (existing?.trim()) return existing;
		const created =
			typeof crypto.randomUUID === 'function'
				? crypto.randomUUID()
				: `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
		localStorage.setItem(INSTALLATION_KEY, created);
		return created;
	} catch {
		return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
	}
}

export function getNotificationInstallationKey() {
	if (!browser) return '';
	try {
		return localStorage.getItem(INSTALLATION_KEY)?.trim() ?? '';
	} catch {
		return '';
	}
}

export async function subscribeToWebPush(args: {
	client: Pick<ConvexClient, 'mutation'>;
	applicationServerKey: string;
}) {
	const capability = getNotificationCapability();
	if (!capability.supported || !capability.pushSupported) {
		throw new Error('Notifications are not supported on this device');
	}
	if (capability.iosLike && !capability.installed) {
		throw new Error('Install Mangarr to the Home Screen before enabling notifications');
	}

	const registration = await registerMangarrServiceWorker();
	if (!registration) {
		throw new Error('Unable to register the service worker');
	}

	const permission = await Notification.requestPermission();
	if (permission !== 'granted') {
		throw new Error(
			permission === 'denied' ? 'Notification permission was denied' : 'Permission was dismissed'
		);
	}

	const subscription =
		(await registration.pushManager.getSubscription()) ??
		(await registration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: toUint8Array(args.applicationServerKey)
		}));
	const json = subscription.toJSON();
	if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
		throw new Error('Push subscription is missing endpoint keys');
	}

	await args.client.mutation(convexApi.notifications.subscribeWebPush, {
		endpoint: json.endpoint,
		p256dh: json.keys.p256dh,
		auth: json.keys.auth,
		userAgent: navigator.userAgent,
		platform: navigator.platform,
		installationKey: getOrCreateNotificationInstallationKey(),
		supportsBadging: capability.badgingSupported
	});
	return subscription;
}

export async function unsubscribeFromWebPush(args: { client: Pick<ConvexClient, 'mutation'> }) {
	const registration = await registerMangarrServiceWorker();
	if (!registration) return;
	const subscription = await registration.pushManager.getSubscription();
	if (!subscription) return;
	await args.client.mutation(convexApi.notifications.unsubscribeWebPush, {
		endpoint: subscription.endpoint
	});
	await subscription.unsubscribe().catch(() => undefined);
}

export async function showForegroundNotification(item: NotificationEventItem) {
	const registration = await registerMangarrServiceWorker();
	if (!registration) {
		throw new Error('Service worker is unavailable');
	}
	await registration.showNotification(item.titleName, {
		body: `${item.newChapterCount} new chapter${item.newChapterCount === 1 ? '' : 's'}`,
		tag: item.tag,
		icon: item.icon || '/icon-192.png',
		badge: '/icon-192.png',
		data: {
			kind: 'title-update',
			titleId: item.titleId,
			eventId: item.id,
			path: item.path
		}
	});
}

export async function syncApplicationBadge(unacknowledgedCount: number) {
	if (!browser) return;
	const nav = navigator as Navigator & {
		setAppBadge?: (count?: number) => Promise<void>;
		clearAppBadge?: () => Promise<void>;
	};
	try {
		if (unacknowledgedCount > 0 && typeof nav.setAppBadge === 'function') {
			await nav.setAppBadge(unacknowledgedCount);
			return;
		}
		if (unacknowledgedCount === 0 && typeof nav.clearAppBadge === 'function') {
			await nav.clearAppBadge();
		}
	} catch {
		// Best-effort only.
	}
}
