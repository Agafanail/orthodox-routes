import { describe, expect, it } from 'vitest';
import { parseConfirmationFragment } from './confirmation-state';

const VALID_TOKEN_HASH = 'b'.repeat(64);
const VALID_DRAFT_TICKET = `v1.${'a'.repeat(16)}.${'b'.repeat(32)}.${'c'.repeat(22)}`;

describe('confirmation fragment parsing', () => {
  it('accepts a normal email confirmation only from the URL fragment', () => {
    expect(parseConfirmationFragment(
      `#flow=login&token_hash=${VALID_TOKEN_HASH}&type=email`,
    )).toEqual({
      contextual: false,
      draft: null,
      flow: 'login',
      tokenHash: VALID_TOKEN_HASH,
    });
  });

  it('accepts a contextual confirmation with a sealed draft ticket', () => {
    expect(parseConfirmationFragment(
      `#flow=contextual&draft=${VALID_DRAFT_TICKET}&token_hash=${VALID_TOKEN_HASH}&type=email`,
    )).toEqual({
      contextual: true,
      draft: VALID_DRAFT_TICKET,
      flow: 'contextual',
      tokenHash: VALID_TOKEN_HASH,
    });
  });

  it('rejects malformed, query-shaped, or raw-capability input', () => {
    expect(parseConfirmationFragment('')).toBeNull();
    expect(parseConfirmationFragment(`?flow=login&token_hash=${VALID_TOKEN_HASH}&type=email`)).toBeNull();
    expect(parseConfirmationFragment(`#flow=contextual&draft=${'a'.repeat(64)}&token_hash=${VALID_TOKEN_HASH}&type=email`)).toBeNull();
    expect(parseConfirmationFragment('#flow=login&token_hash=short&type=email')).toBeNull();
  });
});
