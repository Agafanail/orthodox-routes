import { describe, expect, it } from 'vitest';
import { readStoredArray, type StorageReader } from './storage';

function createStorage(value: string | null): StorageReader & { removedKeys: string[] } {
  const removedKeys: string[] = [];
  return {
    getItem: () => value,
    removeItem: (key) => removedKeys.push(key),
    removedKeys,
  };
}

describe('readStoredArray', () => {
  it('returns an empty array for a missing key', () => {
    expect(readStoredArray(createStorage(null), 'requests')).toEqual([]);
  });

  it('returns a valid parsed array', () => {
    expect(readStoredArray<{ id: string }>(createStorage('[{"id":"1"}]'), 'requests')).toEqual([{ id: '1' }]);
  });

  it('returns an empty array for malformed JSON', () => {
    expect(readStoredArray(createStorage('{invalid'), 'requests')).toEqual([]);
  });

  it('removes a corrupted key after malformed JSON', () => {
    const storage = createStorage('{invalid');
    readStoredArray(storage, 'requests');
    expect(storage.removedKeys).toEqual(['requests']);
  });

  it('returns an empty array when valid JSON is not an array', () => {
    expect(readStoredArray(createStorage('{"id":"1"}'), 'requests')).toEqual([]);
  });

  it('does not throw when storage access fails', () => {
    const storage: StorageReader = {
      getItem: () => {
        throw new Error('storage unavailable');
      },
      removeItem: () => {
        throw new Error('storage unavailable');
      },
    };
    expect(() => readStoredArray(storage, 'requests')).not.toThrow();
    expect(readStoredArray(storage, 'requests')).toEqual([]);
  });
});
