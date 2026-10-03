// ratchet-core, proven: one failing synthetic case per rule (a)-(j), each
// failing on exactly its own rule, plus a passing case; then the regen planner.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  checkRatchet,
  countShapes,
  keyOf,
  planRegen,
  RatchetKeyError,
  serializeSnapshot,
  type RatchetInput,
  type RatchetSite,
  type Snapshot,
} from "../ratchet-core.ts";

const KEY = ["file", "symbol", "key", "ordinal"] as const;

const site = (key: string, verdict: RatchetSite["verdict"], extra: Partial<RatchetSite> = {}): RatchetSite => ({
  file: "src/test/orders.test.ts",
  symbol: "it:ships orders > order",
  key,
  ordinal: 0,
  verdict,
  ...extra,
});

function base(): RatchetInput {
  const sites: RatchetSite[] = [
    site("created_at", "violation", { detail: '= "2000-01-15"' }),
    site("ship_date", "violation"),
    site("delivered_on", "compliant", { shape: "anchored" }),
    site("cancelled_at", "compliant", { shape: "computed" }),
    site("due_date", "violation", { derivedStatus: "CLOCK_PINNED" }),
  ];
  return {
    keyFields: KEY,
    statuses: {
      KNOWN_OPEN: { kind: "worklist" },
      CLOCK_PINNED: { kind: "derived" },
      FIXED_BY_DESIGN: { kind: "exempt" },
      OLD_OPEN: { kind: "retired", note: "the burn-down closed" },
    },
    shapes: { anchored: "required", computed: "required", not_date_shaped: { absent: "no fixture uses one yet" } },
    sites,
    snapshot: {
      entries: [
        { file: "src/test/orders.test.ts", symbol: "it:ships orders > order", key: "created_at", ordinal: 0, status: "KNOWN_OPEN" },
        {
          file: "src/test/orders.test.ts",
          symbol: "it:ships orders > order",
          key: "ship_date",
          ordinal: 0,
          status: "FIXED_BY_DESIGN",
          justification: "formats a fixed calendar date",
        },
      ],
    },
    parseFailures: [],
    shapeCounts: countShapes(sites),
    regenCommand: "npm run regen:fixture-dates",
  };
}

const entries = (i: RatchetInput) => (i.snapshot as Snapshot).entries;
const K = (key: string) => `src/test/orders.test.ts :: it:ships orders > order :: ${key} :: 0`;

function rulesOf(input: RatchetInput) {
  const failures = checkRatchet(input);
  for (const f of failures) {
    // Every message names a key or file, never a line number; (j) quotes the
    // offending value, so it is the one exception.
    if (f.rule !== "j") expect(f.message).not.toMatch(/\.ts:\d/);
  }
  return { rules: failures.map((f) => f.rule), messages: failures.map((f) => f.message), failures };
}

describe("ratchet-core passes a consistent ratchet", () => {
  it("returns no failures, with a worklist entry carrying no justification and a derived site carrying no entry", () => {
    expect(checkRatchet(base())).toEqual([]);
  });
});

