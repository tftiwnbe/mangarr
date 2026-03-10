export type WsEvent = {
	event: string;
	[key: string]: unknown;
};

type Handler = (event: WsEvent) => void;
type Unsubscribe = () => void;

class WebSocketManager {
	private handlers = new Map<string, Set<Handler>>();

	connect(): void {
		// Live worker-backed events are not wired into the alpha shell yet.
	}

	disconnect(): void {}

	on(event: string, handler: Handler): Unsubscribe {
		if (!this.handlers.has(event)) this.handlers.set(event, new Set());
		this.handlers.get(event)!.add(handler);
		return () => this.handlers.get(event)?.delete(handler);
	}
}

export const wsManager = new WebSocketManager();
