// The read-back template, filled. The comparison is pure, over two maps of path
// to bytes; the filled script's own runs use a throwaway repo and a stub npx
// first on PATH, so nothing reaches Supabase.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { filled, writeScripts } from "./fill";

const INDEX = "supabase/functions/place-order/index.ts";
const HANDLER = "supabase/functions/place-order/handler.ts";
const CACHE = "supabase/.temp/cli-latest";
const REF = "abcdefghijklmnopqrst";
const TOKEN = "sb" + "p_0123456789abcdef0123456789abcdef01234567";

type Row = { status: string; path: string; reason?: string };
type Result = { rows: Row[]; equal: number; differences: number; ok: boolean };
type Input = { committed: Map<string, Buffer>; deployed: Map<string, Buffer>; extracted?: string[]; irregular?: string[] };

let dir: string;
let mod: {
  ALLOWED_EXTRAS: Record<string, string>;
  TEST_WORKDIR_VAR: string;
  compareReadback: (i: Input) => Result;
  extractedPaths: (log: string) => string[];
  formatReadback: (r: Result) => string[];
  insideTree: (p: string, top: string) => boolean;
  sha256: (b: Buffer) => string;
  unsafePath: (p: string) => boolean;
};
let pin: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "functions-readback-test-"));
  writeScripts(dir);
  mod = await import(/* @vite-ignore */ pathToFileURL(join(dir, "scripts/functions-readback.mjs")).href);
  pin = (await import(/* @vite-ignore */ pathToFileURL(join(dir, "scripts/functions-deploy.mjs")).href)).SUPABASE_CLI_VERSION;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const files = (entries: Record<string, string>) => new Map(Object.entries(entries).map(([p, t]) => [p, Buffer.from(t, "utf8")]));
const both = () => files({ [INDEX]: "import { handle } from './handler.ts';\n", [HANDLER]: "export function handle() {}\n" });
const statuses = (r: Result) => r.rows.map((row) => [row.status, row.path]);

