// The heartbeat template, proven: the migration applies with its DO block
// passing and leaves the table server-only; the watchdog query reports exactly
// the findings each scenario deserves. Every break probe first shows its clean
// case passing, then shows the break changing the result. A break whose result
// matches the clean run fails the test.
import { afterAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  applyAsOwner,
  breakText,
  findingSet,
  freshDb,
  printProbeLog,
  probeLog,
  renderTemplate,
  runWatchdog,
  seed,
  splitTemplate,
  type WatchdogRow,
} from "./fixture";

const TEMPLATE = renderTemplate("job-heartbeat.sql.tmpl");
const { migration: MIGRATION, query: QUERY } = splitTemplate(TEMPLATE);

const ARCHIVE = "nightly-order-archive";
const RESTOCK = "hourly-item-restock";

// Each scenario seeds cron.job, cron.job_run_details and the heartbeats, with
// every timestamp an offset from now(). Defaults: 36h freshness, 72h lookback.
const hb = (job: string, hoursAgo: number, outcome: string, detail = "null") =>
  outcome === "started"
    ? `insert into public.job_heartbeats (job_name, started_at, outcome, detail)
         values ('${job}', now() - interval '${hoursAgo} hours', 'started', ${detail});`
    : `insert into public.job_heartbeats (job_name, started_at, finished_at, outcome, detail)
         values ('${job}', now() - interval '${hoursAgo} hours', now() - interval '${hoursAgo} hours' + interval '30 seconds', '${outcome}', ${detail});`;
const run = (jobid: number, hoursAgo: number, status: string, message = "1 row") =>
  `insert into cron.job_run_details (jobid, command, status, return_message, start_time, end_time)
     values (${jobid}, 'select secret_job_command()', '${status}', '${message}',
             now() - interval '${hoursAgo} hours', now() - interval '${hoursAgo} hours' + interval '1 second');`;
const job = (jobid: number, name: string, active = true) =>
  `insert into cron.job (jobid, schedule, command, active, jobname)
     values (${jobid}, '0 3 * * *', 'select secret_job_command()', ${active}, '${name}');`;

const SCENARIOS: Record<string, string> = {
  // Fresh ok heartbeat, succeeded ledger rows, and one failure older than the lookback.
  healthy: [job(1, ARCHIVE), hb(ARCHIVE, 2, "ok"), hb(ARCHIVE, 26, "ok"), run(1, 2, "succeeded"), run(1, 100, "failed", "old fault")].join("\n"),
  // Its newest ok heartbeat is older than the window; one older still sits inside the read.
  stale: [job(1, ARCHIVE), hb(ARCHIVE, 50, "ok"), hb(ARCHIVE, 74, "ok"), run(1, 50, "succeeded")].join("\n"),
  // Fresh, but the scheduler's ledger holds two failures inside the lookback.
  intermittent: [
    job(2, RESTOCK),
    hb(RESTOCK, 1, "ok"),
    hb(RESTOCK, 2, "ok"),
    run(2, 1, "succeeded"),
    run(2, 5, "failed", "older fault"),
    run(2, 29, "failed", "oldest fault"),
    run(2, 3, "failed", "newest fault"),
  ].join("\n"),
  // Recent heartbeats exist, but none is ok: one failed, one started and never finished.
  nonOkOnly: [job(1, ARCHIVE), hb(ARCHIVE, 1, "failed"), hb(ARCHIVE, 3, "started"), hb(ARCHIVE, 60, "ok")].join("\n"),
};

async function seeded(scenario: string, migration = MIGRATION): Promise<PGlite> {
  const db = await freshDb();
  expect(await applyAsOwner(db, migration)).toBeNull();
  await seed(db, SCENARIOS[scenario]);
  return db;
}

async function watch(scenario: string, query = QUERY): Promise<WatchdogRow[]> {
  const db = await seeded(scenario);
  try {
    return await runWatchdog(db, query);
  } finally {
    await db.close();
  }
}

/** Applies the migration text: the VERIFY message it raised, or "passes". */
async function verifyOutcome(text: string): Promise<string> {
  const db = await freshDb();
  try {
    const err = await applyAsOwner(db, text);
    if (!err) return "passes";
    expect(err.message).toMatch(/^VERIFY: /);
    return `raises "${err.message}"`;
  } finally {
    await db.close();
  }
}

const show = (rows: string[]) => (rows.length ? rows.join(", ") : "no findings");
const short = (s: string) => (s.length > 90 ? `${s.slice(0, 89)}…` : s);

afterAll(() => printProbeLog("watchdog.test.ts"));

describe("the migration", () => {
  it("applies with its DO block passing", async () => {
    expect(await verifyOutcome(MIGRATION)).toBe("passes");
  });

  it("leaves the table server-only: anon and authenticated are refused, service_role writes", async () => {
    const db = await freshDb();
    expect(await applyAsOwner(db, MIGRATION)).toBeNull();
    const probe = async (role: string, sql: string) => {
      await db.exec("begin");
      try {
        await db.exec(`set local role ${role}`);
        await db.exec(sql);
        return "ok";
      } catch (e) {
        return (e as { code?: string }).code ?? "error";
      } finally {
        await db.exec("rollback");
      }
    };
    const insert = `insert into public.job_heartbeats (job_name) values ('${ARCHIVE}')`;
    expect(await probe("anon", insert)).toBe("42501");
    expect(await probe("authenticated", insert)).toBe("42501");
    expect(await probe("anon", "select 1 from public.job_heartbeats")).toBe("42501");
    expect(await probe("authenticated", "select 1 from public.job_heartbeats")).toBe("42501");
    expect(await probe("service_role", `${insert}; update public.job_heartbeats set outcome = 'ok', finished_at = now()`)).toBe("ok");
    await db.close();
  });

  it("the whole file applies as one paste, migration and query together", async () => {
    const db = await freshDb();
    expect(await applyAsOwner(db, TEMPLATE)).toBeNull();
    expect(await runWatchdog(db, QUERY)).toEqual([]);
    await db.close();
  });
});

