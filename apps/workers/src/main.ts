import http from "node:http";
import { sql } from "drizzle-orm";
import {
  ALL_HANDLERS,
  createKafka,
  createKafkaBroker,
  createMemoryBroker,
  createRelay,
  createRuntime,
  ensureTopics,
  generateThumbnail,
  outboxStats,
  runRetention,
  scanSla,
  sendNotificationEmail,
  startKafkaConsumers,
  sweepPendingMedia,
  type Broker,
  type EventDeps,
  type KafkaConsumers,
} from "@civicpulse/events";
import {
  ConfigError,
  contextFromHeaders,
  loadConfig,
  SpanKind,
  startWorkers,
  withSpan,
  type MailJob,
  type MediaJob,
  type WorkerSet,
} from "@civicpulse/platform";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const runtime = createRuntime(config, { service: "workers", useQueues: !!config.REDIS_URL });
  const { logger, db, metrics } = runtime;
  const deps: EventDeps = {
    db,
    logger,
    search: runtime.search,
    cache: runtime.cache,
    queues: runtime.queues,
    mailer: runtime.mailer,
    storage: runtime.storage,
    webOrigin: config.WEB_ORIGIN,
    metrics,
  };

  // Dependencies may still be starting (Kubernetes starts everything at once); retry setup.
  const retrySetup = async (name: string, run: () => Promise<unknown>) => {
    for (let attempt = 1; ; attempt++) {
      try {
        await run();
        return;
      } catch (error) {
        logger.warn({ err: error, attempt }, `${name} not ready; retrying`);
        await new Promise((resolve) => setTimeout(resolve, Math.min(attempt * 2000, 15_000)));
      }
    }
  };
  await retrySetup("object storage", () => runtime.storage.ensureReady());
  if (runtime.search.driver === "opensearch")
    await retrySetup("search index", () => runtime.search.ensureIndex());

  /* ---- events: outbox relay + consumers ---- */
  let kafkaConsumers: KafkaConsumers | undefined;
  let closeKafka: (() => Promise<void>) | undefined;
  let broker: Broker;
  if (config.EVENT_BROKER === "kafka") {
    const options = {
      brokers: config.KAFKA_BROKERS,
      clientId: config.KAFKA_CLIENT_ID,
      groupPrefix: config.KAFKA_GROUP_PREFIX,
      topicPrefix: config.KAFKA_TOPIC_PREFIX,
    };
    const kafka = createKafka(options, logger);
    await retrySetup("kafka topics", async () => {
      const admin = kafka.admin();
      await admin.connect();
      try {
        await ensureTopics(admin, options.topicPrefix);
      } finally {
        await admin.disconnect();
      }
    });
    const handle = await createKafkaBroker(kafka, options.topicPrefix);
    broker = handle.broker;
    kafkaConsumers = await startKafkaConsumers(
      kafka,
      options,
      ALL_HANDLERS,
      deps,
      handle.producer,
      metrics,
    );
    closeKafka = async () => {
      await kafkaConsumers?.stop();
      await handle.disconnect();
    };
  } else {
    broker = createMemoryBroker(deps, ALL_HANDLERS);
  }
  const relay = createRelay(db, broker, logger, metrics);
  relay.start(500);
  logger.info({ broker: broker.driver }, "outbox relay started");

  /* ---- BullMQ workers and the scheduler ---- */
  let workers: WorkerSet | undefined;
  const runScheduled = async (kind: "sla-scan" | "retention") => {
    if (kind === "sla-scan") {
      const result = await scanSla(deps);
      const swept = await sweepPendingMedia(deps);
      if (result.warned || result.breached || swept)
        logger.info({ ...result, swept }, "sla scan finished");
    } else {
      logger.info(await runRetention(deps), "retention run finished");
    }
  };
  let intervals: NodeJS.Timeout[] = [];
  if (config.REDIS_URL && runtime.queues) {
    const processWithTrace =
      <T extends { trace?: Record<string, string> }>(
        name: string,
        run: (job: { data: T; attemptsMade: number; opts: { attempts?: number } }) => Promise<void>,
      ) =>
      (job: { data: T; attemptsMade: number; opts: { attempts?: number } }) =>
        withSpan(
          `job ${name}`,
          { kind: SpanKind.CONSUMER, parent: contextFromHeaders(job.data.trace ?? {}) },
          () => run(job),
        );
    const finalAttempt = (job: { attemptsMade: number; opts: { attempts?: number } }) =>
      job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

    workers = startWorkers(
      config.REDIS_URL,
      logger,
      {
        mail: processWithTrace("mail", async (job) => {
          const data = job.data as MailJob;
          if (data.kind === "notification") {
            await sendNotificationEmail(deps, data.notificationId, {
              finalAttempt: finalAttempt(job),
            });
          } else {
            await runtime.mailer.send({
              to: data.to,
              subject: data.subject,
              text: data.text,
              template: data.template,
            });
            metrics.emailsSent.inc({ outcome: "sent" });
          }
        }) as never,
        media: processWithTrace("media", async (job) => {
          await generateThumbnail(deps, job.data as MediaJob, {
            finalAttempt: finalAttempt(job),
          });
        }) as never,
        scheduler: processWithTrace("scheduler", async (job) => {
          await runScheduled((job.data as { kind: "sla-scan" | "retention" }).kind);
        }) as never,
      },
      {
        onJob: (info) =>
          metrics.jobDuration.observe(
            { queue: info.queue, name: info.name, outcome: info.outcome },
            info.seconds,
          ),
      },
    );
    await runtime.queues.scheduleRecurring();
    logger.info("bullmq workers started");
  } else {
    // No Redis: run the scheduled work on timers. An advisory lock keeps replicas from overlapping.
    const guarded = (kind: "sla-scan" | "retention", lockId: number) => async () => {
      const got = await db.withSystem(async (tx) => {
        const result = await tx.execute(sql`select pg_try_advisory_xact_lock(${lockId}) as ok`);
        if (!(result.rows[0] as { ok: boolean }).ok) return false;
        await runScheduled(kind);
        return true;
      });
      void got;
    };
    intervals = [
      setInterval(
        () =>
          void guarded("sla-scan", 7001)().catch((e: unknown) =>
            logger.error({ err: e }, "sla scan failed"),
          ),
        5 * 60_000,
      ),
      setInterval(
        () =>
          void guarded("retention", 7002)().catch((e: unknown) =>
            logger.error({ err: e }, "retention failed"),
          ),
        24 * 3600_000,
      ),
    ];
    logger.info("redis not configured: scheduled work runs on timers");
  }

  /* ---- gauges refreshed for Prometheus ---- */
  const refreshGauges = async () => {
    try {
      const stats = await outboxStats(db);
      metrics.outboxPending.set(stats.pending);
      metrics.outboxOldestSeconds.set(stats.oldestSeconds);
      for (const entry of (await runtime.queues?.counts()) ?? []) {
        metrics.queueDepth.set({ queue: entry.queue, state: entry.state }, entry.count);
      }
      await kafkaConsumers?.measureLag();
    } catch (error) {
      logger.warn({ err: error }, "could not refresh gauges");
    }
  };
  const gaugeTimer = setInterval(() => void refreshGauges(), 15_000);
  void refreshGauges();

  /* ---- health and metrics ---- */
  const server = http.createServer(async (request, response) => {
    if (request.url === "/healthz") {
      response.writeHead(200, { "content-type": "application/json" }).end('{"status":"ok"}');
    } else if (request.url === "/readyz") {
      try {
        await db.ping();
        response.writeHead(200, { "content-type": "application/json" }).end('{"status":"ready"}');
      } catch {
        response
          .writeHead(503, { "content-type": "application/json" })
          .end('{"status":"not_ready"}');
      }
    } else if (request.url === "/metrics") {
      response
        .writeHead(200, { "content-type": metrics.registry.contentType })
        .end(await metrics.registry.metrics());
    } else {
      response.writeHead(404).end();
    }
  });
  server.listen(config.WORKER_PORT, config.HOST, () =>
    logger.info({ port: config.WORKER_PORT }, "workers ready"),
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down workers");
    clearInterval(gaugeTimer);
    intervals.forEach(clearInterval);
    server.close();
    await relay.stop();
    await workers?.close();
    await closeKafka?.();
    await runtime.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  console.error("Fatal workers error:", error);
  process.exit(1);
});
