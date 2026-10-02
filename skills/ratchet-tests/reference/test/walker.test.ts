// The fixture-date walker, proven on synthetic sources: what it must flag, what
// it must not, the clock-pinned derivation both ways, and a walk over a
// throwaway tree for roots, exclusions and parse failures.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  CONFIG,
  globToRegExp,
  scan,
  sitesInSource,
  type WalkerConfig,
} from "../fixture-date-anchoring/walker.ts";

const sitesOf = (src: string, file = "orders.test.ts", config: WalkerConfig = CONFIG) => {
  const one = sitesInSource(file, src, config);
  expect(one.parseFailure, "synthetic source did not parse").toBeUndefined();
  return one.sites;
};
const flagged = (src: string, config: WalkerConfig = CONFIG) =>
  sitesOf(src, "orders.test.ts", config).filter((s) => s.verdict === "violation");

describe("the walker MUST flag", () => {
  it("a full date literal in a temporal key", () => {
    const v = flagged(`const order = { created_at: "2000-01-15T00:00:00.000Z" };`);
    expect(v.map((s) => [s.key, s.literal])).toEqual([["created_at", "2000-01-15T00:00:00.000Z"]]);
    expect(v[0].detail).toContain("2000-01-15");
  });

  it("the date-shaped head of a template literal", () => {
    const v = flagged("const order = { created_at: `2000-01-${day}T00:00:0${sec}.000Z` };");
    expect(v.map((s) => s.literal)).toEqual(["2000-01-"]);
  });

  it("a date under each default temporal key shape", () => {
    for (const k of ["created_at", "ship_date", "delivered_on", "date", "since", "until", "cutoff", "Shipped_AT"]) {
      expect(flagged(`const item = { ${k}: "2000-01-15" };`).map((s) => s.key), k).toEqual([k]);
    }
  });

  it("a date under a quoted or computed-string key, a bare YYYY-MM, a no-substitution template, and through as/satisfies/parens", () => {
    const src = [
      `const a = { "created_at": "2000-01-15" };`,
      `const b = { ["ship_date"]: "2000-01" };`,
      "const c = { delivered_on: `2000-01-15` };",
      `const d = { created_at: "2000-01-15" as const };`,
      `const e = { created_at: ("2000-01-15") satisfies string };`,
    ].join("\n");
    expect(flagged(src)).toHaveLength(5);
  });

  it("a date in a JSON fixture that is not excluded as golden", () => {
    const one = sitesInSource("rows.json", `{ "orders": [{ "id": "o1", "created_at": "2000-01-15" }] }`, CONFIG);
    expect(one.sites.map((s) => [s.symbol, s.key, s.verdict])).toEqual([["<json>", "created_at", "violation"]]);
  });
});

describe("the walker must NOT flag", () => {
  it("a date in a comment", () => {
    expect(flagged(`// created_at: "2000-01-15"\n/* created_at: "2000-01-15" */\n/** created_at: "2000-01-15" */\nconst order = { id: "o1" };`)).toEqual([]);
  });

  it("a date under a non-temporal key, or in an assertion string", () => {
    for (const k of ["name", "status", "sku", "label", "update_count", "format", "attempts"]) {
      expect(flagged(`const item = { ${k}: "2000-01-15" };`), k).toEqual([]);
    }
    expect(flagged(`expect(render(order)).toContain("2000-01-15");`)).toEqual([]);
  });

  it("a computed value: an anchor helper, new Date(...), a variable, null", () => {
    const s = sitesOf(
      `const order = { created_at: daysAgo(3), ship_date: dateDaysAgo(1), delivered_on: clock.daysAgo(2), cancelled_at: new Date(), returned_at: new Date(Date.now() - 3 * DAY_MS), until: OLD, since: null, cutoff: "" };`,
    );
    expect(s.filter((x) => x.verdict === "violation")).toEqual([]);
    expect(s.map((x) => x.shape)).toEqual([
      "anchored",
      "anchored",
      "anchored",
      "computed",
      "computed",
      "computed",
      "computed",
      "not_date_shaped",
    ]);
  });

  it("a non-date string, a time of day, or a year alone", () => {
    expect(flagged(`const o = { created_at: "yesterday", ship_date: "10:30", delivered_on: "2000" };`)).toEqual([]);
  });
});

