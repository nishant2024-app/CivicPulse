import { sql } from "drizzle-orm";
import { EVENT_TOPICS } from "@civicpulse/shared";
import type { Tx } from "@civicpulse/db";
import { emitEvent } from "../emit";
import { generateThumbnail } from "./thumbnail";
import type { EventDeps } from "../types";

const OPEN = sql`('REPORTED','VERIFIED','ASSIGNED','IN_PROGRESS','ON_HOLD','REOPENED')`;

interface DueRow extends Record<string, unknown> {
  id: string;
  organization_id: string;
  tracking_id: string;
  title: string;
  status: string;
  reporter_id: string;
  department_id: string | null;
  assigned_worker_id: string | null;
}

async function emitFor(
  tx: Tx,
  rows: DueRow[],
  type: "complaint.sla_warning" | "complaint.sla_breached",
) {
  for (const row of rows) {
    await emitEvent(tx, {
      topic: EVENT_TOPICS.complaints,
      type,
      organizationId: row.organization_id,
      aggregateType: "complaint",
      aggregateId: row.id,
      actorId: null,
      payload: {
        complaintId: row.id,
        trackingId: row.tracking_id,
        title: row.title,
        status: row.status,
        reporterId: row.reporter_id,
        departmentId: row.department_id,
        assignedWorkerId: row.assigned_worker_id,
      },
    });
  }
}

/**
 * Flag complaints that are close to, or past, their resolution deadline. Each complaint is
 * flagged once per kind (slaWarnedAt / slaBreachedAt), so the scan is safe to repeat and to
 * run from several workers at the same time.
 */
export async function scanSla(deps: EventDeps): Promise<{ warned: number; breached: number }> {
  return deps.db.withSystem(async (tx) => {
    const breached = (
      await tx.execute(sql`
        update complaints c set sla_breached_at = now()
        where c.deleted_at is null and c.status in ${OPEN}
          and c.sla_due_at is not null and c.sla_due_at < now() and c.sla_breached_at is null
        returning c.id, c.organization_id, c.tracking_id, c.title, c.status, c.reporter_id,
                  c.department_id, c.assigned_worker_id`)
    ).rows as DueRow[];
    const warned = (
      await tx.execute(sql`
        update complaints c set sla_warned_at = now()
        where c.deleted_at is null and c.status in ${OPEN}
          and c.sla_due_at is not null and c.sla_due_at >= now()
          and c.sla_warned_at is null and c.sla_breached_at is null
          and c.sla_due_at - make_interval(mins => coalesce((
                select p.warning_minutes from sla_policies p
                where p.organization_id = c.organization_id and p.priority = c.priority
                  and (p.category_id = c.category_id or p.category_id is null)
                order by p.category_id is null limit 1), 120)) <= now()
        returning c.id, c.organization_id, c.tracking_id, c.title, c.status, c.reporter_id,
                  c.department_id, c.assigned_worker_id`)
    ).rows as DueRow[];
    await emitFor(tx, breached, "complaint.sla_breached");
    await emitFor(tx, warned, "complaint.sla_warning");
    return { warned: warned.length, breached: breached.length };
  });
}

/** Delete data that has outlived its retention period (see docs/database/DATABASE_DESIGN.md §8). */
export async function runRetention(deps: EventDeps): Promise<Record<string, number>> {
  return deps.db.withSystem(async (tx) => {
    // The append-only trigger allows deletes only inside a transaction that opts in.
    await tx.execute(sql`select set_config('app.retention_purge', 'on', true)`);
    const purge = async (statement: ReturnType<typeof sql>) =>
      (await tx.execute(statement)).rowCount ?? 0;
    return {
      sessions: await purge(
        sql`delete from sessions where expires_at < now() - interval '30 days' or revoked_at < now() - interval '30 days'`,
      ),
      passwordResetTokens: await purge(
        sql`delete from password_reset_tokens where expires_at < now() - interval '7 days'`,
      ),
      invitations: await purge(
        sql`delete from invitations where expires_at < now() - interval '7 days' and accepted_at is null`,
      ),
      processedEvents: await purge(
        sql`delete from processed_events where processed_at < now() - interval '14 days'`,
      ),
      outbox: await purge(
        sql`delete from outbox_events where published_at < now() - interval '14 days'`,
      ),
      notifications: await purge(
        sql`delete from notifications where created_at < now() - interval '180 days'`,
      ),
      auditLogs: await purge(
        sql`delete from audit_logs where created_at < now() - interval '2 years'`,
      ),
    };
  });
}

/**
 * Find uploaded photos whose thumbnail was never made (queue was unreachable, worker was
 * down) and make them. Runs from the scheduler, so a Redis outage only delays thumbnails.
 */
export async function sweepPendingMedia(deps: EventDeps): Promise<number> {
  const rows = (
    await deps.db.withSystem((tx) =>
      tx.execute(sql`
        select id, organization_id, complaint_id from complaint_attachments
        where processing_status = 'PENDING' and deleted_at is null
          and created_at < now() - interval '2 minutes'
        order by created_at limit 50`),
    )
  ).rows as Array<{ id: string; organization_id: string; complaint_id: string }>;
  for (const row of rows) {
    const job = {
      kind: "thumbnail" as const,
      organizationId: row.organization_id,
      complaintId: row.complaint_id,
      attachmentId: row.id,
    };
    const queued = deps.queues ? await deps.queues.enqueueMedia(job) : false;
    if (!queued) await generateThumbnail(deps, job, { finalAttempt: true }).catch(() => undefined);
  }
  return rows.length;
}
