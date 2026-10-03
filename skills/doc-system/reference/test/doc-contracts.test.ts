// Runs the reference doc-contract test against a freshly seeded fixture, one
// vitest child per case, each in its own temp dir. The fixture is the
// templates/ seed set filled in, a CLAUDE.md holding the filled limits block,
// and the reference test at its default path. Cases cover the template-token
// check; the control case proves the seed itself passes the whole test.
import { execFile } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const SKILL = fileURLToPath(new URL("../../", import.meta.url));
const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const VITEST = join(REPO, "node_modules/vitest/vitest.mjs");
const TEST_PATH = "src/test/doc-contracts.test.ts";
const TOKEN = "{{ORDER_TOTAL}}";
const ALLOW_ANCHOR = "allow: [] as TokenAllowance[],";

const FILL: Record<string, string> = {
  "{{PROJECT_NAME}}": "Order Desk",
  "{{SEED_DATE}}": "March 4, 2026",
  "{{PRODUCT_SUMMARY}}": "Order Desk lets a small shop track orders and their items.",
  "{{DEV_TOOLS_SHA}}": "harness",
  "{{CHANGELOG_WINDOW}}": "50",
  "{{SEAL_SIZE}}": "50",
  "{{INDEX_CELL_MAX}}": "300",
  "{{PREAMBLE_MAX_LINES}}": "3",
  "{{DOC_CONTRACT_CMD}}": `npx vitest run ${TEST_PATH}`,
};

const fill = (text: string) => Object.entries(FILL).reduce((t, [k, v]) => t.split(k).join(v), text);

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function seed(): string {
  const root = mkdtempSync(join(tmpdir(), "doc-contracts-"));
  dirs.push(root);
  cpSync(join(SKILL, "templates"), root, { recursive: true });
  for (const rel of ["CHANGELOG.md", "PRODUCT_SPEC.md", "ROADMAP.md", "changelog/v0.1-onward.md"])
    writeFileSync(join(root, rel), fill(readFileSync(join(root, rel), "utf8")));
  const limits = readFileSync(join(SKILL, "reference/limits.md"), "utf8").split("\n---\n")[1];
  writeFileSync(
    join(root, "CLAUDE.md"),
    `# Order Desk: Claude Code Project Context\n\n<!-- doc-contract-limits:start -->\n${fill(limits).trim()}\n<!-- doc-contract-limits:end -->\n`,
  );
  mkdirSync(join(root, "src/test"), { recursive: true });
  writeFileSync(join(root, TEST_PATH), fill(readFileSync(join(SKILL, "reference/doc-contracts.test.ts"), "utf8")));
  symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"), "dir");
  return root;
}

function append(root: string, rel: string, text: string): number {
  const path = join(root, rel);
  const before = readFileSync(path, "utf8").replace(/\n*$/, "\n");
  writeFileSync(path, `${before}\n${text}\n`);
  return before.split("\n").length + 1; // the first line of text
}

function allow(root: string, entries: object[]) {
  const path = join(root, TEST_PATH);
  const src = readFileSync(path, "utf8");
  expect(src.split(ALLOW_ANCHOR).length - 1, "allow anchor in the reference test").toBe(1);
  writeFileSync(path, src.replace(ALLOW_ANCHOR, `allow: ${JSON.stringify(entries)} as TokenAllowance[],`));
}

function run(root: string, ...args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((done) => {
    execFile(
      process.execPath,
      [VITEST, "run", TEST_PATH, "--root", root, "--reporter=verbose", ...args],
      { cwd: root, env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" } },
      (err, stdout, stderr) => done({ code: err ? Number(err.code ?? 1) : 0, out: stdout + stderr }),
    );
  });
}

describe.concurrent("doc-contract test: template tokens", () => {
  it("control: the seeded fixture passes the whole test", async () => {
    const r = await run(seed());
    expect(r.out).toMatch(/no doc keeps an unfilled template token outside code/);
    expect(r.code, r.out).toBe(0);
  });

  it("a token in ROADMAP.md prose fails, naming file and line", async () => {
    const root = seed();
    const line = append(root, "ROADMAP.md", `The export shows ${TOKEN} per order.`);
    const r = await run(root);
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain(`ROADMAP.md:${line}  ${TOKEN}`);
  });

  it("a token in CLAUDE.md prose fails, naming file and line", async () => {
    const root = seed();
    const line = append(root, "CLAUDE.md", `Orders show ${TOKEN} at checkout.`);
    const r = await run(root);
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain(`CLAUDE.md:${line}  ${TOKEN}`);
  });

  it("the same token inside backtick and tilde fences passes", async () => {
    const root = seed();
    append(root, "ROADMAP.md", ["```text", `total: ${TOKEN}`, "```", "", "~~~~", "```", TOKEN, "~~~~"].join("\n"));
    const r = await run(root);
    expect(r.code, r.out).toBe(0);
  });

  it("the same token inside inline code passes", async () => {
    const root = seed();
    append(root, "ROADMAP.md", `The export template writes \`${TOKEN}\` and \`\`a \` ${TOKEN}\`\` literally.`);
    const r = await run(root);
    expect(r.code, r.out).toBe(0);
  });

  it("a lowercase double-brace name in prose passes", async () => {
    const root = seed();
    append(root, "ROADMAP.md", "Each export row names {{order_total}} and {{name}} in its header.");
    const r = await run(root);
    expect(r.code, r.out).toBe(0);
  });

  it("control: an allowance with a reason clears the token it names", async () => {
    const root = seed();
    append(root, "ROADMAP.md", `The export shows ${TOKEN} per order.`);
    allow(root, [{ file: "ROADMAP.md", token: TOKEN, reason: "the export format documents this token" }]);
    const r = await run(root);
    expect(r.code, r.out).toBe(0);
  });

  it("an allowance without a reason fails", async () => {
    const root = seed();
    append(root, "ROADMAP.md", `The export shows ${TOKEN} per order.`);
    allow(root, [{ file: "ROADMAP.md", token: TOKEN, reason: " " }]);
    const r = await run(root);
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain("Template token allowance(s) without a reason");
  });

  it("an allowance matching nothing fails", async () => {
    const root = seed();
    allow(root, [{ file: "ROADMAP.md", token: TOKEN, reason: "the export format documents this token" }]);
    const r = await run(root);
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain(`ROADMAP.md  ${TOKEN}`);
  });

  it('-t "template token" runs the check alone, even with no changelog yet', async () => {
    const root = seed();
    rmSync(join(root, "CHANGELOG.md"));
    rmSync(join(root, "changelog"), { recursive: true });
    const line = append(root, "ROADMAP.md", `The export shows ${TOKEN} per order.`);
    const r = await run(root, "-t", "template token");
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain(`ROADMAP.md:${line}  ${TOKEN}`);
    expect(r.out).toMatch(/^\s+CHANGELOG\.md$/m);
    expect(r.out).toMatch(/^\s+changelog\/$/m);
    expect(r.out).not.toMatch(/ENOENT/);
  });
});
