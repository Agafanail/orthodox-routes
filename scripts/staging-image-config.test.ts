import { describe, expect, it, vi } from 'vitest';
import { IMAGE_STAGING_REF, readStagingImageConfig } from './staging-image-config';

const project = { id: IMAGE_STAGING_REF, name: 'orthodox-routes-staging', status: 'ACTIVE_HEALTHY' };
const keys = [{ type: 'publishable', api_key: 'sb_publishable_synthetic' }, { type: 'secret', api_key: 'sb_secret_synthetic' }];
function setup(metadata: unknown = [project], keyData: unknown = keys) {
  const runCli = vi.fn((args: string[]) => JSON.stringify(args[1] === 'list' ? metadata : keyData));
  return { readLinkedRef: () => IMAGE_STAGING_REF, runCli };
}
describe('pinned staging Storage configuration', () => {
  it('uses only pinned healthy staging metadata before retrieving credentials', () => {
    const dependencies = setup();
    expect(readStagingImageConfig(dependencies)).toEqual({ publicKey: keys[0].api_key, secretKey: keys[1].api_key,
      url: `https://${IMAGE_STAGING_REF}.supabase.co` });
    expect(dependencies.runCli.mock.calls[1][0]).toEqual(['projects', 'api-keys', '--project-ref', IMAGE_STAGING_REF, '--reveal', '--output', 'json']);
  });
  it('rejects a retargeted linked project without any provider call', () => {
    const dependencies = setup();
    expect(() => readStagingImageConfig({ ...dependencies, readLinkedRef: () => 'production-project' })).toThrow();
    expect(dependencies.runCli).not.toHaveBeenCalled();
  });
  it.each([[], null, [{ ...project, id: 'different-project' }], [{ ...project, name: 'production' }],
    [{ ...project, status: 'INACTIVE' }], [null], ['bad']])('refuses unavailable or mismatched metadata %j before keys', (metadata) => {
    const dependencies = setup(metadata);
    expect(() => readStagingImageConfig(dependencies)).toThrow();
    expect(dependencies.runCli).toHaveBeenCalledTimes(1);
  });
  it.each([[], null, [{ type: 'secret', api_key: 'PRIVATE-KEY' }],
    [{ type: 'publishable', api_key: 'sb_secret_wrong' }, keys[1]],
    [keys[0], { type: 'secret', api_key: 'sb_secret_bad\nkey' }]])('refuses invalid key data without exposing it %j', (keyData) => {
    expect(() => readStagingImageConfig(setup([project], keyData))).toThrow('The pinned isolated staging image project is unavailable or misconfigured.');
  });
  it('sanitizes malformed JSON and private CLI errors', () => {
    for (const runCli of [() => '{PRIVATE-OUTPUT', () => { throw new Error('PRIVATE-CREDENTIAL'); }]) {
      expect(() => readStagingImageConfig({ readLinkedRef: () => IMAGE_STAGING_REF, runCli })).toThrow('The pinned isolated staging image project is unavailable or misconfigured.');
    }
  });
});