describe("a literal date inside a Date constructor", () => {
  // One pair per form: the literal date the walker MUST flag, and the
  // clock-relative or opaque value of the same form it must NOT.
  const forms: Array<[form: string, mustFlag: string, mustNotFlag: string]> = [
    ["new Date(<date string>)", `new Date("2000-01-02")`, `new Date("yesterday")`],
    ["new Date(<template, date-shaped head>)", "new Date(`2000-01-${day}T00:00:00Z`)", "new Date(`${year}-01-02`)"],
    ["Date.parse(<date string>)", `Date.parse("2000-01-02T00:00:00Z")`, `Date.parse(input)`],
    ["Date.parse(<template, date-shaped head>)", "Date.parse(`2000-01-${day}`)", "Date.parse(`${stamp}`)"],
    ["new Date(<numeric literals>)", `new Date(2000, 0, 2)`, `new Date(2000, month, 2)`],
    ["new Date(<signed numeric literals>)", `new Date(2000, 0, -1)`, `new Date(2000, 0, -offset)`],
    ["Date.UTC(<numeric literals>)", `Date.UTC(2000, 0, 2)`, `Date.UTC(year, 0, 2)`],
    ["new Date(Date.UTC(<numeric literals>))", `new Date(Date.UTC(2000, 0, 2))`, `new Date(Date.UTC(year, 0, 2))`],
    ["a method on a literal date", `new Date("2000-01-02").toISOString()`, `new Date().toISOString()`],
    ["through as/parens", `(new Date("2000-01-02") as Date)`, `(new Date(Date.now()) as Date)`],
  ];

  it.each(forms)("%s: MUST flag the literal", (_form, mustFlag) => {
    const v = flagged(`const order = { created_at: ${mustFlag} };`);
    expect(v.map((s) => s.key)).toEqual(["created_at"]);
    expect(v[0].detail).toBe(`= ${mustFlag}`);
  });

  it.each(forms)("%s: must NOT flag the clock-relative or opaque value", (_form, _mustFlag, mustNotFlag) => {
    const s = sitesOf(`const order = { created_at: ${mustNotFlag} };`);
    expect(s.map((x) => [x.verdict, x.shape])).toEqual([["compliant", "computed"]]);
  });

  it("must NOT flag new Date(), new Date(Date.now() - n), new Date(daysAgo(n)) or new Date(variable)", () => {
    const s = sitesOf(
      `const order = { created_at: new Date(), shipped_at: new Date(Date.now() - 3 * DAY_MS), delivered_on: new Date(daysAgo(3)), cancelled_at: new Date(when) };`,
    );
    expect(s.filter((x) => x.verdict === "violation")).toEqual([]);
  });

  it("must NOT flag new Date(<one numeric literal>): an epoch is ambiguous, a recorded limitation", () => {
    expect(flagged(`const order = { created_at: new Date(0), shipped_at: new Date(86_400_000) };`)).toEqual([]);
  });

  it("must NOT flag a constructed literal date under a non-temporal key", () => {
    expect(flagged(`const order = { label: new Date("2000-01-02"), sku: Date.UTC(2000, 0, 2) };`)).toEqual([]);
  });

  it("reports the date-shaped string as the literal, and a numeric date as its source text", () => {
    const v = flagged(`const order = { created_at: new Date("2000-01-02"), shipped_at: new Date(2000, 0, 2) };`);
    expect(v.map((s) => s.literal)).toEqual(["2000-01-02", "new Date(2000, 0, 2)"]);
  });

  it("derives CLOCK_PINNED for a constructed literal date in a file that pins the clock", () => {
    const v = flagged(`vi.useFakeTimers();\nconst order = { created_at: new Date("2000-01-02") };`);
    expect(v.map((s) => s.derivedStatus)).toEqual(["CLOCK_PINNED"]);
  });
});

describe("clock-pinned derivation", () => {
  it("POSITIVE: a file that calls setSystemTime or useFakeTimers derives CLOCK_PINNED for its violations", () => {
    for (const call of ["vi.setSystemTime(new Date(0));", "vi.useFakeTimers();", "jest.useFakeTimers();", "beforeEach(() => { vi.useFakeTimers({ now: 0 }); });"]) {
      const v = flagged(`${call}\nconst order = { created_at: "2000-01-15" };`);
      expect(v.map((s) => s.derivedStatus), call).toEqual(["CLOCK_PINNED"]);
    }
  });

  it("NEGATIVE: a mention in a comment or a string, or no call at all, derives nothing", () => {
    for (const pre of ["// vi.setSystemTime(new Date(0))", `const note = "vi.useFakeTimers()";`, ""]) {
      const v = flagged(`${pre}\nconst order = { created_at: "2000-01-15" };`);
      expect(v.map((s) => s.derivedStatus), pre).toEqual([undefined]);
    }
  });

  it("a compliant site in a pinned file stays compliant, with no derived status", () => {
    const s = sitesOf(`vi.useFakeTimers();\nconst order = { created_at: daysAgo(3) };`);
    expect(s.map((x) => [x.verdict, x.derivedStatus])).toEqual([["compliant", undefined]]);
  });
});

