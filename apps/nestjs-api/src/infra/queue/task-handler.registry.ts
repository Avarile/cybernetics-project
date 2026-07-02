import { Injectable, type OnModuleInit } from "@nestjs/common";
import { DiscoveryService } from "@nestjs/core";
import { CELERY_HANDLER } from "./celery-task.decorator";
import type { CeleryKwargs } from "./celery-message";

/** A NestJS-side implementation of a Celery task. Handlers accept kwargs first (Plane uses kwargs). */
export interface TaskHandler {
  readonly name: string;
  run(kwargs: CeleryKwargs, args?: unknown[]): Promise<void>;
}

@Injectable()
export class TaskHandlerRegistry implements OnModuleInit {
  private readonly byName = new Map<string, TaskHandler>();

  constructor(private readonly discovery: DiscoveryService) {}

  onModuleInit(): void {
    for (const wrapper of this.discovery.getProviders()) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;
      const isHandler = Reflect.getMetadata(CELERY_HANDLER, metatype) === true;
      const candidate = instance as Partial<TaskHandler>;
      if (isHandler && typeof candidate.run === "function" && typeof candidate.name === "string") {
        this.byName.set(candidate.name, candidate as TaskHandler);
      }
    }
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
