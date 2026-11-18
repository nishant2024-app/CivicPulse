import type { Redis } from "ioredis";

export interface Cache {
  readonly driver: "redis" | "memory";
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  /** Return the cached value, or load, store and return it. A cache failure is never an error. */
  getOrSet<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T>;
  deleteByPrefix(prefix: string): Promise<void>;
}

export interface CacheHooks {
  /** Called for every lookup and failure; used for metrics. */
  onResult?: (result: "hit" | "miss" | "error") => void;
}

const NAMESPACE = "cp:cache:";

export function createRedisCache(redis: Redis, hooks: CacheHooks = {}): Cache {
  const cache: Cache = {
    driver: "redis",
    async get<T>(key: string) {
      try {
        const raw = await redis.get(NAMESPACE + key);
        hooks.onResult?.(raw === null ? "miss" : "hit");
        return raw === null ? undefined : (JSON.parse(raw) as T);
      } catch {
        hooks.onResult?.("error");
        return undefined;
      }
    },
    async set(key, value, ttlSeconds) {
      try {
        await redis.set(NAMESPACE + key, JSON.stringify(value), "EX", ttlSeconds);
      } catch {
        hooks.onResult?.("error");
      }
    },
    async getOrSet(key, ttlSeconds, load) {
      const cached = await cache.get(key);
      if (cached !== undefined) return cached as never;
      const value = await load();
      await cache.set(key, value, ttlSeconds);
      return value;
    },
    async deleteByPrefix(prefix) {
      try {
        const keys: string[] = [];
        let cursor = "0";
        do {
          const [next, batch] = await redis.scan(
            cursor,
            "MATCH",
            `${NAMESPACE}${prefix}*`,
            "COUNT",
            200,
          );
          cursor = next;
          keys.push(...batch);
        } while (cursor !== "0");
        if (keys.length > 0) await redis.unlink(...keys);
      } catch {
        hooks.onResult?.("error");
      }
    },
  };
  return cache;
}

/** Process-local cache used when Redis is not configured. Bounded and TTL-based. */
export function createMemoryCache(hooks: CacheHooks = {}, maxEntries = 500): Cache {
  const entries = new Map<string, { value: unknown; expiresAt: number }>();
  const cache: Cache = {
    driver: "memory",
    async get<T>(key: string) {
      const entry = entries.get(key);
      if (!entry || entry.expiresAt < Date.now()) {
        entries.delete(key);
        hooks.onResult?.("miss");
        return undefined;
      }
      hooks.onResult?.("hit");
      return entry.value as T;
    },
    async set(key, value, ttlSeconds) {
      if (entries.size >= maxEntries) entries.delete(entries.keys().next().value as string);
      entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
    async getOrSet(key, ttlSeconds, load) {
      const cached = await cache.get(key);
      if (cached !== undefined) return cached as never;
      const value = await load();
      await cache.set(key, value, ttlSeconds);
      return value;
    },
    async deleteByPrefix(prefix) {
      for (const key of entries.keys()) if (key.startsWith(prefix)) entries.delete(key);
    },
  };
  return cache;
}
