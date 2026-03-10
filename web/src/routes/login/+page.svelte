<script lang="ts">
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
	<title>Login | Mangarr v2</title>
</svelte:head>

<div class="auth-shell login-tone">
	<section class="intro">
		<p class="eyebrow">Cookie-backed access</p>
		<h1>Sign in through SvelteKit, not a stored browser token.</h1>
		<p>
			This v2 branch uses opaque httpOnly browser sessions. The frontend no longer keeps a long-lived
			API key in `localStorage`.
		</p>
	</section>

	<section class="panel">
		<div class="panel-head">
			<h2>Sign in</h2>
			<p>Remember me extends the revocable session TTL instead of changing how credentials are stored.</p>
		</div>

		<form method="POST" class="auth-form">
			<label>
				<span>Username</span>
				<input
					name="username"
					autocomplete="username"
					value={form?.values?.username ?? ''}
				/>
			</label>

			<label>
				<span>Password</span>
				<input type="password" name="password" autocomplete="current-password" />
			</label>

			<label class="checkbox-row">
				<input type="checkbox" name="rememberMe" checked={form?.values?.rememberMe ?? false} />
				<span>Remember me for 30 days</span>
			</label>

			{#if form?.error}
				<p class="form-error">{form.error}</p>
			{/if}

			<button type="submit">Open library shell</button>
		</form>
	</section>
</div>

<style>
	:global(body) {
		margin: 0;
		background:
			linear-gradient(140deg, rgba(29, 84, 92, 0.24), transparent 38%),
			radial-gradient(circle at top right, rgba(217, 171, 88, 0.16), transparent 24%),
			linear-gradient(180deg, #0c1719 0%, #091012 100%);
		color: #ebeee8;
		font-family:
			'Baskerville', 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Palatino, serif;
	}

	.auth-shell {
		min-height: 100vh;
		display: grid;
		grid-template-columns: 0.95fr 1.05fr;
		gap: 2rem;
		padding: 2rem;
	}

	.intro,
	.panel {
		border-radius: 1.75rem;
	}

	.intro {
		padding: 2.5rem;
		background: linear-gradient(180deg, rgba(19, 35, 39, 0.92), rgba(11, 20, 22, 0.82));
		border: 1px solid rgba(235, 238, 232, 0.1);
	}

	.panel {
		padding: 2rem;
		background: rgba(9, 16, 18, 0.72);
		border: 1px solid rgba(235, 238, 232, 0.1);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
	}

	.eyebrow {
		margin: 0 0 0.8rem;
		color: #d9ab58;
		font-size: 0.78rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
	}

	h1 {
		margin: 0;
		max-width: 12ch;
		font-size: clamp(3rem, 7vw, 5.4rem);
		line-height: 0.98;
	}

	.intro p:last-child,
	.panel-head p {
		color: rgba(235, 238, 232, 0.7);
		line-height: 1.7;
	}

	.panel-head h2 {
		margin: 0 0 0.4rem;
		font-size: 1.75rem;
	}

	.panel-head p {
		margin: 0 0 1.5rem;
	}

	.auth-form {
		display: grid;
		gap: 1rem;
	}

	label {
		display: grid;
		gap: 0.4rem;
	}

	label span {
		font-size: 0.9rem;
		color: rgba(235, 238, 232, 0.7);
	}

	input {
		width: 100%;
		padding: 0.95rem 1rem;
		border: 1px solid rgba(235, 238, 232, 0.12);
		border-radius: 1rem;
		background: rgba(235, 238, 232, 0.04);
		color: inherit;
		font: inherit;
	}

	.checkbox-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.checkbox-row input {
		width: auto;
		margin: 0;
	}

	button {
		padding: 1rem 1.25rem;
		border: 0;
		border-radius: 999px;
		background: linear-gradient(135deg, #d9ab58, #4ea7a5);
		color: #0b1112;
		font: inherit;
		font-weight: 700;
		cursor: pointer;
	}

	.form-error {
		margin: 0;
		padding: 0.85rem 1rem;
		border-radius: 1rem;
		background: rgba(150, 41, 41, 0.22);
		color: #ffd6d6;
	}

	@media (max-width: 860px) {
		.auth-shell {
			grid-template-columns: 1fr;
			padding: 1rem;
		}

		.intro,
		.panel {
			padding: 1.5rem;
		}
	}
</style>
