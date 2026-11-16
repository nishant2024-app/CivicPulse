import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema>;
/** A transaction handle. Services accept this so they compose inside one transaction. */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface TenantContext {
  organizationId: string;
  /** Acting user; null for system actors such as schedulers. */
  userId: string | null;
}

export interface DbOptions {
  connectionString: string;
  maxConnections?: number;
  /** Called with (durationMs, failed) for every pooled query; used for metrics. */
  onQuery?: (durationMs: number, failed: boolean) => void;
}

export interface Db {
  pool: pg.Pool;
  /**
   * Run `fn` in a transaction that is confined to one organization by row-level
   * security. This is the default way to touch tenant data.
   */
  withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T>;
  /**
   * Run `fn` in a transaction with the connection's own privileges (no tenant
   * confinement). Only for authentication, public tracking, platform administration
   * and background workers. Every call site is privileged code.
   */
  withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createDb(options: DbOptions): Db {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  // An idle client erroring (e.g. the server closed it) must not crash the process.
  pool.on("error", () => undefined);

  if (options.onQuery) {
    const onQuery = options.onQuery;
    pool.on("connect", (client) => {
      const original = client.query.bind(client) as (...args: unknown[]) => unknown;
      (client as unknown as { query: (...args: unknown[]) => unknown }).query = (
        ...args: unknown[]
      ) => {
        const started = performance.now();
        const result = original(...args);
        if (result instanceof Promise) {
          return result.then(
            (value) => {
              onQuery(performance.now() - started, false);
              return value;
            },
            (error) => {
              onQuery(performance.now() - started, true);
              throw error;
            },
          );
        }
        return result;
      };
    });
  }

  const db = drizzle(pool, { schema });

  return {
    pool,
    async withTenant(ctx, fn) {
      if (!UUID_RE.test(ctx.organizationId) || (ctx.userId && !UUID_RE.test(ctx.userId))) {
        throw new Error("withTenant: invalid tenant context");
      }
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`select set_config('app.organization_id', ${ctx.organizationId}, true),
                     set_config('app.user_id', ${ctx.userId ?? ""}, true)`,
        );
        await tx.execute(sql`set local role civicpulse_app`);
        return fn(tx);
      });
    },
    withSystem(fn) {
      return db.transaction(fn);
    },
    async ping() {
      await pool.query("select 1");
    },
    async close() {
      await pool.end();
    },
  };
}
