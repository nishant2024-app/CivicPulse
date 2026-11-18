/**
 * Rebuild the search index from PostgreSQL. The index is derived data: run this after
 * changing the mapping, restoring a database, or if indexing fell behind.
 */
import { complaints } from "@civicpulse/db";
import { loadComplaintDocument, createRuntime } from "@civicpulse/events";
import { loadConfig } from "@civicpulse/platform";

const config = loadConfig();
const runtime = createRuntime(config, { service: "workers", useQueues: false });
try {
  if (runtime.search.driver !== "opensearch") {
    console.error("SEARCH_DRIVER is not opensearch; nothing to reindex");
    process.exit(1);
  }
  await runtime.search.ensureIndex();
  const ids = await runtime.db.withSystem((tx) =>
    tx.select({ id: complaints.id }).from(complaints),
  );
  let indexed = 0;
  for (const { id } of ids) {
    const document = await runtime.db.withSystem((tx) => loadComplaintDocument(tx, id));
    if (document) {
      await runtime.search.upsert(document);
      indexed += 1;
    }
  }
  await runtime.search.refresh();
  console.log(`Indexed ${indexed} complaints (index now holds ${await runtime.search.count()})`);
} finally {
  await runtime.close();
}
