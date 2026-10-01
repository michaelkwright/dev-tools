// Rule coverage: for every rule, a positive fixture that triggers exactly that
// rule (the rule_id:severity set is asserted, not a count), and a hardened
// twin that triggers none. Predicates with a spelling or severity split get a
// positive control in both directions.
import { afterAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  applyAsOwner,
  AUDIT_SQL,
  breakText,
  freshDb,
  printProbeLog,
  probeLog,
  ruleSet,
  runAudit,
  type Finding,
  USER_A,
  USER_B,
} from "./fixture";

// A table the audit has nothing to say about: revoked, RLS on, one policy.
const HARDENED_ITEMS = `
create table public.order_items (id int primary key, user_id uuid, qty int);
revoke all on table public.order_items from public, anon, authenticated;
alter table public.order_items enable row level security;
create policy order_items_select_own on public.order_items
  for select to authenticated using (auth.uid() = user_id);
`;

// anon keeps the leftover default-grant privileges after its DML was revoked.
const ANON_NON_DML = `${HARDENED_ITEMS} grant select, truncate, references, trigger, maintain on table public.order_items to anon;`;

async function auditOf(sql: string): Promise<Finding[]> {
  const db = await freshDb();
  try {
    const err = await applyAsOwner(db, sql);
    if (err) throw err;
    return await runAudit(db);
  } finally {
    await db.close();
  }
}

type Case = {
  rule: string;
  name: string;
  positive: string;
  expect: string[];
  object: string;
  twin: string;
};

