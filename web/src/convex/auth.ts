import { mutationGeneric, queryGeneric } from 'convex/server';
import { v } from 'convex/values';

const publicUser = v.object({
  _id: v.id('users'),
  username: v.string(),
  isAdmin: v.boolean(),
  status: v.union(v.literal('active'), v.literal('disabled')),
  createdAt: v.float64(),
  updatedAt: v.float64(),
  lastLoginAt: v.optional(v.float64())
});

export const getSetupState = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query('users').take(1);
    return { needsSetup: users.length === 0 };
  }
});

export const getUserByUsername = queryGeneric({
  args: { username: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_username', (q) => q.eq('username', args.username))
      .unique();

    if (!user) {
      return null;
    }

    return {
      _id: user._id,
      username: user.username,
      passwordHash: user.passwordHash,
      isAdmin: user.isAdmin,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLoginAt: user.lastLoginAt
    };
  }
});

export const getSessionByTokenHash = queryGeneric({
  args: {
    sessionTokenHash: v.string(),
    now: v.float64()
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query('browserSessions')
      .withIndex('by_token_hash', (q) => q.eq('sessionTokenHash', args.sessionTokenHash))
      .unique();

    if (!session || session.revokedAt || session.expiresAt <= args.now) {
      return null;
    }

    const user = await ctx.db.get(session.ownerUserId);
    if (!user || user.status !== 'active') {
      return null;
    }

    return {
      session: {
        _id: session._id,
        ownerUserId: session.ownerUserId,
        expiresAt: session.expiresAt,
        createdAt: session.createdAt,
        lastUsedAt: session.lastUsedAt,
        revokedAt: session.revokedAt
      },
      user: {
        _id: user._id,
        username: user.username,
        isAdmin: user.isAdmin,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        lastLoginAt: user.lastLoginAt
      }
    };
  }
});

export const registerFirstUser = mutationGeneric({
  args: {
    username: v.string(),
    passwordHash: v.string(),
    sessionTokenHash: v.string(),
    expiresAt: v.float64(),
    now: v.float64()
  },
  handler: async (ctx, args) => {
    const existingUsers = await ctx.db.query('users').take(1);
    if (existingUsers.length > 0) {
      throw new Error('First user is already registered');
    }

    const userId = await ctx.db.insert('users', {
      username: args.username,
      passwordHash: args.passwordHash,
      isAdmin: true,
      status: 'active',
      createdAt: args.now,
      updatedAt: args.now,
      lastLoginAt: args.now
    });

    await ctx.db.insert('browserSessions', {
      ownerUserId: userId,
      sessionTokenHash: args.sessionTokenHash,
      createdAt: args.now,
      expiresAt: args.expiresAt,
      lastUsedAt: args.now
    });

    const installation = await ctx.db
      .query('installation')
      .withIndex('by_key', (q) => q.eq('key', 'main'))
      .unique();

    if (installation) {
      await ctx.db.patch(installation._id, {
        setupState: 'configured',
        defaultAdminCreatedAt: args.now,
        updatedAt: args.now
      });
    } else {
      await ctx.db.insert('installation', {
        key: 'main',
        setupState: 'configured',
        schemaVersion: '0',
        releaseChannel: 'v2.0.0-alpha',
        defaultAdminCreatedAt: args.now,
        createdAt: args.now,
        updatedAt: args.now
      });
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      throw new Error('User creation failed');
    }

    return {
      user: {
        _id: user._id,
        username: user.username,
        isAdmin: user.isAdmin,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        lastLoginAt: user.lastLoginAt
      }
    };
  }
});

export const createBrowserSession = mutationGeneric({
  args: {
    userId: v.id('users'),
    sessionTokenHash: v.string(),
    expiresAt: v.float64(),
    now: v.float64()
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || user.status !== 'active') {
      throw new Error('User is unavailable');
    }

    await ctx.db.insert('browserSessions', {
      ownerUserId: args.userId,
      sessionTokenHash: args.sessionTokenHash,
      createdAt: args.now,
      expiresAt: args.expiresAt,
      lastUsedAt: args.now
    });

    await ctx.db.patch(args.userId, {
      updatedAt: args.now,
      lastLoginAt: args.now
    });

    return {
      user: {
        _id: user._id,
        username: user.username,
        isAdmin: user.isAdmin,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: args.now,
        lastLoginAt: args.now
      }
    };
  }
});

export const revokeBrowserSessionByTokenHash = mutationGeneric({
  args: {
    sessionTokenHash: v.string(),
    revokedAt: v.float64()
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query('browserSessions')
      .withIndex('by_token_hash', (q) => q.eq('sessionTokenHash', args.sessionTokenHash))
      .unique();

    if (!session || session.revokedAt) {
      return { revoked: false };
    }

    await ctx.db.patch(session._id, {
      revokedAt: args.revokedAt,
      lastUsedAt: args.revokedAt
    });

    return { revoked: true };
  }
});

export const touchBrowserSession = mutationGeneric({
  args: {
    sessionTokenHash: v.string(),
    lastUsedAt: v.float64()
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query('browserSessions')
      .withIndex('by_token_hash', (q) => q.eq('sessionTokenHash', args.sessionTokenHash))
      .unique();

    if (!session || session.revokedAt) {
      return { touched: false };
    }

    await ctx.db.patch(session._id, {
      lastUsedAt: args.lastUsedAt
    });

    return { touched: true };
  }
});

export const revokeUserSessions = mutationGeneric({
  args: {
    userId: v.id('users'),
    revokedAt: v.float64()
  },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query('browserSessions')
      .withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', args.userId))
      .collect();

    let revokedCount = 0;
    for (const session of sessions) {
      if (session.revokedAt) {
        continue;
      }

      await ctx.db.patch(session._id, {
        revokedAt: args.revokedAt,
        lastUsedAt: args.revokedAt
      });
      revokedCount += 1;
    }

    return { revokedCount };
  }
});

export const getUserProfile = queryGeneric({
  args: { userId: v.id('users') },
  returns: publicUser,
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error('User not found');
    }

    return {
      _id: user._id,
      username: user.username,
      isAdmin: user.isAdmin,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLoginAt: user.lastLoginAt
    };
  }
});
