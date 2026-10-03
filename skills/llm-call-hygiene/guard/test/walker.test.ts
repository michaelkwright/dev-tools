// The fixed-index-read guard, proven on synthetic sources and a throwaway tree:
// what it must flag, what it must not, comment handling with positive
// controls, exemptions both ways, and the self-failure rules from ratchet-core.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { RuleId, ShapeConfig } from "../ratchet-core.ts";
import {
  CONFIG,
  guardFailures,
  scan,
  sitesInSource,
  type Exemption,
  type GuardConfig,
  type ScanResult,
} from "../fixed-index-read/walker.ts";

const sitesOf = (src: string, file = "orders.ts", config: GuardConfig = CONFIG) => {
  const one = sitesInSource(file, src, config);
  expect(one.parseFailure, "synthetic source did not parse").toBeUndefined();
  return one.sites;
};
const flagged = (src: string) => sitesOf(src).filter((s) => s.verdict === "violation").map((s) => s.form);

describe("the walker MUST flag every fixed-position form", () => {
  const forms: Array<[string, string]> = [
    [`const t = res.content[0].text;`, "content[0]"],
    [`const t = res.content[1].text;`, "content[1]"],
    [`const t = res?.content?.[0]?.text;`, "content?.[0]"],
    [`const t = res.content?.[0].text;`, "content?.[0]"],
    [`const t = res["content"][0].text;`, "content[0]"],
    [`const t = res.content["0"].text;`, 'content["0"]'],
    [`const t = content[0].text;`, "content[0]"],
    [`const t = (res as Reply).content![0].text;`, "content[0]"],
    [`const t = res.content.at(0).text;`, "content.at(0)"],
    [`const t = res.content.at(-1).text;`, "content.at(-1)"],
    [`const [first] = res.content;`, "[...] = content"],
    [`const [, second] = res.content;`, "[...] = content"],
    [`const [first, ...rest] = res.content;`, "[...] = content"],
    [`const { content: [first] } = res;`, "{ content: [...] }"],
    [`const read = ({ content: [first] }: Reply) => first;`, "{ content: [...] }"],
    [`let first; [first] = res.content;`, "[...] = content"],
  ];

  it.each(forms)("%s", (src, form) => {
    expect(flagged(src)).toEqual([form]);
  });

  it("names each site's form and code in its detail", () => {
    const [s] = sitesOf(`function readOrder(res) { return res.content[0].text; }`);
    expect(s.detail).toBe("content[0] in `res.content[0]`");
  });
});

describe("the walker must NOT flag", () => {
  it("a computed position, reported as computed_index", () => {
    const s = sitesOf(`for (let i = 0; i < res.content.length; i++) use(res.content[i]); const last = res.content[res.content.length - 1]; const b = res.content.at(n);`);
    expect(s.map((x) => [x.verdict, x.shape])).toEqual([
      ["compliant", "computed_index"],
      ["compliant", "computed_index"],
      ["compliant", "computed_index"],
    ]);
  });

  it("a lone rest, a shorthand, or a method that is not a position read", () => {
    expect(flagged(`const [...all] = res.content; const { content } = res; const n = res.content.length; const ts = res.content.map((b) => b.type);`)).toEqual([]);
  });

  it("another array read by position", () => {
    expect(flagged(`const first = order.items[0]; const m = body.messages[0].role;`)).toEqual([]);
  });

  it("a mention in a line, block or doc comment", () => {
    expect(flagged(`// res.content[0].text\n/* res.content?.[0] */\n/** const [first] = res.content; */\nconst x = 1;`)).toEqual([]);
  });

  it("a mention in a string, a template or a regex", () => {
    expect(flagged("const a = \"res.content[0]\"; const b = `res.content[0] ${x}`; const c = /content\\[0\\]/;")).toEqual([]);
  });
});

describe("comments: positive controls that real code survives", () => {
  it("a block comment before real code on the same line: the code is flagged, the comment is not", () => {
    expect(flagged(`/* res.content[0] */ const t = res.content[1].text;`)).toEqual(["content[1]"]);
  });

  it("a block comment inside the expression: still flagged once", () => {
    expect(flagged(`const t = res.content/* first block */[0].text;`)).toEqual(["content[0]"]);
  });

  it("a line comment after real code: flagged once", () => {
    expect(flagged(`const t = res.content[0].text; // content[0] is the answer`)).toEqual(["content[0]"]);
  });

  it("a block comment spanning lines around real code: only the code", () => {
    expect(flagged(`/*\n const a = res.content[0];\n*/ const b = res?.content?.[2];\n/* res.content[3] */`)).toEqual(["content?.[2]"]);
  });

  it("a URL holding // inside a string does not swallow the code after it", () => {
    expect(flagged(`const u = "https://example.com/orders"; const t = res.content[0].text;`)).toEqual(["content[0]"]);
  });
});

