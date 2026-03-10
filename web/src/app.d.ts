import type { AuthState } from '$lib/server/auth';

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			auth: AuthState;
		}
		interface PageData {
			auth: AuthState;
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
