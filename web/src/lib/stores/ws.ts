/**
 * WebSocket manager — singleton that stays connected for the lifetime of the
 * authenticated session and lets any part of the app subscribe to server-pushed
 * events (task.done, monitor.run, worker.run, …).
 */

import { getWsToken } from '$lib/api/auth';
import { API_BASE_URL } from '$lib/api/config';

export type WsEvent = {
	event: string;
	[key: string]: unknown;
};

type Handler = (event: WsEvent) => void;
type Unsubscribe = () => void;

const RECONNECT_DELAY_MS = 3_000;
const WS_PATH = '/api/v2/ws';

function buildWsUrl(token: string): string {
	const keyParam = `?api_key=${encodeURIComponent(token)}`;
	if (API_BASE_URL) {
		// Convert http(s):// → ws(s)://
		return API_BASE_URL.replace(/^http/, 'ws') + WS_PATH + keyParam;
	}
	// Relative (same-origin) — derive protocol from window
	if (typeof window !== 'undefined') {
		const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		return `${proto}//${window.location.host}${WS_PATH}${keyParam}`;
	}
	return WS_PATH + keyParam;
}

class WebSocketManager {
	private ws: WebSocket | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private active = false;
	private handlers = new Map<string, Set<Handler>>();

	/** Open the connection. Call once after the user is authenticated. */
	connect(): void {
		if (this.active) return;
		this.active = true;
		void this._open();
	}

	/** Close the connection and stop reconnecting (e.g. on logout). */
	disconnect(): void {
		this.active = false;
		if (this.reconnectTimer !== null) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		this.ws?.close();
		this.ws = null;
	}

	/**
	 * Subscribe to a specific event type.
	 * Pass `'*'` to receive every event.
	 * Returns an unsubscribe function.
	 */
	on(event: string, handler: Handler): Unsubscribe {
		if (!this.handlers.has(event)) this.handlers.set(event, new Set());
		this.handlers.get(event)!.add(handler);
		return () => this.handlers.get(event)?.delete(handler);
	}

	// ── internals ──────────────────────────────────────────────────────────────

	private async _open(): Promise<void> {
		if (!this.active) return;

		// Fetch a short-lived token to avoid exposing the main API key in the URL
		let url: string;
		try {
			const token = await getWsToken();
			url = buildWsUrl(token);
		} catch {
			// Token fetch failed (e.g. network error) — retry on normal schedule
			if (this.active) {
				this.reconnectTimer = setTimeout(() => void this._open(), RECONNECT_DELAY_MS);
			}
			return;
		}

		if (!this.active) return; // disconnected while awaiting token

		const ws = new WebSocket(url);
		this.ws = ws;

		ws.onopen = () => {
			if (this.reconnectTimer !== null) {
				clearTimeout(this.reconnectTimer);
				this.reconnectTimer = null;
			}
		};

		ws.onmessage = (e: MessageEvent) => {
			let data: WsEvent;
			try {
				data = JSON.parse(e.data as string) as WsEvent;
			} catch (err) {
				console.warn('[ws] Failed to parse message:', err);
				return;
			}
			this._dispatch(data);
		};

		ws.onclose = () => {
			this.ws = null;
			if (this.active) {
				this.reconnectTimer = setTimeout(() => void this._open(), RECONNECT_DELAY_MS);
			}
		};

		ws.onerror = () => {
			ws.close(); // triggers onclose → reconnect
		};
	}

	private _dispatch(event: WsEvent): void {
		const specific = this.handlers.get(event.event);
		const wildcard = this.handlers.get('*');
		specific?.forEach((h) => h(event));
		wildcard?.forEach((h) => h(event));
	}
}

export const wsManager = new WebSocketManager();
