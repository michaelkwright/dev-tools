// Fixture-date anchoring: a bidirectional ratchet over every literal date in a
// temporal fixture position. Node environment, no DOM.
// Seeded from dev-tools @ {{DEV_TOOLS_SHA}}; this file is now the project's own.
//
// A fixture carrying a literal date that the code compares against a cutoff
// computed from now is a test with an expiry date. It passes for months, then
// fails on a commit that never touched it, and every push after is red too.
// This guard fails in the diff that writes such a fixture instead.
// Why: a nightly clock-shifted run finds the same fixtures, but months later
// and on someone else's push.
//
// The walker (./walker.ts) enumerates every temporal-keyed property; the
// generic rules live in ../ratchet-core.ts. Statuses:
//   KNOWN_OPEN       worklist, target zero. No justification, deliberately.
//   CLOCK_PINNED     derived: the file pins the system clock, so its literals
//                    are relative to a frozen now. Never claimed by an entry;
//                    such a site needs none.
//   FIXED_BY_DESIGN  exempt: literal forever. Requires a justification.
//
// The burn-down loop: anchor a fixture with daysAgo()/dateDaysAgo() from
// clock.ts, delete its entry, stay green.
//
// This test never writes the snapshot; the regen script does, and its diff is
// meant to be read. Asserted at the foot of this file.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  checkRatchet,
  countShapes,
  type RuleId,
  type ShapeConfig,
  type StatusConfig,
} from "../ratchet-core.ts";
import { CONFIG, KEY_FIELDS, SNAPSHOT_PATH, scan, sitesInSource } from "./walker.ts";

const REGEN = "npm run regen:fixture-dates";

// Declare a retired status here, { kind: "retired", note }, rather than
// deleting it, so an entry that revives it fails by name.
const STATUSES: StatusConfig = {
  KNOWN_OPEN: { kind: "worklist" },
  CLOCK_PINNED: { kind: "derived" },
  FIXED_BY_DESIGN: { kind: "exempt" },
};

// A shape with no site fails, unless declared { absent: "<reason>" }; a shape
// declared absent fails once it has a site.
const SHAPES: ShapeConfig = {
  anchored: "required",
  computed: "required",
  not_date_shaped: "required",
};

// Keys CONFIG.temporalKey must match, and must not. Keep in step with it.
const TEMPORAL_KEYS = ["created_at", "ship_date", "delivered_on", "date", "since", "until", "cutoff"];
const NON_TEMPORAL_KEYS = ["name", "status", "sku", "label", "update_count"];

// Rule (g)'s floor. Raise it toward the real site count once seeded.
const MIN_SITES = 1;

function readSnapshot(): unknown {
  try {
    return JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  } catch (e) {
    return { error: `cannot read ${CONFIG.snapshot}: ${(e as Error).message}` };
  }
}

const SCAN = scan();
const FAILURES = checkRatchet({
  keyFields: KEY_FIELDS,
  statuses: STATUSES,
  shapes: SHAPES,
  sites: SCAN.sites,
  snapshot: readSnapshot(),
  parseFailures: SCAN.parseFailures,
  shapeCounts: countShapes(SCAN.sites),
  regenCommand: REGEN,
  minSites: MIN_SITES,
});

const of = (...rules: RuleId[]) => FAILURES.filter((f) => rules.includes(f.rule)).map((f) => f.message);

const sitesOf = (src: string, file = "synthetic.test.ts") => {
  const one = sitesInSource(file, src, CONFIG);
  expect(one.parseFailure, "synthetic source did not parse").toBeUndefined();
  return one.sites;
};
const violations = (src: string) => sitesOf(src).filter((s) => s.verdict === "violation");

