// Break probes against the audit itself: each load-bearing piece of the SQL is
// removed or bypassed, and the result must change.
import { afterAll, describe, expect, it } from "vitest";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pg_buffercache } from "@electric-sql/pglite/contrib/pg_buffercache";
import {
  applyAsOwner,
  AUDIT_SQL,
  breakText,
  freshDb,
  freshDbWith,
  printProbeLog,
  probeLog,
  ruleSet,
  runAudit,
} from "./fixture";

const PLACEHOLDER = "    (null::text, null::text, null::text)  -- placeholder row, keep it\n";
const withExceptions = (...rows: string[]) =>
  breakText(AUDIT_SQL, PLACEHOLDER, PLACEHOLDER.replace("\n", "") + rows.map((r) => `\n    , ${r}`).join("") + "\n");

afterAll(() => printProbeLog("audit-internals.test.ts"));

describe("NULL acl", () => {
  it("COALESCE(acl, acldefault(...)) is load-bearing: a NULL-acl function is flagged only through it", async () => {
    const db = await freshDb();
    // Created by a role with no default privileges, so proacl stays NULL and
    // the built-in PUBLIC EXECUTE applies.
    await db.exec(`create function public.order_total(p_order_id uuid) returns int
      language sql security definer set search_path = '' as 'select 1'`);
    const acl = await db.query<{ a: string | null }>(
      "select proacl::text as a from pg_proc where oid = 'public.order_total(uuid)'::regprocedure",
    );
    expect(acl.rows[0].a).toBeNull();

    const clean = ruleSet(await runAudit(db));
    expect(clean).toEqual(["F1:high"]);
    const raw = breakText(AUDIT_SQL, "coalesce(p.proacl, acldefault('f', p.proowner))", "p.proacl");
    const broken = ruleSet(await runAudit(db, raw));
    expect(broken).toEqual([]);
    await db.close();
    probeLog.push({
      probe: "NULL acl: read proacl raw instead of COALESCE(acldefault)",
      clean: `with COALESCE: ${clean.join(", ")}`,
      broken: `raw acl: ${broken.join(", ") || "no findings"}`,
      changed: true,
    });
  });
});

describe("exceptions", () => {
  const FN = "public.order_count()";
  const setup = `create function public.order_count() returns int language sql as 'select 1';`;

  it("an exception suppresses its finding and shows an info row; removing it brings the finding back", async () => {
    const db = await freshDb();
    expect(await applyAsOwner(db, setup)).toBeNull();

    const excepted = await runAudit(db, withExceptions(`('F1', '${FN}', 'counts only, reviewed')`));
    expect(ruleSet(excepted)).toEqual([]);
    const info = excepted.filter((r) => r.rule_id === "EXCEPTION");
    expect(info).toHaveLength(1);
    expect(info[0]).toMatchObject({ severity: "info", object: FN });
    expect(info[0].detail).toBe("F1 suppressed (1 matching finding). Reason: counts only, reviewed");

    const removed = await runAudit(db);
    expect(ruleSet(removed)).toEqual(["F1:low"]);
    expect(removed.some((r) => r.rule_id === "EXCEPTION")).toBe(false);
    await db.close();
    probeLog.push({
      probe: "exceptions: remove the exceptions row",
      clean: `with row: no findings, EXCEPTION:info x${info.length}`,
      broken: `row removed: ${ruleSet(removed).join(", ")}`,
      changed: true,
    });
  });

  it("an exception without a reason suppresses nothing and is reported", async () => {
    const db = await freshDb();
    expect(await applyAsOwner(db, setup)).toBeNull();
    const rows = await runAudit(db, withExceptions(`('F1', '${FN}', '  ')`));
    expect(ruleSet(rows)).toEqual(["EXCEPTION:low", "F1:low"]);
    await db.close();
  });

  it("an exception matching nothing is reported as possibly stale", async () => {
    const db = await freshDb();
    const rows = await runAudit(db, withExceptions(`('V1', 'public.order_summaries', 'reviewed')`));
    const info = rows.filter((r) => r.rule_id === "EXCEPTION");
    expect(info).toHaveLength(1);
    expect(info[0].fix_hint).toMatch(/Matches no current finding/);
    await db.close();
  });

  it("the shipped commented example parses when uncommented", async () => {
    const db = await freshDb();
    const uncommented = breakText(
      AUDIT_SQL,
      "    -- , ('V1', 'public.order_summaries',",
      "    , ('V1', 'public.order_summaries',",
    );
    const rows = await runAudit(db, uncommented);
    expect(rows.filter((r) => r.rule_id === "EXCEPTION")).toHaveLength(1);
    await db.close();
  });
});