describe("ratchet-core fails each rule on its own", () => {
  it("(a) a violation with no entry: new violation, named by key", () => {
    const i = base();
    i.sites = [...i.sites, site("returned_at", "violation", { detail: '= "2000-02-01"' })];
    const r = rulesOf(i);
    expect(r.rules).toEqual(["a"]);
    expect(r.messages[0]).toContain("new violation: fix it or add an entry");
    expect(r.messages[0]).toContain(K("returned_at"));
    expect(r.failures[0].key).toBe(K("returned_at"));
  });

  it("(b) an entry whose site is now compliant: fixed, delete this entry", () => {
    const i = base();
    i.sites = i.sites.map((s) => (s.key === "created_at" ? { ...s, verdict: "compliant", shape: "anchored" } : s));
    i.shapeCounts = countShapes(i.sites);
    const r = rulesOf(i);
    expect(r.rules).toEqual(["b"]);
    expect(r.messages[0]).toContain("delete this entry");
    expect(r.messages[0]).toContain(K("created_at"));
  });

  it("(b) an entry whose site now derives a status: fixed, delete this entry", () => {
    const i = base();
    i.sites = i.sites.map((s) => (s.key === "created_at" ? { ...s, derivedStatus: "CLOCK_PINNED" } : s));
    const r = rulesOf(i);
    expect(r.rules).toEqual(["b"]);
    expect(r.messages[0]).toContain("delete this entry");
  });

  it("(c) an entry whose site no longer exists: stale, delete this entry", () => {
    const i = base();
    i.sites = i.sites.filter((s) => s.key !== "created_at");
    const r = rulesOf(i);
    expect(r.rules).toEqual(["c"]);
    expect(r.messages[0]).toMatch(/^stale: delete this entry/);
    expect(r.messages[0]).toContain(K("created_at"));
  });

  it("(d) an exempt entry with an empty or blank justification fails", () => {
    for (const justification of ["", "   ", undefined]) {
      const i = base();
      const e = entries(i).find((x) => x.status === "FIXED_BY_DESIGN")!;
      if (justification === undefined) delete e.justification;
      else e.justification = justification;
      const r = rulesOf(i);
      expect(r.rules, JSON.stringify(justification)).toEqual(["d"]);
      expect(r.messages[0]).toContain(K("ship_date"));
    }
  });

  it("(d) an undeclared status fails", () => {
    const i = base();
    entries(i)[0].status = "MAYBE_LATER";
    const r = rulesOf(i);
    expect(r.rules).toEqual(["d"]);
    expect(r.messages[0]).toContain("MAYBE_LATER");
  });

  it("(e) an entry carrying a retired status fails by name", () => {
    const i = base();
    entries(i)[0].status = "OLD_OPEN";
    const r = rulesOf(i);
    expect(r.rules).toEqual(["e"]);
    expect(r.messages[0]).toContain("OLD_OPEN");
    expect(r.messages[0]).toContain("retired");
    expect(r.messages[0]).toContain(K("created_at"));
  });

  it("(f) an entry claiming a derived status fails, even on a site that derives it", () => {
    const i = base();
    entries(i).push({ file: "src/test/orders.test.ts", symbol: "it:ships orders > order", key: "due_date", ordinal: 0, status: "CLOCK_PINNED" });
    const r = rulesOf(i);
    expect(r.rules).toEqual(["f"]);
    expect(r.messages[0]).toContain("derived");
    expect(r.messages[0]).toContain(K("due_date"));
  });

  it("(g) zero enumerated sites fails", () => {
    const i = base();
    i.sites = [];
    i.snapshot = { entries: [] };
    i.shapes = {};
    i.shapeCounts = {};
    const r = rulesOf(i);
    expect(r.rules).toEqual(["g"]);
    expect(r.messages[0]).toContain("enumerated 0 site(s)");
  });

  it("(g) zero files walked fails on its own message, beside the zero-site one", () => {
    const i = base();
    i.sites = [];
    i.snapshot = { entries: [] };
    i.shapes = {};
    i.shapeCounts = {};
    i.filesWalked = 0;
    const r = rulesOf(i);
    expect(r.rules).toEqual(["g", "g"]);
    expect(r.messages[0]).toContain("walked 0 files");
    expect(r.messages[1]).toContain("enumerated 0 site(s)");
  });

  it("(g) a walk that read files adds nothing, and an absent count is not checked", () => {
    const i = base();
    i.filesWalked = 3;
    expect(checkRatchet(i)).toEqual([]);
    delete i.filesWalked;
    expect(checkRatchet(i)).toEqual([]);
  });

  it("(g) fewer sites than a raised floor fails", () => {
    const i = base();
    i.minSites = 50;
    expect(rulesOf(i).rules).toEqual(["g"]);
  });

  it("(h) a parse failure fails, naming each file", () => {
    const i = base();
    i.parseFailures = [
      { file: "src/test/broken.test.ts", reason: "'}' expected." },
      { file: "src/test/also-broken.test.ts", reason: "Unterminated string literal." },
    ];
    const r = rulesOf(i);
    expect(r.rules).toEqual(["h", "h"]);
    expect(r.messages[0]).toContain("src/test/broken.test.ts");
    expect(r.messages[1]).toContain("src/test/also-broken.test.ts");
  });

  it("(i) a required shape with no sites fails", () => {
    const i = base();
    i.sites = i.sites.filter((s) => s.shape !== "computed");
    i.shapeCounts = countShapes(i.sites);
    const r = rulesOf(i);
    expect(r.rules).toEqual(["i"]);
    expect(r.messages[0]).toContain('"computed"');
  });

  it("(i) a shape declared absent with an empty reason fails", () => {
    const i = base();
    i.shapes = { ...i.shapes, not_date_shaped: { absent: " " } };
    expect(rulesOf(i).rules).toEqual(["i"]);
  });

  it("(i) a shape declared absent with no sites passes", () => {
    const i = base();
    expect(i.shapeCounts.not_date_shaped ?? 0).toBe(0);
    expect(rulesOf(i).rules).toEqual([]);
  });

  it("(i) a shape declared absent that has a site fails, naming the shape and the count", () => {
    const i = base();
    i.shapes = { ...i.shapes, anchored: { absent: "clock.ts is new" } };
    const r = rulesOf(i);
    expect(r.rules).toEqual(["i"]);
    expect(r.messages[0]).toBe('compliance shape "anchored" is declared absent but has 1 site(s): change it to required.');
  });

  it("(i) a counted shape that is not declared fails", () => {
    const i = base();
    i.shapeCounts = { ...i.shapeCounts, guessed: 2 };
    expect(rulesOf(i).rules).toEqual(["i"]);
  });

  it("(j) a key field named like a line number fails construction", () => {
    for (const name of ["line", "lineNumber", "line_no", "column"]) {
      const i = base();
      i.keyFields = ["file", name];
      expect(rulesOf(i).rules, name).toEqual(["j"]);
      expect(() => keyOf(["file", name], { file: "a.ts", [name]: 3 })).toThrow(RatchetKeyError);
    }
  });

  it("(j) a key value that looks like a line reference fails construction", () => {
    for (const v of ["src/test/orders.test.ts:42", "src/test/orders.test.ts:42:7", "orders.test.ts#L42", "line 42", "L42"]) {
      const i = base();
      i.sites = [...i.sites, site("created_at", "violation", { file: v })];
      expect(rulesOf(i).rules, v).toEqual(["j"]);
    }
  });

  it("(j) does not mistake an ordinal, or a title holding a time, for a line number", () => {
    expect(keyOf(KEY, { file: "a.ts", symbol: "it:closes at 10:30", key: "closed_at", ordinal: 3 })).toBe(
      "a.ts :: it:closes at 10:30 :: closed_at :: 3",
    );
  });

  it("a duplicate entry or site key fails", () => {
    const i = base();
    entries(i).push({ ...entries(i)[0] });
    expect(rulesOf(i).rules).toEqual(["snapshot"]);
    const j = base();
    j.sites = [...j.sites, site("delivered_on", "compliant", { shape: "anchored" })];
    j.shapeCounts = countShapes(j.sites);
    expect(rulesOf(j).rules).toEqual(["walker"]);
  });

  it("a malformed snapshot fails rather than reading as empty", () => {
    const i = base();
    i.snapshot = { error: "cannot read snapshot.json" };
    expect(rulesOf(i).rules).toEqual(["snapshot"]);
  });
});