describe("the walker sees what it claims to see", () => {
  it("flags a full date literal in a temporal key", () => {
    const v = violations(`const order = { created_at: "2000-01-15T00:00:00.000Z" };`);
    expect(v.map((s) => [s.key, s.literal])).toEqual([["created_at", "2000-01-15T00:00:00.000Z"]]);
  });

  it("flags the date-shaped head of a template literal", () => {
    const v = violations("const order = { created_at: `2000-01-${day}T00:00:00.000Z` };");
    expect(v.map((s) => s.literal)).toEqual(["2000-01-"]);
  });

  it("flags a literal date inside a Date constructor, and not a clock-relative one", () => {
    const v = violations(`const order = { created_at: new Date("2000-01-15"), shipped_at: new Date(2000, 0, 15), until: new Date(Date.now()) };`);
    expect(v.map((s) => s.key)).toEqual(["created_at", "shipped_at"]);
  });

  it("flags a date under every temporal key shape", () => {
    for (const k of TEMPORAL_KEYS) {
      expect(violations(`const item = { ${k}: "2000-01-15" };`), k).toHaveLength(1);
    }
  });

  it("does not flag a date in a comment", () => {
    expect(violations(`// created_at: "2000-01-15"\n/* created_at: "2000-01-15" */\nconst order = { id: "o1" };`)).toEqual([]);
  });

  it("does not flag a date under a non-temporal key", () => {
    for (const k of NON_TEMPORAL_KEYS) {
      expect(violations(`const item = { ${k}: "2000-01-15" };`), k).toEqual([]);
    }
  });

  it("does not flag a computed value, and reads an anchor helper as anchored", () => {
    const s = sitesOf(`const order = { created_at: daysAgo(3), ship_date: dateDaysAgo(1), until: new Date() };`);
    expect(s.map((x) => [x.key, x.verdict, x.shape])).toEqual([
      ["created_at", "compliant", "anchored"],
      ["ship_date", "compliant", "anchored"],
      ["until", "compliant", "computed"],
    ]);
  });

  it("derives CLOCK_PINNED for a file that pins the clock, and not for one that only mentions it", () => {
    const pinned = violations(`vi.setSystemTime(new Date(0));\nconst order = { created_at: "2000-01-15" };`);
    expect(pinned.map((s) => s.derivedStatus)).toEqual(["CLOCK_PINNED"]);
    const mentioned = violations(`// vi.setSystemTime is not called here\nconst order = { created_at: "2000-01-15" };`);
    expect(mentioned.map((s) => s.derivedStatus)).toEqual([undefined]);
  });

  it("keys a site by its enclosing scope and an ordinal, never a line number", () => {
    const s = violations(`describe("orders", () => {\n  it("ships", () => {\n    const rows = [{ created_at: "2000-01-15" }, { created_at: "2000-02-15" }];\n  });\n});`);
    expect(s.map((x) => [x.symbol, x.ordinal])).toEqual([
      ["describe:orders > it:ships > rows", 0],
      ["describe:orders > it:ships > rows", 1],
    ]);
  });

  it("reports a file it cannot parse instead of skipping it", () => {
    expect(sitesInSource("broken.test.ts", `const order = { created_at: "2000-01-15" `, CONFIG).parseFailure?.file).toBe("broken.test.ts");
  });
});

describe("the guard fails on its own failure", () => {
  it("(g) enumerated real sites", () => {
    expect(of("g")).toEqual([]);
  });

  it("(h) parsed every file it walked", () => {
    expect(of("h")).toEqual([]);
  });

  it("(i) every declared compliance shape is represented", () => {
    expect(of("i")).toEqual([]);
  });
});

describe("the snapshot matches the source, in both directions", () => {
  it("(a) every literal-date site has an entry: anchor it with daysAgo()/dateDaysAgo()", () => {
    expect(of("a")).toEqual([]);
  });

  it("(b) no entry names a site that is now anchored or clock-pinned", () => {
    expect(of("b")).toEqual([]);
  });

  it("(c) no entry names a site that no longer exists", () => {
    expect(of("c")).toEqual([]);
  });

  it("(d) every status is declared, and every FIXED_BY_DESIGN entry says why", () => {
    expect(of("d")).toEqual([]);
  });

  it("(e) no entry carries a retired status", () => {
    expect(of("e")).toEqual([]);
  });

  it("(f) no entry claims CLOCK_PINNED, which is derived", () => {
    expect(of("f")).toEqual([]);
  });

  it("(j) no key carries a line number", () => {
    expect(of("j")).toEqual([]);
  });

  it("the snapshot is well-formed, and no two sites or entries share a key", () => {
    expect(of("snapshot", "walker")).toEqual([]);
  });
});

describe("the guard never rewrites its own worklist", () => {
  it("this test, the walker and the core contain no file-write call", () => {
    // Needles are assembled so this file does not match its own text.
    const needles = [["write", "File"], ["append", "File"], ["create", "WriteStream"]].map((p) => p.join(""));
    for (const url of [import.meta.url, new URL("./walker.ts", import.meta.url).href, new URL("../ratchet-core.ts", import.meta.url).href]) {
      const src = readFileSync(fileURLToPath(url), "utf8");
      for (const n of needles) expect(src.includes(n), `${url} contains ${n}`).toBe(false);
    }
  });
});
