import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import * as amqp from "amqplib";
import type Redis from "ioredis";
import { REDIS } from "../cache/redis.module";
import { ConfigService } from "../config/config.service";
import { CeleryProducer } from "../queue/celery-producer.service";
import { cronNext } from "./cron";

type AmqpConnection = Awaited<ReturnType<typeof amqp.connect>>;
const RECONNECT_MS = 5000;

/** A periodic schedule: fires `task` (a Celery task name) on `cron` (UTC) or every `intervalMs`. */
export interface ScheduleEntry {
  name: string;
  task: string;
  kwargs?: Record<string, unknown>;
  cron?: string;
  intervalMs?: number;
}

/**
 * RabbitMQ-based distributed scheduler (replaces @nestjs/schedule).
 *
 * Rationale: RabbitMQ is already the broker, so let it hold the timer instead of an in-process cron
 * that requires a single replica. Uses the `x-delayed-message` exchange: each schedule publishes a
 * self-perpetuating "tick" delayed until its next occurrence; on delivery the consumer (a) enqueues
 * the Celery task and (b) re-arms the next tick. The tick chain is single because each delayed
 * message is delivered to exactly one consumer. Initial arming is leader-guarded (Redis SET NX) so
 * multiple scheduler replicas don't each seed the chain.
 *
 * Requires the RabbitMQ `rabbitmq_delayed_message_exchange` plugin on the broker.
 * TODO(phase4): dedupe re-seeding across broker/scheduler restarts (last-fire guard in Redis).
 */
@Injectable()
export class RabbitMqScheduler implements OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqScheduler.name);
  private readonly exchange = "plane.scheduler";
  private readonly queue = "plane.scheduler.ticks";
  private readonly routingKey = "tick";
  private readonly entries = new Map<string, ScheduleEntry>();
  private connection?: AmqpConnection;
  private channel?: amqp.Channel;
  private stopped = false;

  constructor(
    private readonly config: ConfigService,
    private readonly producer: CeleryProducer,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async start(entries: ScheduleEntry[]): Promise<void> {
    this.stopped = false;
    for (const e of entries) this.entries.set(e.name, e);
    await this.connectWithRetry();
  }

  private msUntilNext(entry: ScheduleEntry): number {
    if (entry.intervalMs && entry.intervalMs > 0) return entry.intervalMs;
    if (entry.cron) return Math.max(1000, cronNext(entry.cron, new Date()).getTime() - Date.now());
    throw new Error(`Schedule "${entry.name}" needs cron or intervalMs`);
  }

  private async connectWithRetry(): Promise<void> {
    if (this.stopped) return;
    const url = this.config.get<string>("AMQP_URL", "amqp://guest:guest@localhost:5672/");
    try {
      const conn = await amqp.connect(url);
      conn.on("error", (e: Error) => this.logger.warn(`AMQP error: ${e.message}`));
      conn.on("close", () => {
        if (!this.stopped) setTimeout(() => void this.connectWithRetry(), RECONNECT_MS);
      });
      const ch = await conn.createChannel();
      await ch.assertExchange(this.exchange, "x-delayed-message", {
        durable: true,
        arguments: { "x-delayed-type": "direct" },
      });
      await ch.assertQueue(this.queue, { durable: true });
      await ch.bindQueue(this.queue, this.exchange, this.routingKey);
      await ch.consume(this.queue, (msg) => void this.onTick(ch, msg));
      this.connection = conn;
      this.channel = ch;
      this.logger.log(`Scheduler connected; ${this.entries.size} schedules`);
      await this.armAll();
    } catch (e) {
      this.logger.warn(`Scheduler AMQP connect failed: ${(e as Error).message}; retry in ${RECONNECT_MS}ms`);
      setTimeout(() => void this.connectWithRetry(), RECONNECT_MS);
    }
  }

  /** Leader-guarded initial seeding so only one replica arms the tick chains. */
  private async armAll(): Promise<void> {
    const token = randomUUID();
    const acquired = await this.redis.set("plane:scheduler:leader", token, "EX", 300, "NX");
    if (!acquired) {
      this.logger.log("Not the scheduler leader; ticks already armed elsewhere");
      return;
    }
    for (const e of this.entries.values()) this.arm(e);
    this.logger.log(`Armed ${this.entries.size} schedules (leader)`);
  }

  private arm(entry: ScheduleEntry): void {
    if (!this.channel) return;
    const delay = this.msUntilNext(entry);
    this.channel.publish(this.exchange, this.routingKey, Buffer.from(JSON.stringify({ name: entry.name })), {
      headers: { "x-delay": delay },
      deliveryMode: 2,
    });
  }

  private async onTick(ch: amqp.Channel, msg: amqp.ConsumeMessage | null): Promise<void> {
    if (!msg) return;
    try {
      const { name } = JSON.parse(msg.content.toString("utf-8")) as { name: string };
      const entry = this.entries.get(name);
      if (entry) {
        await this.producer.enqueue(entry.task, entry.kwargs ?? {});
        this.arm(entry); // re-arm the next occurrence (single chain)
        this.logger.debug(`Fired schedule "${name}" -> ${entry.task}`);
      }
      ch.ack(msg);
    } catch (err) {
      this.logger.error(`Scheduler tick failed: ${(err as Error).message}`);
      ch.nack(msg, false, false);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch {
      /* ignore */
    }
  }
}
