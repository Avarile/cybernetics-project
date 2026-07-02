import { Injectable } from "@nestjs/common";
import { AsyncLocalStorage } from "node:async_hooks";

// Request-scoped context (Node AsyncLocalStorage) — the equivalent of Django's crum current-user
// thread-local. Dependency-free; established per request by RequestContextMiddleware.
export interface RequestStore {
  userId: string | null;
  requestId?: string | null;
  origin?: string | null;
}

const storage = new AsyncLocalStorage<RequestStore>();

@Injectable()
export class RequestContextService {
  run<T>(store: RequestStore, fn: () => T): T {
    return storage.run(store, fn);
  }

  get store(): RequestStore | undefined {
    return storage.getStore();
  }

  get userId(): string | null {
    return storage.getStore()?.userId ?? null;
  }

  set<K extends keyof RequestStore>(key: K, value: RequestStore[K]): void {
    const s = storage.getStore();
    if (s) s[key] = value;
  }
}