describe("compareReadback", () => {
  it("all equal: every file equal, exit-0 verdict, one line per file with both hashes", () => {
    const r = mod.compareReadback({ committed: both(), deployed: both() });
    expect(r).toMatchObject({ ok: true, equal: 2, differences: 0 });
    expect(statuses(r)).toEqual([["equal", HANDLER], ["equal", INDEX]]);
    const lines = mod.formatReadback(r);
    const h = mod.sha256(both().get(INDEX)!);
    expect(lines[1]).toBe(`  equal      ${INDEX}  ${both().get(INDEX)!.length} bytes  committed ${h}  deployed ${h}`);
    expect(lines.at(-1)).toBe("readback: 2 files equal");
  });

  it("one byte changed, same length: DIFFERENT, with each side's hash", () => {
    const deployed = both();
    const b = Buffer.from(deployed.get(HANDLER)!);
    b[7] = b[7] ^ 1;
    deployed.set(HANDLER, b);
    expect(b.length).toBe(both().get(HANDLER)!.length);
    const r = mod.compareReadback({ committed: both(), deployed });
    expect(r).toMatchObject({ ok: false, equal: 1, differences: 1 });
    expect(statuses(r)).toEqual([["DIFFERENT", HANDLER], ["equal", INDEX]]);
    const line = mod.formatReadback(r)[0];
    expect(line).toContain(`committed ${b.length} bytes ${mod.sha256(both().get(HANDLER)!)}`);
    expect(line).toContain(`deployed ${b.length} bytes ${mod.sha256(b)}`);
    expect(mod.formatReadback(r).at(-1)).toBe("readback: 1 differences, 1 files equal");
  });

  it("a committed file not deployed: MISSING", () => {
    const deployed = both();
    deployed.delete(HANDLER);
    const r = mod.compareReadback({ committed: both(), deployed });
    expect(r.ok).toBe(false);
    expect(statuses(r)).toEqual([["MISSING", HANDLER], ["equal", INDEX]]);
    expect(mod.formatReadback(r)[0]).toContain("deployed: absent");
  });

  it("a deployed file with no committed counterpart: EXTRA", () => {
    const deployed = both();
    deployed.set("supabase/functions/_shared/http.ts", Buffer.from("export {};\n"));
    const r = mod.compareReadback({ committed: both(), deployed });
    expect(r).toMatchObject({ ok: false, equal: 2, differences: 1 });
    expect(statuses(r)[0]).toEqual(["EXTRA", "supabase/functions/_shared/http.ts"]);
    expect(mod.formatReadback(r)[0]).toContain("committed: absent");
  });

  it("an empty file on either side against a non-empty one: DIFFERENT; empty on both: equal", () => {
    const empty = both();
    empty.set(HANDLER, Buffer.alloc(0));
    expect(statuses(mod.compareReadback({ committed: empty, deployed: both() }))[0]).toEqual(["DIFFERENT", HANDLER]);
    expect(statuses(mod.compareReadback({ committed: both(), deployed: empty }))[0]).toEqual(["DIFFERENT", HANDLER]);
    expect(mod.compareReadback({ committed: empty, deployed: empty })).toMatchObject({ ok: true, equal: 2 });
  });

  it('a path with "..", or an absolute one, is REFUSED on either side, even when the bytes are equal', () => {
    for (const bad of ["supabase/functions/place-order/../../../etc/x.ts", "/etc/passwd"]) {
      const deployed = both();
      const committed = both();
      deployed.set(bad, Buffer.from("x"));
      const r = mod.compareReadback({ committed, deployed });
      expect(r.ok).toBe(false);
      expect(r.rows.find((row) => row.path === bad)).toMatchObject({ status: "REFUSED", reason: 'absolute or contains ".."' });
      committed.set(bad, Buffer.from("x"));
      expect(mod.compareReadback({ committed, deployed }).rows.find((row) => row.path === bad)?.status).toBe("REFUSED");
    }
    expect(mod.unsafePath(INDEX)).toBe(false);
    expect(mod.unsafePath("")).toBe(true);
  });

  it("the CLI's update-check cache is the one allowed extra: listed, never compared, never required", () => {
    expect(Object.keys(mod.ALLOWED_EXTRAS)).toEqual([CACHE]);
    const deployed = both();
    deployed.set(CACHE, Buffer.from("v0.0.0"));
    const r = mod.compareReadback({ committed: both(), deployed });
    expect(r).toMatchObject({ ok: true, equal: 2, differences: 0 });
    expect(statuses(r)[0]).toEqual(["allowed", CACHE]);
    expect(mod.formatReadback(r)[0]).toContain("not compared: the Supabase CLI's update-check cache");
    expect(mod.compareReadback({ committed: both(), deployed: both() }).ok).toBe(true);
    // The allowance is by exact path: the same name anywhere else is EXTRA.
    const elsewhere = both();
    elsewhere.set("supabase/functions/place-order/cli-latest", Buffer.from("v0.0.0"));
    expect(mod.compareReadback({ committed: both(), deployed: elsewhere }).ok).toBe(false);
  });

  it("an extracted path absent from the work directory is ESCAPED, a non-regular entry REFUSED", () => {
    const gone = "supabase/functions/place-order/gone.ts";
    const r = mod.compareReadback({ committed: both(), deployed: both(), extracted: [INDEX, gone] });
    expect(r.ok).toBe(false);
    expect(r.rows.find((row) => row.path === gone)?.status).toBe("ESCAPED");
    const link = "supabase/functions/place-order/link.ts";
    const s = mod.compareReadback({ committed: both(), deployed: both(), irregular: [link] });
    expect(s.rows.find((row) => row.path === link)).toMatchObject({ status: "REFUSED", reason: "not a regular file" });
  });

  it("nothing on either side is not a pass", () => {
    const r = mod.compareReadback({ committed: new Map(), deployed: new Map() });
    expect(r.ok).toBe(false);
    expect(mod.formatReadback(r).at(-1)).toBe("readback: no files to compare");
  });

  it("reads the extracted paths from the CLI's own output", () => {
    const log = `Downloading Function: place-order\nExtracting file: ${INDEX}\nExtracting file: ${HANDLER}\nDownloaded Function place-order from project x.\n`;
    expect(mod.extractedPaths(log)).toEqual([INDEX, HANDLER]);
  });
});

describe("insideTree", () => {
  it("is the top itself and anything under it, not a sibling or a parent", () => {
    expect(mod.insideTree("/a/repo", "/a/repo")).toBe(true);
    expect(mod.insideTree("/a/repo/supabase/functions", "/a/repo")).toBe(true);
    expect(mod.insideTree("/a/repo-other", "/a/repo")).toBe(false);
    expect(mod.insideTree("/a", "/a/repo")).toBe(false);
    expect(mod.insideTree("/a/repo/..data", "/a/repo")).toBe(true);
  });
});

