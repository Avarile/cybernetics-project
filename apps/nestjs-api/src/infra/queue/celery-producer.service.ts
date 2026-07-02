import { Injectable, Logger, type OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import amqp, { type AmqpConnectionManager, type ChannelWrapper } from "amqp-connection-manager";
import type { ConfirmChannel } from "amqplib";
import { buildCeleryMessage, type CeleryKwargs, type CeleryMessageOptions } from "./celery-message";

/**
 * Publishes Celery-protocol-v2 messages so Django Celery workers can execute NestJS-enqueued tasks.
 * Mirror of Django's `<task>.delay(**kwargs)` / `apply_async`.
 */
@Injectable()
export class CeleryProducer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CeleryProducer.name);
  private connection?: AmqpConnectionManager;
  private channel?: ChannelWrapper;
  private readonly defaultQueue = "celery";

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const url = this.config.get<string>("AMQP_URL", "amqp://guest:guest@localhost:5672/");
    this.connection = amqp.connect([url]);
    this.connection.on("connect", () => this.logger.log("Connected to RabbitMQ (producer)"));
    this.connection.on("disconnect", (e) => this.logger.warn(`RabbitMQ disconnected: ${e?.err?.message}`));
    this.channel = this.connection.createChannel({
      json: false, // we control the bytes (raw JSON body)
      setup: (ch: ConfirmChannel) => ch.assertQueue(this.defaultQueue, { durable: true }),
    });
  }

  /** Enqueue a Celery task by dotted name with kwargs (empty positional args, like Plane). */
  async enqueue(
    taskName: string,
    kwargs: CeleryKwargs = {},
    opts: CeleryMessageOptions & { queue?: string } = {},
  ): Promise<void> {
    if (!this.channel) throw new Error("CeleryProducer not initialised");
    const { body, properties } = buildCeleryMessage(taskName, kwargs, opts);
    const queue = opts.queue ?? this.defaultQueue;
    await this.channel.sendToQueue(queue, body, properties);
  }

  async onModuleDestroy(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
  }
}