const CASES: Case[] = [
  {
    rule: "T1",
    name: "RLS disabled, a client role holds a privilege",
    positive: `create table public.order_items (id int primary key);
      revoke all on table public.order_items from public, anon, authenticated;
      grant select on table public.order_items to authenticated;`,
    expect: ["T1:high"],
    object: "public.order_items",
    twin: `${HARDENED_ITEMS} grant select on table public.order_items to authenticated;`,
  },
  {
    rule: "T1",
    name: "RLS disabled, no client role holds anything",
    positive: `create table public.order_items (id int primary key);
      revoke all on table public.order_items from public, anon, authenticated;`,
    expect: ["T1:low"],
    object: "public.order_items",
    twin: HARDENED_ITEMS,
  },
  {
    rule: "T1",
    name: "RLS disabled, the only client grant is on a column",
    positive: `create table public.order_items (id int primary key, qty int);
      revoke all on table public.order_items from public, anon, authenticated;
      grant select (qty) on table public.order_items to authenticated;`,
    expect: ["T1:high"],
    object: "public.order_items",
    twin: `${HARDENED_ITEMS} grant select (qty) on table public.order_items to authenticated;`,
  },
  {
    rule: "T2",
    name: "anon holds INSERT",
    positive: `${HARDENED_ITEMS} grant select, insert on table public.order_items to anon;`,
    expect: ["T2:high"],
    object: "public.order_items",
    twin: `${HARDENED_ITEMS} grant select on table public.order_items to anon;`,
  },
  {
    rule: "T2",
    name: "PUBLIC holds DELETE",
    positive: `${HARDENED_ITEMS} grant delete on table public.order_items to public;`,
    expect: ["T2:high"],
    object: "public.order_items",
    twin: `${HARDENED_ITEMS} grant delete on table public.order_items to authenticated;`,
  },
  {
    rule: "T2",
    name: "anon holds INSERT and the non-DML privileges",
    positive: `${HARDENED_ITEMS} grant select, insert, truncate, references, trigger, maintain on table public.order_items to anon;`,
    expect: ["T2:high", "T3:medium"],
    object: "public.order_items",
    twin: `${HARDENED_ITEMS} grant select on table public.order_items to anon;`,
  },
  {
    rule: "T3",
    name: "anon holds only TRUNCATE, REFERENCES, TRIGGER and MAINTAIN",
    positive: ANON_NON_DML,
    expect: ["T3:medium"],
    object: "public.order_items",
    twin: `${HARDENED_ITEMS} grant select on table public.order_items to anon;`,
  },
  {
    rule: "T3",
    name: "authenticated holds TRUNCATE",
    positive: `${HARDENED_ITEMS} grant select, truncate on table public.order_items to authenticated;`,
    expect: ["T3:medium"],
    object: "public.order_items",
    twin: `${HARDENED_ITEMS} grant select on table public.order_items to authenticated;`,
  },
  {
    rule: "T4",
    name: "RLS on, no policy, a client grant",
    positive: `create table public.order_items (id int primary key);
      revoke all on table public.order_items from public, anon, authenticated;
      alter table public.order_items enable row level security;
      grant select on table public.order_items to authenticated;`,
    expect: ["T4:medium"],
    object: "public.order_items",
    twin: `create table public.order_items (id int primary key);
      revoke all on table public.order_items from public, anon, authenticated;
      alter table public.order_items enable row level security;`,
  },
  {
    rule: "C1",
    name: "anon holds a column UPDATE",
    positive: `${HARDENED_ITEMS} grant update (qty) on table public.order_items to anon;`,
    expect: ["C1:high"],
    object: "public.order_items.qty",
    twin: `${HARDENED_ITEMS} grant update (qty) on table public.order_items to authenticated;`,
  },
  {
    rule: "C1",
    name: "PUBLIC holds a column INSERT",
    positive: `${HARDENED_ITEMS} grant insert (qty) on table public.order_items to public;`,
    expect: ["C1:high"],
    object: "public.order_items.qty",
    twin: `${HARDENED_ITEMS} grant select (qty) on table public.order_items to public;`,
  },
  {
    rule: "V1",
    name: "owner-rights view a client role can read",
    positive: `${HARDENED_ITEMS}
      create view public.order_item_totals as select id, qty from public.order_items;
      revoke all on table public.order_item_totals from public, anon, authenticated;
      grant select on table public.order_item_totals to authenticated;`,
    expect: ["V1:high"],
    object: "public.order_item_totals",
    twin: `${HARDENED_ITEMS}
      create view public.order_item_totals with (security_invoker = true) as select id, qty from public.order_items;
      revoke all on table public.order_item_totals from public, anon, authenticated;
      grant select on table public.order_item_totals to authenticated;`,
  },
  {
    rule: "V1",
    name: "owner-rights view no client role can read",
    positive: `${HARDENED_ITEMS}
      create view public.order_item_totals as select id, qty from public.order_items;
      revoke all on table public.order_item_totals from public, anon, authenticated;`,
    expect: ["V1:medium"],
    object: "public.order_item_totals",
    twin: `${HARDENED_ITEMS}
      create view public.order_item_totals with (security_invoker = on) as select id, qty from public.order_items;
      revoke all on table public.order_item_totals from public, anon, authenticated;`,
  },
  {
    rule: "V1",
    name: "security_invoker = false is still owner rights",
    positive: `${HARDENED_ITEMS}
      create view public.order_item_totals with (security_invoker = false) as select id, qty from public.order_items;
      revoke all on table public.order_item_totals from public, anon, authenticated;`,
    expect: ["V1:medium"],
    object: "public.order_item_totals",
    twin: `${HARDENED_ITEMS}
      create view public.order_item_totals with (security_invoker) as select id, qty from public.order_items;
      revoke all on table public.order_item_totals from public, anon, authenticated;`,
  },
  {
    rule: "F1",
    name: "invoker function executable by PUBLIC and anon",
    positive: `create function public.order_item_count() returns int language sql as 'select 1';`,
    expect: ["F1:low"],
    object: "public.order_item_count()",
    twin: `create function public.order_item_count() returns int language sql as 'select 1';
      revoke all on function public.order_item_count() from public, anon, authenticated;`,
  },
  {
    rule: "F1",
    name: "SECURITY DEFINER function executable by anon only",
    positive: `create function public.order_item_count(p_user_id uuid) returns int language sql
        security definer set search_path = '' as 'select 1';
      revoke all on function public.order_item_count(uuid) from public, authenticated;`,
    expect: ["F1:high"],
    object: "public.order_item_count(p_user_id uuid)",
    twin: `create function public.order_item_count(p_user_id uuid) returns int language sql
        security definer set search_path = '' as 'select 1';
      revoke all on function public.order_item_count(uuid) from public, anon, authenticated;
      grant execute on function public.order_item_count(uuid) to service_role;`,
  },
  {
    rule: "F2",
    name: "SECURITY DEFINER with no proconfig",
    positive: `create function public.order_item_count() returns int language sql security definer as 'select 1';
      revoke all on function public.order_item_count() from public, anon, authenticated;`,
    expect: ["F2:medium"],
    object: "public.order_item_count()",
    twin: `create function public.order_item_count() returns int language sql security definer
        set search_path = '' as 'select 1';
      revoke all on function public.order_item_count() from public, anon, authenticated;`,
  },
  {
    rule: "F2",
    name: "SECURITY DEFINER with a non-empty search_path",
    positive: `create function public.order_item_count() returns int language sql security definer
        set search_path = public as 'select 1';
      revoke all on function public.order_item_count() from public, anon, authenticated;`,
    expect: ["F2:medium"],
    object: "public.order_item_count()",
    // Another setting beside the hardened entry is still hardened.
    twin: `create function public.order_item_count() returns int language sql security definer
        set search_path = '' set statement_timeout = '5s' as 'select 1';
      revoke all on function public.order_item_count() from public, anon, authenticated;`,
  },
];

