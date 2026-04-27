import { writable } from 'svelte/store';

/**
 * `true` while at least one slide-panel / overlay surface is open.
 * Hides the mobile bottom nav so panel content can reach the bottom edge.
 *
 * Don't `.set()` this directly — slide panels manage it via push/pop so
 * concurrent panels stack correctly.
 */
export const panelOverlayOpen = writable(false);

let openCount = 0;

export function pushPanelOverlay(): void {
	openCount += 1;
	panelOverlayOpen.set(openCount > 0);
}

export function popPanelOverlay(): void {
	openCount = Math.max(0, openCount - 1);
	panelOverlayOpen.set(openCount > 0);
}
