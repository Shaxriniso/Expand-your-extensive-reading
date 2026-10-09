import crypto from 'node:crypto';

export const MIN_AGE = 7;
export const MAX_AGE = 70;
export const GUARDIAN_AGE = 16; // members younger than this need a parent/guardian's consent

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const calc = crypto.scryptSync(password, Buffer.from(salt, 'base64'), 64);
  const expected = Buffer.from(hash, 'base64');
  return calc.length === expected.length && crypto.timingSafeEqual(calc, expected);
}

const b64 = (s) => Buffer.from(s).toString('base64url');

export function signToken(secret, payload, ttlSeconds) {
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(secret, token) {
  if (typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    return payload.exp > Date.now() / 1000 ? payload : null;
  } catch {
    return null;
  }
}

// Age in whole years on `onDate` (YYYY-MM-DD) for a birth date (YYYY-MM-DD).
export function ageOn(birthDate, onDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate || '');
  if (!m) return NaN;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return NaN;
  const [ty, tm, td] = onDate.split('-').map(Number);
  let age = ty - y;
  if (tm < mo || (tm === mo && td < d)) age--;
  return age;
}
