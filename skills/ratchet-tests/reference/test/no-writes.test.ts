// The ratchet half never writes: ratchet-core.ts, walker.ts and the project
// test contain no file-write call. The regen script must, which is the control
// proving the needles can match at all.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const NEEDLES = ["writeFile", "writeFileSync", "appendFile", "appendFileSync", "createWriteStream"];
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

describe("no fs write calls in the ratchet half", () => {
  it.each(["ratchet-core.ts", "fixture-date-anchoring/walker.ts", "fixture-date-anchoring/fixture-date-anchoring.test.ts"])(
    "%s contains none",
    (rel) => {
      const src = read(rel);
      expect(NEEDLES.filter((n) => src.includes(n))).toEqual([]);
    },
  );

  it("control: the regen template and its instance do write, so the needles match real calls", () => {
    for (const rel of ["regen-template.ts", "fixture-date-anchoring/regen.ts"]) {
      expect(NEEDLES.filter((n) => read(rel).includes(n)), rel).toContain("writeFileSync");
    }
  });

  it("the instantiated regen fills every template placeholder", () => {
    const src = read("fixture-date-anchoring/regen.ts");
    expect(src.match(/\{\{[A-Z_]+\}\}/g)).toEqual(["{{DEV_TOOLS_SHA}}"]);
    expect(src).not.toContain("PLACEHOLDER");
  });
});
