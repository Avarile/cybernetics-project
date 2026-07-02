import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import amqp, { type AmqpConnectionManager, type ChannelWrapper } from "amqp-connection-manager";
import type { ConfirmChannel, ConsumeMessage } from "amqplib";
import { parseCeleryBody } from "./celery-message";
import { TaskHandlerRegistry } from "./task-handler.registry";

/**
 * Consumes the Celery queue and dispatches to registered TaskHandlers. Runs only in worker.ts.
 * Unknown tasks (Django-owned during migration) are nacked without requeue; use per-queue routing
 * to guarantee ownership (see developments/backend/current_design/05-background-jobs.md §1).
 */
@Injectable()
export class CeleryWorker implements OnModuleDestroy {
  private readonly logger = new Logger(CeleryWorker.name);
  private connection?: AmqpConnectionManager;
  private channel?: ChannelWrapper;

  constructor(
    private readonly config: ConfigService,
    private readonly registry: TaskHandlerRegistry,
  ) {}

  async start(): Promise<void> {
    const url = this.config.get<string>("AMQP_URL", "amqp://guest:guest@localhost:5672/");
    const queue = this.config.get<string>("NODE_CELERY_QUEUE", "celery");
    const prefetch = Number(this.config.get("CELERY_PREFETCH", 4));

    this.connection = amqp.connect([url]);
    this.channel = this.connection.createChannel({
      setup: async (ch: ConfirmChannel) => {
        await ch.assertQueue(queue, { durable: true });
        await ch.prefetch(prefetch);
        await ch.consume(queue, (msg) => void this.dispatch(ch, msg));
      },
    });
    this.logger.log(
      `Celery worker consuming "${queue}" (prefetch ${prefetch}); handlers: ${this.registry.names().length}`,
    );
  }

  private async dispatch(ch: ConfirmChannel, msg: ConsumeMessage | null): Promise<void> {
    if (!msg) return;
    const taskName = msg.properties.headers?.task as string | undefined;
    if (!taskName) {
      ch.nack(msg, false, false);
      return;
    }
    const handler = this.registry.get(taskName);
    if (!handler) {
      this.logger.debug(`No handler for "${taskName}"; nack(requeue=false)`);
      ch.nack(msg, false, false);
      return;
    }
    try {
      const { args, kwargs } = parseCeleryBody(msg.content);
      await handler.run(kwargs, args);
      ch.ack(msg);
    } catch (err) {
      this.logger.error(`Task "${taskName}" failed: ${(err as Error).message}`);
      // No result backend; drop on failure. Per-task retry/backoff is added in Phase 3.
      ch.nack(msg, false, false);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
  }
}
