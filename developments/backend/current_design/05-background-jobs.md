# 05 — Background Jobs (Celery-compatible RabbitMQ)

The highest-risk part of coexistence: NestJS must **produce and consume RabbitMQ messages in Celery's own
wire format** so Django Celery workers and NestJS workers can share queues and tasks can be cut over one at
a time.

## 0. Ground truths

From `plane/celery.py` and `plane/settings/common.py`:
- **Broker**: RabbitMQ. `CELERY_BROKER_URL = amqp://…` (from `AMQP_URL` or `RABBITMQ_*`).
- **Serializer**: `CELERY_TASK_SERIALIZER = "json"`, `CELERY_ACCEPT_CONTENT = ["application/json"]`.
- **No result backend** → tasks are **fire-and-forget**. We only produce/consume; never write results.
  This massively simplifies the compatibility layer.
- Plane enqueues with **kwargs** (`issue_activity.delay(type=…, requested_data=…)`), so every body is
  `[[], {kwargs}, embed]`.
- **47 live tasks** across `plane/bgtasks/*` + `license/bgtasks/telemetry_metrics.py` (one, `restore_related_objects`, is commented out). **12 beat entries** (11 distinct tasks; `delete_old_s3_link` scheduled twice).
- **No custom queues/routing** in Django — everything runs on the default `celery` queue.

## 1. The Celery-compatible RabbitMQ layer

### Why not the obvious libraries
- `@nestjs/bullmq` / `bull` — Redis-only. Wrong broker **and** wrong format.
- `@nestjs/microservices` RMQ transport — speaks its **own** envelope (`{pattern, data, id}`); a Celery
  worker cannot parse it. Unusable for coexistence.
- **Chosen: a hand-rolled `amqplib` (via `amqp-connection-manager`) producer/consumer that speaks Celery
  task-protocol v2 directly.** The only way to guarantee bidirectional compatibility.

### The exact wire format (protocol v2, JSON)
Celery 5 defaults to task protocol **v2**: the task name is in the **AMQP header** `task` (not the body);
the body is a JSON 3-tuple `[args, kwargs, embed]`.

For `issue_activity.delay(type="issue.activity.created", requested_data="{...}", actor_id="…", issue_id="…",
project_id="…", current_instance=None, epoch=…, notification=True, origin="https://app…")`:

```
Exchange:      ""           (default direct exchange)
Routing key:   "celery"     (= queue name)
properties:
  content_type:     "application/json"
  content_encoding: "utf-8"
  correlation_id:   "<uuid4>"      # == headers.id
  delivery_mode:    2              # persistent
  priority:         0
  headers:
    lang: "py"
    task: "plane.bgtasks.issue_activities_task.issue_activity"   # <- dispatch key
    id: "<uuid4>"  root_id: "<uuid4>"  parent_id: null
    group: null  retries: 0  eta: null  expires: null  timelimit: [null, null]
    argsrepr: "()"  kwargsrepr: "{'type': 'issue.activity.created', ...}"   # cosmetic
    origin: "gen1@<host>"  ignore_result: true
body (raw JSON bytes, NOT base64 for json content-type):
  [ [],                                             # args
    { "type": "issue.activity.created", "requested_data": "{...}", "actor_id": "…",
      "issue_id": "…", "project_id": "…", "current_instance": null, "epoch": …,
      "notification": true, "subscriber": true, "origin": "https://app…" },
    { "callbacks": null, "errbacks": null, "chain": null, "chord": null } ]   # embed
```

Correctness points that de-risk this:
- **Task name = header `task`**; `id` = header `id` **and** `correlation_id`. Django keys off the header.
- **Body is raw JSON bytes** (base64 only applies to pickle/binary). amqplib publishes the Buffer as-is;
  set `contentType` + `contentEncoding` so Celery's codec picks JSON.
- **kwargs must byte-match Django.** Where Django passes `json.dumps(..., cls=DjangoJSONEncoder)` (e.g.
  `requested_data`, `current_instance`), the producer passes the same **JSON string**, not a nested object.
  Stringify UUIDs (`str(uuid)`) and datetimes (ISO-8601) identically.
- **Routing**: publish to exchange `""` with routing key `"celery"` (default exchange routes by queue name)
  → lands in the `celery` queue Django already consumes. Declare `celery` **durable** on boot.

### QueueModule

