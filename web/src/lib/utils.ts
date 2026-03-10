import type { HTMLAttributes } from 'svelte/elements';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export type WithElementRef<T extends EventTarget> = HTMLAttributes<T> & {
	ref?: T | null;
};

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
