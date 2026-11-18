import { eq } from "drizzle-orm";
import { complaintCategories, complaints, departments, type Tx } from "@civicpulse/db";
import type { ComplaintDocument } from "@civicpulse/platform";
import type { EventHandler } from "../types";

/** Build the search document from the current database row (never from the event payload). */
export async function loadComplaintDocument(tx: Tx, id: string): Promise<ComplaintDocument | null> {
  const [row] = await tx
    .select({
      c: complaints,
      categoryName: complaintCategories.name,
      departmentName: departments.name,
    })
    .from(complaints)
    .innerJoin(complaintCategories, eq(complaintCategories.id, complaints.categoryId))
    .leftJoin(departments, eq(departments.id, complaints.departmentId))
    .where(eq(complaints.id, id))
    .limit(1);
  if (!row || row.c.deletedAt) return null;
  const c = row.c;
  return {
    id: c.id,
    organizationId: c.organizationId,
    trackingId: c.trackingId,
    title: c.title,
    description: c.description,
    locationText: c.locationText,
    categoryId: c.categoryId,
    categoryName: row.categoryName,
    departmentId: c.departmentId,
    departmentName: row.departmentName,
    status: c.status,
    priority: c.priority,
    reporterId: c.reporterId,
    assignedWorkerId: c.assignedWorkerId,
    location:
      c.latitude !== null && c.longitude !== null ? { lat: c.latitude, lon: c.longitude } : null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    slaDueAt: c.slaDueAt?.toISOString() ?? null,
  };
}

/**
 * Keeps OpenSearch eventually consistent with PostgreSQL. It indexes the *current* row, so
 * replayed or out-of-order events can never write stale data. A failure throws, which rolls
 * back the idempotency claim and triggers the retry / dead-letter path.
 */
export const searchIndexHandler: EventHandler = {
  group: "search-index",
  async handle(tx, event, deps) {
    if (deps.search.driver !== "opensearch" || !event.type.startsWith("complaint.")) return;
    if (event.type === "complaint.commented" || event.type === "complaint.attachment_added") return;
    const document = await loadComplaintDocument(tx, event.aggregateId);
    if (document) await deps.search.upsert(document);
    else await deps.search.remove(event.aggregateId);
  },
};
