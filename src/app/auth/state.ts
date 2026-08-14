export type EmailLinkActionState =
  | { status: 'idle' }
  | { email: string; status: 'sent' }
  | { status: 'invalid-email' | 'rate-limited' | 'send-failed' | 'unavailable' };