afterAll(() => printProbeLog("rules.test.ts"));

describe("rule coverage", () => {
  for (const c of CASES) {
    it(`${c.rule}: ${c.name}`, async () => {
      const pos = await auditOf(c.positive);
      expect(ruleSet(pos)).toEqual(c.expect);
      expect(pos.filter((r) => r.rule_id === c.rule).map((r) => r.object)).toEqual([c.object]);
      const twin = await auditOf(c.twin);
      expect(ruleSet(twin)).toEqual([]);
      probeLog.push({
        probe: `${c.rule}: ${c.name}`,
        clean: "twin: no findings",
        broken: `positive: ${ruleSet(pos).join(", ")}`,
        changed: true,
      });
    });
  }

  it("D1: the fixture's live default privileges are reported, and revoking them clears it", async () => {
    const pos = await auditOf("select 1;");
    expect(ruleSet(pos, true)).toEqual(["D1:info"]);
    expect(pos.map((r) => r.object).sort()).toEqual([
      "public functions created by app_owner",
      "public tables created by app_owner",
    ]);
    expect(pos.find((r) => r.object.includes("tables"))?.detail).toMatch(/anon INSERT/);

    const twin = await auditOf(`
      alter default privileges for role app_owner in schema public revoke all on tables from anon, authenticated;
      alter default privileges for role app_owner in schema public revoke all on functions from anon, authenticated;`);
    expect(ruleSet(twin, true)).toEqual([]);
    probeLog.push({
      probe: "D1: default privileges grant to client roles",
      clean: "defaults revoked: no rows",
      broken: `fixture defaults: ${ruleSet(pos, true).join(", ")} x${pos.length}`,
      changed: true,
    });
  });

  it("exposed_schemas decides what is audited", async () => {
    const db = await freshDb();
    await db.exec(`
      create schema private;
      grant usage on schema private to anon;
      create table private.order_notes (id int);
      grant all on table private.order_notes to anon;`);
    const left = ruleSet(await runAudit(db));
    expect(left).toEqual([]);
    const added = ruleSet(
      await runAudit(db, breakText(AUDIT_SQL, "    ('public')\n", "    ('public'),\n    ('private')\n")),
    );
    expect(added).toEqual(["T1:high", "T2:high", "T3:medium"]);
    await db.close();
    probeLog.push({
      probe: "exposed_schemas: add a schema holding an open table",
      clean: "public only: no findings",
      broken: `public + private: ${added.join(", ")}`,
      changed: true,
    });
  });

  it("system schemas are skipped even when listed in exposed_schemas", async () => {
    const db = await freshDb();
    const listed = breakText(
      AUDIT_SQL,
      "    ('public')\n",
      "    ('public'),\n    ('pg_catalog'),\n    ('information_schema')\n",
    );
    const clean = ruleSet(await runAudit(db, listed));
    expect(clean).toEqual([]);
    const unfiltered = breakText(
      breakText(listed, "  where n.nspname::text <> 'information_schema'\n", "  where true\n"),
      "    and n.nspname::text !~ '^pg_'  -- every system schema, and no user schema may start with pg_\n",
      "",
    );
    const broken = ruleSet(await runAudit(db, unfiltered));
    expect(broken).toContain("F1:low");
    await db.close();
    probeLog.push({
      probe: "system schemas: drop the exclusion with pg_catalog listed",
      clean: "pg_catalog + information_schema listed: no findings",
      broken: `exclusion removed: ${broken.join(", ")}`,
      changed: true,
    });
  });

  it("reloptions keeps security_invoker as written, so a check for the text 'true' alone misses true spellings", async () => {
    const db = await freshDb();
    expect(
      await applyAsOwner(
        db,
        `${HARDENED_ITEMS}
        create view public.order_item_totals with (security_invoker = on) as select id from public.order_items;
        revoke all on table public.order_item_totals from public, anon, authenticated;`,
      ),
    ).toBeNull();
    const r = await db.query<{ opts: string; naive: boolean }>(`
      select reloptions::text as opts, reloptions @> array['security_invoker=true'] as naive
      from pg_class where oid = 'public.order_item_totals'::regclass`);
    expect(r.rows[0]).toEqual({ opts: "{security_invoker=on}", naive: false });
    // The audit reads it as invoker rights: no V1.
    expect(ruleSet(await runAudit(db))).toEqual([]);
    await db.close();
  });

  it("output is ordered by severity, then object", async () => {
    const rows = await auditOf(`
      create table public.b_orders (id int);
      create function public.a_order_count() returns int language sql as 'select 1';
      ${HARDENED_ITEMS} grant select, truncate on table public.order_items to authenticated;`);
    const rank: Record<string, number> = { high: 0, medium: 1, low: 2, info: 3 };
    const keys = rows.map((r) => `${rank[r.severity]}|${r.object}`);
    expect(keys).toEqual([...keys].sort());
    expect(rows[0].severity).toBe("high");
    expect(rows.at(-1)?.severity).toBe("info");
  });

  it("T2: the INSERT/UPDATE/DELETE predicate is load-bearing; the old non-SELECT one flags anon's non-DML grants", async () => {
    const db = await freshDb();
    expect(await applyAsOwner(db, ANON_NON_DML)).toBeNull();
    const clean = ruleSet(await runAudit(db));
    expect(clean).toEqual(["T3:medium"]);
    const old = breakText(
      AUDIT_SQL,
      "  where g.grantee in ('PUBLIC', 'anon') and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')\n",
      "  where g.grantee in ('PUBLIC', 'anon') and g.privilege_type <> 'SELECT'\n",
    );
    const broken = ruleSet(await runAudit(db, old));
    expect(broken).toEqual(["T2:high", "T3:medium"]);
    await db.close();
    probeLog.push({
      probe: "T2: restore the old non-SELECT predicate, anon holding only non-DML",
      clean: `INSERT/UPDATE/DELETE predicate: ${clean.join(", ")}`,
      broken: `non-SELECT predicate: ${broken.join(", ")}`,
      changed: JSON.stringify(clean) !== JSON.stringify(broken),
    });
  });
});

