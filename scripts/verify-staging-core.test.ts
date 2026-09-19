import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./verify-staging-core.mjs', import.meta.url)),
  'utf8',
);

describe('staging Core smoke safety', () => {
  it('never truncates shared staging data or requires an empty project', () => {
    expect(source).not.toMatch(/\btruncate\b/i);
    expect(source).not.toContain('staging smoke requires an empty');
  });

  it('requires the exact staging project and an existing current Terms fixture', () => {
    expect(source).toContain("expectedProjectName = 'orthodox-routes-staging'");
    expect(source).toContain("app.current_legal_document_id('terms', now())");
  });

  it('scopes teardown to the accounts created by the current run', () => {
    expect(source).toContain('cleanupSql(createdAccountIds, churchId, createdChurch)');
    expect(source).toContain('where author_account_id in (${accounts})');
    expect(source).toContain('where owner_account_id in (${accounts})');
    expect(source).toContain('where id in (${fixtureAccounts})');
  });
});
