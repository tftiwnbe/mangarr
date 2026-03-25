import type { Id } from '$convex/_generated/dataModel';
import type { FunctionReference } from 'convex/server';
import { convexApi } from '$lib/convex/api';

export type CommandState<TResult = Record<string, unknown>> = {
	id?: string;
	commandType: string;
	status: string;
	payload?: unknown;
	progress?: unknown;
	result?: TResult | null;
	lastErrorMessage?: string | null;
	createdAt?: number;
	updatedAt?: number;
};

type WaitableCommandClient = {
	query<Query extends FunctionReference<'query'>>(
		query: Query,
		args: Query['_args']
	): Promise<Awaited<Query['_returnType']>>;
};

export async function waitForCommand<TCommand extends CommandState = CommandState>(
	client: WaitableCommandClient,
	commandId: Id<'commands'>,
	options: {
		timeoutMs?: number;
		pollIntervalMs?: number;
		onUpdate?: (command: TCommand) => void;
	} = {}
) {
	const timeoutMs = options.timeoutMs ?? 15_000;
	const pollIntervalMs = options.pollIntervalMs ?? 250;
	const startedAt = Date.now();

	while (Date.now() - startedAt < timeoutMs) {
		const command = (await client.query(convexApi.commands.getMineById, {
			commandId
		})) as TCommand | null;
		if (!command) {
			throw new Error('Command not found');
		}

		options.onUpdate?.(command);

		if (command.status === 'succeeded') {
			return command;
		}
		if (command.status === 'failed' || command.status === 'cancelled' || command.status === 'dead_letter') {
			throw new Error(command.lastErrorMessage ?? 'Command failed');
		}

		await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
	}

	throw new Error('Command timed out');
}
