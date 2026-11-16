import { and, asc, eq, isNull } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  complaintAttachments,
  complaintCategories,
  complaints,
  complaintStatusHistory,
  departments,
  organizations,
} from "@civicpulse/db";
import { TRACKING_ID_PATTERN } from "@civicpulse/platform";
import { organizationSettingsSchema, publicTrackingSchema } from "@civicpulse/shared";
import { errors } from "../../errors";

/**
 * Public, unauthenticated tracking. Runs with system privileges because there is no
 * tenant to scope to, so the query selects an explicit allow-list of columns and the
 * response is serialized through `publicTrackingSchema` — nothing else can leave.
 */
export const trackingRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/:trackingId",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        tags: ["Tracking"],
        summary: "Public status of a complaint by tracking ID",
        description:
          "Never includes the reporter, staff names, internal notes, exact coordinates or internal IDs.",
        params: z.object({ trackingId: z.string().max(20) }),
        response: { 200: publicTrackingSchema },
      },
    },
    async (request) => {
      const trackingId = request.params.trackingId.trim().toUpperCase();
      // Same answer for malformed, unknown and disabled, so IDs cannot be probed.
      const notFound = () => errors.notFound("Tracking ID");
      if (!TRACKING_ID_PATTERN.test(trackingId)) throw notFound();

      return app.db.withSystem(async (tx) => {
        const [row] = await tx
          .select({
            id: complaints.id,
            trackingId: complaints.trackingId,
            title: complaints.title,
            status: complaints.status,
            locationText: complaints.locationText,
            createdAt: complaints.createdAt,
            updatedAt: complaints.updatedAt,
            slaDueAt: complaints.slaDueAt,
            category: complaintCategories.name,
            organization: organizations.name,
            settings: organizations.settings,
            department: departments.name,
          })
          .from(complaints)
          .innerJoin(organizations, eq(organizations.id, complaints.organizationId))
          .innerJoin(complaintCategories, eq(complaintCategories.id, complaints.categoryId))
          .leftJoin(departments, eq(departments.id, complaints.departmentId))
          .where(
            and(
              eq(complaints.trackingId, trackingId),
              isNull(complaints.deletedAt),
              isNull(organizations.deletedAt),
            ),
          )
          .limit(1);
        if (!row || !organizationSettingsSchema.parse(row.settings).publicTrackingEnabled) {
          throw notFound();
        }

        const timeline = await tx
          .select({
            status: complaintStatusHistory.toStatus,
            note: complaintStatusHistory.note,
            at: complaintStatusHistory.createdAt,
          })
          .from(complaintStatusHistory)
          .where(eq(complaintStatusHistory.complaintId, row.id))
          .orderBy(asc(complaintStatusHistory.createdAt));

        const photos = await tx
          .select({
            storageKey: complaintAttachments.storageKey,
            thumbnailKey: complaintAttachments.thumbnailKey,
          })
          .from(complaintAttachments)
          .where(
            and(
              eq(complaintAttachments.complaintId, row.id),
              eq(complaintAttachments.kind, "RESOLUTION"),
              isNull(complaintAttachments.deletedAt),
            ),
          );

        return {
          trackingId: row.trackingId,
          title: row.title,
          status: row.status,
          category: row.category,
          organization: row.organization,
          department: row.department,
          locationText: row.locationText,
          reportedAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          slaDueAt: row.slaDueAt?.toISOString() ?? null,
          timeline: timeline.map((entry) => ({
            status: entry.status,
            // Notes on these steps explain the outcome to the public; other notes are
            // working remarks between staff and the reporter.
            note: ["REJECTED", "RESOLVED", "ON_HOLD"].includes(entry.status) ? entry.note : null,
            at: entry.at.toISOString(),
          })),
          resolutionPhotos: photos.map((photo) => ({
            url: app.storage.signedUrl(photo.storageKey),
            thumbnailUrl: app.storage.signedUrl(photo.thumbnailKey ?? photo.storageKey),
          })),
        };
      });
    },
  );
};
