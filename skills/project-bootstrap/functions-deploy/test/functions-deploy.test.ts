// The deploy template, filled, driven through main() on fakes: no network, no
// real CLI, no terminal. One case runs the filled script for real, with no
// terminal, to show the guard that stops a session's Bash.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { filled, writeScripts } from "./fill";

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const REF = "abcdefghijklmnopqrst";
// Built in two parts so a secret scan does not read the fake as a real token.
const TOKEN = "sb" + "p_0123456789abcdef0123456789abcdef01234567";
// Not token-shaped, so only keeping it out of the child can keep it out of the output.
const PARENT_SENTINEL = "parent-environment-sentinel-value";

type Call = { cmd: string; args: string[]; env: NodeJS.ProcessEnv; logPath: string };
type Over = Partial<{
  env: NodeJS.ProcessEnv;
  porcelain: string;
  head: string;
  isFile: boolean;
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  token: string;
  deployStatus: number;
  readbackStatus: number;
}>;

let dir: string;
let mod: {
  main: (argv: string[], io: unknown) => Promise<number>;
  SUPABASE_CLI_VERSION: string;
  DEPLOY_FLAGS: readonly string[];
  TOKEN_ENV: string;
  maskSecrets: (text: string) => string;
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "functions-deploy-test-"));
  writeScripts(dir);
  mod = await import(/* @vite-ignore */ pathToFileURL(join(dir, "scripts/functions-deploy.mjs")).href);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function harness(over: Over = {}) {
  const lines: string[] = [];
  const calls: Call[] = [];
  let asked = 0;
  const logs = new Map<string, string>();
  const io = {
    out: (l: string) => lines.push(l),
    env: { SUPABASE_PROJECT_REF: REF, PATH: "/bin", ...(over.env ?? {}) } as NodeJS.ProcessEnv,
    stdinIsTTY: over.stdinIsTTY ?? true,
    stdoutIsTTY: over.stdoutIsTTY ?? true,
    git: (args: string[]) => (args[0] === "rev-parse" ? `${over.head ?? HEAD}\n` : (over.porcelain ?? "")),
    isFile: () => over.isFile ?? true,
    askToken: async () => {
      asked += 1;
      lines.push("<token asked>");
      return over.token ?? TOKEN;
    },
    makeLogDir: () => "/scratch/logs",
    run: (cmd: string, args: string[], o: { env: NodeJS.ProcessEnv; logPath: string }) => {
      calls.push({ cmd, args, env: o.env, logPath: o.logPath });
      const isDeploy = cmd === "npx";
      // A CLI that echoes the credential its environment holds, to show the masking.
      logs.set(o.logPath, `running with ${o.env[mod.TOKEN_ENV]}\ndone\n`);
      return { status: isDeploy ? (over.deployStatus ?? 0) : (over.readbackStatus ?? 0) };
    },
    readLog: (p: string) => logs.get(p) ?? "",
  };
  return { io, lines, calls, asked: () => asked };
}

