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
	secureContext: boolean;
	permission: NotificationPermission | 'unsupported';
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
			secureContext: false,
			permission: 'unsupported'
		};
	}
	const iosLike =
		/iPad|iPhone|iPod/i.test(navigator.userAgent) ||
		(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
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
		secureContext: window.isSecureContext,
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
			.catch(() => {
				registrationPromise = null;
				return null;
			});
	}
	return registrationPromise;
}

function toUint8Array(base64: string) {
	const normalized = base64.replace(/-/g, '+').replace(/_/g, '/');
	const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
	const raw = window.atob(padded);
	return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function notificationDeviceName() {
	const agent = navigator.userAgent;
	const platform = navigator.platform;
	if (/iPhone/i.test(agent)) return 'iPhone';
	if (/iPad/i.test(agent) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
		return 'iPad';
	}
	if (/Android/i.test(agent)) return 'Android';
	if (/Edg\//i.test(agent)) return 'Edge on desktop';
	if (/Chrome\//i.test(agent)) return 'Chrome on desktop';
	if (/Firefox\//i.test(agent)) return 'Firefox on desktop';
	if (/Safari\//i.test(agent)) return 'Safari on Mac';
	return platform || 'Browser';
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

export async function subscribeToWebPush(args: {
	client: Pick<ConvexClient, 'mutation'>;
	applicationServerKey: string;
	vapidKeyId: string;
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

	const applicationServerKey = toUint8Array(args.applicationServerKey);
	let subscription = await registration.pushManager.getSubscription();
	if (subscription && !subscriptionUsesKey(subscription, applicationServerKey)) {
		await subscription.unsubscribe().catch(() => undefined);
		subscription = null;
	}
	subscription ??= await registration.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey
	});
	const json = subscription.toJSON();
	if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
		throw new Error('Push subscription is missing endpoint keys');
	}

	await args.client.mutation(convexApi.notifications.reconcileDevice, {
		endpoint: json.endpoint,
		p256dh: json.keys.p256dh,
		auth: json.keys.auth,
		vapidKeyId: args.vapidKeyId,
		expirationTime: subscription.expirationTime ?? undefined,
		userAgent: navigator.userAgent,
		platform: navigator.platform,
		displayName: notificationDeviceName(),
		installationId: getOrCreateNotificationInstallationKey(),
		supportsBadging: capability.badgingSupported,
		allowReactivate: true
	});
	return subscription;
}

export async function unsubscribeFromWebPush(args: { client: Pick<ConvexClient, 'mutation'> }) {
	const registration = await registerMangarrServiceWorker();
	await args.client.mutation(convexApi.notifications.revokeDevice, {
		installationId: getOrCreateNotificationInstallationKey()
	});
	if (!registration) return;
	const subscription = await registration.pushManager.getSubscription();
	await subscription?.unsubscribe().catch(() => undefined);
}

function subscriptionUsesKey(subscription: PushSubscription | null, expected: Uint8Array) {
	if (!subscription) return false;
	const current = subscription.options.applicationServerKey;
	if (!current) return false;
	const bytes = new Uint8Array(current);
	if (bytes.length !== expected.length) return false;
	return bytes.every((value, index) => value === expected[index]);
}

export async function reconcileWebPush(args: {
	client: Pick<ConvexClient, 'mutation'>;
	applicationServerKey: string;
	vapidKeyId: string;
}) {
	const capability = getNotificationCapability();
	const installationId = getOrCreateNotificationInstallationKey();
	if (capability.permission === 'denied') {
		await args.client.mutation(convexApi.notifications.revokeDevice, { installationId });
		return { reconciled: false as const, denied: true as const };
	}
	if (!capability.supported || !capability.pushSupported || capability.permission !== 'granted') {
		return { reconciled: false as const };
	}
	const registration = await registerMangarrServiceWorker();
	if (!registration) return { reconciled: false as const };
	const expectedKey = toUint8Array(args.applicationServerKey);
	let subscription = await registration.pushManager.getSubscription();
	if (!subscriptionUsesKey(subscription, expectedKey)) {
		await subscription?.unsubscribe().catch(() => undefined);
		subscription = await registration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: expectedKey
		});
	}
	if (!subscription) return { reconciled: false as const };
	const json = subscription.toJSON();
	if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
		return { reconciled: false as const };
	}
	const result = await args.client.mutation(convexApi.notifications.reconcileDevice, {
		installationId,
		endpoint: json.endpoint,
		p256dh: json.keys.p256dh,
		auth: json.keys.auth,
		vapidKeyId: args.vapidKeyId,
		expirationTime: subscription.expirationTime ?? undefined,
		userAgent: navigator.userAgent,
		platform: navigator.platform,
		displayName: notificationDeviceName(),
		supportsBadging: capability.badgingSupported,
		allowReactivate: false
	});
	if ('disabled' in result && result.disabled) {
		await subscription.unsubscribe().catch(() => undefined);
		return { reconciled: false as const, disabled: true as const };
	}
	return { reconciled: true as const };
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
