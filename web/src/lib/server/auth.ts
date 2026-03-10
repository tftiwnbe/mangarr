import { redirect } from '@sveltejs/kit';
import type { Cookies, RequestEvent } from '@sveltejs/kit';

import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

import { convexApi } from './convex-api';
import { getConvexClient } from './convex';
import {
  generateOpaqueToken,
  hashPassword,
  hashToken,
  normalizeUsername,
  validatePasswordStrength,
  verifyPassword
} from './security';

const REMEMBERED_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EPHEMERAL_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_REFRESH_WINDOW_MS = 15 * 60 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_FAILS = 10;
const loginFailures = new Map<string, number[]>();

export type SessionUser = {
  id: string;
  username: string;
  isAdmin: boolean;
  createdAt: number;
  lastLoginAt?: number;
};

export type AuthState = {
  user: SessionUser | null;
  sessionToken: string | null;
  setupOpen: boolean;
};

type SessionLookup = {
  session: {
    _id: string;
    ownerUserId: string;
    expiresAt: number;
    createdAt: number;
    lastUsedAt?: number;
    revokedAt?: number;
  };
  user: {
    _id: string;
    username: string;
    isAdmin: boolean;
    status: 'active' | 'disabled';
    createdAt: number;
    updatedAt: number;
    lastLoginAt?: number;
  };
} | null;

export function getSessionCookieName() {
	return privateEnv.MANGARR_SESSION_COOKIE_NAME || 'mangarr_session';
}

export function isConvexConfigured() {
	return Boolean(publicEnv.PUBLIC_CONVEX_URL);
}

function isSecureRequest(event: Pick<RequestEvent, 'url'>) {
  return event.url.protocol === 'https:';
}

function sessionCookieOptions(event: Pick<RequestEvent, 'url'>, expires: Date) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isSecureRequest(event),
    expires
  };
}

export async function getSetupState() {
	if (!isConvexConfigured()) {
		return true;
	}

	const client = getConvexClient();
	const result = await client.query(convexApi.auth.getSetupState, {});
	return result.needsSetup;
}

export async function resolveAuthState(event: RequestEvent): Promise<AuthState> {
	if (!isConvexConfigured()) {
		return { user: null, sessionToken: null, setupOpen: true };
	}

	const sessionToken = event.cookies.get(getSessionCookieName()) ?? null;
	const setupOpen = await getSetupState();

  if (!sessionToken) {
    return { user: null, sessionToken: null, setupOpen };
  }

  const lookup = await fetchSessionByToken(sessionToken);
  if (!lookup) {
    clearSessionCookie(event.cookies, event);
    return { user: null, sessionToken: null, setupOpen };
  }

  const now = Date.now();
  const lastUsedAt = lookup.session.lastUsedAt ?? lookup.session.createdAt;
  if (now - lastUsedAt >= SESSION_REFRESH_WINDOW_MS) {
    const client = getConvexClient();
    await client.mutation(convexApi.auth.touchBrowserSession, {
      sessionTokenHash: hashToken(sessionToken),
      lastUsedAt: now
    });
  }

  return {
    sessionToken,
    setupOpen,
    user: {
      id: lookup.user._id,
      username: lookup.user.username,
      isAdmin: lookup.user.isAdmin,
      createdAt: lookup.user.createdAt,
      lastLoginAt: lookup.user.lastLoginAt
    }
  };
}

export async function registerFirstUser(event: RequestEvent, formData: FormData) {
	if (!isConvexConfigured()) {
		return { ok: false as const, field: 'form', message: 'PUBLIC_CONVEX_URL is not configured' };
	}

  const usernameResult = normalizeUsername(String(formData.get('username') ?? ''));
  if (!usernameResult.ok) {
    return { ok: false as const, field: 'username', message: usernameResult.message };
  }

  const password = String(formData.get('password') ?? '');
  const passwordResult = validatePasswordStrength(password);
  if (!passwordResult.ok) {
    return { ok: false as const, field: 'password', message: passwordResult.message };
  }

  const confirmPassword = String(formData.get('confirmPassword') ?? '');
  if (password !== confirmPassword) {
    return { ok: false as const, field: 'confirmPassword', message: 'Passwords do not match' };
  }

  if (!(await getSetupState())) {
    return { ok: false as const, field: 'form', message: 'Setup is already complete' };
  }

  const sessionToken = generateOpaqueToken();
  const now = Date.now();
  const expiresAt = now + REMEMBERED_SESSION_TTL_MS;
  const client = getConvexClient();

  try {
    await client.mutation(convexApi.auth.registerFirstUser, {
      username: usernameResult.value,
      passwordHash: hashPassword(password),
      sessionTokenHash: hashToken(sessionToken),
      expiresAt,
      now
    });
  } catch (error) {
    return {
      ok: false as const,
      field: 'form',
      message: error instanceof Error ? error.message : 'Failed to create the first user'
    };
  }

  setSessionCookie(event.cookies, event, sessionToken, expiresAt);
  return { ok: true as const };
}

