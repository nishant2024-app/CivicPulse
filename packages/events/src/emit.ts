import { randomUUID } from "node:crypto";
import { outboxEvents, type Tx } from "@civicpulse/db";
import { currentTraceHeaders } from "@civicpulse/platform";

export interface DomainEvent {
  topic: string;
  type: string;
  organizationId: string;
  aggregateType: string;
  aggregateId: string;
  actorId: string | null;
  correlationId?: string | null;
  payload: Record<string, unknown>;
}

/**
 * Record a domain event in the transactional outbox. It commits or rolls back with the
 * business change that caused it; the relay publishes it afterwards. The active trace
 * context is stored with the row, so the trace continues through the relay and consumers.
 */
export async function emitEvent(tx: Tx, event: DomainEvent): Promise<string> {
  const id = randomUUID();
  // No RETURNING: the tenant role may insert into the outbox but not read it.
  await tx.insert(outboxEvents).values({
    id,
    organizationId: event.organizationId,
    topic: event.topic,
    eventType: event.type,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    payload: { ...event.payload, actorId: event.actorId },
    headers: {
      ...(event.correlationId ? { "correlation-id": event.correlationId } : {}),
      ...currentTraceHeaders(),
    },
  });
  return id;
}
