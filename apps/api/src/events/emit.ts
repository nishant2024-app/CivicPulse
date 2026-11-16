import { randomUUID } from "node:crypto";
import { outboxEvents, type Tx } from "@civicpulse/db";

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
 * business change that caused it; the relay publishes it afterwards.
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
    headers: event.correlationId ? { "correlation-id": event.correlationId } : {},
  });
  return id;
}
