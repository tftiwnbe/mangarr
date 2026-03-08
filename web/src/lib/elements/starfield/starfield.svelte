<script lang="ts">
	import { resolvedTheme } from '$lib/stores/theme';

	interface Props {
		count?: number;
		class?: string;
	}

	let { count = 40, class: className = '' }: Props = $props();

	// Simple seeded PRNG (mulberry32) — deterministic but organic-looking
	function prng(seed: number) {
		return () => {
			seed |= 0;
			seed = (seed + 0x6d2b79f5) | 0;
			let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	function generateStars(n: number) {
		const rand = prng(42);
		const stars: Array<{
			x: number;
			y: number;
			size: number;
			opacity: number;
			delay: number;
			duration: number;
			bright: boolean;
			glow: number;
		}> = [];

		for (let i = 0; i < n; i++) {
			const r1 = rand();
			const r2 = rand();
			const r3 = rand();
			const r4 = rand();
			const r5 = rand();

			// ~15% of stars are bright, rest are dim dust
			const isBright = r3 < 0.15;

			stars.push({
				x: r1 * 100,
				y: r2 * 100,
				size: isBright ? 1.5 + r4 * 1.5 : 0.8 + r4 * 1,
				opacity: isBright ? 0.6 + r5 * 0.35 : 0.15 + r5 * 0.35,
				delay: r3 * 6,
				duration: 2.5 + r4 * 4,
				bright: isBright,
				glow: isBright ? 3 + r5 * 5 : 1 + r4 * 2
			});
		}
		return stars;
	}

	const stars = generateStars(count);
</script>

<div class="pointer-events-none fixed inset-0 overflow-hidden {className}">
	{#each stars as star, i (i)}
		<div
			class="absolute rounded-full"
			style="
				left: {star.x}%;
				top: {star.y}%;
				width: {star.size}px;
				height: {star.size}px;
				opacity: {star.opacity};
				background: {$resolvedTheme === 'light'
				? star.bright
					? 'rgba(20, 20, 24, 0.22)'
					: 'rgba(20, 20, 24, 0.12)'
				: star.bright
					? 'rgba(255, 255, 255, 0.95)'
					: 'rgba(200, 200, 210, 0.6)'};
				animation: {star.bright ? 'twinkle' : 'twinkle-slow'} {star.duration}s ease-in-out infinite;
				animation-delay: {star.delay}s;
				box-shadow: 0 0 {star.glow}px {$resolvedTheme === 'light'
				? star.bright
					? 'rgba(20, 20, 24, 0.1)'
					: 'rgba(20, 20, 24, 0.04)'
				: star.bright
					? 'rgba(255, 255, 255, 0.5)'
					: 'rgba(200, 200, 210, 0.2)'};
			"
		></div>
	{/each}
</div>
