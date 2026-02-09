<script lang="ts">
	import { goto } from '$app/navigation';
	import { signOut } from '$lib/api/auth';
	import { Button } from '$lib/elements/button/index.js';
	import { Separator } from '$lib/elements/separator/index.js';

	import GithubIcon from '@lucide/svelte/icons/github';
	import HeartIcon from '@lucide/svelte/icons/heart';
	import BookOpenIcon from '@lucide/svelte/icons/book-open';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';

	const version = '2.0.0';
	const buildDate = '2024-02-07';

	async function handleSignOut(): Promise<void> {
		signOut();
		await goto('/login', { replaceState: true });
	}
</script>

<div class="flex flex-col gap-8">
	<section class="flex flex-col items-center gap-4 py-8 text-center">
		<div class="flex size-20 items-center justify-center rounded-2xl bg-primary/10">
			<BookOpenIcon class="size-10 text-primary" />
		</div>
		<div>
			<h1 class="text-2xl font-bold">Mangarr</h1>
			<p class="text-muted-foreground">Your personal reading tracker</p>
		</div>
		<div class="flex items-center gap-2 text-sm text-muted-foreground">
			<span>Version {version}</span>
			<span>&bull;</span>
			<span>Build {buildDate}</span>
		</div>
	</section>

	<section class="flex flex-col gap-4">
		<div class="flex flex-col gap-2 rounded-lg border p-4">
			<div class="flex items-center justify-between">
				<div>
					<p class="font-medium">Check for Updates</p>
					<p class="text-sm text-muted-foreground">You're on the latest version</p>
				</div>
				<Button variant="outline" size="sm">
					<RefreshCwIcon class="size-4" />
					Check
				</Button>
			</div>
		</div>
		<div class="flex flex-col gap-2 rounded-lg border p-4">
			<div class="flex items-center justify-between">
				<div>
					<p class="font-medium">Session</p>
					<p class="text-sm text-muted-foreground">Sign out and clear local token</p>
				</div>
				<Button variant="outline" size="sm" onclick={handleSignOut}>Sign Out</Button>
			</div>
		</div>
	</section>

	<section class="flex flex-col gap-4">
		<h2 class="text-lg font-medium">Links</h2>

		<div class="flex flex-col rounded-lg border">
			<a
				href="https://github.com/your-repo/mangarr"
				target="_blank"
				rel="noopener noreferrer"
				class="flex items-center gap-4 p-4 transition-colors hover:bg-secondary/50"
			>
				<GithubIcon class="size-5" />
				<div class="flex-1">
					<p class="font-medium">GitHub Repository</p>
					<p class="text-sm text-muted-foreground">View source code and contribute</p>
				</div>
			</a>
			<Separator />
			<a
				href="https://github.com/your-repo/mangarr/issues"
				target="_blank"
				rel="noopener noreferrer"
				class="flex items-center gap-4 p-4 transition-colors hover:bg-secondary/50"
			>
				<HeartIcon class="size-5" />
				<div class="flex-1">
					<p class="font-medium">Report an Issue</p>
					<p class="text-sm text-muted-foreground">Help us improve by reporting bugs</p>
				</div>
			</a>
		</div>
	</section>

	<section class="flex flex-col gap-4">
		<h2 class="text-lg font-medium">Credits</h2>

		<div class="rounded-lg border p-4">
			<p class="text-sm text-muted-foreground">
				Built with SvelteKit, Tailwind CSS, and shadcn-svelte.
				Powered by Tachiyomi extensions.
			</p>
		</div>
	</section>
</div>