describe("the four cases", () => {
  it("a healthy job yields no finding", async () => {
    expect(findingSet(await watch("healthy"))).toEqual([]);
  });

  it("a job with no heartbeat in its window yields MISSING", async () => {
    const rows = await watch("stale");
    expect(findingSet(rows)).toEqual([`MISSING:${ARCHIVE}`]);
    expect(rows[0].detail.newest_ok_started_at).not.toBeNull();
  });

  it("a job that fails intermittently but stays fresh yields FAILED and not MISSING", async () => {
    const rows = await watch("intermittent");
    expect(findingSet(rows)).toEqual([`FAILED:${RESTOCK}`]);
    // Aggregated to one row; the newest failure's message; never the command text.
    expect(rows[0].detail.failed_runs).toBe(3);
    expect(rows[0].detail.latest_return_message).toBe("newest fault");
    expect(JSON.stringify(rows)).not.toContain("secret_job_command");
  });

  it("a job whose only recent heartbeats are non-ok yields MISSING", async () => {
    expect(findingSet(await watch("nonOkOnly"))).toEqual([`MISSING:${ARCHIVE}`]);
  });
});

describe("edges", () => {
  async function watchSql(rows: string): Promise<string[]> {
    const db = await freshDb();
    expect(await applyAsOwner(db, MIGRATION)).toBeNull();
    await seed(db, rows);
    try {
      return findingSet(await runWatchdog(db, QUERY));
    } finally {
      await db.close();
    }
  }

  it("a job that never wrote a heartbeat yields MISSING", async () => {
    expect(await watchSql(job(1, ARCHIVE))).toEqual([`MISSING:${ARCHIVE}`]);
  });

  it("a fresh dry run is not evidence: MISSING", async () => {
    expect(await watchSql([job(1, ARCHIVE), hb(ARCHIVE, 1, "ok", `'{"dry_run": true}'`)].join("\n"))).toEqual([
      `MISSING:${ARCHIVE}`,
    ]);
  });

  it("an inactive job is not expected to run: no finding", async () => {
    expect(await watchSql(job(1, ARCHIVE, false))).toEqual([]);
  });

  it("a job unscheduled since it failed still surfaces, under its jobid", async () => {
    expect(await watchSql(run(9, 4, "failed", "gone"))).toEqual(["FAILED:jobid:9"]);
  });

  it("a per-job window override applies to that job only", async () => {
    const overridden = breakText(
      QUERY,
      "  -- union all values ('weekly-order-report', interval '8 days')",
      `  union all values ('${ARCHIVE}', interval '3 days')`,
    );
    const db = await seeded("stale");
    try {
      expect(findingSet(await runWatchdog(db, overridden))).toEqual([]);
    } finally {
      await db.close();
    }
  });
});

type QueryBreak = { probe: string; scenario: string; find: string; replace: string; expected: string[]; broken: string[] };

const QUERY_BREAKS: QueryBreak[] = [
  {
    probe: "(1) delete the FAILED branch",
    scenario: "intermittent",
    find: "union all\nselect finding, job_name, detail from failed\n",
    replace: "",
    expected: [`FAILED:${RESTOCK}`],
    broken: [],
  },
  {
    probe: "(2) count non-ok heartbeats as fresh",
    scenario: "nonOkOnly",
    find: "a.job_name\n      and h.outcome = 'ok'\n",
    replace: "a.job_name\n",
    expected: [`MISSING:${ARCHIVE}`],
    broken: [],
  },
  {
    probe: "(3) remove the window filter",
    scenario: "stale",
    find: "      and h.started_at >= now() - a.fresh_window\n",
    replace: "",
    expected: [`MISSING:${ARCHIVE}`],
    broken: [],
  },
];

describe("break probes", () => {
  for (const b of QUERY_BREAKS) {
    it(b.probe, async () => {
      const clean = findingSet(await watch(b.scenario));
      expect(clean).toEqual(b.expected);
      const broken = findingSet(await watch(b.scenario, breakText(QUERY, b.find, b.replace)));
      expect(broken).toEqual(b.broken);
      const changed = JSON.stringify(clean) !== JSON.stringify(broken);
      expect(changed).toBe(true);
      probeLog.push({ probe: `${b.probe} [${b.scenario}]`, clean: show(clean), broken: show(broken), changed });
    });
  }

  it("(4) drop the revoke: the DO block raises", async () => {
    const clean = await verifyOutcome(MIGRATION);
    expect(clean).toBe("passes");
    const broken = await verifyOutcome(
      breakText(MIGRATION, "revoke all on table public.job_heartbeats from public, anon, authenticated;\n", ""),
    );
    expect(broken).toMatch(/a client role or PUBLIC holds a table privilege/);
    probeLog.push({ probe: "(4) drop the revoke", clean: `DO ${clean}`, broken: `DO ${short(broken)}`, changed: true });
  });

  it("a raised check rolls the whole paste back", async () => {
    const db = await freshDb();
    const err = await applyAsOwner(
      db,
      breakText(MIGRATION, "revoke all on table public.job_heartbeats from public, anon, authenticated;\n", ""),
    );
    expect(err?.message).toMatch(/^VERIFY: /);
    const left = await db.query<{ t: string | null }>("select to_regclass('public.job_heartbeats')::text as t");
    expect(left.rows[0].t).toBeNull();
    await db.close();
  });
});