export async function login(event: RequestEvent, formData: FormData) {
	if (!isConvexConfigured()) {
		return { ok: false as const, field: 'form', message: 'PUBLIC_CONVEX_URL is not configured' };
	}

  const ip = event.getClientAddress();
  const rateLimited = checkRateLimit(ip);
  if (rateLimited) {
    return { ok: false as const, field: 'form', message: rateLimited };
  }

  const usernameResult = normalizeUsername(String(formData.get('username') ?? ''));
  if (!usernameResult.ok) {
    recordFailure(ip);
    return { ok: false as const, field: 'username', message: usernameResult.message };
  }

  const password = String(formData.get('password') ?? '');
  const rememberMe = formData.get('rememberMe') === 'on';
  const client = getConvexClient();
  const user = await client.query(convexApi.auth.getUserByUsername, {
    username: usernameResult.value
  });

  if (!user || user.status !== 'active' || !verifyPassword(password, user.passwordHash)) {
    recordFailure(ip);
    return {
      ok: false as const,
      field: 'form',
      message: 'Invalid username or password'
    };
  }

  const sessionToken = generateOpaqueToken();
  const now = Date.now();
  const expiresAt = now + (rememberMe ? REMEMBERED_SESSION_TTL_MS : EPHEMERAL_SESSION_TTL_MS);

  await client.mutation(convexApi.auth.createBrowserSession, {
    userId: user._id,
    sessionTokenHash: hashToken(sessionToken),
    expiresAt,
    now
  });

  clearFailures(ip);
  setSessionCookie(event.cookies, event, sessionToken, expiresAt);
  return { ok: true as const };
}

export async function logout(event: RequestEvent) {
	const sessionToken = event.cookies.get(getSessionCookieName());
	if (sessionToken && isConvexConfigured()) {
		const client = getConvexClient();
		await client.mutation(convexApi.auth.revokeBrowserSessionByTokenHash, {
			sessionTokenHash: hashToken(sessionToken),
      revokedAt: Date.now()
    });
  }

  clearSessionCookie(event.cookies, event);
}

export function requireUser(event: RequestEvent) {
  if (!event.locals.auth.user) {
    throw redirect(303, '/login');
  }

  return event.locals.auth.user;
}

function setSessionCookie(
  cookies: Cookies,
  event: Pick<RequestEvent, 'url'>,
  sessionToken: string,
  expiresAt: number
) {
  cookies.set(getSessionCookieName(), sessionToken, sessionCookieOptions(event, new Date(expiresAt)));
}

function clearSessionCookie(cookies: Cookies, event: Pick<RequestEvent, 'url'>) {
  cookies.delete(getSessionCookieName(), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(event)
  });
}

async function fetchSessionByToken(sessionToken: string): Promise<SessionLookup> {
	const client = getConvexClient();
	return client.query(convexApi.auth.getSessionByTokenHash, {
    sessionTokenHash: hashToken(sessionToken),
    now: Date.now()
  }) as Promise<SessionLookup>;
}

function checkRateLimit(ip: string) {
  const now = Date.now();
  const entries = (loginFailures.get(ip) ?? []).filter((timestamp) => now - timestamp < RATE_WINDOW_MS);
  loginFailures.set(ip, entries);

  if (entries.length >= RATE_MAX_FAILS) {
    return 'Too many failed login attempts. Try again later.';
  }

  return null;
}

function recordFailure(ip: string) {
  const failures = loginFailures.get(ip) ?? [];
  failures.push(Date.now());
  loginFailures.set(ip, failures);
}

function clearFailures(ip: string) {
  loginFailures.delete(ip);
}
