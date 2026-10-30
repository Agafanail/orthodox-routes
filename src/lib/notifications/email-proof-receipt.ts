const DATE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/;

// Pure validation shared with browser receipts; no server or provider imports.
export function emailProofDatabaseTimestamp(value: unknown): number {
  if (typeof value !== 'string' || !DATE.test(value)) return NaN;
  const calendar = new Date(`${value.slice(0, 19)}Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 19) !== value.slice(0, 19)) return NaN;
  return Date.parse(value);
}
