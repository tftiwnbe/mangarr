<script lang="ts">
	let {
		sourceName,
		sourceLang,
		sourceHealthLabel,
		sourceHealthDetail,
		offlineLabel,
		offlineDetail,
		headingLabel
	} = $props<{
		sourceName: string;
		sourceLang: string;
		sourceHealthLabel: string;
		sourceHealthDetail: string;
		offlineLabel: string;
		offlineDetail: string;
		headingLabel: string;
	}>();
</script>

<div class="mt-3 bg-[var(--void-2)] px-3 py-2">
	<div class="min-w-0">
		<p class="text-[10px] tracking-widest text-[var(--void-6)] uppercase">{headingLabel}</p>
		<p class="truncate text-sm text-[var(--text)]">{sourceName} [{sourceLang}]</p>
		<p class="mt-1 text-[11px] text-[var(--text-ghost)]">
			<span class="text-[var(--text-muted)]">{sourceHealthLabel}</span>
			<span> · {sourceHealthDetail}</span>
		</p>
		<p class="mt-1 text-[11px] text-[var(--text-ghost)]">
			<span class="text-[var(--text-muted)]">{offlineLabel}</span>
			<span> · {offlineDetail}</span>
		</p>
	</div>
</div>
