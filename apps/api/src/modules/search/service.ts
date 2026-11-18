import { inArray, sql, type SQL } from "drizzle-orm";
import { complaints, type Db } from "@civicpulse/db";
import {
  MARK_CLOSE,
  MARK_OPEN,
  toSegments,
  type Logger,
  type SearchIndex,
  type SearchScope,
  type Segment,
} from "@civicpulse/platform";
import { hasPermission, type ComplaintSummary } from "@civicpulse/shared";
import type { AuthContext } from "../auth/sessions";
import { listComplaints, summariesByIds, type Ctx } from "../complaints/service";

export interface SearchParams {
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

export interface SearchResult {
  data: Array<
    ComplaintSummary & {
      highlights: { title?: Segment[]; description?: Segment[]; locationText?: Segment[] };
    }
  >;
  total: number;
  /** Which engine answered. `degraded` means OpenSearch was configured but unavailable. */
  engine: "opensearch" | "postgres";
  degraded: boolean;
  tookMs: number;
}

/** The documents a caller may see, in the search index's terms (mirrors the SQL visibility rule). */
export function searchScope(auth: AuthContext, organizationId: string): SearchScope {
  const me = auth.user.id;
  switch (auth.role) {
    case "SUPER_ADMIN":
    case "ORGANIZATION_ADMIN":
      return { organizationId, anyOf: null };
    case "DEPARTMENT_MANAGER":
      return {
        organizationId,
        anyOf: {
          reporterId: me,
          ...(auth.departmentId ? { departmentId: auth.departmentId } : {}),
        },
      };
    case "FIELD_WORKER":
      return { organizationId, anyOf: { reporterId: me, assignedWorkerId: me } };
    default:
      return { organizationId, anyOf: { reporterId: me } };
  }
}

const HIGHLIGHT_OPTIONS = `StartSel=${MARK_OPEN},StopSel=${MARK_CLOSE},HighlightAll=true`;
const SNIPPET_OPTIONS = `StartSel=${MARK_OPEN},StopSel=${MARK_CLOSE},MaxWords=35,MinWords=15`;

/** PostgreSQL full-text search with highlighting. Used by default and as the fallback. */
async function searchInPostgres(
  db: Db,
  ctx: Ctx,
  params: SearchParams,
): Promise<Omit<SearchResult, "engine" | "degraded" | "tookMs">> {
  let near: SQL | undefined;
  if (params.near) {
    const { lat, lon, radiusKm } = params.near;
    // Haversine distance in kilometres.
    near = sql`(${complaints.latitude} is not null and 2 * 6371 * asin(sqrt(
      power(sin(radians(${complaints.latitude} - ${lat}) / 2), 2) +
      cos(radians(${lat})) * cos(radians(${complaints.latitude})) *
      power(sin(radians(${complaints.longitude} - ${lon}) / 2), 2))) <= ${radiusKm})`;
  }
  const { total, rows } = await listComplaints(
    db,
    ctx,
    {
      page: params.page,
      pageSize: params.pageSize,
      sort: params.sort === "updatedAt" ? "updatedAt" : "createdAt",
      order: params.order,
      ...(params.q ? { q: params.q } : {}),
      ...(params.status ? { status: params.status as never } : {}),
      ...(params.priority ? { priority: params.priority as never } : {}),
      ...(params.categoryId ? { categoryId: params.categoryId } : {}),
      ...(params.departmentId ? { departmentId: params.departmentId } : {}),
    },
    near,
  );
  const highlights = new Map<string, SearchResult["data"][number]["highlights"]>();
  if (params.q && rows.length > 0) {
    const found = await db.withTenant(ctx, (tx) =>
      tx
        .select({
          id: complaints.id,
          title: sql<string>`ts_headline('english', ${complaints.title}, websearch_to_tsquery('english', ${params.q}), ${HIGHLIGHT_OPTIONS})`,
          description: sql<string>`ts_headline('english', ${complaints.description}, websearch_to_tsquery('english', ${params.q}), ${SNIPPET_OPTIONS})`,
        })
        .from(complaints)
        .where(
          inArray(
            complaints.id,
            rows.map((row) => row.id),
          ),
        ),
    );
    for (const row of found) {
      highlights.set(row.id, {
        ...(row.title.includes(MARK_OPEN) ? { title: toSegments(row.title) } : {}),
        ...(row.description.includes(MARK_OPEN)
          ? { description: toSegments(row.description) }
          : {}),
      });
    }
  }
  return { total, data: rows.map((row) => ({ ...row, highlights: highlights.get(row.id) ?? {} })) };
}

export async function searchComplaints(
  deps: { db: Db; index: SearchIndex; logger: Logger },
  ctx: Ctx,
  params: SearchParams,
): Promise<SearchResult> {
  const started = performance.now();
  const took = () => Math.round(performance.now() - started);
  if (deps.index.driver === "postgres") {
    return {
      ...(await searchInPostgres(deps.db, ctx, params)),
      engine: "postgres",
      degraded: false,
      tookMs: took(),
    };
  }
  try {
    const result = await deps.index.search({
      scope: searchScope(ctx.auth, ctx.organizationId),
      ...(params.q ? { q: params.q } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.priority ? { priority: params.priority } : {}),
      ...(params.categoryId ? { categoryId: params.categoryId } : {}),
      ...(params.departmentId ? { departmentId: params.departmentId } : {}),
      ...(params.near ? { near: params.near } : {}),
      sort: params.sort,
      order: params.order,
      page: params.page,
      pageSize: params.pageSize,
    });
    // The database has the last word: re-check visibility and drop anything stale.
    const summaries = await summariesByIds(
      deps.db,
      ctx,
      result.hits.map((hit) => hit.id),
    );
    const hitById = new Map(result.hits.map((hit) => [hit.id, hit]));
    return {
      total: result.total,
      data: summaries.map((summary) => ({
        ...summary,
        highlights: hitById.get(summary.id)?.highlights ?? {},
      })),
      engine: "opensearch",
      degraded: false,
      tookMs: took(),
    };
  } catch (error) {
    deps.logger.warn({ err: error }, "opensearch query failed; answering from PostgreSQL");
    return {
      ...(await searchInPostgres(deps.db, ctx, params)),
      engine: "postgres",
      degraded: true,
      tookMs: took(),
    };
  }
}

export const canSearch = (auth: AuthContext) => hasPermission(auth.role, "search:use");
