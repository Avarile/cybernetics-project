import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "../config/config.service";
import * as amqp from "amqplib";
import { parseCeleryBody } from "./celery-message";
import { TaskHandlerRegistry } from "./task-handler.registry";

type AmqpConnection = Awaited<ReturnType<typeof amqp.connect>>;
const RECONNECT_MS = 5000;

/**
 * Consumes the Celery queue and dispatches to registered TaskHandlers. Runs only in worker.ts.
 * Unknown tasks (Django-owned during migration) are nacked without requeue; use per-queue routing
 * to guarantee ownership (see developments/backend/current_design/05-background-jobs.md §1).
 */
@Injectable()
export class CeleryWorker implements OnModuleDestroy {
  private readonly logger = new Logger(CeleryWorker.name);
  private connection?: AmqpConnection;
  private channel?: amqp.Channel;
  private stopped = false;

  constructor(
    private readonly config: ConfigService,
    private readonly registry: TaskHandlerRegistry,
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    await this.connectWithRetry();
  }

  private async connectWithRetry(): Promise<void> {
    if (this.stopped) return;
    const url = this.config.get<string>("AMQP_URL", "amqp://guest:guest@localhost:5672/");
    const queue = this.config.get<string>("NODE_CELERY_QUEUE", "celery");
    const prefetch = Number(this.config.get("CELERY_PREFETCH", 4));
    try {
      const conn = await amqp.connect(url);
      conn.on("error", (e: Error) => this.logger.warn(`AMQP error: ${e.message}`));
      conn.on("close", () => {
        if (!this.stopped) {
          this.logger.warn(`AMQP closed; reconnecting in ${RECONNECT_MS}ms`);
          setTimeout(() => void this.connectWithRetry(), RECONNECT_MS);
        }
      });
      const ch = await conn.createChannel();
      await ch.assertQueue(queue, { durable: true });
      await ch.prefetch(prefetch);
      await ch.consume(queue, (msg) => void this.dispatch(ch, msg));
      this.connection = conn;
      this.channel = ch;
      this.logger.log(
        `Celery worker consuming "${queue}" (prefetch ${prefetch}); handlers: ${this.registry.names().length}`,
      );
    } catch (e) {
      this.logger.warn(`AMQP connect failed: ${(e as Error).message}; retrying in ${RECONNECT_MS}ms`);
      setTimeout(() => void this.connectWithRetry(), RECONNECT_MS);
    }
  }

  private async dispatch(ch: amqp.Channel, msg: amqp.ConsumeMessage | null): Promise<void> {
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
    this.stopped = true;
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch {
      /* ignore shutdown errors */
    }
  }
}