```ts
// infra/queue/celery-producer.service.ts
@Injectable()
export class CeleryProducer implements OnModuleInit {
  private channel: ChannelWrapper;
  constructor(private cfg: ConfigService) {}
  async onModuleInit() {
    const conn = amqp.connect([this.cfg.get('AMQP_URL')]);
    this.channel = conn.createChannel({
      json: false,                                    // we control the bytes
      setup: (ch: amqplib.Channel) => ch.assertQueue('celery', { durable: true }),
    });
  }
  /** Mirror of Django's <task>.delay(**kwargs) */
  async enqueue(taskName: string, kwargs: Record<string, unknown>, opts?: { queue?: string; eta?: Date }) {
    const id = randomUUID();
    const body = Buffer.from(JSON.stringify([[], kwargs,
      { callbacks: null, errbacks: null, chain: null, chord: null }]), 'utf-8');
    return this.channel.sendToQueue(opts?.queue ?? 'celery', body, {
      contentType: 'application/json', contentEncoding: 'utf-8',
      correlationId: id, deliveryMode: 2, priority: 0,
      headers: { lang: 'py', task: taskName, id, root_id: id, parent_id: null, group: null,
        retries: 0, eta: opts?.eta?.toISOString() ?? null, expires: null, timelimit: [null, null],
        argsrepr: '()', kwargsrepr: pyRepr(kwargs), origin: `gen1@${os.hostname()}`, ignore_result: true },
    });
  }
}
```

A typed registry keeps task names the single source of truth both sides agree on:

```ts
export const CELERY_TASKS = {
  issueActivity: 'plane.bgtasks.issue_activities_task.issue_activity',
  modelActivity: 'plane.bgtasks.webhook_task.model_activity',
  notifications: 'plane.bgtasks.notification_task.notifications',
  webhookActivity: 'plane.bgtasks.webhook_task.webhook_activity',
  webhookSend: 'plane.bgtasks.webhook_task.webhook_send_task',
  stackEmailNotification: 'plane.bgtasks.email_notification_task.stack_email_notification',
  hardDelete: 'plane.bgtasks.deletion_task.hard_delete',
  softDeleteRelated: 'plane.bgtasks.deletion_task.soft_delete_related_objects',
  pushInstanceMetrics: 'plane.license.bgtasks.telemetry_metrics.push_instance_metrics',
  // …all 47 (names must exactly match the Django dotted paths)
} as const;
```

### Consumer / worker

```ts
// infra/queue/celery-worker.service.ts (runs only in worker.ts)
@Injectable()
export class CeleryWorker {
  constructor(private registry: TaskHandlerRegistry, private cfg: ConfigService) {}
  async start() {
    const conn = amqp.connect([this.cfg.get('AMQP_URL')]);
    conn.createChannel({ setup: async (c: amqplib.Channel) => {
      const queue = this.cfg.get('NODE_CELERY_QUEUE', 'celery');
      await c.assertQueue(queue, { durable: true });
      await c.prefetch(Number(this.cfg.get('CELERY_PREFETCH', 4)));
      await c.consume(queue, (msg) => this.dispatch(c, msg));
    }});
  }
  private async dispatch(ch: amqplib.Channel, msg: amqplib.ConsumeMessage | null) {
    if (!msg) return;
    const taskName = msg.properties.headers?.task as string;
    const [args, kwargs] = JSON.parse(msg.content.toString('utf-8'));
    const handler = this.registry.get(taskName);
    if (!handler) return ch.nack(msg, false, false);   // not ours — see coexistence §1 mitigation
    try { await handler.run(kwargs, args); ch.ack(msg); }
    catch (e) { await this.retryOrDrop(ch, msg, e); }   // emulate Celery retry via re-publish (retries+1)
  }
}
```

Handlers self-register by task name:

```ts
export interface TaskHandler { readonly name: string; run(kwargs: any, args?: any[]): Promise<void>; }

@TaskHandlerFor(CELERY_TASKS.issueActivity)
@Injectable()
export class IssueActivityHandler implements TaskHandler {
  readonly name = CELERY_TASKS.issueActivity;
  run(kwargs: IssueActivityKwargs) { /* the ported audit engine (§3) */ }
}
```

### Coexistence risks + mitigations (the crux)

1. **A message lands on a worker that doesn't implement that task.** During migration some tasks live only
   in Django, some only in NestJS, and a shared `celery` queue means either worker can grab any message.
   **Mitigation: route by queue during migration.** Give NestJS-owned tasks their own queue (e.g.
   `celery.node`); Django-only tasks stay on `celery`. NestJS `enqueue` targets the right queue; each worker
   consumes only its own. Cut tasks over one queue at a time. (`nack(requeue=false)` is only a safety net.)
2. **kwargs drift** (a string vs object, a missing default like `subscriber=True`). **Mitigation: a shared
   TS contract per task** (`IssueActivityKwargs`, …) + a **golden-message test**: capture a real
   Django-emitted message from RabbitMQ and assert the NestJS producer reproduces byte-identical body+headers
   (modulo `id`/`origin`). This is the single most valuable test in the layer.
