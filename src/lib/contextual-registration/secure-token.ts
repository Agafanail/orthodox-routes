import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto';

const CAPABILITY_PATTERN = /^[0-9a-f]{64}$/;
const TICKET_PART_PATTERN = /^[A-Za-z0-9_-]+$/;
const TICKET_CONTEXT = 'orthodox-routes:contextual-registration:v1';

export type ContextualResume = {
  capability: string;
  expiresAt: string;
};

function encryptionKey(secret: string) {
  return createHash('sha256').update(`${TICKET_CONTEXT}:ticket:${secret}`, 'utf8').digest();
}

export function isContextualCapability(value: unknown): value is string {
  return typeof value === 'string' && CAPABILITY_PATTERN.test(value);
}

export function isContextualTicket(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 1024) return false;
  const [version, iv, ciphertext, tag, extra] = value.split('.');
  return version === 'v1'
    && !extra
    && iv.length === 16
    && tag.length === 22
    && ciphertext.length > 0
    && TICKET_PART_PATTERN.test(iv)
    && TICKET_PART_PATTERN.test(ciphertext)
    && TICKET_PART_PATTERN.test(tag);
}

export function sealContextualResume(resume: ContextualResume, secret: string) {
  if (!isContextualCapability(resume.capability) || !Number.isFinite(Date.parse(resume.expiresAt))) {
    throw new Error('Invalid contextual resume material.');
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  cipher.setAAD(Buffer.from(TICKET_CONTEXT, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(resume), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${ciphertext.toString('base64url')}.${tag.toString('base64url')}`;
}

export function openContextualResume(ticket: unknown, secret: string, now = new Date()) {
  if (!isContextualTicket(ticket)) return null;

  try {
    const [, encodedIv, encodedCiphertext, encodedTag] = ticket.split('.');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey(secret),
      Buffer.from(encodedIv, 'base64url'),
    );
    decipher.setAAD(Buffer.from(TICKET_CONTEXT, 'utf8'));
    decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    const candidate = JSON.parse(plaintext) as Partial<ContextualResume>;
    if (
      !isContextualCapability(candidate.capability)
      || typeof candidate.expiresAt !== 'string'
      || !Number.isFinite(Date.parse(candidate.expiresAt))
      || Date.parse(candidate.expiresAt) <= now.getTime()
    ) return null;
    return candidate as ContextualResume;
  } catch {
    return null;
  }
}

export function deriveContextualRateKey(networkIdentity: string, secret: string) {
  const boundedIdentity = networkIdentity.trim().slice(0, 256) || 'unavailable';
  return createHmac('sha256', `${TICKET_CONTEXT}:rate:${secret}`)
    .update(boundedIdentity, 'utf8')
    .digest('hex');
}
