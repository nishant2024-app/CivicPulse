import { eq } from "drizzle-orm";
import sharp from "sharp";
import { complaintAttachments } from "@civicpulse/db";
import type { MediaJob } from "@civicpulse/platform";
import type { EventDeps } from "../types";

/** Create the 480 px thumbnail for an uploaded photo. Safe to repeat. */
export async function generateThumbnail(
  deps: EventDeps,
  job: Pick<MediaJob, "attachmentId">,
  options: { finalAttempt: boolean },
): Promise<void> {
  const [attachment] = await deps.db.withSystem((tx) =>
    tx
      .select()
      .from(complaintAttachments)
      .where(eq(complaintAttachments.id, job.attachmentId))
      .limit(1),
  );
  if (!attachment || attachment.deletedAt || attachment.processingStatus === "READY") return;
  try {
    const original = await deps.storage.get(attachment.storageKey);
    if (!original) throw new Error("original image is missing from storage");
    const thumbnail = await sharp(original.body, { limitInputPixels: 40_000_000 })
      .resize({ width: 480, height: 480, fit: "cover" })
      .webp({ quality: 72 })
      .toBuffer();
    const thumbnailKey = attachment.storageKey.replace(/\.webp$/, ".thumb.webp");
    await deps.storage.put(thumbnailKey, thumbnail, "image/webp");
    await deps.db.withSystem((tx) =>
      tx
        .update(complaintAttachments)
        .set({ thumbnailKey, processingStatus: "READY" })
        .where(eq(complaintAttachments.id, attachment.id)),
    );
  } catch (error) {
    if (options.finalAttempt) {
      await deps.db.withSystem((tx) =>
        tx
          .update(complaintAttachments)
          .set({ processingStatus: "FAILED" })
          .where(eq(complaintAttachments.id, attachment.id)),
      );
    }
    throw error;
  }
}
