import { Client } from "@opensearch-project/opensearch";

/** A piece of highlighted text. Segments, not HTML: the UI never renders markup from search. */
export interface Segment {
  text: string;
  match: boolean;
}

export interface ComplaintDocument {
  id: string;
  organizationId: string;
  trackingId: string;
  title: string;
  description: string;
  locationText: string;
  categoryId: string;
  categoryName: string;
  departmentId: string | null;
  departmentName: string | null;
  status: string;
  priority: string;
  reporterId: string;
  assignedWorkerId: string | null;
  location: { lat: number; lon: number } | null;
  createdAt: string;
  updatedAt: string;
  slaDueAt: string | null;
}

/** Who is searching, expressed as the set of documents they may see. */
export interface SearchScope {
  organizationId: string;
  /** Null: everything in the organization. Otherwise a document must match one of these. */
  anyOf: null | { reporterId?: string; assignedWorkerId?: string; departmentId?: string };
}

export interface SearchQuery {
  scope: SearchScope;
  q?: string;
  status?: string;
  priority?: string;
  categoryId?: string;
  departmentId?: string;
  near?: { lat: number; lon: number; radiusKm: number };
  sort: "relevance" | "createdAt" | "updatedAt";
  order: "asc" | "desc";
  page: number;
  pageSize: number;
}

export interface SearchHit {
  id: string;
  score: number | null;
  highlights: { title?: Segment[]; description?: Segment[]; locationText?: Segment[] };
}