describe("functions:deploy refusals", () => {
  const refused = async (h: ReturnType<typeof harness>, argv: string[], text: RegExp) => {
    expect(await mod.main(argv, h.io)).toBe(2);
    expect(h.lines.join("\n")).toMatch(text);
    expect(h.calls).toEqual([]);
    expect(h.asked()).toBe(0);
  };

  it("needs exactly a slug and a commit, neither starting with a dash", async () => {
    await refused(harness(), ["place-order"], /usage/);
    await refused(harness(), ["place-order", "abc1234", "x"], /usage/);
    await refused(harness(), ["--help", "abc1234"], /usage/);
  });
  it("refuses a slug of the wrong shape, and one with no index.ts", async () => {
    await refused(harness(), ["../x", HEAD], /not a function/);
    await refused(harness(), ["Place_Order", HEAD], /not a function/);
    await refused(harness({ isFile: false }), ["nope", HEAD], /not a function/);
  });
  it("refuses a commit that is not HEAD", async () => {
    await refused(harness(), ["place-order", "deadbee"], /not HEAD/);
    await refused(harness(), ["place-order", "abc"], /not HEAD/);
  });
  it("refuses a dirty tree", async () => {
    await refused(harness({ porcelain: " M src/x.ts\n" }), ["place-order", HEAD], /not clean/);
  });
  it("refuses an unset or malformed project ref", async () => {
    await refused(harness({ env: { SUPABASE_PROJECT_REF: "" } }), ["place-order", HEAD], /project ref/);
    await refused(harness({ env: { SUPABASE_PROJECT_REF: "ABCDEFGHIJKLMNOPQRST" } }), ["place-order", HEAD], /project ref/);
    await refused(harness({ env: { SUPABASE_PROJECT_REF: "abcdefghijklmnopqrs" } }), ["place-order", HEAD], /project ref/);
    await refused(harness({ env: { SUPABASE_PROJECT_REF: "abcdefghijklmnopqrs1" } }), ["place-order", HEAD], /project ref/);
  });
  it("refuses unless stdin and stdout are both terminals", async () => {
    await refused(harness({ stdinIsTTY: false }), ["place-order", HEAD], /terminal/);
    await refused(harness({ stdoutIsTTY: false }), ["place-order", HEAD], /terminal/);
  });
  it("refuses an empty token answer and starts nothing", async () => {
    const h = harness({ token: "  " });
    expect(await mod.main(["place-order", HEAD], h.io)).toBe(2);
    expect(h.lines.join("\n")).toMatch(/no token/);
    expect(h.calls).toEqual([]);
  });
});

describe("functions:deploy run", () => {
  it("runs exactly the pinned npx form, then the read-back, with an argument array", async () => {
    const h = harness();
    expect(await mod.main(["place-order", HEAD.slice(0, 7)], h.io)).toBe(0);
    expect(h.calls.map((c) => [c.cmd, c.args])).toEqual([
      ["npx", ["--yes", `supabase@${mod.SUPABASE_CLI_VERSION}`, "functions", "deploy", "place-order", "--project-ref", REF, "--use-api"]],
      ["node", ["scripts/functions-readback.mjs", "place-order", HEAD]],
    ]);
    expect(mod.DEPLOY_FLAGS).toEqual(["--use-api"]);
    expect(h.lines.join("\n")).toMatch(/deploy exit code: 0/);
    expect(h.lines.join("\n")).toMatch(/readback exit code: 0/);
  });

  it("prints the ref before it asks for the token", async () => {
    const h = harness();
    await mod.main(["place-order", HEAD], h.io);
    const refLine = h.lines.findIndex((l) => l.includes(REF));
    expect(refLine).toBeGreaterThanOrEqual(0);
    expect(refLine).toBeLessThan(h.lines.indexOf("<token asked>"));
  });

  it("keeps a sentinel token in the parent's environment out of every child and every output line", async () => {
    const h = harness({ env: { SUPABASE_ACCESS_TOKEN: PARENT_SENTINEL } });
    expect(await mod.main(["place-order", HEAD], h.io)).toBe(0);
    expect(h.calls).toHaveLength(2);
    for (const c of h.calls) {
      expect(Object.values(c.env)).not.toContain(PARENT_SENTINEL);
      expect(c.args.join(" ")).not.toContain(PARENT_SENTINEL);
    }
    expect(h.lines.join("\n")).not.toContain(PARENT_SENTINEL);
    // The parent's own environment is left as it was.
    expect(h.io.env.SUPABASE_ACCESS_TOKEN).toBe(PARENT_SENTINEL);
  });

  it("hands the typed token to each child's environment and never to its arguments", async () => {
    const h = harness();
    await mod.main(["place-order", HEAD], h.io);
    expect(h.calls).toHaveLength(2);
    for (const c of h.calls) {
      expect(c.env.SUPABASE_ACCESS_TOKEN).toBe(TOKEN);
      expect(c.env.SUPABASE_PROJECT_REF).toBe(REF);
      expect(c.args.join(" ")).not.toContain(TOKEN);
      expect(c.logPath.startsWith("/scratch/logs/")).toBe(true);
    }
  });

  it("prints no line holding the typed token, even when the CLI echoes it", async () => {
    const h = harness();
    await mod.main(["place-order", HEAD], h.io);
    const all = h.lines.join("\n");
    expect(all).not.toContain(TOKEN);
    expect(all).toContain("[masked]");
    expect(all).toMatch(/Edge Functions read and write/);
  });

  it("masks a typed token that is not token-shaped", async () => {
    const plain = "plain-typed-credential";
    const h = harness({ token: plain });
    await mod.main(["place-order", HEAD], h.io);
    expect(h.lines.join("\n")).not.toContain(plain);
  });

  it("masks every token shape", () => {
    for (const t of [TOKEN, "sb_" + "secret_abc-DEF_123", "sb_" + "publishable_abc-DEF_123", "eyJ" + "abc.def-_1.ghi"])
      expect(mod.maskSecrets(`x ${t} y`)).toBe("x [masked] y");
  });

  it("never runs the read-back after a failed deploy, and exits with the CLI's code", async () => {
    const h = harness({ deployStatus: 3 });
    expect(await mod.main(["place-order", HEAD], h.io)).toBe(3);
    expect(h.calls.map((c) => c.cmd)).toEqual(["npx"]);
    expect(h.lines.join("\n")).toMatch(/deploy exit code: 3/);
  });

  it("exits with the read-back's code", async () => {
    const h = harness({ readbackStatus: 1 });
    expect(await mod.main(["place-order", HEAD], h.io)).toBe(1);
    expect(h.calls.map((c) => c.cmd)).toEqual(["npx", "node"]);
  });
});