describe("reader calls", () => {
  it("each configured reader is a compliant site keyed by its own name", () => {
    const s = sitesOf(`const t = trailingText(res); const v = parseJsonReply(res, { stripOneFence: true }); const o = helpers.trailingText(res);`);
    expect(s.map((x) => [x.name, x.verdict, x.shape])).toEqual([
      ["trailingText", "compliant", "reader"],
      ["parseJsonReply", "compliant", "reader"],
      ["trailingText", "compliant", "reader"],
    ]);
  });

  it("a call to anything else is not a site", () => {
    expect(sitesOf(`const t = firstText(res); const u = readOrder(res);`)).toEqual([]);
  });
});

describe("keys", () => {
  it("are (file, enclosing scope path, name, ordinal), never a line number", () => {
    const s = sitesOf(
      `function readOrder(res) {\n  const a = res.content[0];\n  const b = res.content[i];\n  const c = res.content[1];\n}\nclass Client { parse(res) { return res.content[0]; } }\ndescribe("orders", () => { it("reads", () => { const t = res.content[0]; }); });`,
    );
    expect(s.map((x) => [x.symbol, x.name, x.ordinal, x.verdict])).toEqual([
      ["readOrder > a", "content", 0, "violation"],
      ["readOrder > b", "content", 0, "compliant"],
      ["readOrder > c", "content", 0, "violation"],
      ["Client > parse", "content", 0, "violation"],
      ["describe:orders > it:reads > t", "content", 0, "violation"],
    ]);
  });

  it("count compliant sites in the ordinal, so fixing one read does not re-key the next", () => {
    const before = sitesOf(`function f(res) { use(res.content[0]); use(res.content[1]); }`);
    const after = sitesOf(`function f(res) { use(res.content[i]); use(res.content[1]); }`);
    expect(before.map((s) => [s.ordinal, s.verdict])).toEqual([[0, "violation"], [1, "violation"]]);
    expect(after.map((s) => [s.ordinal, s.verdict])).toEqual([[0, "compliant"], [1, "violation"]]);
  });

  it("do not move when lines are inserted above a site", () => {
    const src = `function f(res) { return res.content[0]; }`;
    const key = (xs: ReturnType<typeof sitesOf>) => xs.map(({ file, symbol, name, ordinal }) => ({ file, symbol, name, ordinal }));
    expect(key(sitesOf(`\n\n// moved\n${src}`))).toEqual(key(sitesOf(src)));
  });
});

describe("parse failures", () => {
  it("a broken file is reported by name, not skipped", () => {
    expect(sitesInSource("broken.ts", `const t = res.content[0`, CONFIG).parseFailure?.file).toBe("broken.ts");
  });
});

// ── The guard's verdict, through ratchet-core ─────────────────────────────────

const SHAPES: ShapeConfig = { reader: "required", computed_index: { absent: "none in these fixtures" } };
const rules = (r: ScanResult, exemptions: Exemption[] = [], shapes: ShapeConfig = SHAPES) =>
  guardFailures(r, { exemptions, shapes }).map((f) => f.rule as RuleId);
const one = (file: string, src: string): ScanResult => {
  const o = sitesInSource(file, src, CONFIG);
  return { files: [file], sites: o.sites, parseFailures: o.parseFailure ? [o.parseFailure] : [] };
};

const CLEAN = `export function total(res) { return trailingText(res); }`;
const VIOLATING = `export function readOrder(res) {\n  const t = trailingText(res);\n  return res.content[0].text;\n}`;
const EXEMPT: Exemption = {
  file: "orders.ts",
  symbol: "readOrder",
  name: "content",
  ordinal: 0,
  status: "EXEMPT",
  justification: "reads the request body's first message, not a response",
};

