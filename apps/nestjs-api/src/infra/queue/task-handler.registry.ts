import { Inject, Injectable, Optional } from "@nestjs/common";
import type { CeleryKwargs } from "./celery-message";

/** A NestJS-side implementation of a Celery task. Handlers accept kwargs first (Plane uses kwargs). */
export interface TaskHandler {
  readonly name: string;
  run(kwargs: CeleryKwargs, args?: unknown[]): Promise<void>;
}

/** Multi-provider token: each processor registers with { provide: TASK_HANDLERS, useClass, multi: true }. */
export const TASK_HANDLERS = Symbol("TASK_HANDLERS");

@Injectable()
export class TaskHandlerRegistry {
  private readonly byName = new Map<string, TaskHandler>();

  constructor(@Optional() @Inject(TASK_HANDLERS) handlers: TaskHandler[] = []) {
    for (const h of handlers ?? []) this.byName.set(h.name, h);
  }

  get(name: string): TaskHandler | undefined {
    return this.byName.get(name);
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  names(): string[] {
    return [...this.byName.keys()];
  }
}
