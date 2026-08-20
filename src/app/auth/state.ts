export type EmailLinkActionState =
  | { status: 'idle' }
  | { email: string; status: 'sent' }
  | { status: 'draft-unavailable' | 'invalid-email' | 'rate-limited' | 'send-failed' | 'unavailable' };
