// Fixture and helpers for the observability-traps watchdog harness.
//
// Every test gets a fresh PGlite database with the Supabase shape the heartbeat
// template must survive: the client roles, an owner role standing in for
// `postgres`, and default privileges that grant every new table in public to
// anon, authenticated and service_role. A stubbed `cron` schema stands in for
// pg_cron: `cron.job` and `cron.job_run_details` with the columns the watchdog
// query reads (and `command`, which it must never read).
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const skillDir = fileURLToPath(new URL("../../", import.meta.url));

export const FIXTURE_SQL = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role app_owner nologin;

grant usage on schema public to anon, authenticated, service_role;
grant usage, create on schema public to app_owner;

alter default privileges for role app_owner in schema public
  grant all on tables to anon, authenticated, service_role;

create schema cron;
create table cron.job (
  jobid    bigserial primary key,
  schedule text not null,
  command  text not null,
  active   boolean not null default true,
  jobname  text
);
create table cron.job_run_details (
  runid          bigserial primary key,
  jobid          bigint,
  command        text,
  status         text,
  return_message text,
  start_time     timestamptz,
  end_time       timestamptz
);
grant usage on schema cron to app_owner;
grant select on cron.job, cron.job_run_details to app_owner;
`;

let base: Promise<PGlite> | undefined;

/** A fresh database with the fixture applied: a clone of one per-file base. */
export async function freshDb(): Promise<PGlite> {
  base ??= (async () => {
    const db = await PGlite.create();
    await db.exec(FIXTURE_SQL);
    return db;
  })();
  return (await base).clone() as Promise<PGlite>;
}

/**
 * Runs SQL as app_owner, the way a paste in the dashboard runs as postgres.
 * Returns the error if it raised, else null; either way the session is left
 * out of any transaction and back to its own role.
 */
export async function applyAsOwner(db: PGlite, sql: string): Promise<(Error & { code?: string }) | null> {
  await db.exec("set role app_owner");
  try {
    await db.exec(sql);
    return null;
  } catch (e) {
    return e as Error;
  } finally {
    await db.exec("rollback");
    await db.exec("reset role");
  }
}

/** Seeds scenario rows as the fixture superuser, the way pg_cron and the jobs write them, in one transaction. */
export async function seed(db: PGlite, sql: string): Promise<void> {
  await db.exec(`begin; ${sql} commit;`);
}

export type WatchdogRow = { finding: string; job_name: string; detail: Record<string, unknown> };

/** Runs the watchdog query as one statement, as app_owner, inside a READ ONLY transaction that rolls back. */
export async function runWatchdog(db: PGlite, sql: string): Promise<WatchdogRow[]> {
  await db.exec("begin transaction read only");
  try {
    await db.exec("set local role app_owner");
    return (await db.query<WatchdogRow>(sql)).rows;
  } finally {
    await db.exec("rollback");
  }
}

/** "FINDING:job" for every row, in the query's own order. */
export function findingSet(rows: WatchdogRow[]): string[] {
  return rows.map((r) => `${r.finding}:${r.job_name}`);
}

/** Replaces exactly one occurrence; throws if the needle is missing or repeated, so a break can never be a no-op. */
export function breakText(text: string, find: string, replacement: string): string {
  const first = text.indexOf(find);
  if (first === -1) throw new Error(`break needle not found: ${JSON.stringify(find)}`);
  if (text.indexOf(find, first + 1) !== -1) throw new Error(`break needle not unique: ${JSON.stringify(find)}`);
  return text.slice(0, first) + replacement + text.slice(first + find.length);
}

/** The template with its placeholders filled. */
export function renderTemplate(name: string): string {
  const raw = readFileSync(`${skillDir}templates/${name}`, "utf8");
  const out = raw.replaceAll("{{DEV_TOOLS_SHA}}", "harness");
  if (out.includes("{{")) throw new Error(`${name}: unfilled placeholder remains`);
  return out;
}

/** Splits the heartbeat template into its migration (part 1) and its watchdog query (part 2). */
export function splitTemplate(text: string): { migration: string; query: string } {
  const part2 = text.indexOf("-- PART 2: the watchdog query");
  const banner = text.lastIndexOf("\n-- ═", part2);
  const queryStart = text.indexOf("\nwith params as (", part2);
  if (part2 === -1 || banner === -1 || queryStart === -1 || text.indexOf("-- PART 2", part2 + 1) !== -1) {
    throw new Error("expected one PART 2 banner followed by the watchdog query");
  }
  return { migration: text.slice(0, banner), query: text.slice(queryStart + 1) };
}

export type ProbeRow = { probe: string; clean: string; broken: string; changed: boolean };

/** Collects probe outcomes; the file prints its table once, after its last test. */
export const probeLog: ProbeRow[] = [];

export function printProbeLog(title: string): void {
  if (probeLog.length === 0) return;
  const lines = probeLog.map((p) => `| ${p.probe} | ${p.clean} | ${p.broken} | ${p.changed ? "yes" : "NO"} |`);
  console.log([title, "| probe | clean | broken | changed |", "|---|---|---|---|", ...lines].join("\n"));
}
