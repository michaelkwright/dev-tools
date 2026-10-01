// Fixture and helpers for the supabase-hardening break-probe harness.
//
// Every test gets a fresh PGlite database that recreates the Supabase shape
// described in reference/born-open-defaults.md: the client roles, an owner
// role standing in for `postgres`, default privileges that grant every new
// table and function in public to anon, authenticated and service_role, and an
// auth schema whose uid() reads the sub claim from request.jwt.claims.
import { PGlite, type PGliteOptions } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const skillDir = fileURLToPath(new URL("../../", import.meta.url));

export const AUDIT_SQL = readFileSync(`${skillDir}audit/posture-audit.sql`, "utf8");

// app_owner owns everything a migration creates. auditor is the read-only role
// the audit runs as: it is granted nothing, so it holds only what PUBLIC holds
// (SELECT on the catalogs, and no USAGE on auth).
export const FIXTURE_SQL = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role app_owner nologin;
create role auditor nologin;

grant usage on schema public to anon, authenticated, service_role;
grant usage, create on schema public to app_owner;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role, app_owner;
create table auth.users (id uuid primary key);
grant references on auth.users to app_owner;
create function auth.uid() returns uuid
language sql stable
as $$ select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;

alter default privileges for role app_owner in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role app_owner in schema public
  grant all on functions to anon, authenticated, service_role;
`;

export const USER_A = "00000000-0000-0000-0000-00000000000a";
export const USER_B = "00000000-0000-0000-0000-00000000000b";

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

/** A database built from scratch with extra options (e.g. extensions). */
export async function freshDbWith(options: PGliteOptions): Promise<PGlite> {
  const db = await PGlite.create(options);
  await db.exec(FIXTURE_SQL);
  return db;
}

/**
 * Runs SQL as app_owner, the way a migration pasted in the dashboard runs as
 * postgres. Returns the error if it raised, else null; either way the session
 * is left out of any transaction and back to its own role.
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

export type Finding = {
  rule_id: string;
  severity: string;
  object_type: string;
  object: string;
  detail: string;
  fix_hint: string;
};

/** Runs the audit text as one statement through db.query(), as the read-only auditor role. */
export async function runAudit(db: PGlite, sql: string = AUDIT_SQL): Promise<Finding[]> {
  await db.exec("set role auditor");
  try {
    return (await db.query<Finding>(sql)).rows;
  } finally {
    await db.exec("reset role");
  }
}

/** "rule:severity" for every finding, sorted; info rows (D1, EXCEPTION) excluded unless asked. */
export function ruleSet(rows: Finding[], includeInfo = false): string[] {
  return [
    ...new Set(rows.filter((r) => includeInfo || r.severity !== "info").map((r) => `${r.rule_id}:${r.severity}`)),
  ].sort();
}

/** Replaces exactly one occurrence; throws if the needle is missing or repeated, so a break can never be a no-op. */
export function breakText(text: string, find: string, replacement: string): string {
  const first = text.indexOf(find);
  if (first === -1) throw new Error(`break needle not found: ${JSON.stringify(find)}`);
  if (text.indexOf(find, first + 1) !== -1) throw new Error(`break needle not unique: ${JSON.stringify(find)}`);
  return text.slice(0, first) + replacement + text.slice(first + find.length);
}

/** Renders a template from templates/ with its placeholders filled. */
export function renderTemplate(name: string): string {
  const raw = readFileSync(`${skillDir}templates/${name}`, "utf8");
  const out = raw.replaceAll("{{DEV_TOOLS_SHA}}", "harness");
  if (out.includes("{{")) throw new Error(`${name}: unfilled placeholder remains`);
  return out;
}

/** Removes a template's final DO verification block, so a broken migration commits and the audit can read it. */
export function stripVerify(text: string): string {
  const start = text.indexOf("\ndo $$");
  const end = text.indexOf("end $$;", start);
  if (start === -1 || end === -1 || text.indexOf("\ndo $$", start + 1) !== -1) {
    throw new Error("expected exactly one DO verification block");
  }
  return text.slice(0, start) + text.slice(end + "end $$;".length);
}

/**
 * Runs body inside a transaction that always rolls back, as `role` with the
 * given claims (reference/verification.md: SET LOCAL ROLE and SET LOCAL
 * request.jwt.claims together). Returns the SQLSTATE of the error, or "ok".
 */
export async function probeAs(
  db: PGlite,
  role: string,
  claims: Record<string, unknown> | null,
  body: string,
): Promise<string> {
  await db.exec("begin");
  try {
    await db.exec(`set local role ${role}`);
    if (claims) await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await db.exec(body);
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? `error: ${(e as Error).message}`;
  } finally {
    await db.exec("rollback");
  }
}

export type ProbeRow = { probe: string; clean: string; broken: string; changed: boolean };

/** Collects probe outcomes; a file prints its table once, after its last test. */
export const probeLog: ProbeRow[] = [];

export function printProbeLog(title: string): void {
  if (probeLog.length === 0) return;
  const lines = probeLog.map((p) => `| ${p.probe} | ${p.clean} | ${p.broken} | ${p.changed ? "yes" : "NO"} |`);
  console.log([`${title}`, "| probe | clean | broken | changed |", "|---|---|---|---|", ...lines].join("\n"));
}

export function describeAudit(rows: Finding[]): string {
  const set = ruleSet(rows);
  return set.length ? set.join(", ") : "no findings";
}
