interface CacheEntry {
  value: unknown;
  expiresAt: number | null;
  tags: string[];
}

class MemoryCache {
  private store = new Map<string, CacheEntry>();
  private readonly REDIS_URL = process.env.REDIS_URL;
  private redisClient: { get: (k: string) => Promise<string | null>; set: (k: string, v: string, opts?: Record<string, unknown>) => Promise<void>; del: (k: string) => Promise<void>; keys: (pattern: string) => Promise<string[]> } | null = null;
  private useRedis = false;

  constructor() {
    this.initRedis();
  }

  private async initRedis() {
    if (!this.REDIS_URL) {
      console.log("[MemoryCache] No REDIS_URL found. Using in-memory cache.");
      return;
    }
    try {
      const { createClient } = await import("redis" as string).catch(() => ({ createClient: null })) as { createClient: ((opts: { url: string }) => { connect: () => Promise<void>; get: (k: string) => Promise<string | null>; set: (k: string, v: string, opts?: Record<string, unknown>) => Promise<void>; del: (k: string) => Promise<void>; keys: (pattern: string) => Promise<string[]> }) | null };
      if (!createClient) {
        console.log("[MemoryCache] Redis client not available, using in-memory.");
        return;
      }
      const client = createClient({ url: this.REDIS_URL });
      await client.connect();
      this.redisClient = client;
      this.useRedis = true;
      console.log("[MemoryCache] Connected to Redis successfully.");
    } catch (err) {
      console.warn("[MemoryCache] Redis connection failed, falling back to in-memory:", err);
    }
  }

  async set(key: string, value: unknown, ttlSeconds?: number, tags: string[] = []): Promise<void> {
    const serialized = JSON.stringify({ value, tags });
    if (this.useRedis && this.redisClient) {
      const opts = ttlSeconds ? { EX: ttlSeconds } : {};
      await this.redisClient.set(`cortexflow:${key}`, serialized, opts);
      return;
    }
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { value, expiresAt, tags });
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    if (this.useRedis && this.redisClient) {
      const raw = await this.redisClient.get(`cortexflow:${key}`);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        return parsed.value as T;
      } catch {
        return null;
      }
    }
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async delete(key: string): Promise<void> {
    if (this.useRedis && this.redisClient) {
      await this.redisClient.del(`cortexflow:${key}`);
      return;
    }
    this.store.delete(key);
  }

  async keys(pattern = "*"): Promise<string[]> {
    if (this.useRedis && this.redisClient) {
      const keys = await this.redisClient.keys(`cortexflow:${pattern}`);
      return keys.map(k => k.replace("cortexflow:", ""));
    }
    return Array.from(this.store.keys()).filter(k => {
      if (pattern === "*") return true;
      const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
      return regex.test(k);
    });
  }

  async flush(): Promise<void> {
    this.store.clear();
  }

  isRedisConnected(): boolean {
    return this.useRedis;
  }

  getStats(): { backend: string; entries: number } {
    return {
      backend: this.useRedis ? "redis" : "in-memory",
      entries: this.store.size,
    };
  }
}

export const memoryCache = new MemoryCache();