export interface SearchIndex {
  readonly driver: "opensearch" | "postgres";
  ensureIndex(): Promise<void>;
  upsert(document: ComplaintDocument): Promise<void>;
  remove(id: string): Promise<void>;
  search(query: SearchQuery): Promise<{ total: number; hits: SearchHit[] }>;
  refresh(): Promise<void>;
  count(): Promise<number>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

/** Used when SEARCH_DRIVER=postgres: the database itself answers queries. */
export function createPostgresSearchMarker(): SearchIndex {
  const unsupported = () => {
    throw new Error("search queries are served by PostgreSQL in this configuration");
  };
  return {
    driver: "postgres",
    ensureIndex: async () => {},
    upsert: async () => {},
    remove: async () => {},
    search: async () => unsupported(),
    refresh: async () => {},
    count: async () => 0,
    ping: async () => {},
    close: async () => {},
  };
}

// Printable sentinels: OpenSearch drops control characters used as highlight tags.
// They are removed from the text in toSegments, so they can never reach the UI.
export const MARK_OPEN = "\u27e6";
export const MARK_CLOSE = "\u27e7";

/** Split a highlighted fragment into segments, using the sentinel characters as markers. */
export function toSegments(fragment: string): Segment[] {
  const segments: Segment[] = [];
  let rest = fragment;
  while (rest.length > 0) {
    const open = rest.indexOf(MARK_OPEN);
    if (open === -1) {
      segments.push({ text: rest, match: false });
      break;
    }
    if (open > 0) segments.push({ text: rest.slice(0, open), match: false });
    const close = rest.indexOf(MARK_CLOSE, open + 1);
    const end = close === -1 ? rest.length : close;
    segments.push({ text: rest.slice(open + 1, end), match: true });
    rest = close === -1 ? "" : rest.slice(close + 1);
  }
  // Defensive: stray markers inside user text must never survive.
  return segments.map((s) => ({
    ...s,
    text: s.text.replaceAll(MARK_OPEN, "").replaceAll(MARK_CLOSE, ""),
  }));
}

const MAPPING = {
  settings: { number_of_shards: 1, number_of_replicas: 0 },
  mappings: {
    dynamic: "strict" as const,
    properties: {
      organizationId: { type: "keyword" },
      trackingId: { type: "keyword" },
      title: { type: "text", analyzer: "english" },
      description: { type: "text", analyzer: "english" },
      locationText: { type: "text", analyzer: "english" },
      categoryId: { type: "keyword" },
      categoryName: { type: "text", fields: { keyword: { type: "keyword" } } },
      departmentId: { type: "keyword" },
      departmentName: { type: "text", fields: { keyword: { type: "keyword" } } },
      status: { type: "keyword" },
      priority: { type: "keyword" },
      reporterId: { type: "keyword" },
      assignedWorkerId: { type: "keyword" },
      location: { type: "geo_point" },
      createdAt: { type: "date" },
      updatedAt: { type: "date" },
      slaDueAt: { type: "date" },
    },
  },
};

type Hooks = { onRequest?: (operation: string, seconds: number, ok: boolean) => void };

export function createOpenSearchIndex(url: string, index: string, hooks: Hooks = {}): SearchIndex {
  const client = new Client({ node: url, requestTimeout: 8000, maxRetries: 2 });
  const timed = async <T>(operation: string, run: () => Promise<T>): Promise<T> => {
    const started = performance.now();
    try {
      const result = await run();
      hooks.onRequest?.(operation, (performance.now() - started) / 1000, true);
      return result;
    } catch (error) {
      hooks.onRequest?.(operation, (performance.now() - started) / 1000, false);
      throw error;
    }
  };

  return {
    driver: "opensearch",
    async ensureIndex() {
      const exists = await client.indices.exists({ index });
      if (!exists.body) {
        try {
          // The client's request types are stricter than the REST API; the body is validated by the server.
          await client.indices.create({ index, body: MAPPING as never });
        } catch (error) {
          // Another replica created it first.
          if (!String((error as Error).message).includes("resource_already_exists")) throw error;
        }
      }
    },
    upsert: (document) =>
      timed("index", async () => {
        const { id, ...body } = document;
        await client.index({ index, id, body, refresh: false });
      }),
    remove: (id) =>
      timed("delete", async () => {
        await client
          .delete({ index, id, refresh: false })
          .catch((error: { statusCode?: number }) => {
            if (error.statusCode !== 404) throw error;
          });
      }),
    search: (query) =>
      timed("search", async () => {
        const filter: object[] = [{ term: { organizationId: query.scope.organizationId } }];
        const { anyOf } = query.scope;
        if (anyOf) {
          const should = Object.entries(anyOf)
            .filter(([, value]) => value)
            .map(([field, value]) => ({ term: { [field]: value } }));
          // An empty restriction means "nothing is visible", not "everything".
          filter.push(
            should.length ? { bool: { should, minimum_should_match: 1 } } : { match_none: {} },
          );
        }
        if (query.status) filter.push({ term: { status: query.status } });
        if (query.priority) filter.push({ term: { priority: query.priority } });
        if (query.categoryId) filter.push({ term: { categoryId: query.categoryId } });
        if (query.departmentId) filter.push({ term: { departmentId: query.departmentId } });
        if (query.near) {
          filter.push({
            geo_distance: {
              distance: `${query.near.radiusKm}km`,
              location: { lat: query.near.lat, lon: query.near.lon },
            },
          });
        }
        const must = query.q
          ? [
              {
                bool: {
                  should: [
                    { term: { trackingId: { value: query.q.trim().toUpperCase(), boost: 20 } } },
                    {
                      multi_match: {
                        query: query.q,
                        fields: [
                          "title^3",
                          "locationText^2",
                          "categoryName^2",
                          "description",
                          "departmentName",
                        ],
                        fuzziness: "AUTO",
                        operator: "and",
                      },
                    },
                  ],
                  minimum_should_match: 1,
                },
              },
            ]
          : [{ match_all: {} }];
        const sort =
          query.sort === "relevance" && query.q
            ? ["_score", { createdAt: "desc" }]
            : [{ [query.sort === "updatedAt" ? "updatedAt" : "createdAt"]: query.order }];
        const response = await client.search({
          index,
          body: {
            from: (query.page - 1) * query.pageSize,
            size: query.pageSize,
            track_total_hits: true,
            query: { bool: { must, filter } },
            sort,
            _source: false,
            highlight: {
              pre_tags: [MARK_OPEN],
              post_tags: [MARK_CLOSE],
              number_of_fragments: 0,
              fields: {
                title: {},
                description: { fragment_size: 200, number_of_fragments: 1 },
                locationText: {},
              },
            },
          } as never,
        });
        const body = response.body as {
          hits: {
            total: { value: number };
            hits: Array<{
              _id: string;
              _score: number | null;
              highlight?: Record<string, string[]>;
            }>;
          };
        };
        return {
          total: body.hits.total.value,
          hits: body.hits.hits.map((hit) => ({
            id: hit._id,
            score: hit._score,
            highlights: {
              ...(hit.highlight?.title?.[0] ? { title: toSegments(hit.highlight.title[0]) } : {}),
              ...(hit.highlight?.description?.[0]
                ? { description: toSegments(hit.highlight.description[0]) }
                : {}),
              ...(hit.highlight?.locationText?.[0]
                ? { locationText: toSegments(hit.highlight.locationText[0]) }
                : {}),
            },
          })),
        };
      }),
    async refresh() {
      await client.indices.refresh({ index });
    },
    async count() {
      const response = await client.count({ index });
      return (response.body as { count: number }).count;
    },
    async ping() {
      await client.cluster.health({ timeout: "3s" });
    },
    async close() {
      await client.close();
    },
  };
}
