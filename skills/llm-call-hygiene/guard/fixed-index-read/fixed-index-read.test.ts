// Fixed-index reads of a model response: an invariant ratchet. Node environment.
// Seeded from dev-tools @ {{DEV_TOOLS_SHA}}; this file is now the project's own.
//
// Zero fixed-position reads of a response's content array is the rule from day
// one, so there is no worklist: only the walk (./walker.ts), the verdict and
// the self-failure checks, all through ../ratchet-core.ts. The one status is
// EXEMPT, for a read that is not of a response (a request body's message
// content) or must stay fixed (frozen evidence), and it needs a justification.
// An exemption whose site is gone or now compliant fails as stale.
//
// Fix a violation by reading through the trailing-text reader in
// CONFIG.readerModule, never by adding an exemption.
// Why: on a thinking-capable model the answer is not at index 0, and the read
// fails one request in several with a verdict that blames the prompt.
//
// This test never writes; the exemption list below is edited by hand and its
// diff is read. Asserted at the foot of this file.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { formatFailures, type RuleId, type ShapeConfig } from "../ratchet-core.ts";
import { CONFIG, guardFailures, scan, sitesInSource, type Exemption } from "./walker.ts";

// Each entry names one site by its key, copied exactly from the failure message.
const EXEMPTIONS: Exemption[] = [
  // { file: "scripts/replay-orders.ts", symbol: "buildRequest", name: "content", ordinal: 0,
  //   status: "EXEMPT", justification: "reads the REQUEST body's first message, not a response" },
];

// A shape with no site fails, unless declared { absent: "<reason>" }; a shape
// declared absent fails once it has a site.
const SHAPES: ShapeConfig = {
  reader: "required",
  computed_index: { absent: "no response array is read by a computed position yet" },
};

// Rule (g)'s floor. Raise it toward the real site count once adopted.
const MIN_SITES = 1;

const SCAN = scan();
const FAILURES = guardFailures(SCAN, { exemptions: EXEMPTIONS, shapes: SHAPES, minSites: MIN_SITES });
const of = (...rules: RuleId[]) => formatFailures(FAILURES.filter((f) => rules.includes(f.rule)));

describe("the walker sees what it claims to see", () => {
  const sitesOf = (src: string) => {
    const one = sitesInSource("synthetic.ts", src, CONFIG);
    expect(one.parseFailure, "synthetic source did not parse").toBeUndefined();
    return one.sites;
  };
  const flagged = (src: string) => sitesOf(src).filter((s) => s.verdict === "violation").map((s) => s.form);

  it("flags each fixed-position form", () => {
    expect(flagged(`const t = res.content[0].text;`)).toEqual(["content[0]"]);
    expect(flagged(`const t = res?.content?.[0]?.text;`)).toEqual(["content?.[0]"]);
    expect(flagged(`const [first] = res.content;`)).toEqual(["[...] = content"]);
  });

  it("does not flag a mention in a comment or a string, and still flags real code beside one", () => {
    expect(flagged(`// res.content[0]\n/* res.content[0] */\nconst note = "res.content[0]";`)).toEqual([]);
    expect(flagged(`/* res.content[0] */ const t = res.content[1].text;`)).toEqual(["content[1]"]);
  });

  it("reads a reader call as compliant", () => {
    expect(sitesOf(`const t = ${CONFIG.readers[0]}(res);`).map((s) => [s.verdict, s.shape])).toEqual([["compliant", "reader"]]);
  });
});

describe("the designated reader really reads the trailing text", () => {
  it(`${CONFIG.readerModule} skips a leading thinking block and returns null when no text trails`, async () => {
    const mod = (await import(pathToFileURL(resolve(CONFIG.root, CONFIG.readerModule)).href)) as Record<string, (m: unknown) => unknown>;
    const read = mod[CONFIG.readers[0]];
    expect(typeof read, `${CONFIG.readerModule} does not export ${CONFIG.readers[0]}`).toBe("function");
    const reply = (content: unknown[]) => ({ content, stop_reason: "end_turn" });
    expect(read(reply([{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text: "ok" }]))).toBe("ok");
    expect(read(reply([{ type: "thinking", thinking: "", signature: "s" }]))).toBeNull();
  });
});

describe("the guard fails on its own failure", () => {
  it("(g) walked files and enumerated real sites", () => {
    expect(of("g")).toBe("");
  });

  it("(h) parsed every file it walked, and every root exists", () => {
    expect(of("h")).toBe("");
  });

  it("(i) every declared shape is represented, and no absent one is", () => {
    expect(of("i")).toBe("");
  });
});

describe("no fixed-index read, and no stale exemption", () => {
  it("(a) every fixed-position read is fixed or exempt: read through the trailing-text reader", () => {
    expect(of("a")).toBe("");
  });

  it("(b) (c) every exemption still names a live fixed-position read", () => {
    expect(of("b", "c")).toBe("");
  });

  it("(d) every exemption is EXEMPT and says why", () => {
    expect(of("d")).toBe("");
  });

  it("(j) and the rest: keys carry no line numbers, and no two sites or exemptions share a key", () => {
    expect(of("e", "f", "j", "snapshot", "walker")).toBe("");
  });
});

describe("the guard never rewrites its own exemption list", () => {
  it("this test, the walker and the core contain no file-write call", () => {
    // Needles are assembled so this file does not match its own text.
    const needles = [["write", "File"], ["append", "File"], ["create", "WriteStream"]].map((p) => p.join(""));
    for (const url of [import.meta.url, new URL("./walker.ts", import.meta.url).href, new URL("../ratchet-core.ts", import.meta.url).href]) {
      const src = readFileSync(fileURLToPath(url), "utf8");
      for (const n of needles) expect(src.includes(n), `${url} contains ${n}`).toBe(false);
    }
  });
});
