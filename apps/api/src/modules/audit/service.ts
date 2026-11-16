import { auditLogs, type Tx } from "@civicpulse/db";

export interface AuditEntry {
  organizationId: string | null;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  requestId?: string | null;
}

/**
 * Append an audit record inside the caller's transaction, so the record exists
 * if and only if the audited change committed.
 */
export async function recordAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLogs).values({
    organizationId: entry.organizationId,
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    metadata: entry.metadata ?? {},
    ipAddress: entry.ipAddress ?? null,
    requestId: entry.requestId ?? null,
  });
}
