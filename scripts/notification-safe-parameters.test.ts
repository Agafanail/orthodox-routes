import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../supabase/migrations/20261005090000_notification_safe_uuid_parameters.sql', import.meta.url),
  'utf8',
);

describe('notification safe parameters hardening', () => {
  it('allows only canonical UUID references to bypass contact-pattern matching', () => {
    expect(migration).toContain("string_content !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'");
    expect(migration).toContain('https?://');
    expect(migration).toContain('www\\.');
    expect(migration).toContain('[[:alnum:]_.%+-]+@');
    expect(migration).toContain('\\+?[0-9][0-9 ()-]{6,}[0-9]');
  });

  it('keeps sensitive keys and nested values prohibited', () => {
    expect(migration).toContain("item.key ~* '(email|phone|contact|address|coordinate|latitude|longitude|note|route|token|secret)'");
    expect(migration).toContain("jsonb_typeof(item.content) not in ('string', 'number', 'boolean', 'null')");
  });
});
