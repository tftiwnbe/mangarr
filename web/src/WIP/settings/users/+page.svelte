<script lang="ts">
	import SectionHeader from '$lib/components/section-header.svelte';
	import TagPill from '$lib/components/tag-pill.svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	const users = [
		{ name: 'shadcn', email: 'm@example.com', role: 'Admin', status: 'Active' },
		{ name: 'arisa', email: 'arisa@example.com', role: 'Editor', status: 'Active' },
		{ name: 'jules', email: 'jules@example.com', role: 'Viewer', status: 'Invited' }
	];
</script>

<SectionHeader
	title="Team management"
	description="Invite collaborators, adjust roles, and manage authentication sessions."
	actionHref="/settings/users"
	actionLabel="Invite user"
/>

<div class="rounded-lg border border-border/60 bg-background/80 p-4">
	<div class="flex flex-wrap items-center gap-2">
		<TagPill tone="neutral" size="sm">All roles</TagPill>
		<TagPill tone="outline" size="sm">Admin</TagPill>
		<TagPill tone="outline" size="sm">Editor</TagPill>
		<TagPill tone="outline" size="sm">Viewer</TagPill>
		<div class="ml-auto flex gap-2">
			<Button size="sm" variant="secondary">Invite</Button>
			<Button size="sm" variant="ghost">Export</Button>
		</div>
	</div>
	<div class="mt-4 overflow-x-auto">
		<table class="min-w-full divide-y divide-border/60 text-sm">
			<thead class="text-left text-xs tracking-wide text-muted-foreground uppercase">
				<tr>
					<th class="px-3 py-2 font-semibold">Name</th>
					<th class="px-3 py-2 font-semibold">Role</th>
					<th class="px-3 py-2 font-semibold">Status</th>
					<th class="px-3 py-2 font-semibold">Actions</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-border/40">
				{#each users as user (user.email)}
					<tr class="bg-card/80">
						<td class="px-3 py-3">
							<div class="font-medium text-foreground">{user.name}</div>
							<div class="text-xs text-muted-foreground">{user.email}</div>
						</td>
						<td class="px-3 py-3">
							<TagPill tone="outline" size="sm">{user.role}</TagPill>
						</td>
						<td class="px-3 py-3">
							<TagPill tone={user.status === 'Active' ? 'neutral' : 'accent'} size="sm">
								{user.status}
							</TagPill>
						</td>
						<td class="px-3 py-3">
							<div class="flex gap-2">
								<Button size="sm" variant="ghost">Edit</Button>
								<Button size="sm" variant="ghost">Sessions</Button>
								<Button size="sm" variant="ghost">Remove</Button>
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<div
		class="mt-4 rounded-lg border border-dashed border-border/60 bg-card/60 p-4 text-sm text-muted-foreground"
	>
		Enable SSO and enforce MFA to keep your team secure. Configure provider settings under Network.
	</div>
</div>