describe("the regen planner", () => {
  const prev = (): Snapshot => ({
    entries: [
      { file: "b.ts", symbol: "s", key: "created_at", ordinal: 0, status: "FIXED_BY_DESIGN", justification: "fixed calendar date" },
      { file: "a.ts", symbol: "s", key: "created_at", ordinal: 0, status: "KNOWN_OPEN" },
      { file: "gone.ts", symbol: "s", key: "created_at", ordinal: 0, status: "KNOWN_OPEN" },
      { file: "fixed.ts", symbol: "s", key: "created_at", ordinal: 0, status: "KNOWN_OPEN" },
    ],
  });
  const at = (file: string, verdict: RatchetSite["verdict"], extra: Partial<RatchetSite> = {}): RatchetSite => ({
    file,
    symbol: "s",
    key: "created_at",
    ordinal: 0,
    verdict,
    ...extra,
  });

  it("keeps survivors' status and justification, adds new violations as worklist, drops vanished, skips compliant and derived", () => {
    const next = planRegen({
      keyFields: KEY,
      sites: [
        at("b.ts", "violation"),
        at("a.ts", "violation"),
        at("fixed.ts", "compliant", { shape: "anchored" }),
        at("new.ts", "violation"),
        at("pinned.ts", "violation", { derivedStatus: "CLOCK_PINNED" }),
        at("clean.ts", "compliant", { shape: "computed" }),
      ],
      previous: prev(),
      worklistStatus: "KNOWN_OPEN",
    });
    expect(next.entries).toEqual([
      { file: "a.ts", symbol: "s", key: "created_at", ordinal: 0, status: "KNOWN_OPEN" },
      { file: "b.ts", symbol: "s", key: "created_at", ordinal: 0, status: "FIXED_BY_DESIGN", justification: "fixed calendar date" },
      { file: "new.ts", symbol: "s", key: "created_at", ordinal: 0, status: "KNOWN_OPEN" },
    ]);
    expect([next.added.length, next.removed.length, next.kept.length]).toEqual([1, 2, 2]);
    expect(next.removed.sort()).toEqual(["fixed.ts :: s :: created_at :: 0", "gone.ts :: s :: created_at :: 0"]);
  });

  it("warns when it keeps a status the test rejects, rather than laundering it", () => {
    const p = prev();
    p.entries[1].status = "OLD_OPEN";
    const next = planRegen({
      keyFields: KEY,
      sites: [at("a.ts", "violation")],
      previous: p,
      worklistStatus: "KNOWN_OPEN",
      statuses: { KNOWN_OPEN: { kind: "worklist" }, OLD_OPEN: { kind: "retired" } },
    });
    expect(next.entries[0].status).toBe("OLD_OPEN");
    expect(next.warnings).toHaveLength(1);
  });

  it("serializes in a stable order, whatever order the walker produced", () => {
    const a = planRegen({ keyFields: KEY, sites: [at("b.ts", "violation"), at("a.ts", "violation")], previous: null, worklistStatus: "KNOWN_OPEN" });
    const b = planRegen({ keyFields: KEY, sites: [at("a.ts", "violation"), at("b.ts", "violation")], previous: null, worklistStatus: "KNOWN_OPEN" });
    expect(serializeSnapshot(KEY, a.entries, ["c"])).toBe(serializeSnapshot(KEY, b.entries, ["c"]));
    const ordinals = serializeSnapshot(KEY, [10, 2, 1].map((n) => ({ file: "a.ts", symbol: "s", key: "k_at", ordinal: n, status: "KNOWN_OPEN" })), []);
    expect((JSON.parse(ordinals) as Snapshot).entries.map((e) => e.ordinal)).toEqual([1, 2, 10]);
  });

  it("the shipped example snapshot is in serialized form and passes the snapshot rules", () => {
    const text = readFileSync(new URL("../fixture-date-anchoring/example-snapshot.json", import.meta.url), "utf8");
    const example = JSON.parse(text) as Snapshot;
    expect(serializeSnapshot(KEY, example.entries, example.$comment ?? [])).toBe(text);
    const sites = example.entries.map((e) => ({ ...e, verdict: "violation" as const }));
    const failures = checkRatchet({
      keyFields: KEY,
      statuses: { KNOWN_OPEN: { kind: "worklist" }, CLOCK_PINNED: { kind: "derived" }, FIXED_BY_DESIGN: { kind: "exempt" } },
      shapes: {},
      sites,
      snapshot: example,
      parseFailures: [],
      shapeCounts: {},
    });
    expect(failures).toEqual([]);
  });
});
