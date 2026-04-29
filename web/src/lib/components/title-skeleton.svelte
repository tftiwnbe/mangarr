<script lang="ts">
	import { _ } from '$lib/i18n';

	type Props = {
		thumbnailUrl?: string | null;
		titleHint?: string | null;
		phaseLabel?: string | null;
		phaseDescription?: string | null;
	};

	let {
		thumbnailUrl = null,
		titleHint = null,
		phaseLabel = null,
		phaseDescription = null
	}: Props = $props();
</script>

<div class="flex flex-col">
	<!-- Mobile cover slot -->
	<div class="relative -mx-[max(0.875rem,env(safe-area-inset-left))] md:hidden">
		<div class="relative aspect-[3/4] max-h-[60vh] w-full overflow-hidden bg-[var(--void-2)]">
			{#if thumbnailUrl}
				<img
					src={thumbnailUrl}
					alt={titleHint ?? 'cover'}
					class="h-full w-full object-cover object-top opacity-40"
				/>
			{/if}
			<!-- HUD scanline shimmer -->
			<div class="hud-shimmer absolute inset-0 mix-blend-screen" aria-hidden="true"></div>
			<div
				class="pointer-events-none absolute inset-x-0 bottom-0 h-2/3"
				style="background: linear-gradient(to top, var(--void-0) 4%, transparent 100%);"
			></div>
		</div>
	</div>

	<!-- Body -->
	<div class="md:grid md:grid-cols-[260px_1fr] md:items-start md:gap-8">
		<!-- Desktop cover -->
		<div class="relative hidden aspect-[2/3] w-full overflow-hidden bg-[var(--void-2)] md:block">
			{#if thumbnailUrl}
				<img
					src={thumbnailUrl}
					alt={titleHint ?? 'cover'}
					class="h-full w-full object-cover opacity-50"
				/>
			{/if}
			<div class="hud-shimmer absolute inset-0 mix-blend-screen" aria-hidden="true"></div>
		</div>

		<div class="relative flex flex-col gap-3 pt-4 md:pt-0">
			<!-- HUD phase label -->
			<div class="flex items-center gap-2">
				<span
					class="hud-pulse h-1 w-1 shrink-0 bg-[var(--cosmic)] shadow-[0_0_4px_var(--cosmic-glow)]"
				></span>
				<span class="font-mono text-[10px] tracking-[0.24em] text-[var(--text-ghost)] uppercase">
					{phaseLabel ?? $_('common.loading')}
				</span>
			</div>

			{#if titleHint}
				<h1 class="text-display text-2xl leading-tight text-[var(--text)] sm:text-3xl">
					{titleHint}
				</h1>
			{:else}
				<div class="hud-bar h-7 w-3/4 bg-[var(--void-3)]"></div>
			{/if}

			{#if phaseDescription}
				<p class="text-sm leading-relaxed text-[var(--text-ghost)]">
					{phaseDescription}
				</p>
			{/if}

			<!-- Skeleton lines -->
			<div class="mt-2 flex flex-col gap-1.5">
				<div class="hud-bar h-2 w-full bg-[var(--void-3)]" style="--d: 0ms;"></div>
				<div class="hud-bar h-2 w-5/6 bg-[var(--void-3)]" style="--d: 120ms;"></div>
				<div class="hud-bar h-2 w-2/3 bg-[var(--void-3)]" style="--d: 240ms;"></div>
			</div>
		</div>
	</div>
</div>

<style>
	@keyframes hud-pulse {
		0%,
		100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.3;
			transform: scale(0.85);
		}
	}

	.hud-pulse {
		animation: hud-pulse 1.4s ease-in-out infinite;
	}

	@keyframes hud-bar-pulse {
		0%,
		100% {
			opacity: 0.55;
		}
		50% {
			opacity: 1;
		}
	}

	.hud-bar {
		animation: hud-bar-pulse 1.6s ease-in-out infinite;
		animation-delay: var(--d, 0ms);
	}

	@keyframes hud-shimmer {
		0% {
			transform: translateY(-100%);
		}
		100% {
			transform: translateY(100%);
		}
	}

	.hud-shimmer {
		background: linear-gradient(
			180deg,
			transparent 0%,
			rgba(199, 210, 254, 0.05) 48%,
			rgba(199, 210, 254, 0.12) 50%,
			rgba(199, 210, 254, 0.05) 52%,
			transparent 100%
		);
		animation: hud-shimmer 2.4s linear infinite;
	}
</style>
