import { Injectable, Logger, type OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "../config/config.service";
import * as amqp from "amqplib";
import { buildCeleryMessage, type CeleryKwargs, type CeleryMessageOptions } from "./celery-message";

type AmqpConnection = Awaited<ReturnType<typeof amqp.connect>>;

/**
 * Publishes Celery-protocol-v2 messages so Django Celery workers can execute NestJS-enqueued tasks.
 * Mirror of Django's `<task>.delay(**kwargs)` / `apply_async`. Lazy connect with reset-on-error so
 * the app boots without a live broker.
 */
@Injectable()
export class CeleryProducer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CeleryProducer.name);
  private readonly defaultQueue = "celery";
  private connection?: AmqpConnection;
  private channel?: amqp.Channel;
  private channelPromise?: Promise<amqp.Channel>;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    // Best-effort warm connect; never crash boot if the broker is down.
    void this.ensureChannel().catch((e) => this.logger.warn(`RabbitMQ not ready (producer): ${(e as Error).message}`));
  }

  private url(): string {
    return this.config.get<string>("AMQP_URL", "amqp://guest:guest@localhost:5672/");
  }

  private reset(): void {
    this.channel = undefined;
    this.channelPromise = undefined;
  }

  private ensureChannel(): Promise<amqp.Channel> {
    if (this.channel) return Promise.resolve(this.channel);
    if (!this.channelPromise) {
      this.channelPromise = (async () => {
        const conn = await amqp.connect(this.url());
        conn.on("error", (e: Error) => {
          this.logger.warn(`AMQP connection error: ${e.message}`);
          this.reset();
        });
        conn.on("close", () => this.reset());
        const ch = await conn.createChannel();
        await ch.assertQueue(this.defaultQueue, { durable: true });
        this.connection = conn;
        this.channel = ch;
        this.logger.log("Connected to RabbitMQ (producer)");
        return ch;
      })().catch((e) => {
        this.channelPromise = undefined;
        throw e;
      });
    }
    return this.channelPromise;
  }

  /** Enqueue a Celery task by dotted name with kwargs (empty positional args, like Plane). */
  async enqueue(
    taskName: string,
    kwargs: CeleryKwargs = {},
    opts: CeleryMessageOptions & { queue?: string } = {},
  ): Promise<void> {
    const ch = await this.ensureChannel();
    const { body, properties } = buildCeleryMessage(taskName, kwargs, opts);
    ch.sendToQueue(opts.queue ?? this.defaultQueue, body, properties);
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch {
      /* ignore shutdown errors */
    }
  }
}
