import { sql, type SQL } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Tx } from "@civicpulse/db";
import {
  analyticsOverviewSchema,
  categoryCountSchema,
  COMPLAINT_STATUSES,
  departmentPerformanceSchema,
  hotspotSchema,
  trendPointSchema,
  type ComplaintStatus,
} from "@civicpulse/shared";
import type { AuthContext } from "../auth/sessions";

const OPEN = sql`('REPORTED','VERIFIED','ASSIGNED','IN_PROGRESS','ON_HOLD','REOPENED')`;
const DONE = sql`('RESOLVED','CLOSED')`;
const tags = ["Analytics"];

/** Department managers get figures for their own department only. */
function scope(auth: AuthContext): SQL {
  return auth.role === "DEPARTMENT_MANAGER"
    ? sql`c.deleted_at is null and c.department_id = ${auth.departmentId}`
    : sql`c.deleted_at is null`;
}

async function rows<T extends Record<string, unknown>>(tx: Tx, query: SQL): Promise<T[]> {
  return (await tx.execute(query)).rows as T[];
}
const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));

/**
 * Every figure here is computed from the complaints table at request time.
 * With no data the endpoints return zeros and nulls — never placeholders.
 */
export const analyticsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook("preHandler", app.requirePermission("analytics:read"));

  app.get(
    "/overview",
    { schema: { tags, summary: "Headline figures", response: { 200: analyticsOverviewSchema } } },
    async (request) => {
      const ctx = request.tenant();
      const where = scope(ctx.auth);
      return app.db.withTenant(ctx, async (tx) => {
        const [totals] = await rows<Record<string, unknown>>(
          tx,
          sql`select
                count(*)::int as total,
                count(*) filter (where c.status in ${OPEN})::int as open,
                count(*) filter (where c.status in ${DONE})::int as resolved,
                count(*) filter (where c.status = 'REJECTED')::int as rejected,
                count(*) filter (where c.status in ${OPEN} and c.sla_due_at < now())::int as overdue,
                count(*) filter (where c.status in ('REPORTED','VERIFIED','REOPENED'))::int as unassigned,
                avg(extract(epoch from (c.resolved_at - c.created_at)) / 3600)
                  filter (where c.resolved_at is not null) as avg_hours
              from complaints c where ${where}`,
        );
        const byStatus = await rows<{ status: ComplaintStatus; count: number }>(
          tx,
          sql`select c.status, count(*)::int as count from complaints c where ${where} group by c.status`,
        );
        const [rating] = await rows<Record<string, unknown>>(
          tx,
          sql`select avg(f.rating) as average, count(*)::int as count
              from complaint_feedback f join complaints c on c.id = f.complaint_id where ${where}`,
        );
        const total = Number(totals?.total ?? 0);
        const resolved = Number(totals?.resolved ?? 0);
        const rejected = Number(totals?.rejected ?? 0);
        // Rejected reports were never work to be done, so they do not count against the rate.
        const actionable = total - rejected;
        const counts = new Map(byStatus.map((row) => [row.status, row.count]));
        return {
          total,
          open: Number(totals?.open ?? 0),
          resolved,
          rejected,
          overdue: Number(totals?.overdue ?? 0),
          unassigned: Number(totals?.unassigned ?? 0),
          averageResolutionHours: num(totals?.avg_hours),
          resolutionRate: actionable > 0 ? resolved / actionable : null,
          averageRating: num(rating?.average),
          ratingCount: Number(rating?.count ?? 0),
          byStatus: COMPLAINT_STATUSES.map((status) => ({
            status,
            count: counts.get(status) ?? 0,
          })),
        };
      });
    },
  );

  app.get(
    "/departments",
    {
      schema: {
        tags,
        summary: "Performance by department",
        response: { 200: z.object({ data: z.array(departmentPerformanceSchema) }) },
      },
    },
    async (request) => {
      const ctx = request.tenant();
      const only =
        ctx.auth.role === "DEPARTMENT_MANAGER" ? sql`and d.id = ${ctx.auth.departmentId}` : sql``;
      const data = await app.db.withTenant(ctx, (tx) =>
        rows<Record<string, unknown>>(
          tx,
          sql`select d.id, d.name,
                count(c.id)::int as total,
                count(c.id) filter (where c.status in ${OPEN})::int as open,
                count(c.id) filter (where c.status in ${DONE})::int as resolved,
                count(c.id) filter (where c.status in ${OPEN} and c.sla_due_at < now())::int as overdue,
                avg(extract(epoch from (c.resolved_at - c.created_at)) / 3600)
                  filter (where c.resolved_at is not null) as avg_hours
              from departments d
              left join complaints c on c.department_id = d.id and c.deleted_at is null
              where d.deleted_at is null ${only}
              group by d.id, d.name order by total desc, d.name`,
        ),
      );
      return {
        data: data.map((row) => ({
          departmentId: String(row.id),
          name: String(row.name),
          total: Number(row.total),
          open: Number(row.open),
          resolved: Number(row.resolved),
          overdue: Number(row.overdue),
          averageResolutionHours: num(row.avg_hours),
        })),
      };
    },
  );

  app.get(
    "/categories",
    {
      schema: {
        tags,
        summary: "Complaints by category",
        response: { 200: z.object({ data: z.array(categoryCountSchema) }) },
      },
    },
    async (request) => {
      const ctx = request.tenant();
      const data = await app.db.withTenant(ctx, (tx) =>
        rows<Record<string, unknown>>(
          tx,
          sql`select k.id, k.name, count(c.id)::int as total,
                count(c.id) filter (where c.status in ${OPEN})::int as open
              from complaint_categories k
              left join complaints c on c.category_id = k.id and ${scope(ctx.auth)}
              group by k.id, k.name, k.sort_order order by total desc, k.sort_order`,
        ),
      );
      return {
        data: data.map((row) => ({
          categoryId: String(row.id),
          name: String(row.name),
          total: Number(row.total),
          open: Number(row.open),
        })),
      };
    },
  );

  app.get(
    "/trends",
    {
      schema: {
        tags,
        summary: "Reported and resolved per month",
        querystring: z.object({ months: z.coerce.number().int().min(1).max(24).default(6) }),
        response: { 200: z.object({ data: z.array(trendPointSchema) }) },
      },
    },
    async (request) => {
      const ctx = request.tenant();
      const where = scope(ctx.auth);
      const data = await app.db.withTenant(ctx, (tx) =>
        rows<{ month: string; reported: number; resolved: number }>(
          tx,
          sql`with months as (
                select generate_series(
                  date_trunc('month', now()) - make_interval(months => ${request.query.months - 1}),
                  date_trunc('month', now()), interval '1 month') as month)
              select to_char(m.month, 'YYYY-MM') as month,
                (select count(*)::int from complaints c
                  where ${where} and date_trunc('month', c.created_at) = m.month) as reported,
                (select count(*)::int from complaints c
                  where ${where} and date_trunc('month', c.resolved_at) = m.month) as resolved
              from months m order by m.month`,
        ),
      );
      return { data };
    },
  );

  app.get(
    "/hotspots",
    {
      schema: {
        tags,
        summary: "Open complaints grouped into ~100 m cells",
        response: { 200: z.object({ data: z.array(hotspotSchema) }) },
      },
    },
    async (request) => {
      const ctx = request.tenant();
      const data = await app.db.withTenant(ctx, (tx) =>
        rows<Record<string, unknown>>(
          tx,
          sql`select round(c.latitude::numeric, 3) as latitude, round(c.longitude::numeric, 3) as longitude,
                count(*)::int as count
              from complaints c
              where ${scope(ctx.auth)} and c.latitude is not null and c.status in ${OPEN}
              group by 1, 2 order by count desc limit 200`,
        ),
      );
      return {
        data: data.map((row) => ({
          latitude: Number(row.latitude),
          longitude: Number(row.longitude),
          count: Number(row.count),
        })),
      };
    },
  );
};
