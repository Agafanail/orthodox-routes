export type StorageReader = {
  getItem: (key: string) => string | null;
  removeItem: (key: string) => void;
};

export function readStoredArray<T>(storage: StorageReader, key: string): T[] {
  try {
    const value = storage.getItem(key);

    if (value === null) {
      return [];
    }

    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // A broken storage implementation must not break mock-state hydration.
    }

    return [];
  }
}
