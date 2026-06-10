export type MemoryEntry<T = unknown> = {
  key: string;
  value: T;
  createdAt: number;
  expiresAt?: number;
  metadata?: Record<string, unknown>;
};

export type MemoryBackend = 'memory' | 'redis';

export type MemoryStoreOptions = {
  backend?: MemoryBackend;
  ttl?: number;
  maxSize?: number;
};

export class MemoryStore {
  private store = new Map<string, MemoryEntry>();
  private readonly ttl: number;
  private readonly maxSize: number;

  constructor(options: MemoryStoreOptions = {}) {
    this.ttl = options.ttl ?? 3600;
    this.maxSize = options.maxSize ?? 1000;
  }

  set<T>(key: string, value: T, metadata?: Record<string, unknown>): void {
    if (this.store.size >= this.maxSize) {
      const oldest = [...this.store.entries()].sort(
        ([, a], [, b]) => a.createdAt - b.createdAt
      )[0];
      if (oldest) this.store.delete(oldest[0]);
    }

    this.store.set(key, {
      key,
      value,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.ttl * 1000,
      metadata,
    });
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  keys(): string[] {
    this.evictExpired();
    return [...this.store.keys()];
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  append<T>(key: string, item: T): void {
    const existing = this.get<T[]>(key) ?? [];
    this.set(key, [...existing, item]);
  }

  getAll<T>(): Array<MemoryEntry<T>> {
    this.evictExpired();
    return [...this.store.values()] as Array<MemoryEntry<T>>;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}

export class ConversationMemory {
  private memory: MemoryStore;

  constructor(options: MemoryStoreOptions = {}) {
    this.memory = new MemoryStore(options);
  }

  addMessage(agentId: string, role: 'user' | 'assistant', content: string): void {
    this.memory.append(`conversation:${agentId}`, { role, content, ts: Date.now() });
  }

  getHistory(agentId: string): Array<{ role: 'user' | 'assistant'; content: string }> {
    return (this.memory.get<Array<{ role: 'user' | 'assistant'; content: string; ts: number }>>(`conversation:${agentId}`) ?? [])
      .map(({ role, content }) => ({ role, content }));
  }

  clearHistory(agentId: string): void {
    this.memory.delete(`conversation:${agentId}`);
  }
}