3. **`eta`/`countdown`** — Celery uses broker or its own timer. Plane only uses these indirectly via retry
   backoff, so a NestJS-side re-publish-with-delay suffices; fully faithful `eta` would need the
   `rabbitmq-delayed-message` plugin (flag, not needed initially).

## 2. Beat / periodic scheduler — RabbitMQ-based (replaces `@nestjs/schedule`)

**Decision:** RabbitMQ is already the broker, so let it hold the timer instead of an in-process cron
(`@nestjs/schedule`) that requires a single replica. A `RabbitMqScheduler` uses the broker's
**`x-delayed-message`** exchange with a **self-rescheduling tick loop**:

1. For each schedule, compute the delay to the next occurrence (a dependency-free UTC cron calculator,
   `infra/scheduler/cron.ts`, or a fixed `intervalMs`).
2. Publish a "tick" message to the delayed exchange with header `x-delay = msUntilNext`.
3. On delivery, the consumer (a) **enqueues** the corresponding Celery task and (b) **re-arms** the next
   tick. Because each delayed message is delivered to exactly one consumer, the tick chain stays single.
4. **Initial arming is leader-guarded** (Redis `SET NX`) so multiple scheduler replicas don't each seed
   the chain — no single-replica requirement, unlike in-process cron.

Requires the broker's `rabbitmq_delayed_message_exchange` plugin. `@nestjs/schedule` is **not used** and
can be dropped from dependencies. Implemented in `src/infra/scheduler/{cron.ts, scheduler.service.ts,
beat-schedule.ts}` and driven by `scheduler.ts`.

The 12 entries (all UTC):

| Cron | Enqueues |
|---|---|
| `*/5 * * * *` | `email_notification_task.stack_email_notification` |
| every `METRICS_PUSH_INTERVAL_MINUTES` (default 360) | `telemetry_metrics.push_instance_metrics` |
| `0 0 * * *` | `deletion_task.hard_delete` |
| `0 1 * * *` | `issue_automation_task.archive_and_close_old_issues` |
| `30 1 * * *` | `exporter_expired_task.delete_old_s3_link` |
| `0 2 * * *` | `file_asset_task.delete_unuploaded_file_asset` |
| `30 2 * * *` | `cleanup_task.delete_api_logs` |
| `45 2 * * *` | `cleanup_task.delete_email_notification_logs` |
| `0 3 * * *` | `cleanup_task.delete_page_versions` |
| `15 3 * * *` | `cleanup_task.delete_issue_description_versions` |
| `30 3 * * *` | `cleanup_task.delete_webhook_logs` |
| `45 3 * * *` | `exporter_expired_task.delete_old_s3_link` (duplicate) |

```ts
// Schedules are plain data (infra/scheduler/beat-schedule.ts): each has a cron OR an intervalMs.
export interface ScheduleEntry { name: string; task: string; kwargs?: Record<string, unknown>; cron?: string; intervalMs?: number; }

// RabbitMqScheduler.start(entries): connect → assert x-delayed-message exchange → consume ticks →
// leader-guarded initial arm. On each tick: enqueue the Celery task, then re-arm the next occurrence.
private arm(entry: ScheduleEntry): void {
  const delay = entry.intervalMs ?? Math.max(1000, cronNext(entry.cron!, new Date()).getTime() - Date.now());
  this.channel.publish("plane.scheduler", "tick", Buffer.from(JSON.stringify({ name: entry.name })),
    { headers: { "x-delay": delay }, deliveryMode: 2 });
}
```

**Migration note:** run **either** Django beat **or** the NestJS scheduler, never both, or every daily job
fires twice. Cut beat over as a single atomic switch (it only enqueues; whichever worker owns the task runs it).
TODO(phase4): dedupe re-seeding across broker/scheduler restarts (a last-fire guard in Redis).

## 3. Task inventory → NestJS processors (47 tasks)

Each domain group is a module whose `*.processor.ts` registers `TaskHandler`s:

