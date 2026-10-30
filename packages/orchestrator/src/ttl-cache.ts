export type TtlCache<V> = {
  get: (key: string, now: number) => V | undefined;
  set: (key: string, value: V, now: number) => void;
  delete: (key: string) => void;
  deleteWhere: (matches: (key: string) => boolean) => void;
};

export function createTtlCache<V>(ttlMs: number): TtlCache<V> {
  const entries = new Map<string, { value: V; storedAt: number }>();
  return {
    get: (key, now) => {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (now - entry.storedAt >= ttlMs) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set: (key, value, now) => {
      entries.set(key, { value, storedAt: now });
    },
    delete: (key) => {
      entries.delete(key);
    },
    deleteWhere: (matches) => {
      for (const key of entries.keys()) if (matches(key)) entries.delete(key);
    },
  };
}

export function scopedTtlCache<V>(ttlMs: number): (scope: object) => TtlCache<V> {
  const caches = new WeakMap<object, TtlCache<V>>();
  return (scope) => {
    const existing = caches.get(scope);
    if (existing) return existing;
    const created = createTtlCache<V>(ttlMs);
    caches.set(scope, created);
    return created;
  };
}
