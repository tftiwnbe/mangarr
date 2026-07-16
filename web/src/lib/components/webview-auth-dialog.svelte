<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { tick, untrack } from 'svelte';
	import {
		ArrowLeftIcon,
		ArrowRightIcon,
		ArrowClockwiseIcon,
		CheckIcon,
		SpinnerIcon,
		XIcon
	} from 'phosphor-svelte';

	import { Alert } from '$lib/elements/alert';
	import { Button } from '$lib/elements/button';
	import { _ } from '$lib/i18n';

	type SessionResponse = {
		sessionId: string;
		ticket: string;
		packageName: string;
		extensionName: string;
		sourceId: string;
		sourceName: string;
		initialUrl: string;
		expiresAt: number;
	};

	type Props = {
		open: boolean;
		packageName: string | null;
		extensionName?: string | null;
		onclose: () => void;
		oncompleted?: (packageName: string) => void;
	};

	let { open, packageName, extensionName, onclose, oncompleted }: Props = $props();

	let canvas = $state<HTMLCanvasElement | null>(null);
	let socket = $state<WebSocket | null>(null);
	let session = $state<SessionResponse | null>(null);
	let status = $state<'starting' | 'connecting' | 'ready' | 'finishing' | 'completed'>('starting');
	let error = $state<string | null>(null);
	let currentUrl = $state('');
	let pageTitle = $state('');
	let loading = $state(false);
	let canGoBack = $state(false);
	let canGoForward = $state(false);
	let resizeObserver: ResizeObserver | null = null;
	let runId = 0;
	let lastMoveAt = 0;

	const displayHost = $derived.by(() => {
		try {
			return new URL(currentUrl || session?.initialUrl || '').host;
		} catch {
			return currentUrl || session?.initialUrl || '';
		}
	});

	$effect(() => {
		if (!open || !packageName) {
			untrack(() => cleanup(false));
			return;
		}
		const currentRun = ++runId;
		void untrack(() => startSession(packageName, currentRun));
		return () => {
			if (runId === currentRun) runId += 1;
			untrack(() => cleanup(true));
		};
	});

	async function startSession(targetPackage: string, currentRun: number) {
		cleanup(false);
		status = 'starting';
		error = null;
		currentUrl = '';
		pageTitle = '';
		try {
			const response = await fetch('/api/internal/bridge/extensions/webview/session', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ packageName: targetPackage })
			});
			const payload = (await response.json()) as SessionResponse | { message?: string };
			if (!response.ok) {
				throw new Error(
					'message' in payload && payload.message ? payload.message : 'Unable to start WebView'
				);
			}
			if (runId !== currentRun || !open) return;
			session = payload as SessionResponse;
			currentUrl = session.initialUrl;
			status = 'connecting';
			await tick();
			connectSocket(session, currentRun);
		} catch (cause) {
			if (runId !== currentRun) return;
			error = cause instanceof Error ? cause.message : 'Unable to start WebView';
		}
	}

	function connectSocket(activeSession: SessionResponse, currentRun: number) {
		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		const connection = new WebSocket(
			`${protocol}//${window.location.host}/api/internal/bridge/webview/socket`
		);
		connection.binaryType = 'blob';
		socket = connection;
		connection.onopen = () => {
			if (runId !== currentRun) return connection.close();
			connection.send(JSON.stringify({ type: 'authenticate', ticket: activeSession.ticket }));
			observeCanvas();
		};
		connection.onmessage = (event) => {
			if (runId !== currentRun) return;
			if (typeof event.data === 'string') {
				handleControlMessage(event.data);
			} else if (event.data instanceof Blob) {
				void drawFrame(event.data, currentRun);
			}
		};
		connection.onerror = () => {
			if (runId === currentRun && status !== 'completed') {
				error = $_('extensions.webviewConnectionFailed');
			}
		};
		connection.onclose = (event) => {
			if (runId !== currentRun || status === 'completed') return;
			if (status === 'finishing' && event.code === 1000) return;
			error ||= event.reason || $_('extensions.webviewDisconnected');
		};
	}

	function handleControlMessage(raw: string) {
		let message: Record<string, unknown>;
		try {
			message = JSON.parse(raw) as Record<string, unknown>;
		} catch {
			return;
		}
		switch (message.type) {
			case 'ready':
				status = 'ready';
				sendResize();
				break;
			case 'address':
				currentUrl = typeof message.url === 'string' ? message.url : currentUrl;
				break;
			case 'title':
				pageTitle = typeof message.title === 'string' ? message.title : '';
				break;
			case 'loading':
				loading = message.loading === true;
				canGoBack = message.canGoBack === true;
				canGoForward = message.canGoForward === true;
				break;
			case 'navigation':
				canGoBack = message.canGoBack === true;
				canGoForward = message.canGoForward === true;
				break;
			case 'loadError':
				error =
					typeof message.message === 'string'
						? message.message
						: $_('extensions.webviewLoadFailed');
				break;
			case 'error':
				error =
					typeof message.message === 'string'
						? message.message
						: $_('extensions.webviewConnectionFailed');
				break;
			case 'completed':
				status = 'completed';
				if (session) oncompleted?.(session.packageName);
				window.setTimeout(onclose, 350);
				break;
		}
	}

	async function drawFrame(blob: Blob, currentRun: number) {
		const bitmap = await createImageBitmap(blob);
		try {
			if (runId !== currentRun || !canvas) return;
			if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
				canvas.width = bitmap.width;
				canvas.height = bitmap.height;
			}
			canvas.getContext('2d', { alpha: false })?.drawImage(bitmap, 0, 0);
		} finally {
			bitmap.close();
		}
	}

	function observeCanvas() {
		resizeObserver?.disconnect();
		if (!canvas) return;
		resizeObserver = new ResizeObserver(sendResize);
		resizeObserver.observe(canvas);
		sendResize();
	}

	function sendResize() {
		if (!canvas || socket?.readyState !== WebSocket.OPEN) return;
		const rect = canvas.getBoundingClientRect();
		const scale = Math.min(window.devicePixelRatio || 1, 1.5);
		send({
			type: 'resize',
			width: Math.max(320, Math.round(rect.width * scale)),
			height: Math.max(240, Math.round(rect.height * scale))
		});
	}

	function send(message: Record<string, unknown>) {
		if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
	}

	function sendPointer(event: MouseEvent, eventType: string) {
		if (!canvas || status !== 'ready') return;
		if (eventType === 'mousemove') {
			const now = performance.now();
			if (now - lastMoveAt < 16) return;
			lastMoveAt = now;
		}
		const rect = canvas.getBoundingClientRect();
		const scaleX = canvas.width / Math.max(rect.width, 1);
		const scaleY = canvas.height / Math.max(rect.height, 1);
		send({
			type: 'input',
			eventType,
			x: (event.clientX - rect.left) * scaleX,
			y: (event.clientY - rect.top) * scaleY,
			button: event.button,
			ctrlKey: event.ctrlKey,
			shiftKey: event.shiftKey,
			metaKey: event.metaKey
		});
	}

	function sendWheel(event: WheelEvent) {
		event.preventDefault();
		if (!canvas || status !== 'ready') return;
		const rect = canvas.getBoundingClientRect();
		send({
			type: 'input',
			eventType: 'wheel',
			x: ((event.clientX - rect.left) * canvas.width) / Math.max(rect.width, 1),
			y: ((event.clientY - rect.top) * canvas.height) / Math.max(rect.height, 1),
			deltaY: event.deltaY,
			ctrlKey: event.ctrlKey,
			shiftKey: event.shiftKey,
			metaKey: event.metaKey
		});
	}

	function sendKey(event: KeyboardEvent, eventType: 'keydown' | 'keyup') {
		if (status !== 'ready') return;
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') return;
		event.preventDefault();
		send({
			type: 'input',
			eventType,
			key: event.key,
			ctrlKey: event.ctrlKey,
			shiftKey: event.shiftKey,
			metaKey: event.metaKey
		});
	}

	function handlePaste(event: ClipboardEvent) {
		const value = event.clipboardData?.getData('text/plain');
		if (!value) return;
		event.preventDefault();
		send({ type: 'paste', value });
	}

	function finish() {
		status = 'finishing';
		error = null;
		send({ type: 'done' });
	}

	function cancel() {
		send({ type: 'close' });
		onclose();
	}

	function cleanup(sendClose: boolean) {
		resizeObserver?.disconnect();
		resizeObserver = null;
		if (sendClose && socket?.readyState === WebSocket.OPEN && status !== 'completed') {
			socket.send(JSON.stringify({ type: 'close' }));
		}
		socket?.close();
		socket = null;
		session = null;
	}
