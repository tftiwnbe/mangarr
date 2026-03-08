<script lang="ts">
	interface Props {
		count?: number;
		class?: string;
	}

	let { count = 30, class: className = '' }: Props = $props();

	// Generate deterministic but varied star positions
	function generateStars(n: number) {
		const stars: Array<{
			x: number;
			y: number;
			size: number;
			opacity: number;
			delay: number;
			duration: number;
			bright: boolean;
		}> = [];

		for (let i = 0; i < n; i++) {
			// Use golden ratio for better distribution
			const golden = 1.618033988749;
			const x = (i * golden * 37) % 100;
			const y = (i * golden * 53) % 100;

			// More visible stars
			const isBright = i % 4 === 0;
			stars.push({
				x,
				y,
				size: isBright ? 2 + (i % 2) : 1.5 + (i % 2) * 0.5,
				opacity: isBright ? 0.7 + (i % 3) * 0.1 : 0.4 + (i % 4) * 0.1,
				delay: (i % 7) * 0.6,
				duration: 2 + (i % 3) * 1.5,
				bright: isBright
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
				background: {star.bright ? 'rgba(255, 255, 255, 0.95)' : 'rgba(200, 200, 210, 0.7)'};
				animation: {star.bright ? 'twinkle' : 'twinkle-slow'} {star.duration}s ease-in-out infinite;
				animation-delay: {star.delay}s;
				box-shadow: 0 0 {star.bright ? star.size * 4 : star.size * 2}px {star.bright
				? 'rgba(255, 255, 255, 0.5)'
				: 'rgba(200, 200, 210, 0.3)'};
			"
		></div>
	{/each}
</div>
