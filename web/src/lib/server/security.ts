import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const USERNAME_PATTERN = /^[a-z0-9_.-]{3,50}$/;
const PASSWORD_MIN_LENGTH = 10;
const SCRYPT_N = 1 << 14;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LEN = 64;
const TOKEN_HASH_KEY_LEN = 32;
const TOKEN_HASH_SALT = Buffer.from('mangarr-token-hash-v2', 'utf-8');

type ValidationResult = {
  ok: true;
  value: string;
} | {
  ok: false;
  message: string;
};

export function normalizeUsername(username: string): ValidationResult {
  const normalized = username.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(normalized)) {
    return {
      ok: false,
      message: 'Username must be 3-50 chars: letters, numbers, ., _, -'
    };
  }

  return { ok: true, value: normalized };
}

export function validatePasswordStrength(password: string): ValidationResult {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`
    };
  }

  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /\d/.test(password);

  if (!hasLower || !hasUpper || !hasDigit) {
    return {
      ok: false,
      message: 'Password must include upper, lower, and numeric characters'
    };
  }

  return { ok: true, value: password };
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const digest = scryptSync(password, salt, SCRYPT_KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P
  });

  return [
    'scrypt',
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString('base64'),
    digest.toString('base64')
  ].join('$');
}

export function verifyPassword(password: string, passwordHash: string): boolean {
  const parts = passwordHash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }

  const [_, nRaw, rRaw, pRaw, saltBase64, digestBase64] = parts;
  const n = Number.parseInt(nRaw, 10);
  const r = Number.parseInt(rRaw, 10);
  const p = Number.parseInt(pRaw, 10);

  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false;
  }

  const salt = Buffer.from(saltBase64, 'base64');
  const expectedDigest = Buffer.from(digestBase64, 'base64');
  const actualDigest = scryptSync(password, salt, expectedDigest.length, {
    N: n,
    r,
    p
  });

  return timingSafeEqual(actualDigest, expectedDigest);
}

export function generateOpaqueToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string) {
  return scryptSync(token, TOKEN_HASH_SALT, TOKEN_HASH_KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P
  }).toString('hex');
}
