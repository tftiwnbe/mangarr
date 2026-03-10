import { writable } from 'svelte/store';

/** Set to true when a slide panel / overlay is open — hides mobile bottom nav */
export const panelOverlayOpen = writable(false);
