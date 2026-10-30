import { emailProofDatabaseTimestamp } from '@/lib/notifications/email-proof-receipt';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type ComplaintDraftReceipt = { status: 'pending_email' | 'email_verified' | 'expired'; draftId: string; expiresAt: string };

export const complaintDatabaseTimestamp = emailProofDatabaseTimestamp;

export function parseComplaintDraftReceipt(value: unknown): ComplaintDraftReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) return null;
  const item = value as Record<string, unknown>;
  if (Object.keys(item).length !== 3 || !['draft_id', 'status', 'expires_at'].every((key) => Object.hasOwn(item, key))
    || typeof item.draft_id !== 'string' || !UUID.test(item.draft_id)
    || typeof item.status !== 'string' || !['pending_email', 'email_verified', 'expired'].includes(item.status)
    || !Number.isFinite(complaintDatabaseTimestamp(item.expires_at))) return null;
  return { status: item.status as ComplaintDraftReceipt['status'], draftId: item.draft_id, expiresAt: item.expires_at as string };
}
