import { Kafka, logLevel, type Admin, type Consumer, type Producer } from "kafkajs";
import type { Logger, Metrics } from "@civicpulse/platform";
import { eventEnvelopeSchema, type EventEnvelope } from "@civicpulse/shared";
import { consumeWithRetry } from "./consume";
import type { Broker, EventDeps, EventHandler } from "./types";

export interface KafkaOptions {
  brokers: string[];
  clientId: string;
  groupPrefix: string;
  /** Topics are `<prefix>.complaints`, `<prefix>.platform` and `<prefix>.dlq`. */
  topicPrefix: string;
}

export function topicNames(prefix: string) {
  return {
    complaints: `${prefix}.complaints`,
    platform: `${prefix}.platform`,
    deadLetter: `${prefix}.dlq`,
  };
}

const PARTITIONS = 2;

export function createKafka(options: KafkaOptions, logger: Logger): Kafka {
  return new Kafka({
    clientId: options.clientId,
    brokers: options.brokers,
    connectionTimeout: 5000,
    requestTimeout: 15_000,
    retry: { initialRetryTime: 300, retries: 8 },
    logLevel: logLevel.WARN,
    logCreator:
      () =>
      ({ namespace, level, log }) => {
        const { message, ...extra } = log;
        const method = level === logLevel.ERROR ? "error" : "warn";
        logger[method]({ kafka: namespace, ...extra }, message);
      },
  });
}

const topicFor = (prefix: string, event: EventEnvelope) =>
  event.aggregateType === "complaint" ? topicNames(prefix).complaints : topicNames(prefix).platform;

/** Create the topics if they do not exist. Idempotent; safe from every replica. */
export async function ensureTopics(admin: Admin, topicPrefix: string): Promise<void> {
  await admin.createTopics({
    waitForLeaders: true,
    topics: Object.values(topicNames(topicPrefix)).map((topic) => ({
      topic,
      numPartitions: PARTITIONS,
      replicationFactor: 1,
    })),
  });
}

export interface KafkaProducerHandle {
  broker: Broker;
  producer: Producer;
  disconnect(): Promise<void>;
}

/** Producer used by the outbox relay. Keyed by aggregate id so one complaint stays ordered. */
export async function createKafkaBroker(
  kafka: Kafka,
  topicPrefix: string,
): Promise<KafkaProducerHandle> {
  const producer = kafka.producer({ allowAutoTopicCreation: false, idempotent: true });
  await producer.connect();
  return {
    producer,
    broker: {
      driver: "kafka",
      async publish(event, headers) {
        await producer.send({
          topic: topicFor(topicPrefix, event),
          acks: -1,
          messages: [
            {
              key: event.aggregateId,
              value: JSON.stringify(event),
              headers: { ...headers, "event-id": event.id, "event-type": event.type },
            },
          ],
        });
      },
    },
    disconnect: () => producer.disconnect(),
  };
}

export interface KafkaConsumers {
  stop(): Promise<void>;
  /** Refresh the lag gauge for every group. */
  measureLag(): Promise<void>;
}

/**
 * One consumer group per handler, so each can fall behind, fail or be replayed on its own.
 * New groups start from the beginning of the topic, so adding a handler backfills it.
 */
export async function startKafkaConsumers(
  kafka: Kafka,
  options: KafkaOptions,
  handlers: EventHandler[],
  deps: EventDeps,
  producer: Producer,
  metrics?: Metrics,
): Promise<KafkaConsumers> {
  const logger = deps.logger;
  const topics = topicNames(options.topicPrefix);
  const admin = kafka.admin();
  await admin.connect();
  const consumers: Array<{ consumer: Consumer; groupId: string; handler: EventHandler }> = [];

  for (const handler of handlers) {
    const groupId = `${options.groupPrefix}-${handler.group}`;
    const consumer = kafka.consumer({
      groupId,
      allowAutoTopicCreation: false,
      sessionTimeout: 30_000,
    });
    await consumer.connect();
    await consumer.subscribe({ topic: topics.complaints, fromBeginning: true });
    await consumer.run({
      eachMessage: async ({ message }) => {
        if (!message.value) return;
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(message.headers ?? {})) {
          if (value !== undefined) headers[key] = value.toString();
        }
        const parsed = eventEnvelopeSchema.safeParse(JSON.parse(message.value.toString()));
        if (!parsed.success) {
          logger.error(
            { group: handler.group, issues: parsed.error.issues.length },
            "malformed event skipped",
          );
          await producer.send({
            topic: topics.deadLetter,
            messages: [
              {
                key: message.key,
                value: message.value,
                headers: { ...headers, "dlq-group": handler.group, "dlq-reason": "malformed" },
              },
            ],
          });
          return;
        }
        await consumeWithRetry(deps, handler, parsed.data, {
          headers,
          // Mirror dead letters to a topic so they can be inspected with ordinary Kafka tooling.
          onDeadLetter: async (event, group, error) => {
            await producer.send({
              topic: topics.deadLetter,
              messages: [
                {
                  key: event.aggregateId,
                  value: JSON.stringify(event),
                  headers: { "dlq-group": group, "dlq-reason": error.slice(0, 200) },
                },
              ],
            });
          },
        });
      },
    });
    consumers.push({ consumer, groupId, handler });
    logger.info({ group: groupId }, "kafka consumer started");
  }

  async function measureLag() {
    if (!metrics) return;
    try {
      const latest = await admin.fetchTopicOffsets(topics.complaints);
      for (const { groupId } of consumers) {
        const committed = await admin.fetchOffsets({ groupId, topics: [topics.complaints] });
        const partitions = committed[0]?.partitions ?? [];
        let lag = 0;
        for (const end of latest) {
          const position = Number(
            partitions.find((p) => p.partition === end.partition)?.offset ?? -1,
          );
          lag += Math.max(0, Number(end.offset) - (position < 0 ? Number(end.low) : position));
        }
        metrics.kafkaLag.set({ group: groupId, topic: topics.complaints }, lag);
      }
    } catch (error) {
      logger.warn({ err: error }, "could not measure kafka consumer lag");
    }
  }

  return {
    measureLag,
    async stop() {
      await Promise.allSettled(consumers.map(({ consumer }) => consumer.disconnect()));
      await admin.disconnect().catch(() => undefined);
    },
  };
}
