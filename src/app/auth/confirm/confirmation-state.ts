import { isValidEmailTokenHash } from '@/lib/auth/flow';
import { isContextualTicket } from '@/lib/contextual-registration/secure-token';

export type ConfirmationState = {
  contextual: boolean;
  draft: string | null;
  flow: 'contextual' | 'login';
  tokenHash: string;
};

export function parseConfirmationFragment(fragment: string): ConfirmationState | null {
  if (!fragment.startsWith('#')) return null;
  const params = new URLSearchParams(fragment.slice(1));
  const flow = params.get('flow');
  const tokenHash = params.get('token_hash');
  const type = params.get('type');
  const draft = params.get('draft');
  const contextual = flow === 'contextual';

  if (
    type !== 'email'
    || !isValidEmailTokenHash(tokenHash)
    || (flow !== 'login' && !contextual)
    || (contextual && !isContextualTicket(draft))
  ) {
    return null;
  }

  return {
    contextual,
    draft: contextual ? draft : null,
    flow: contextual ? 'contextual' : 'login',
    tokenHash,
  };
}