</script>

<Dialog.Root {open} onOpenChange={(nextOpen) => !nextOpen && cancel()}>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-[80] bg-[var(--void-0)]/90 backdrop-blur-sm" />
		<Dialog.Content
			class="fixed inset-2 z-[80] flex flex-col overflow-hidden border border-[var(--line)] bg-[var(--void-1)] shadow-2xl focus:outline-none sm:inset-6"
		>
			<div class="flex min-h-12 items-center gap-2 border-b border-[var(--line)] px-3">
				<div class="min-w-0 flex-1">
					<Dialog.Title class="truncate text-sm text-[var(--text)]">
						{$_('extensions.authenticate')} · {extensionName ??
							session?.extensionName ??
							packageName}
					</Dialog.Title>
					<p class="truncate text-[10px] text-[var(--text-ghost)]">
						{pageTitle || displayHost || $_('extensions.webviewStarting')}
					</p>
				</div>
				<button
					type="button"
					class="flex h-8 w-8 items-center justify-center text-[var(--text-ghost)] hover:text-[var(--text)] disabled:opacity-30"
					disabled={!canGoBack}
					onclick={() => send({ type: 'back' })}
					aria-label="Back"><ArrowLeftIcon size={15} /></button
				>
				<button
					type="button"
					class="flex h-8 w-8 items-center justify-center text-[var(--text-ghost)] hover:text-[var(--text)] disabled:opacity-30"
					disabled={!canGoForward}
					onclick={() => send({ type: 'forward' })}
					aria-label="Forward"><ArrowRightIcon size={15} /></button
				>
				<button
					type="button"
					class="flex h-8 w-8 items-center justify-center text-[var(--text-ghost)] hover:text-[var(--text)]"
					onclick={() => send({ type: 'reload' })}
					aria-label="Reload"
				>
					{#if loading}<SpinnerIcon size={15} class="animate-spin" />{:else}<ArrowClockwiseIcon
							size={15}
						/>{/if}
				</button>
				<button
					type="button"
					class="flex h-8 w-8 items-center justify-center text-[var(--text-ghost)] hover:text-[var(--text)]"
					onclick={cancel}
					aria-label="Close"><XIcon size={15} /></button
				>
			</div>

			<div class="relative min-h-0 flex-1 bg-white">
				<canvas
					bind:this={canvas}
					class="h-full w-full touch-none outline-none"
					tabindex="0"
					onpointerdown={(event) => {
						canvas?.focus();
						canvas?.setPointerCapture(event.pointerId);
						sendPointer(event, 'mousedown');
					}}
					onpointerup={(event) => sendPointer(event, 'mouseup')}
					onpointermove={(event) => sendPointer(event, 'mousemove')}
					onwheel={sendWheel}
					onkeydown={(event) => sendKey(event, 'keydown')}
					onkeyup={(event) => sendKey(event, 'keyup')}
					onpaste={handlePaste}
					oncontextmenu={(event) => event.preventDefault()}
				></canvas>
				{#if status === 'starting' || status === 'connecting'}
					<div class="absolute inset-0 flex items-center justify-center bg-[var(--void-1)]">
						<div class="flex items-center gap-2 text-xs text-[var(--text-muted)]">
							<SpinnerIcon size={14} class="animate-spin" />
							{$_('extensions.webviewStarting')}
						</div>
					</div>
				{/if}
			</div>

			{#if error}
				<Alert variant="error" class="m-3">{error}</Alert>
			{/if}

			<div class="flex items-center justify-between gap-3 border-t border-[var(--line)] px-3 py-2">
				<p class="text-[10px] text-[var(--text-ghost)]">{$_('extensions.webviewHint')}</p>
				<Button
					size="sm"
					onclick={finish}
					disabled={status !== 'ready'}
					loading={status === 'finishing'}
				>
					<CheckIcon size={13} />
					{$_('extensions.authDone')}
				</Button>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
