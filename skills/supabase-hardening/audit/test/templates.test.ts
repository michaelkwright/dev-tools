// The three templates, proven: each applies cleanly with its DO block passing
// and leaves no audit finding; each deliberate break makes its own DO block
// raise AND makes the audit flag the matching rule. A break whose result
// matches the clean run fails the test.
import { afterAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  applyAsOwner,
  breakText,
  describeAudit,
  freshDb,
  printProbeLog,
  probeAs,
  probeLog,
  renderTemplate,
  ruleSet,
  runAudit,
  stripVerify,
  USER_A,
  USER_B,
} from "./fixture";

const TABLE = renderTemplate("new-table.sql.tmpl");
const VIEW = renderTemplate("new-view.sql.tmpl");
const FUNCTION = renderTemplate("new-function.sql.tmpl");

// The view template reads from the table template's table.
const PREREQ: Record<string, string | null> = { table: null, view: TABLE, function: null };
const TEMPLATES: Record<string, string> = { table: TABLE, view: VIEW, function: FUNCTION };

async function withPrereq(kind: string): Promise<PGlite> {
  const db = await freshDb();
  const pre = PREREQ[kind];
  if (pre) expect(await applyAsOwner(db, pre)).toBeNull();
  return db;
}

/** Applies the full text (DO block included): returns the VERIFY message, or "passes". */
async function verifyOutcome(kind: string, text: string): Promise<string> {
  const db = await withPrereq(kind);
  try {
    const err = await applyAsOwner(db, text);
    if (!err) return "passes";
    // A break must trip the template's own check, not a syntax error.
    expect(err.message).toMatch(/^VERIFY: /);
    return `raises "${err.message}"`;
  } finally {
    await db.close();
  }
}

/** Applies the text with its DO block removed, so it commits, then audits. */
async function auditOutcome(kind: string, text: string): Promise<string[]> {
  const db = await withPrereq(kind);
  try {
    expect(await applyAsOwner(db, stripVerify(text))).toBeNull();
    return ruleSet(await runAudit(db));
  } finally {
    await db.close();
  }
}

// The clean run of each template, computed once per file and asserted in every probe.
const cleanRuns = new Map<string, Promise<[string, string[]]>>();
function cleanRun(kind: string): Promise<[string, string[]]> {
  if (!cleanRuns.has(kind)) {
    cleanRuns.set(kind, Promise.all([verifyOutcome(kind, TEMPLATES[kind]), auditOutcome(kind, TEMPLATES[kind])]));
  }
  return cleanRuns.get(kind)!;
}

const short = (s: string) => (s.length > 90 ? `${s.slice(0, 89)}…` : s);

type Break = {
  kind: string;
  probe: string;
  find: string;
  replace: string;
  raises: RegExp;
  rules: string[];
};

const BREAKS: Break[] = [
  {
    kind: "table",
    probe: "table: remove the REVOKE",
    find: "revoke all on table public.orders from public, anon, authenticated;\n",
    replace: "",
    raises: /anon or PUBLIC holds a table privilege/,
    rules: ["T2:high", "T3:medium"],
  },
  {
    kind: "view",
    probe: "view: remove the REVOKE",
    find: "revoke all on table public.order_summaries from public, anon, authenticated, service_role;\n",
    replace: "",
    raises: /anon or PUBLIC holds a privilege/,
    rules: ["T2:high", "T3:medium"],
  },
  {
    kind: "view",
    probe: "view: drop security_invoker",
    find: "with (security_invoker = true)\n",
    replace: "",
    raises: /lacks security_invoker=true/,
    rules: ["V1:high"],
  },
  {
    kind: "function",
    probe: "function: remove the REVOKE",
    find: "revoke all on function public.consume_order_submit_quota(uuid) from public, anon, authenticated;\n",
    replace: "",
    raises: /still grants EXECUTE to PUBLIC, anon or authenticated/,
    rules: ["F1:high"],
  },
  {
    kind: "function",
    probe: "function: remove PUBLIC from the revoke",
    find: "on function public.consume_order_submit_quota(uuid) from public, anon, authenticated;",
    replace: "on function public.consume_order_submit_quota(uuid) from anon, authenticated;",
    raises: /still grants EXECUTE to PUBLIC, anon or authenticated/,
    rules: ["F1:high"],
  },
  {
    kind: "function",
    probe: "function: remove SET search_path",
    find: "set search_path = ''\n",
    replace: "",
    raises: /lacks search_path = ''/,
    rules: ["F2:medium"],
  },
  {
    kind: "function",
    probe: "function: remove the counter-table REVOKE",
    find: "revoke all on table public.order_submit_counters from public, anon, authenticated;\n",
    replace: "",
    raises: /a client role holds a privilege on/,
    rules: ["T2:high", "T3:medium", "T4:medium"],
  },
];