describe("one statement, read-only", () => {
  it("the file is a single statement for db.query(), with no semicolon but the last", async () => {
    const db = await freshDb();
    // db.query() uses the extended protocol, which refuses more than one command.
    await expect(runAudit(db)).resolves.toBeInstanceOf(Array);
    await expect(runAudit(db, `${AUDIT_SQL}\nselect 1;`)).rejects.toThrow(/multiple commands/);
    expect(AUDIT_SQL.split(";").length - 1).toBe(1);
    expect(AUDIT_SQL.trimEnd().endsWith(";")).toBe(true);
    await db.close();
    probeLog.push({
      probe: "single statement: append a second statement",
      clean: "the file: runs through db.query()",
      broken: "file + 'select 1': rejected, multiple commands",
      changed: true,
    });
  });

  it("the auditor role can read no project data and call no project function, and the audit still runs", async () => {
    const db = await freshDb();
    expect(await applyAsOwner(db, "create table public.orders (id int);")).toBeNull();
    await db.exec("set role auditor");
    await expect(db.query("select * from public.orders")).rejects.toThrow(/permission denied/);
    await expect(db.query("select auth.uid()")).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
    await expect(runAudit(db)).resolves.toBeInstanceOf(Array);

    // Break: make the audit call a project function. It fails under the same role.
    const calling = breakText(
      AUDIT_SQL,
      "  select 0::oid, 'PUBLIC'::text\n",
      "  select 0::oid, coalesce(auth.uid()::text, 'PUBLIC')\n",
    );
    await expect(runAudit(db, calling)).rejects.toThrow(/permission denied/);
    await db.close();
    probeLog.push({
      probe: "read-only role: audit calls a project function",
      clean: "catalog-only audit: runs as auditor",
      broken: "calls auth.uid(): permission denied",
      changed: true,
    });
  });
});

describe("extension-owned objects", () => {
  it("objects an extension created in public are excluded, and only through the pg_depend check", async () => {
    const db = await freshDbWith({ extensions: { pg_trgm, pg_buffercache } });
    await db.exec("create extension pg_trgm schema public; create extension pg_buffercache schema public;");
    const members = await db.query<{ n: number }>(
      "select count(*)::int as n from pg_depend where deptype = 'e' and refobjid in (select oid from pg_extension where extname in ('pg_trgm', 'pg_buffercache'))",
    );
    expect(members.rows[0].n).toBeGreaterThan(10);

    const clean = await runAudit(db);
    expect(ruleSet(clean)).toEqual([]);

    const noFnFilter = breakText(
      AUDIT_SQL,
      "    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')\n",
      "\n",
    );
    const fnRows = await runAudit(db, noFnFilter);
    expect(ruleSet(fnRows)).toEqual(["F1:low"]);
    expect(fnRows.some((r) => r.object.startsWith("public.similarity("))).toBe(true);

    const noRelFilter = breakText(
      AUDIT_SQL,
      "    and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')\n",
      "\n",
    );
    const relRows = await runAudit(db, noRelFilter);
    expect(ruleSet(relRows)).toEqual(["V1:medium"]);
    expect(relRows.filter((r) => r.rule_id === "V1").map((r) => r.object)).toContain("public.pg_buffercache");
    await db.close();

    probeLog.push({
      probe: "extensions: drop the function pg_depend exclusion",
      clean: "pg_trgm + pg_buffercache in public: no findings",
      broken: `${ruleSet(fnRows).join(", ")} x${fnRows.filter((r) => r.rule_id === "F1").length}`,
      changed: true,
    });
    probeLog.push({
      probe: "extensions: drop the relation pg_depend exclusion",
      clean: "pg_trgm + pg_buffercache in public: no findings",
      broken: `${ruleSet(relRows).join(", ")} x${relRows.filter((r) => r.rule_id === "V1").length}`,
      changed: true,
    });
  });
});