describe("the guard's verdict", () => {
  it("a clean file passes", () => {
    expect(rules(one("orders.ts", CLEAN))).toEqual([]);
  });

  it("a violation fails (a), naming the site and its form", () => {
    const f = guardFailures(one("orders.ts", VIOLATING), { exemptions: [], shapes: SHAPES });
    expect(f.map((x) => x.rule)).toEqual(["a"]);
    expect(f[0].message).toContain("orders.ts :: readOrder :: content :: 0");
    expect(f[0].message).toContain("content[0] in `res.content[0]`");
  });

  it("a comment-only mention passes", () => {
    expect(rules(one("orders.ts", `${CLEAN}\n// res.content[0].text was the old read\n/* const [first] = res.content; */`))).toEqual([]);
  });

  it("an exempt site passes", () => {
    expect(rules(one("orders.ts", VIOLATING), [EXEMPT])).toEqual([]);
  });

  it("an exempt file still fails on a second, unexempted violation", () => {
    expect(rules(one("orders.ts", VIOLATING.replace("return res.content[0].text;", "use(res.content[1]); return res.content[0].text;")), [EXEMPT])).toEqual(["a"]);
  });

  it("a stale exemption fails: its site is gone (c)", () => {
    expect(rules(one("orders.ts", CLEAN), [EXEMPT])).toEqual(["c"]);
  });

  it("a stale exemption fails: its site is now compliant (b)", () => {
    const fixed = VIOLATING.replace("res.content[0].text", "res.content[i].text");
    expect(rules(one("orders.ts", fixed), [EXEMPT], { reader: "required", computed_index: "required" })).toEqual(["b"]);
  });

  it("an exemption without a reason fails (d), and so does any other status", () => {
    expect(rules(one("orders.ts", VIOLATING), [{ ...EXEMPT, justification: "  " }])).toEqual(["d"]);
    expect(rules(one("orders.ts", VIOLATING), [{ ...EXEMPT, status: "KNOWN_OPEN" as "EXEMPT" }])).toEqual(["d"]);
  });

  it("a parse failure fails (h), naming the file", () => {
    const f = guardFailures(one("orders.ts", `${CLEAN}\nconst t = res.content[0`), { exemptions: [], shapes: SHAPES });
    expect(f.map((x) => x.rule)).toContain("h");
    expect(f.find((x) => x.rule === "h")?.message).toContain("orders.ts");
  });

  it("no reader call anywhere fails (i): the walker must see the compliant shape", () => {
    expect(rules(one("orders.ts", `export const n = 1;`), [], { reader: "required" })).toEqual(["g", "i"]);
  });

  it("zero files walked fails (g) on its own message", () => {
    const f = guardFailures({ files: [], sites: [], parseFailures: [] }, { exemptions: [], shapes: {} });
    expect(f.map((x) => x.rule)).toEqual(["g", "g"]);
    expect(f[0].message).toContain("walked 0 files");
  });
});

describe("the walk over a tree", () => {
  const root = mkdtempSync(join(tmpdir(), "fixed-index-read-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const put = (rel: string, text: string) => {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  put("server/orders.ts", VIOLATING);
  put("server/shared/read.ts", CLEAN);
  put("server/orders.test.ts", `const t = res.content[0].text;`);
  put("server/node_modules/dep/index.ts", `const t = res.content[0].text;`);
  put("server/notes.md", `res.content[0].text`);
  put("empty/.keep", "");
  const config: GuardConfig = { ...CONFIG, root, roots: ["server"] };

  it("reads included files and skips tests, node_modules and non-code files", () => {
    const r = scan(config);
    expect(r.files).toEqual(["server/orders.ts", "server/shared/read.ts"]);
    expect(r.parseFailures).toEqual([]);
    expect(r.sites.filter((s) => s.verdict === "violation").map((s) => [s.file, s.form])).toEqual([["server/orders.ts", "content[0]"]]);
  });

  it("an empty root walks zero files, which the guard fails", () => {
    const r = scan({ ...config, roots: ["empty"] });
    expect([r.files.length, r.sites.length, r.parseFailures.length]).toEqual([0, 0, 0]);
    expect(rules(r)).toContain("g");
  });

  it("a missing root is a parse failure, named", () => {
    expect(scan({ ...config, roots: ["nope"] }).parseFailures.map((p) => p.file)).toEqual(["nope"]);
  });

  it("an unparseable file is a parse failure, named, not skipped", () => {
    put("server/broken.ts", "const t = res.content[0");
    try {
      expect(scan(config).parseFailures.map((p) => p.file)).toEqual(["server/broken.ts"]);
    } finally {
      rmSync(join(root, "server/broken.ts"));
    }
  });
});

describe("the shipped helper and guard, against each other", () => {
  const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

  it("the response helpers contain no fixed-index read, and call their own reader", () => {
    const src = readFileSync(here("../../helpers/message-reading.ts"), "utf8");
    const s = sitesOf(src, "helpers/message-reading.ts");
    expect(s.filter((x) => x.verdict === "violation")).toEqual([]);
    expect(s.some((x) => x.shape === "reader")).toBe(true);
  });

  it("the default readers and reader module name what the helpers export", () => {
    const src = readFileSync(here("../../helpers/message-reading.ts"), "utf8");
    for (const r of CONFIG.readers) expect(src).toMatch(new RegExp(`export function ${r}\\b`));
    expect(CONFIG.readerModule.endsWith("/message-reading.ts")).toBe(true);
  });

  it("the walker, the guard test and the core shim contain no file-write call", () => {
    const needles = [["write", "File"], ["append", "File"], ["create", "WriteStream"]].map((p) => p.join(""));
    for (const rel of ["../fixed-index-read/walker.ts", "../fixed-index-read/fixed-index-read.test.ts", "../ratchet-core.ts"]) {
      const src = readFileSync(here(rel), "utf8");
      expect(needles.filter((n) => src.includes(n)), rel).toEqual([]);
    }
  });

  it("the copyable files carry exactly the provenance placeholder", () => {
    for (const rel of ["../fixed-index-read/walker.ts", "../fixed-index-read/fixed-index-read.test.ts", "../../helpers/message-reading.ts"]) {
      expect(readFileSync(here(rel), "utf8").match(/\{\{[A-Z_]+\}\}/g), rel).toEqual(["{{DEV_TOOLS_SHA}}"]);
    }
  });
});