describe("behavior: what T3 guards", () => {
  // RLS on with an owner-scoped policy for every command, rows owned by two users.
  const OWNED = (grant: string) => `
    create table public.order_items (id int primary key, user_id uuid not null, qty int);
    revoke all on table public.order_items from public, anon, authenticated;
    alter table public.order_items enable row level security;
    create policy order_items_own on public.order_items
      for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
    grant ${grant} on table public.order_items to authenticated;
    insert into public.order_items (id, user_id, qty)
      values (1, '${USER_A}', 1), (2, '${USER_A}', 2), (3, '${USER_B}', 3);`;

  type Counts = { a: number; b: number };
  const countRows = async (db: PGlite): Promise<Counts> => {
    const r = await db.query<{ a: number; b: number }>(`
      select count(*) filter (where user_id = '${USER_A}')::int as a,
             count(*) filter (where user_id = '${USER_B}')::int as b
      from public.order_items`);
    return r.rows[0];
  };

  /** As user A (SET LOCAL ROLE + claims), reads what RLS shows, then truncates; counts every owner's rows before the rollback. */
  async function truncateAsUserA(db: PGlite): Promise<{ visible: number; outcome: string; after: Counts }> {
    await db.exec("begin");
    try {
      await db.exec("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: USER_A, role: "authenticated" }),
      ]);
      const visible = (await db.query<{ n: number }>("select count(*)::int as n from public.order_items")).rows[0].n;
      let outcome = "ok";
      await db.exec("savepoint probe");
      try {
        await db.exec("truncate public.order_items");
      } catch (e) {
        outcome = (e as { code?: string }).code ?? `error: ${(e as Error).message}`;
        await db.exec("rollback to savepoint probe");
      }
      await db.exec("reset role");
      return { visible, outcome, after: await countRows(db) };
    } finally {
      await db.exec("rollback");
    }
  }

  it("TRUNCATE ignores RLS: user A empties user B's rows too, and without the grant it is refused", async () => {
    const open = await freshDb();
    expect(await applyAsOwner(open, OWNED("select, truncate"))).toBeNull();
    const before = await countRows(open);
    expect(before).toEqual({ a: 2, b: 1 });
    const granted = await truncateAsUserA(open);
    // RLS is live for user A: a SELECT sees only A's rows.
    expect(granted.visible).toBe(2);
    expect(granted.outcome).toBe("ok");
    expect(granted.after).toEqual({ a: 0, b: 0 });
    await open.close();

    const twin = await freshDb();
    expect(await applyAsOwner(twin, OWNED("select"))).toBeNull();
    const twinBefore = await countRows(twin);
    const refused = await truncateAsUserA(twin);
    expect(refused.outcome).toBe("42501");
    expect(refused.after).toEqual(twinBefore);
    await twin.close();

    const fmt = (c: Counts) => `A ${c.a}, B ${c.b}`;
    probeLog.push({
      probe: "behavior: TRUNCATE as user A under RLS",
      clean: `no TRUNCATE grant: ${refused.outcome}; rows ${fmt(twinBefore)} -> ${fmt(refused.after)}`,
      broken: `TRUNCATE granted: ${granted.outcome} (A sees ${granted.visible}); rows ${fmt(before)} -> ${fmt(granted.after)}`,
      changed: granted.outcome !== refused.outcome,
    });
  });
});
