import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import { setupConvex } from 'convex-svelte';

let initialized = false;

export function setupConvexClient() {
  if (!browser || initialized) {
    return;
  }

  const url = env.PUBLIC_CONVEX_URL;
  if (!url) {
    return;
  }

  setupConvex(url);
  initialized = true;
}

export function getConvexUrl() {
  return env.PUBLIC_CONVEX_URL ?? '';
}