afterAll(() => printProbeLog("templates.test.ts"));

describe("templates apply cleanly", () => {
  for (const kind of Object.keys(TEMPLATES)) {
    it(`${kind}: the DO block passes and the audit has no finding above info`, async () => {
      expect(await verifyOutcome(kind, TEMPLATES[kind])).toBe("passes");
      const db = await withPrereq(kind);
      expect(await applyAsOwner(db, TEMPLATES[kind])).toBeNull();
      const rows = await runAudit(db);
      expect(ruleSet(rows)).toEqual([]);
      // The only info rows are the fixture's default privileges.
      expect(ruleSet(rows, true)).toEqual(["D1:info"]);
      await db.close();
    });
  }

  it("table with the column allowlist enabled: passes, and stays clean", async () => {
    const text = breakText(
      breakText(
        breakText(
          breakText(
            TABLE,
            "-- revoke insert, update on table public.orders from authenticated;",
            "revoke insert, update on table public.orders from authenticated;",
          ),
          "-- grant insert (user_id, title, note) on table public.orders to authenticated;",
          "grant insert (user_id, title, note) on table public.orders to authenticated;",
        ),
        "-- grant update (title, note) on table public.orders to authenticated;",
        "grant update (title, note) on table public.orders to authenticated;",
      ),
      "v_column_allowlist constant boolean  := false;",
      "v_column_allowlist constant boolean  := true;",
    );
    expect(await verifyOutcome("table", text)).toBe("passes");
    expect(await auditOutcome("table", text)).toEqual([]);

    // Break: the allowlist names a server-owned column.
    const broken = breakText(
      text,
      "grant update (title, note) on table public.orders to authenticated;",
      "grant update (title, note, status) on table public.orders to authenticated;",
    );
    const raised = await verifyOutcome("table", broken);
    expect(raised).toMatch(/server-owned column/);
    probeLog.push({
      probe: "table allowlist: grant a server-owned column",
      clean: "DO passes",
      broken: `DO ${short(raised)}`,
      changed: true,
    });
  });
});

describe("template break probes", () => {
  for (const b of BREAKS) {
    it(b.probe, async () => {
      const clean = TEMPLATES[b.kind];
      const broken = breakText(clean, b.find, b.replace);

      // Clean first: the check passes and the audit is silent.
      const [cleanVerify, cleanRules] = await cleanRun(b.kind);
      expect(cleanVerify).toBe("passes");
      expect(cleanRules).toEqual([]);

      // Broken: the template's own check raises, and the audit flags the rule.
      const brokenVerify = await verifyOutcome(b.kind, broken);
      expect(brokenVerify).toMatch(b.raises);
      const brokenRules = await auditOutcome(b.kind, broken);
      expect(brokenRules).toEqual(b.rules);

      const changed = brokenVerify !== cleanVerify && JSON.stringify(brokenRules) !== JSON.stringify(cleanRules);
      expect(changed).toBe(true);
      probeLog.push({
        probe: b.probe,
        clean: `DO passes; audit: ${cleanRules.join(", ") || "no findings"}`,
        broken: `DO ${short(brokenVerify)}; audit: ${brokenRules.join(", ")}`,
        changed,
      });
    });
  }

  it("view: any spelling of true passes the check, and false still raises", async () => {
    const on = breakText(VIEW, "with (security_invoker = true)\n", "with (security_invoker = on)\n");
    const onVerify = await verifyOutcome("view", on);
    expect(onVerify).toBe("passes");
    expect(await auditOutcome("view", on)).toEqual([]);

    const off = breakText(VIEW, "with (security_invoker = true)\n", "with (security_invoker = false)\n");
    const offVerify = await verifyOutcome("view", off);
    expect(offVerify).toMatch(/lacks security_invoker=true/);
    const offRules = await auditOutcome("view", off);
    expect(offRules).toEqual(["V1:high"]);
    probeLog.push({
      probe: "view: security_invoker = on vs = false",
      clean: `= on: DO ${onVerify}; audit: no findings`,
      broken: `= false: DO ${short(offVerify)}; audit: ${offRules.join(", ")}`,
      changed: true,
    });
  });

  it("a raised check rolls the whole paste back", async () => {
    const db = await freshDb();
    const err = await applyAsOwner(db, breakText(TABLE, BREAKS[0].find, ""));
    expect(err?.message).toMatch(/^VERIFY: /);
    const left = await db.query<{ t: string | null }>("select to_regclass('public.orders')::text as t");
    expect(left.rows[0].t).toBeNull();
    await db.close();
  });
});

