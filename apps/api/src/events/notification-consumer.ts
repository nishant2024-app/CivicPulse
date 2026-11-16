import { and, eq, inArray } from "drizzle-orm";
import { departments, notifications, organizationMembers, type Tx } from "@civicpulse/db";
import { complaintEventPayloadSchema, type EventEnvelope } from "@civicpulse/shared";
import type { EventConsumer } from "./pump";

interface Draft {
  userId: string;
  title: string;
  body: string;
}

async function organizationAdmins(tx: Tx, organizationId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.role, "ORGANIZATION_ADMIN"),
        eq(organizationMembers.status, "ACTIVE"),
      ),
    );
  return rows.map((row) => row.userId);
}

async function departmentManager(tx: Tx, departmentId: string | null): Promise<string[]> {
  if (!departmentId) return [];
  const [row] = await tx
    .select({ managerUserId: departments.managerUserId })
    .from(departments)
    .where(eq(departments.id, departmentId))
    .limit(1);
  return row?.managerUserId ? [row.managerUserId] : [];
}

/** Turns complaint events into in-app notifications for the people they concern. */
export const notificationConsumer: EventConsumer = {
  group: "notification",
  async handle(tx, event: EventEnvelope) {
    if (!event.type.startsWith("complaint.") || !event.organizationId) return;
    const p = complaintEventPayloadSchema.parse(event.payload);
    const ref = `${p.trackingId} “${p.title}”`;
    const reason = p.note ? ` Note: ${p.note}` : "";
    const drafts: Draft[] = [];
    const toReporter = (title: string, body: string) =>
      drafts.push({ userId: p.reporterId, title, body });
    const toAll = (userIds: string[], title: string, body: string) =>
      userIds.forEach((userId) => drafts.push({ userId, title, body }));

    switch (event.type) {
      case "complaint.created":
        toReporter("Report received", `We logged ${ref}. Keep the tracking ID to follow progress.`);
        toAll(
          await organizationAdmins(tx, event.organizationId),
          "New report to review",
          `${ref} is waiting for verification.`,
        );
        break;
      case "complaint.verified":
        toReporter("Report verified", `${ref} was confirmed and will be assigned.`);
        break;
      case "complaint.rejected":
        toReporter("Report not accepted", `${ref} was rejected.${reason}`);
        break;
      case "complaint.assigned":
        toReporter("Report assigned", `${ref} has been assigned to a team.`);
        if (p.assignedWorkerId) {
          toAll([p.assignedWorkerId], "New assignment", `${ref} was assigned to you.${reason}`);
        }
        toAll(
          await departmentManager(tx, p.departmentId),
          "Assigned to your department",
          `${ref} was routed to your department.`,
        );
        break;
      case "complaint.work_started":
        toReporter("Work started", `Work has begun on ${ref}.`);
        break;
      case "complaint.on_hold":
        toReporter("Work paused", `${ref} is on hold.${reason}`);
        break;
      case "complaint.resolved":
        toReporter(
          "Marked as resolved",
          `${ref} was resolved.${reason} Confirm it, or reopen it if the problem remains.`,
        );
        break;
      case "complaint.reopened":
        toAll(
          [
            ...(await organizationAdmins(tx, event.organizationId)),
            ...(await departmentManager(tx, p.departmentId)),
            ...(p.assignedWorkerId ? [p.assignedWorkerId] : []),
          ],
          "Report reopened",
          `${ref} was reopened.${reason}`,
        );
        break;
      case "complaint.commented":
        if (p.byStaff) toReporter("New reply", `There is a new reply on ${ref}.`);
        else {
          toAll(
            [
              ...(p.assignedWorkerId ? [p.assignedWorkerId] : []),
              ...(await departmentManager(tx, p.departmentId)),
            ],
            "Reporter replied",
            `The reporter replied on ${ref}.`,
          );
        }
        break;
      default:
        return;
    }

    // Nobody is notified about their own action; one notification per person per event.
    const unique = new Map<string, Draft>();
    for (const draft of drafts) {
      if (draft.userId !== event.actorId && !unique.has(draft.userId)) {
        unique.set(draft.userId, draft);
      }
    }
    if (unique.size === 0) return;

    // Only people who are still active members receive anything.
    const active = await tx
      .select({ userId: organizationMembers.userId })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, event.organizationId),
          eq(organizationMembers.status, "ACTIVE"),
          inArray(organizationMembers.userId, [...unique.keys()]),
        ),
      );
    const rows = active.map(({ userId }) => {
      const draft = unique.get(userId)!;
      return {
        organizationId: event.organizationId!,
        userId,
        complaintId: p.complaintId,
        type: event.type,
        title: draft.title,
        body: draft.body,
        dedupeKey: event.id,
        // When it happened, not when it was processed: keeps the inbox in true order.
        createdAt: new Date(event.occurredAt),
      };
    });
    if (rows.length) await tx.insert(notifications).values(rows).onConflictDoNothing();
  },
};
