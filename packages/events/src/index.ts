export * from "./types";
export * from "./emit";
export * from "./consume";
export * from "./relay";
export * from "./kafka";
export * from "./handlers/notification";
export * from "./handlers/search-index";
export * from "./handlers/cache";
export * from "./jobs/mail";
export * from "./jobs/thumbnail";
export * from "./jobs/scheduled";

import { cacheInvalidationHandler } from "./handlers/cache";
import { notificationHandler } from "./handlers/notification";
import { searchIndexHandler } from "./handlers/search-index";
import type { EventHandler } from "./types";

/** Every consumer group of the system. */
export const ALL_HANDLERS: EventHandler[] = [
  notificationHandler,
  searchIndexHandler,
  cacheInvalidationHandler,
];
export * from "./runtime";