describe("behavior: the threat the audit encodes", () => {
  const anon = { role: "anon" };
  const userA = { sub: USER_A, role: "authenticated" };
  const insertAs = (owner: string) =>
    `insert into public.orders (user_id, title) values ('${owner}', 'probe order')`;

  async function seedUsers(db: PGlite) {
    await db.exec(`insert into auth.users (id) values ('${USER_A}'), ('${USER_B}')`);
  }

  it("table: anon can INSERT into a new table under the defaults, and cannot after the template", async () => {
    // Defaults only: the template's CREATE TABLE and nothing after it.
    const bare = TABLE.slice(0, TABLE.indexOf("-- 2. Revoke FIRST")) + "commit;";
    const before = await freshDb();
    expect(await applyAsOwner(before, bare)).toBeNull();
    await seedUsers(before);
    const anonBefore = await probeAs(before, "anon", anon, insertAs(USER_A));
    expect(anonBefore).toBe("ok");
    const auditBefore = describeAudit(await runAudit(before));
    expect(auditBefore).toBe("T1:high, T2:high, T3:medium");
    await before.close();

    const after = await freshDb();
    expect(await applyAsOwner(after, TABLE)).toBeNull();
    await seedUsers(after);
    const anonAfter = await probeAs(after, "anon", anon, insertAs(USER_A));
    expect(anonAfter).toBe("42501");
    // The owner still writes their own row, and only their own.
    expect(await probeAs(after, "authenticated", userA, insertAs(USER_A))).toBe("ok");
    expect(await probeAs(after, "authenticated", userA, insertAs(USER_B))).toBe("42501");
    await after.close();

    probeLog.push({
      probe: "behavior: anon INSERT into public.orders",
      clean: `template applied: ${anonAfter}`,
      broken: `defaults, no template: ${anonBefore} (audit ${auditBefore})`,
      changed: anonBefore !== anonAfter,
    });
  });

  it("function: anon can drain another user's quota under the defaults, and cannot after the template", async () => {
    const call = `select public.consume_order_submit_quota('${USER_A}')`;
    const open = stripVerify(
      breakText(FUNCTION, "revoke all on function public.consume_order_submit_quota(uuid) from public, anon, authenticated;\n", ""),
    );
    const before = await freshDb();
    expect(await applyAsOwner(before, open)).toBeNull();
    await seedUsers(before);
    const anonBefore = await probeAs(before, "anon", anon, call);
    expect(anonBefore).toBe("ok");
    await before.close();

    const after = await freshDb();
    expect(await applyAsOwner(after, FUNCTION)).toBeNull();
    await seedUsers(after);
    const anonAfter = await probeAs(after, "anon", anon, call);
    expect(anonAfter).toBe("42501");
    expect(await probeAs(after, "authenticated", userA, call)).toBe("42501");
    expect(await probeAs(after, "service_role", { role: "service_role" }, call)).toBe("ok");
    await after.close();

    probeLog.push({
      probe: "behavior: anon EXECUTE of the rate-limit RPC",
      clean: `template applied: ${anonAfter}`,
      broken: `REVOKE removed: ${anonBefore}`,
      changed: anonBefore !== anonAfter,
    });
  });

  it("function: the limit holds on the server clock and fails closed for an unknown user", async () => {
    const db = await freshDb();
    expect(await applyAsOwner(db, FUNCTION)).toBeNull();
    await seedUsers(db);
    await db.exec("set role service_role");
    const allowed: boolean[] = [];
    for (let i = 0; i < 51; i++) {
      const r = await db.query<{ v: { allowed: boolean } }>(
        `select public.consume_order_submit_quota('${USER_A}') as v`,
      );
      allowed.push(r.rows[0].v.allowed);
    }
    expect(allowed.filter(Boolean).length).toBe(50);
    expect(allowed[50]).toBe(false);
    // An unknown user fails the foreign key and raises: a fault, never an allow.
    await expect(db.query(`select public.consume_order_submit_quota('${USER_B.replace("b", "c")}')`)).rejects.toThrow(
      /foreign key/,
    );
    await db.exec("reset role");
    await db.close();
  });
});
