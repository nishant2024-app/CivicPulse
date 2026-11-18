import type { EventHandler } from "../types";

/** Cache key prefix for an organization's analytics. */
export const analyticsPrefix = (organizationId: string) => `analytics:${organizationId}:`;

/** Drops cached analytics whenever a complaint changes. */
export const cacheInvalidationHandler: EventHandler = {
  group: "analytics-cache",
  async handle(_tx, event, deps) {
    if (!event.type.startsWith("complaint.") || !event.organizationId) return;
    await deps.cache.deleteByPrefix(analyticsPrefix(event.organizationId));
  },
};
