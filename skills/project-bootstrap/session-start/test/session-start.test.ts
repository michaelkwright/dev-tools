// The session-start template (templates/session-start.sh.tmpl), filled as the
// bootstrap fills it and run with sh in a throwaway git clone. Exit status and
// stderr lines are the verdict; the token's value must never be printed.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const TMPL = readFileSync(fileURLToPath(new URL("../../templates/session-start.sh.tmpl", import.meta.url)), "utf8");
const BLOCKS = ["supabase-cli", "push-guard", "scheduled-ci"];
const TOKEN = "stub-token-value-never-printed";
// A local YYYY-MM-DD some days from the clock at test time (the script reads
// `date +%Y-%m-%d`, local too). A literal day offset at every call site, never
// a literal date, so no fixture expires.
const dateDaysAhead = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const CLEAR = { SUPABASE_ACCESS_TOKEN: TOKEN, SUPABASE_TOKEN_EXPIRES: dateDaysAhead(60) };

// Strip TEMPLATE NOTES (through the blank line after them), keep or strip each
// block, delete kept blocks' marker lines, fill the placeholders.
const fill = (keep: string[], ciCmd = "echo scheduled-run-listed") => {
  let s = TMPL.replace(/^(#!\/bin\/sh\n)# TEMPLATE NOTES[^]*?\n\n/, "$1");
  for (const b of BLOCKS)
    s = keep.includes(b)
      ? s.replace(new RegExp(`^# (BEGIN|END):${b}\\n`, "gm"), "")
      : s.replace(new RegExp(`^# BEGIN:${b}\\n[^]*?^# END:${b}\\n`, "m"), "");
  return s.replaceAll("{{DEV_TOOLS_SHA}}", "abc1234").replaceAll("{{PROJECT_SLUG}}", "order-desk").replaceAll("{{SCHEDULED_CI_CMD}}", ciCmd);
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "session-start-"));
  execFileSync("git", ["init", "-q", dir]);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run = (script: string, env: Record<string, string> = {}, hooksPath: string | null = ".githooks") => {
  if (hooksPath) execFileSync("git", ["-C", dir, "config", "core.hooksPath", hooksPath]);
  writeFileSync(join(dir, "session-start.sh"), script);
  const base = { PATH: process.env.PATH ?? "", HOME: dir, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const r = spawnSync("sh", ["session-start.sh"], { cwd: dir, env: { ...base, ...env }, encoding: "utf8" });
  expect(r.stdout + r.stderr).not.toContain(TOKEN);
  return { status: r.status, out: r.stdout, err: r.stderr.split("\n").filter(Boolean) };
};

describe("session-start check", () => {
  it("the filled script has no placeholder, marker or notes left, and parses", () => {
    const s = fill(BLOCKS);
    expect(s).not.toMatch(/\{\{|^# (BEGIN|END):|TEMPLATE NOTES/m);
    expect(s.startsWith("#!/bin/sh\n# Session-start check.")).toBe(true);
    writeFileSync(join(dir, "s.sh"), s);
    expect(spawnSync("sh", ["-n", join(dir, "s.sh")]).status).toBe(0);
  });

  it("passes with the token and a clear expiry date set and the guard on, and prints the scheduled runs", () => {
    const r = run(fill(BLOCKS), CLEAR);
    expect(r).toMatchObject({ status: 0, err: [] });
    expect(r.out).toContain("scheduled-run-listed");
  });

  it("fails with one plain line naming the hook and the token file when the token is unset or empty", () => {
    for (const env of [{ SUPABASE_TOKEN_EXPIRES: CLEAR.SUPABASE_TOKEN_EXPIRES }, { ...CLEAR, SUPABASE_ACCESS_TOKEN: "" }]) {
      const r = run(fill(BLOCKS), env);
      expect(r.status).toBe(1);
      expect(r.err).toEqual([
        expect.stringMatching(/^session-start: SUPABASE_ACCESS_TOKEN is not set: the SessionStart hook in \.claude\/settings\.json did not load it; check that ~\/\.config\/order-desk\/supabase-token exists and is readable/),
      ]);
    }
  });

  it("fails with one line saying the expires file is missing when the expiry variable is unset or empty", () => {
    for (const env of [{ SUPABASE_ACCESS_TOKEN: TOKEN }, { ...CLEAR, SUPABASE_TOKEN_EXPIRES: "" }]) {
      const r = run(fill(BLOCKS), env);
      expect(r.status).toBe(1);
      expect(r.err).toEqual([expect.stringMatching(/^session-start: SUPABASE_TOKEN_EXPIRES is not set: ~\/\.config\/order-desk\/supabase-token-expires is missing/)]);
    }
  });

  it("fails when the expiry value is not YYYY-MM-DD, without printing the value", () => {
    for (const value of ["next-month", "1-2-3", "20991231", " ", `${CLEAR.SUPABASE_TOKEN_EXPIRES}x`]) {
      const r = run(fill(BLOCKS), { ...CLEAR, SUPABASE_TOKEN_EXPIRES: value });
      expect(r.status).toBe(1);
      expect(r.err).toEqual([expect.stringMatching(/^session-start: SUPABASE_TOKEN_EXPIRES is not a YYYY-MM-DD date; fix ~\/\.config\/order-desk\/supabase-token-expires/)]);
      if (value.trim()) expect(r.err[0]).not.toContain(value);
    }
  });

  it("fails when the expiry date is before today, without printing the date", () => {
    for (const days of [-1, -30, -400]) {
      const date = dateDaysAhead(days);
      const r = run(fill(BLOCKS), { ...CLEAR, SUPABASE_TOKEN_EXPIRES: date });
      expect(r.status).toBe(1);
      expect(r.err).toEqual([expect.stringMatching(/^session-start: the Supabase token has expired \(per ~\/\.config\/order-desk\/supabase-token-expires\)/)]);
      expect(r.err[0]).not.toContain(date);
    }
  });

  it("warns on stderr without failing when the expiry date is within 14 days, today and the 14th day included", () => {
    for (const days of [0, 1, 7, 14]) {
      const date = dateDaysAhead(days);
      const r = run(fill(BLOCKS), { ...CLEAR, SUPABASE_TOKEN_EXPIRES: date });
      expect(r.status).toBe(0);
      expect(r.err).toEqual([`session-start: warning: the Supabase token expires on ${date} (${days} days left); create a new token with the same scope before then and replace the token file and the expires file`]);
      expect(r.out).toContain("scheduled-run-listed");
    }
  });

  it("is silent when the expiry date is more than 14 days away", () => {
    for (const days of [15, 30, 365, 1500]) {
      const r = run(fill(BLOCKS), { ...CLEAR, SUPABASE_TOKEN_EXPIRES: dateDaysAhead(days) });
      expect(r).toMatchObject({ status: 0, err: [] });
    }
  });

  it("fails when core.hooksPath does not name .githooks", () => {
    for (const hooksPath of [null, ".husky"]) {
      const r = run(fill(BLOCKS), CLEAR, hooksPath);
      expect(r.status).toBe(1);
      expect(r.err).toEqual([expect.stringMatching(/^session-start: git config core.hooksPath does not print \.githooks/)]);
    }
  });

  it("fails when the scheduled-CI command fails", () => {
    const r = run(fill(BLOCKS, "false"), CLEAR);
    expect(r.status).toBe(1);
    expect(r.err).toEqual([expect.stringMatching(/^session-start: could not list the latest scheduled CI runs/)]);
  });

  it("reports every failure, each on its own line", () => {
    const r = run(fill(BLOCKS, "false"), {}, null);
    expect(r.status).toBe(1);
    expect(r.err).toHaveLength(4);
  });

  it("a stripped block checks nothing", () => {
    expect(run(fill(["push-guard"])).status).toBe(0);
    expect(run(fill([]), {}, null)).toMatchObject({ status: 0, err: [], out: "" });
  });
});

// dev-tools' own scripts/session-start.sh, run from the root of a throwaway
// repository it was copied into, as `sh scripts/session-start.sh`.
describe("dev-tools' own session-start script", () => {
  const OWN = fileURLToPath(new URL("../../../../scripts/session-start.sh", import.meta.url));
  const runOwn = (hooksPath: string | null) => {
    mkdirSync(join(dir, "scripts"));
    copyFileSync(OWN, join(dir, "scripts", "session-start.sh"));
    chmodSync(join(dir, "scripts", "session-start.sh"), 0o755);
    if (hooksPath) execFileSync("git", ["-C", dir, "config", "core.hooksPath", hooksPath]);
    const env = { PATH: process.env.PATH ?? "", HOME: dir, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
    const r = spawnSync("sh", ["scripts/session-start.sh"], { cwd: dir, env, encoding: "utf8" });
    return { status: r.status, out: r.stdout, err: r.stderr.split("\n").filter(Boolean) };
  };

  it("exits 1 with one stderr line when core.hooksPath is unset", () => {
    const r = runOwn(null);
    expect(r.status).toBe(1);
    expect(r.err).toEqual([expect.stringMatching(/^session-start: git config core\.hooksPath does not print \.githooks/)]);
  });

  it("exits 0 and prints nothing when core.hooksPath is .githooks", () => {
    expect(runOwn(".githooks")).toMatchObject({ status: 0, err: [], out: "" });
  });
});
