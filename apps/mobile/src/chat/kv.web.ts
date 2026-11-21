// Web build is a DEV tool only (no at-rest guarantee): same interface on localStorage.
const P = 'thirstr.kv.';

export const kv = {
  async get<T>(k: string): Promise<T | null> {
    try {
      const v = localStorage.getItem(P + k);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  },
  async set(k: string, v: unknown) {
    localStorage.setItem(P + k, JSON.stringify(v));
  },
  async del(k: string) {
    localStorage.removeItem(P + k);
  },
  async keys(prefix: string): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(P + prefix)) out.push(k.slice(P.length));
    }
    return out;
  },
  async getPrefix<T>(prefix: string): Promise<T[]> {
    const out: T[] = [];
    for (const k of await this.keys(prefix)) {
      const v = await this.get<T>(k);
      if (v !== null) out.push(v);
    }
    return out;
  },
  async delPrefix(prefix: string) {
    for (const k of await this.keys(prefix)) localStorage.removeItem(P + k);
  },
  async wipe() {
    for (const k of await this.keys('')) localStorage.removeItem(P + k);
  },
};
