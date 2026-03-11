export async function requireBridgeIdentity(ctx: {
	auth: {
		getUserIdentity(): Promise<Record<string, unknown> | null>;
	};
}) {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) {
		throw new Error('Not authenticated');
	}

	if (identity.role !== 'bridge' || identity.service !== 'tachibridge') {
		throw new Error('Not authorized for bridge runtime access');
	}

	return identity;
}
