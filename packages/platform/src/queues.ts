import { Queue, Worker, type Job, type JobsOptions } from "bullmq";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import { createRedis } from "./redis";
import { currentTraceHeaders } from "./telemetry";

/** Retryable background work. Domain events travel on Kafka; these are commands. */
/** W3C trace context of whoever queued the job, so the trace continues in the worker. */
export interface Traced {
  trace?: Record<string, string>;
}

export type MailJob = Traced &
  (
    | { kind: "message"; to: string; subject: string; text: string; template: string }
    | { kind: "notification"; notificationId: string }
  );

export type MediaJob = Traced & {
  kind: "thumbnail";
  organizationId: string;
  complaintId: string;
  attachmentId: string;
};

export type SchedulerJob = { kind: "sla-scan" } | { kind: "retention" };

export const QUEUE_NAMES = { mail: "mail", media: "media", scheduler: "scheduler" } as const;
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600, count: 5000 },
};

export interface JobQueues {
  readonly driver: "bullmq";
  /** Resolves true when queued; false when the queue is unreachable, so the caller can run inline. */
  enqueueMail(job: MailJob): Promise<boolean>;
  enqueueMedia(job: MediaJob): Promise<boolean>;
  counts(): Promise<Array<{ queue: QueueName; state: string; count: number }>>;
  /** Register the repeatable jobs. Safe to call from every worker replica. */
  scheduleRecurring(): Promise<void>;
  close(): Promise<void>;
}

export function createJobQueues(redis: Redis, logger: Logger): JobQueues {
  const queues = {
    mail: new Queue<MailJob>(QUEUE_NAMES.mail, {
      connection: redis,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
    media: new Queue<MediaJob>(QUEUE_NAMES.media, {
      connection: redis,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
    scheduler: new Queue<SchedulerJob>(QUEUE_NAMES.scheduler, { connection: redis }),
  };
  for (const queue of Object.values(queues)) {
    queue.on("error", (error) => logger.warn({ err: error, queue: queue.name }, "queue error"));
  }

  async function safeAdd(run: () => Promise<unknown>, what: string): Promise<boolean> {
    // BullMQ waits for the connection to come up, so an outage would hang the caller.
    // Not connected: answer immediately; connected but stalled: give up after two seconds.
    if (redis.status !== "ready") {
      logger.warn(
        { what },
        "redis is not connected; running the job inline instead of queueing it",
      );
      return false;
    }
    try {
      await Promise.race([
        run(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("timed out queueing the job")), 2000).unref(),
        ),
      ]);
      return true;
    } catch (error) {
      logger.warn({ err: error, what }, "could not enqueue job; falling back to inline execution");
      return false;
    }
  }

  return {
    driver: "bullmq",
    enqueueMail: (job) =>
      safeAdd(
        () =>
          queues.mail.add(
            job.kind,
            { ...job, trace: currentTraceHeaders() },
            {
              // A notification is emailed at most once even if its event is delivered twice.
              ...(job.kind === "notification"
                ? { jobId: `notification-${job.notificationId}` }
                : {}),
            },
          ),
        "mail",
      ),
    enqueueMedia: (job) =>
      safeAdd(
        () =>
          queues.media.add(
            job.kind,
            { ...job, trace: currentTraceHeaders() },
            { jobId: `thumbnail-${job.attachmentId}` },
          ),
        "media",
      ),
    async counts() {
      const result: Array<{ queue: QueueName; state: string; count: number }> = [];
      for (const [name, queue] of Object.entries(queues)) {
        const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed");
        for (const [state, count] of Object.entries(counts)) {
          result.push({ queue: name as QueueName, state, count });
        }
      }
      return result;
    },
    async scheduleRecurring() {
      await queues.scheduler.upsertJobScheduler(
        "sla-scan",
        { every: 5 * 60 * 1000 },
        { name: "sla-scan", data: { kind: "sla-scan" } },
      );
      await queues.scheduler.upsertJobScheduler(
        "retention",
        { every: 24 * 60 * 60 * 1000 },
        { name: "retention", data: { kind: "retention" } },
      );
    },
    async close() {
      await Promise.allSettled(Object.values(queues).map((queue) => queue.close()));
    },
  };
}

export interface WorkerHooks {
  /** Called when a job ends, for metrics. */
  onJob?: (info: {
    queue: QueueName;
    name: string;
    outcome: "completed" | "failed";
    seconds: number;
  }) => void;
}

export interface WorkerSet {
  close(): Promise<void>;
}

/** Start the BullMQ workers. Each processor must be idempotent: jobs are retried. */
export function startWorkers(
  url: string,
  logger: Logger,
  processors: {
    mail: (job: Job<MailJob>) => Promise<void>;
    media: (job: Job<MediaJob>) => Promise<void>;
    scheduler: (job: Job<SchedulerJob>) => Promise<void>;
  },
  hooks: WorkerHooks = {},
): WorkerSet {
  const connection = createRedis(url, logger, { mode: "blocking", name: "workers" });
  const make = <T>(
    name: QueueName,
    processor: (job: Job<T>) => Promise<void>,
    concurrency: number,
  ) => {
    const worker = new Worker<T>(
      name,
      async (job) => {
        const started = performance.now();
        try {
          await processor(job);
          hooks.onJob?.({
            queue: name,
            name: job.name,
            outcome: "completed",
            seconds: (performance.now() - started) / 1000,
          });
        } catch (error) {
          hooks.onJob?.({
            queue: name,
            name: job.name,
            outcome: "failed",
            seconds: (performance.now() - started) / 1000,
          });
          throw error;
        }
      },
      // Idle workers poll; a long drain delay keeps Redis command usage low.
      { connection, concurrency, drainDelay: 10, stalledInterval: 60_000 },
    );
    worker.on("failed", (job, error) =>
      logger.warn(
        { err: error, queue: name, job: job?.name, attempt: job?.attemptsMade },
        "job failed",
      ),
    );
    worker.on("error", (error) => logger.warn({ err: error, queue: name }, "worker error"));
    return worker;
  };
  const workers = [
    make<MailJob>(QUEUE_NAMES.mail, processors.mail, 5),
    make<MediaJob>(QUEUE_NAMES.media, processors.media, 2),
    make<SchedulerJob>(QUEUE_NAMES.scheduler, processors.scheduler, 1),
  ];
  return {
    async close() {
      await Promise.allSettled(workers.map((worker) => worker.close()));
      connection.disconnect();
    },
  };
}
