import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createComplaintPreparationIntent, type ComplaintPreparationIntent } from './preparation';

const CONTEXT = 'orthodox-routes:complaint-preparation-retry:v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64}$/;
const PART = /^[A-Za-z0-9_-]+$/;
const DATE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/;
const MAX_AGE_MS = 900_000; // Existing unsubmitted draft ceiling, not a complaint retention policy.
type State = ComplaintPreparationIntent & { issuedAt: number; expiresAt: number };
const validTime = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const validActor = (value: unknown): value is string | null => value === null || typeof value === 'string' && UUID.test(value);

function databaseTimestamp(value: unknown) {
  if (typeof value !== 'string' || !DATE.test(value)) return NaN;
  // Validate the literal calendar/time before applying its zone: Date.parse otherwise
  // normalizes impossible dates and 24:00 into a different day. Fractions stay conservative.
  const calendar = new Date(`${value.slice(0, 19)}Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 19) !== value.slice(0, 19)) return NaN;
  return Date.parse(value);
}

// Inactive Node/server-only codec. The caller supplies verified session context and a
// dedicated random 32-byte hex secret; no cookies, headers, environment or I/O are read.
export function createComplaintPreparationRetryStore(secret: unknown) {
  const key = typeof secret === 'string' && TOKEN.test(secret)
    ? createHash('sha256').update(`${CONTEXT}:ticket:${secret}`, 'utf8').digest() : null;
  const aad = (actor: string | null) => Buffer.from(`${CONTEXT}:${actor === null ? 'guest' : actor.toLowerCase()}`, 'utf8');
  const seal = (state: State, actor: string | null) => {
    if (!key) return null;
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad(actor));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(state), 'utf8'), cipher.final()]);
    return `v1.${iv.toString('base64url')}.${encrypted.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`;
  };
  const read = (ticket: unknown, actor: unknown, now: number): State | null => {
    try {
      if (!key || !validActor(actor) || !validTime(now) || typeof ticket !== 'string' || ticket.length > 1024) return null;
      const parts = ticket.split('.');
      if (parts.length !== 4 || parts[0] !== 'v1' || parts[1].length !== 16 || parts[3].length !== 22
        || !parts.slice(1).every((value) => PART.test(value))) return null;
      const decoded = parts.slice(1).map((value) => Buffer.from(value, 'base64url'));
      if (decoded.some((value, index) => value.toString('base64url') !== parts[index + 1])) return null;
      const decipher = createDecipheriv('aes-256-gcm', key, decoded[0]);
      decipher.setAAD(aad(actor)); decipher.setAuthTag(decoded[2]);
      const value = JSON.parse(Buffer.concat([decipher.update(decoded[1]), decipher.final()]).toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 5
        || !['clientKey', 'resumeToken', 'emailToken', 'issuedAt', 'expiresAt'].every((field) => Object.hasOwn(value, field))
        || typeof value.clientKey !== 'string' || !UUID.test(value.clientKey)
        || typeof value.resumeToken !== 'string' || !TOKEN.test(value.resumeToken)
        || typeof value.emailToken !== 'string' || !TOKEN.test(value.emailToken) || value.resumeToken === value.emailToken
        || !validTime(value.issuedAt) || !validTime(value.expiresAt) || value.issuedAt > now
        || value.expiresAt <= now || value.expiresAt <= value.issuedAt || value.expiresAt - value.issuedAt > MAX_AGE_MS) return null;
      return value as State;
    } catch { return null; }
  };
  return {
    issue(reporterAccountId: unknown, now = Date.now()) {
      try {
        if (!key || !validActor(reporterAccountId) || !validTime(now) || !validTime(now + MAX_AGE_MS)) return null;
        const intent = createComplaintPreparationIntent(), expiresAt = now + MAX_AGE_MS;
        const ticket = seal({ ...intent, issuedAt: now, expiresAt }, reporterAccountId);
        return ticket ? Object.freeze({ ticket, intent, expiresAt }) : null;
      } catch { return null; }
    },
    open(ticket: unknown, reporterAccountId: unknown, now = Date.now()) {
      const state = read(ticket, reporterAccountId, now);
      return state ? Object.freeze({ intent: Object.freeze({ clientKey: state.clientKey,
        resumeToken: state.resumeToken, emailToken: state.emailToken }), expiresAt: state.expiresAt }) : null;
    },
    restrict(ticket: unknown, reporterAccountId: unknown, databaseExpiry: unknown, now = Date.now()) {
      try {
        const state = read(ticket, reporterAccountId, now);
        const expiry = databaseTimestamp(databaseExpiry);
        if (!state || !validActor(reporterAccountId) || !validTime(expiry) || expiry <= now) return null;
        return seal({ ...state, expiresAt: Math.min(state.expiresAt, expiry) }, reporterAccountId);
      } catch { return null; }
    },
  };
}