| Module | Tasks | Notes |
|---|---|---|
| **activity** (largest, central) | `issue_activity`, `model_activity` | the hub — see below |
| **notification** | `notifications`, `stack_email_notification` (beat), `send_email_notification` | in-app + email-log fan-out; batch with a Redis lock |
| **email (transactional)** | `forgot_password`, `magic_link`, `user_activation_email`, `user_deactivation_email`, `send_email_update_confirmation`, `send_email_update_magic_code`, `project_invitation`, `project_add_user_email`, `workspace_invitation`, `send_webhook_deactivation_email` | SMTP via `InstanceConfiguration` + templates |
| **webhook** | `webhook_activity`, `webhook_send_task` | HMAC-SHA256; **SSRF-safe pinned-IP fetch**; retry/backoff (600s, 5 retries, jitter); auto-deactivate + email on exhaustion; `WebhookLog` |
| **export** | `issue_export_task`, `analytic_export_task`, `export_analytics_to_csv_email`, `delete_old_s3_link` (beat ×2) | zip → S3 → email link |
| **versioning** | `schedule_issue_version`, `sync_issue_version`, `issue_task`, `schedule_issue_description_version`, `sync_issue_description_version`, `issue_description_version_task`, `track_page_version`, `page_transaction` | issue + page description snapshots |
| **asset / s3** | `copy_s3_objects_of_description_and_assets`, `get_asset_object_metadata`, `delete_unuploaded_file_asset` (beat) | copy also calls the **live** service `/convert-document/` (see [`07`](./07-infra-and-integrations.md) §4) |
| **deletion / cleanup** | `soft_delete_related_objects`, `hard_delete` (beat), `delete_api_logs`, `delete_email_notification_logs`, `delete_page_versions`, `delete_issue_description_versions`, `delete_webhook_logs`, `archive_and_close_old_issues` (beat) | retention sweeps |
| **telemetry / analytics** | `push_instance_metrics` (beat), `track_event`, `process_logs`, `recent_visited_task`, `crawl_work_item_link_title` | PostHog / OTEL / API-activity log / link-title crawl (SSRF-hardened) |
| **seeding / dev** | `workspace_seed`, `create_dummy_data` | admin/management |

### The two-engine fan-out (get this right)

Django has **two independent** fan-outs triggered separately from controller actions:
- `issue_activity` (audit) → writes `IssueActivity` via a 28-entry `ACTIVITY_MAPPER` (12 `track_*` diff
  helpers) → if `notification=True`, **enqueues** `notifications` (in-app `Notification` + `EmailNotificationLog`).
  **It does not touch webhooks.**
- `model_activity` (diff) → enqueues `webhook_activity` → enqueues `webhook_send_task` (HMAC + `pinned_fetch`
  + `WebhookLog`).

### issue_activity audit engine (the biggest unit)
- `ISSUE_ACTIVITY_MAPPER` — 12 `track_*` handlers keyed by changed field (name, description, parent,
  priority, state, target_date, start_date, labels, assignees, estimate_points, archive_at, closed_to) diff
  `requested_data` vs `current_instance` → produce `IssueActivity` rows.
- `ACTIVITY_MAPPER` — 28 entries routing `type` (`issue.activity.created`, `comment.activity.updated`,
  `cycle.activity.created`, …) to `create_*` builders.
- After bulk insert, if `notification=True`, **enqueue** `notifications` (not inline). In NestJS:
  `IssueActivityHandler.run()` writes rows via Drizzle, then `producer.enqueue(CELERY_TASKS.notifications, {...})`.

### Enqueuing after a mutation (controller side)
Mirror `plane/app/views/issue/base.py` — after the DB write, fire the audit and (separately) the webhook diff:

```ts
const issue = await this.issues.createIssue({ ...dto, projectId });
await this.celery.enqueue(CELERY_TASKS.issueActivity, {
  type: 'issue.activity.created',
  requested_data: JSON.stringify(dto),                 // string, like DjangoJSONEncoder
  actor_id: String(user.id), issue_id: String(issue.id), project_id: String(projectId),
  current_instance: null, epoch: Math.floor(Date.now()/1000),
  notification: true, origin: baseHost(req, { isApp: true }),
});
await this.celery.enqueue(CELERY_TASKS.modelActivity, {
  model_name: 'issue', model_id: String(issue.id), requested_data: dto,
  current_instance: null, actor_id: String(user.id), slug, origin: baseHost(req, { isApp: true }),
});
```

An `ActivityDispatcher` service (or a `@AfterMutation()` interceptor) centralizes this so controllers stay
thin and the two-engine pattern is enforced consistently.

## 4. Fidelity checklist

- [ ] **Golden-message parity**: NestJS producer reproduces a Django-captured message byte-for-byte
      (body + headers, modulo `id`/`origin`).
- [ ] A **Django worker** executes a **NestJS-enqueued** task; a **NestJS worker** executes a
      **Django-enqueued** task.
- [ ] Per-queue routing lets a task be owned by exactly one worker fleet during cutover.
- [ ] Beat runs on exactly one scheduler (Django **or** NestJS); all 12 entries fire at the right UTC times.
- [ ] A mutation produces identical `IssueActivity`, `Notification`, and webhook deliveries as Django.
- [ ] Webhook delivery signs with the same HMAC and honors SSRF pinning + retry/backoff + `WebhookLog`.
