const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/;
export type ComplaintDraftReceipt = { status: 'pending_email' | 'email_verified' | 'expired'; draftId: string; expiresAt: string };

export function complaintDatabaseTimestamp(value: unknown): number {
  if (typeof value !== 'string' || !DATE.test(value)) return NaN;
  const calendar = new Date(`${value.slice(0, 19)}Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 19) !== value.slice(0, 19)) return NaN;
  return Date.parse(value);
}

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
