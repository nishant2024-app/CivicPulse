import { eq, sql } from "drizzle-orm";
import { notificationPreferences, notifications, users } from "@civicpulse/db";
import { withSpan, SpanKind } from "@civicpulse/platform";
import type { EventDeps } from "../types";

/**
 * Email one notification. Safe to repeat: an already-sent notification is skipped.
 * `finalAttempt` marks the notification FAILED instead of leaving it queued for a retry.
 */
export async function sendNotificationEmail(
  deps: EventDeps,
  notificationId: string,
  options: { finalAttempt: boolean },
): Promise<void> {
  const row = await deps.db.withSystem(async (tx) => {
    const [found] = await tx
      .select({
        id: notifications.id,
        userId: notifications.userId,
        title: notifications.title,
        body: notifications.body,
        complaintId: notifications.complaintId,
        emailStatus: notifications.emailStatus,
        email: users.email,
        status: users.status,
        emailEnabled: notificationPreferences.emailEnabled,
      })
      .from(notifications)
      .innerJoin(users, eq(users.id, notifications.userId))
      .leftJoin(notificationPreferences, eq(notificationPreferences.userId, notifications.userId))
      .where(eq(notifications.id, notificationId))
      .limit(1);
    return found;
  });
  if (!row || row.emailStatus === "SENT") return;

  const setStatus = (emailStatus: "SENT" | "FAILED" | "NOT_REQUESTED" | "QUEUED", error?: string) =>
    deps.db.withSystem((tx) =>
      tx
        .update(notifications)
        .set({
          emailStatus,
          emailError: error?.slice(0, 500) ?? null,
          ...(emailStatus === "SENT" || emailStatus === "FAILED" || error
            ? { emailAttempts: sql`${notifications.emailAttempts} + 1` }
            : {}),
        })
        .where(eq(notifications.id, notificationId)),
    );

  if (row.status !== "ACTIVE" || row.emailEnabled === false) {
    await setStatus("NOT_REQUESTED");
    return;
  }

  const link = row.complaintId
    ? `\n\nOpen it: ${deps.webOrigin}/complaints/${row.complaintId}`
    : "";
  try {
    await withSpan(
      "email.send",
      {
        kind: SpanKind.CLIENT,
        attributes: { "email.template": "notification", "peer.service": "smtp" },
      },
      () =>
        deps.mailer.send({
          to: row.email,
          template: "notification",
          subject: `CivicPulse: ${row.title}`,
          text: `${row.body}${link}\n\nYou receive this because of activity on a report you are involved in. Manage this in Settings.`,
        }),
    );
    deps.metrics?.emailsSent.inc({ outcome: "sent" });
    await setStatus("SENT");
  } catch (error) {
    deps.metrics?.emailsSent.inc({ outcome: "failed" });
    // Not the last attempt: stay QUEUED and let the queue retry. The failure is recorded either way.
    await setStatus(options.finalAttempt ? "FAILED" : "QUEUED", (error as Error).message);
    if (!options.finalAttempt) throw error;
    deps.logger.error({ err: error, notificationId }, "notification email failed permanently");
  }
}