describe("the filled script against a stub npx", () => {
  let repo: string;
  let bin: string;
  let stub: string;

  const git = (...args: string[]) => execFileSync("git", ["-C", repo, "-c", "user.email=a@example.com", "-c", "user.name=a", ...args], { encoding: "utf8" });

  beforeEach(() => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), "functions-readback-repo-")));
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "functions-readback-stub-")));
    bin = join(outside, "bin");
    stub = join(outside, "stub");
    mkdirSync(bin);
    mkdirSync(join(stub, "deployed"), { recursive: true });
    // Records its arguments, working directory and credential, then "downloads" the stub's tree.
    writeFileSync(
      join(bin, "npx"),
      `#!/bin/sh
printf '%s\\n' "$@" > "${stub}/argv"
pwd -P > "${stub}/cwd"
printf '%s' "\${SUPABASE_ACCESS_TOKEN:-}" > "${stub}/token"
[ -f "${stub}/log" ] && cat "${stub}/log"
[ -f "${stub}/exit" ] && exit "$(cat "${stub}/exit")"
while [ $# -gt 0 ]; do
  if [ "$1" = "--workdir" ]; then work="$2"; fi
  shift
done
cp -R "${stub}/deployed/." "$work/"
`,
    );
    chmodSync(join(bin, "npx"), 0o755);

    writeScripts(repo);
    for (const [p, b] of both()) {
      mkdirSync(join(repo, p, ".."), { recursive: true });
      writeFileSync(join(repo, p), b);
      mkdirSync(join(stub, "deployed", p, ".."), { recursive: true });
      writeFileSync(join(stub, "deployed", p), b);
    }
    git("init", "-q");
    git("add", ".");
    git("commit", "-q", "-m", "x");
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(join(bin, ".."), { recursive: true, force: true });
  });

  const run = (args: string[], env: Record<string, string> = {}) => {
    const r = spawnSync(process.execPath, ["scripts/functions-readback.mjs", ...args], {
      cwd: repo,
      encoding: "utf8",
      env: { PATH: `${bin}:${process.env.PATH ?? ""}`, HOME: repo, SUPABASE_PROJECT_REF: REF, SUPABASE_ACCESS_TOKEN: TOKEN, ...env },
    });
    return { status: r.status, out: r.stdout };
  };
  const ran = () => existsSync(join(stub, "argv"));

  it("exits 0 on equal bytes, through exactly the pinned npx form", () => {
    const r = run(["place-order", "HEAD"]);
    expect(r).toMatchObject({ status: 0 });
    expect(r.out).toContain("readback: 2 files equal");
    const argv = readFileSync(join(stub, "argv"), "utf8").trim().split("\n");
    const work = argv.at(-1)!;
    expect(argv).toEqual(["--yes", `supabase@${pin}`, "functions", "download", "place-order", "--use-api", "--project-ref", REF, "--workdir", work]);
  });

  it("runs the CLI from a fresh temporary directory outside the repo, and cleans it up", () => {
    run(["place-order", "HEAD"]);
    const cwd = readFileSync(join(stub, "cwd"), "utf8").trim();
    expect(mod.insideTree(cwd, repo)).toBe(false);
    expect(cwd.endsWith("/work")).toBe(true);
    expect(existsSync(cwd)).toBe(false);
    expect(git("status", "--porcelain")).toBe("");
  });

  it("passes the environment's token to the CLI and prints none of it", () => {
    writeFileSync(join(stub, "log"), `using ${TOKEN}\n`);
    const r = run(["place-order", "HEAD"]);
    expect(readFileSync(join(stub, "token"), "utf8")).toBe(TOKEN);
    expect(r.out).not.toContain(TOKEN);
  });

  it("exits 1 on a changed byte", () => {
    writeFileSync(join(stub, "deployed", HANDLER), "export function handlf() {}\n");
    const r = run(["place-order", "HEAD"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("DIFFERENT");
  });

  it("exits 1 on a missing file, an extra file and a symlink, and 0 with only the CLI's cache beside the source", () => {
    rmSync(join(stub, "deployed", HANDLER));
    expect(run(["place-order", "HEAD"]).out).toContain("MISSING");
    writeFileSync(join(stub, "deployed", HANDLER), both().get(HANDLER)!);

    writeFileSync(join(stub, "deployed/supabase/functions/place-order/extra.ts"), "x");
    expect(run(["place-order", "HEAD"])).toMatchObject({ status: 1 });
    rmSync(join(stub, "deployed/supabase/functions/place-order/extra.ts"));

    symlinkSync("/etc/hosts", join(stub, "deployed/supabase/functions/place-order/link.ts"));
    const link = run(["place-order", "HEAD"]);
    expect(link.status).toBe(1);
    expect(link.out).toContain("REFUSED");
    rmSync(join(stub, "deployed/supabase/functions/place-order/link.ts"));

    mkdirSync(join(stub, "deployed/supabase/.temp"));
    writeFileSync(join(stub, "deployed", CACHE), "v0.0.0");
    const cached = run(["place-order", "HEAD"]);
    expect(cached.status).toBe(0);
    expect(cached.out).toContain("allowed");
  });

  it("reports ESCAPED for a path the CLI says it extracted that is not in the work directory", () => {
    writeFileSync(join(stub, "log"), "Extracting file: supabase/functions/place-order/gone.ts\n");
    const r = run(["place-order", "HEAD"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("ESCAPED");
  });

  it("exits 2 when the CLI fails, and masks what it said", () => {
    writeFileSync(join(stub, "log"), `failed with ${TOKEN}\n`);
    writeFileSync(join(stub, "exit"), "7");
    const r = run(["place-order", "HEAD"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("download failed");
    expect(r.out).not.toContain(TOKEN);
  });

  it("refuses the repository's top level as its work directory, before any download", () => {
    const r = run(["place-order", "HEAD"], { READBACK_TEST_WORKDIR: repo });
    expect(r.status).toBe(2);
    expect(r.out).toContain("is inside the repository");
    expect(r.out).toContain("nothing downloaded");
    expect(ran()).toBe(false);
  });

  it("refuses a path inside the repository as its work directory", () => {
    const r = run(["place-order", "HEAD"], { READBACK_TEST_WORKDIR: join(repo, "supabase") });
    expect(r.status).toBe(2);
    expect(r.out).toContain("is inside the repository");
    expect(ran()).toBe(false);
  });

  it("the test variable never leads to a download, even at a path outside the repository", () => {
    const r = run(["place-order", "HEAD"], { [mod.TEST_WORKDIR_VAR]: join(bin, "..") });
    expect(r.status).toBe(2);
    expect(r.out).toContain("accepted only to show the guard refusing");
    expect(ran()).toBe(false);
  });

  it("refuses an unset or malformed ref before any download", () => {
    for (const ref of ["", "ABCDEFGHIJKLMNOPQRST", "abcdefghijklmnopqrs"]) {
      const r = run(["place-order", "HEAD"], { SUPABASE_PROJECT_REF: ref });
      expect(r.status).toBe(2);
      expect(r.out).toContain("does not look like a project ref");
    }
    expect(ran()).toBe(false);
  });

  it("refuses a slug that is not a function at the commit, a commit git does not resolve, and bad arguments", () => {
    expect(run(["_shared", "HEAD"])).toMatchObject({ status: 2 });
    expect(run(["_shared", "HEAD"]).out).toContain("not a function at");
    expect(run(["place-order", "no-such-commit-zz"]).out).toContain("not a commit: no-such-commit-zz");
    expect(run(["place-order"]).out).toContain("usage:");
    expect(run(["--help", "HEAD"]).out).toContain("usage:");
    expect(ran()).toBe(false);
  });
});

describe("the template", () => {
  it("carries the provenance line, imports the pin, and never calls a bare CLI or reads the token", () => {
    const s = filled("functions-readback.mjs.tmpl");
    expect(s.startsWith("// Seeded from dev-tools @ abc1234; this file is now the project's own,\n")).toBe(true);
    expect(s).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(s).toContain('import { SUPABASE_CLI_VERSION, maskSecrets } from "./functions-deploy.mjs";');
    expect(s).not.toMatch(/SUPABASE_CLI_VERSION = /);
    expect(s).not.toMatch(/spawnSync\("supabase"/);
    expect(s).not.toContain("SUPABASE_ACCESS_TOKEN");
  });
});

describe("the CI pin test template", () => {
  // The template, filled, run by vitest from a throwaway root holding the filled deploy script.
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  let target: string;
  beforeEach(() => {
    target = mkdtempSync(join(tmpdir(), "cli-pin-"));
    writeScripts(target);
    mkdirSync(join(target, ".github/workflows"), { recursive: true });
    mkdirSync(join(target, "test"));
    writeFileSync(join(target, "test/cli-pin.test.ts"), filled("cli-pin.test.ts.tmpl").replaceAll("{{CLI_PIN_WORKFLOW}}", ".github/workflows/functions.yml"));
    symlinkSync(join(root, "node_modules"), join(target, "node_modules"));
  });
  afterEach(() => rmSync(target, { recursive: true, force: true }));

  const workflow = (version: string) =>
    writeFileSync(join(target, ".github/workflows/functions.yml"), `jobs:\n  a:\n    steps:\n      - uses: supabase/setup-cli@v1\n        with:\n          version: ${version}\n`);
  const vitest = () => spawnSync(process.execPath, [join(root, "node_modules/vitest/vitest.mjs"), "run", "--root", target], { cwd: target, encoding: "utf8" }).status;

  it("passes when the workflow's version equals the constant, quoted or not", () => {
    workflow(pin);
    expect(vitest()).toBe(0);
    workflow(`"${pin}"`);
    expect(vitest()).toBe(0);
  });

  it("fails when the workflow's version differs", () => {
    workflow("0.0.1");
    expect(vitest()).toBe(1);
  });

  it("keeps the provenance line and names its one placeholder", () => {
    const s = filled("cli-pin.test.ts.tmpl");
    expect(s.startsWith("// Seeded from dev-tools @ abc1234; this file is now the project's own,\n")).toBe(true);
    expect(s).toContain('const WORKFLOW = "{{CLI_PIN_WORKFLOW}}";');
    expect(s).not.toContain("{{DEV_TOOLS_SHA}}");
  });
});