describe("keys", () => {
  it("are (file, enclosing scope path, key, ordinal), never a line number", () => {
    const s = flagged(
      `describe("orders", () => {\n  it.only("ships", () => {\n    const rows = [{ created_at: "2000-01-15" }, { created_at: "2000-02-15" }];\n  });\n});\nfunction makeItem() { return { ship_date: "2000-01-15" }; }\nclass Seed { order = { created_at: "2000-01-15" }; }`,
    );
    expect(s.map((x) => [x.symbol, x.key, x.ordinal])).toEqual([
      ["describe:orders > it:ships > rows", "created_at", 0],
      ["describe:orders > it:ships > rows", "created_at", 1],
      ["makeItem", "ship_date", 0],
      ["Seed > order", "created_at", 0],
    ]);
  });

  it("count compliant sites in the ordinal, so anchoring one site does not re-key its neighbours", () => {
    const before = sitesOf(`const rows = [{ created_at: "2000-01-15" }, { created_at: "2000-02-15" }];`);
    const after = sitesOf(`const rows = [{ created_at: daysAgo(45) }, { created_at: "2000-02-15" }];`);
    expect(before.map((s) => [s.ordinal, s.verdict])).toEqual([[0, "violation"], [1, "violation"]]);
    expect(after.map((s) => [s.ordinal, s.verdict])).toEqual([[0, "compliant"], [1, "violation"]]);
  });

  it("do not move when blank lines are inserted above a site", () => {
    const src = `it("ships", () => { const o = { created_at: "2000-01-15" }; });`;
    const strip = (xs: ReturnType<typeof sitesOf>) => xs.map(({ file, symbol, key, ordinal }) => ({ file, symbol, key, ordinal }));
    expect(strip(sitesOf(`\n\n\n${src}`))).toEqual(strip(sitesOf(src)));
  });
});

describe("parse failures", () => {
  it("a broken TS file is reported by name, not skipped", () => {
    expect(sitesInSource("broken.test.ts", `const order = { created_at: "2000-01-15" `, CONFIG).parseFailure?.file).toBe("broken.test.ts");
  });

  it("a broken JSON file is reported by name, including what only strict JSON rejects", () => {
    for (const src of [`{ "created_at": "2000-01-15" `, `{ "created_at": "2000-01-15", }`]) {
      expect(sitesInSource("rows.json", src, CONFIG).parseFailure?.file, src).toBe("rows.json");
    }
  });
});

describe("the date-shape rule", () => {
  it("narrowed to a full YYYY-MM-DD, misses the template head: the reason the default accepts YYYY-MM", () => {
    const narrow: WalkerConfig = { ...CONFIG, dateShaped: /^\d{4}-\d{2}-\d{2}/ };
    const src = "const order = { created_at: `2000-01-${day}` };";
    expect(flagged(src)).toHaveLength(1);
    expect(flagged(src, narrow)).toHaveLength(0);
  });
});

describe("globs", () => {
  it("** spans directories, * and ? do not, {a,b} takes alternatives", () => {
    expect(globToRegExp("**/fixtures/**/*.json").test("src/test/fixtures/golden/a.json")).toBe(true);
    expect(globToRegExp("**/fixtures/**/*.json").test("fixtures/a.json")).toBe(true);
    expect(globToRegExp("**/fixtures/**/*.json").test("src/test/rows.json")).toBe(false);
    expect(globToRegExp("src/*.ts").test("src/a/b.ts")).toBe(false);
    expect(globToRegExp("**/*.{ts,tsx}").test("a/b.tsx")).toBe(true);
    expect(globToRegExp("**/*.{ts,tsx}").test("a/b.tsxx")).toBe(false);
    expect(globToRegExp("a?.ts").test("ab.ts")).toBe(true);
  });
});

describe("the walk over a tree", () => {
  const root = mkdtempSync(join(tmpdir(), "ratchet-walker-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const put = (rel: string, text: string) => {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  put("src/test/orders.test.ts", `const order = { created_at: "2000-01-15", ship_date: daysAgo(3) };`);
  put("src/test/fixtures/golden/orders.json", `{ "created_at": "2000-01-15" }`);
  put("src/test/rows.json", `{ "created_at": "2000-01-15" }`);
  put("src/test/ratchet/snapshot.json", `{ "entries": [] }`);
  put("src/test/node_modules/dep/index.ts", `const x = { created_at: "2000-01-15" };`);
  put("src/test/notes.md", `created_at: "2000-01-15"`);
  put("src/empty/.keep", "");
  const config: WalkerConfig = { ...CONFIG, root, testRoots: ["src/test"], snapshot: "src/test/ratchet/snapshot.json" };

  it("reads included files, skips golden JSON, the snapshot, node_modules and non-code files", () => {
    const r = scan(config);
    expect(r.files).toEqual(["src/test/orders.test.ts", "src/test/rows.json"]);
    expect(r.parseFailures).toEqual([]);
    expect(r.sites.map((s) => [s.file, s.key, s.verdict])).toEqual([
      ["src/test/orders.test.ts", "created_at", "violation"],
      ["src/test/orders.test.ts", "ship_date", "compliant"],
      ["src/test/rows.json", "created_at", "violation"],
    ]);
  });

  it("an empty root enumerates zero sites, which the ratchet then fails", () => {
    const r = scan({ ...config, testRoots: ["src/empty"] });
    expect([r.files.length, r.sites.length, r.parseFailures.length]).toEqual([0, 0, 0]);
  });

  it("a missing root is a parse failure, named", () => {
    expect(scan({ ...config, testRoots: ["src/nope"] }).parseFailures.map((p) => p.file)).toEqual(["src/nope"]);
  });

  it("an unparseable file is a parse failure, named", () => {
    put("src/test/broken.test.ts", "const order = {");
    try {
      expect(scan(config).parseFailures.map((p) => p.file)).toEqual(["src/test/broken.test.ts"]);
    } finally {
      rmSync(join(root, "src/test/broken.test.ts"));
    }
  });
});
