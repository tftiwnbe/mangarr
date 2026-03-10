<script lang="ts">
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
	<title>Setup | Mangarr v2</title>
</svelte:head>

<div class="auth-shell setup-tone">
	<section class="intro">
		<p class="eyebrow">First admin bootstrap</p>
		<h1>Open the instance with one durable account.</h1>
		<p>
			This is the only public setup window. After the first admin exists, the app closes setup and
			switches to normal sign-in.
		</p>
	</section>

	<section class="panel">
		<div class="panel-head">
			<h2>Create the admin account</h2>
			<p>Username is normalized to lowercase. Password rules match the archived FastAPI prototype.</p>
		</div>

		<form method="POST" class="auth-form">
			<label>
				<span>Username</span>
				<input
					name="username"
					autocomplete="username"
					value={form?.values?.username ?? ''}
					placeholder="admin"
				/>
			</label>

			<label>
				<span>Password</span>
				<input
					type="password"
					name="password"
					autocomplete="new-password"
					placeholder="Use upper, lower, and numeric characters"
				/>
			</label>

			<label>
				<span>Confirm password</span>
				<input type="password" name="confirmPassword" autocomplete="new-password" />
			</label>

			{#if form?.error}
				<p class="form-error">{form.error}</p>
			{/if}

			<button type="submit">Create admin and open the app</button>
		</form>
	</section>
</div>

<style>
	:global(body) {
		margin: 0;
		background:
			radial-gradient(circle at 15% 15%, rgba(230, 157, 61, 0.18), transparent 22%),
			radial-gradient(circle at 85% 15%, rgba(166, 87, 42, 0.18), transparent 26%),
			linear-gradient(180deg, #120f0c 0%, #0b0908 100%);
		color: #f3e6d6;
		font-family:
			'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif;
	}

	.auth-shell {
		min-height: 100vh;
		display: grid;
		grid-template-columns: 1.1fr 0.9fr;
		gap: 2rem;
		padding: 2rem;
	}

	.intro,
	.panel {
		border: 1px solid rgba(243, 230, 214, 0.12);
		border-radius: 1.75rem;
		background: rgba(12, 10, 9, 0.72);
		backdrop-filter: blur(16px);
	}

	.intro {
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		padding: 2.5rem;
	}

	.panel {
		padding: 2rem;
	}

	.eyebrow {
		margin: 0 0 0.75rem;
		color: #e0a256;
		font-size: 0.78rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
	}

	h1 {
		margin: 0;
		max-width: 11ch;
		font-size: clamp(3rem, 7vw, 5.6rem);
		line-height: 0.95;
	}

	.intro p:last-child {
		max-width: 32rem;
		color: rgba(243, 230, 214, 0.72);
		line-height: 1.7;
	}

	.panel-head h2 {
		margin: 0 0 0.5rem;
		font-size: 1.8rem;
	}

	.panel-head p {
		margin: 0 0 1.5rem;
		color: rgba(243, 230, 214, 0.66);
		line-height: 1.6;
	}

	.auth-form {
		display: grid;
		gap: 1rem;
	}

	label {
		display: grid;
		gap: 0.45rem;
	}

	label span {
		font-size: 0.9rem;
		color: rgba(243, 230, 214, 0.72);
	}

	input {
		width: 100%;
		padding: 0.95rem 1rem;
		border: 1px solid rgba(243, 230, 214, 0.14);
		border-radius: 1rem;
		background: rgba(243, 230, 214, 0.05);
		color: inherit;
		font: inherit;
	}

	input::placeholder {
		color: rgba(243, 230, 214, 0.36);
	}

	button {
		margin-top: 0.5rem;
		padding: 1rem 1.2rem;
		border: 0;
		border-radius: 999px;
		background: linear-gradient(135deg, #dc9a4c, #a8562f);
		color: #120f0c;
		font: inherit;
		font-weight: 700;
		cursor: pointer;
	}

	.form-error {
		margin: 0;
		padding: 0.85rem 1rem;
		border-radius: 1rem;
		background: rgba(170, 58, 32, 0.18);
		color: #ffccbf;
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