describe("the template", () => {
  it("carries the provenance line, one pin, and no bare CLI call", () => {
    const s = filled("functions-deploy.mjs.tmpl");
    expect(s.startsWith("// Seeded from dev-tools @ abc1234; this file is now the project's own,\n")).toBe(true);
    expect(s).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(s.match(/^export const SUPABASE_CLI_VERSION = "\d+\.\d+\.\d+";$/gm)).toHaveLength(1);
    expect(s).not.toMatch(/(run|spawnSync|execFileSync)\("supabase"/);
  });

  it("reads SUPABASE_ACCESS_TOKEN from its environment nowhere: only to strip it", () => {
    const s = filled("functions-deploy.mjs.tmpl");
    expect(s).not.toMatch(/env\.SUPABASE_ACCESS_TOKEN|env\[TOKEN_ENV\]|env\["SUPABASE_ACCESS_TOKEN"\]/);
    expect(s).toContain("const { [TOKEN_ENV]: _ignored, ...rest } = io.env;");
  });
});

describe("the filled script, run with no terminal", () => {
  it("refuses with exit 2 and runs nothing, past every other guard", () => {
    const repo = mkdtempSync(join(tmpdir(), "functions-deploy-repo-"));
    try {
      writeScripts(repo);
      mkdirSync(join(repo, "supabase/functions/place-order"), { recursive: true });
      writeFileSync(join(repo, "supabase/functions/place-order/index.ts"), "export {};\n");
      const git = (...args: string[]) => execFileSync("git", ["-C", repo, "-c", "user.email=a@example.com", "-c", "user.name=a", ...args], { encoding: "utf8" });
      git("init", "-q");
      git("add", ".");
      git("commit", "-q", "-m", "x");
      const head = git("rev-parse", "HEAD").trim();

      // A stub npx that would leave a mark if the script ever reached it.
      const bin = join(repo, "..", `stub-bin-${head.slice(0, 7)}`);
      mkdirSync(bin);
      const mark = join(bin, "reached");
      writeFileSync(join(bin, "npx"), `#!/bin/sh\ntouch "${mark}"\n`);
      chmodSync(join(bin, "npx"), 0o755);
      try {
        const r = spawnSync(process.execPath, ["scripts/functions-deploy.mjs", "place-order", head], {
          cwd: repo,
          encoding: "utf8",
          env: { PATH: `${bin}:${process.env.PATH ?? ""}`, HOME: repo, SUPABASE_PROJECT_REF: REF, SUPABASE_ACCESS_TOKEN: PARENT_SENTINEL },
        });
        expect(r.status).toBe(2);
        expect(r.stdout).toContain("stdin and stdout must both be a terminal");
        expect(r.stdout).not.toContain(PARENT_SENTINEL);
        expect(existsSync(mark)).toBe(false);
      } finally {
        rmSync(bin, { recursive: true, force: true });
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
