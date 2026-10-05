// The push guard template (templates/pre-push.tmpl), run as git runs it:
// installed with core.hooksPath in a clone, pushing to a bare remote. The
// remote's refs are the verdict. The control pushes without the hook, proving
// each refused push would otherwise have changed the remote.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const HOOK = fileURLToPath(new URL("../../templates/pre-push.tmpl", import.meta.url));
const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

let dir: string;
let work: string;
let remote: string;

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, env: ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const push = (...args: string[]) => spawnSync("git", ["push", ...args], { cwd: work, env: ENV, encoding: "utf8" });
const remoteRefs = () => git(remote, "for-each-ref", "--format=%(refname) %(objectname)");
const commit = (msg: string) => git(work, "commit", "-q", "--allow-empty", "-m", msg);
const install = () => {
  mkdirSync(join(work, ".githooks"), { recursive: true });
  copyFileSync(HOOK, join(work, ".githooks/pre-push"));
  chmodSync(join(work, ".githooks/pre-push"), 0o755);
  git(work, "config", "core.hooksPath", ".githooks");
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "push-guard-"));
  remote = join(dir, "remote.git");
  work = join(dir, "work");
  git(dir, "init", "-q", "--bare", "-b", "main", remote);
  git(dir, "init", "-q", "-b", "main", work);
  git(work, "remote", "add", "origin", remote);
  commit("a");
  git(work, "push", "-q", "origin", "main", "main:tmp");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// Each case leaves the work clone so that `args` would change the remote.
const REFUSED: [string, () => void, string[]][] = [
  ["--force over a rewritten commit", () => git(work, "commit", "-q", "--amend", "--allow-empty", "-m", "b"), ["--force", "origin", "main"]],
  ["a +refspec", () => git(work, "commit", "-q", "--amend", "--allow-empty", "-m", "b"), ["origin", "+main"]],
  ["--delete", () => {}, ["--delete", "origin", "tmp"]],
  ["a :branch refspec", () => {}, ["origin", ":tmp"]],
  ["--prune", () => {}, ["--prune", "origin", "refs/heads/*:refs/heads/*"]],
];

describe("push guard", () => {
  it.each(REFUSED)("control: without the hook, %s changes the remote", (_name, setup, args) => {
    setup();
    const before = remoteRefs();
    expect(push(...args).status).toBe(0);
    expect(remoteRefs()).not.toBe(before);
  });

  it.each(REFUSED)("refuses %s and leaves the remote unchanged", (_name, setup, args) => {
    install();
    setup();
    const before = remoteRefs();
    const r = push(...args);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("pre-push: refusing");
    expect(remoteRefs()).toBe(before);
  });

  it("passes a fast-forward and a new branch", () => {
    install();
    commit("b");
    expect(push("origin", "main").status).toBe(0);
    expect(push("origin", "main:feature").status).toBe(0);
    expect(remoteRefs()).toContain(`refs/heads/feature ${git(work, "rev-parse", "HEAD")}`);
  });

  it("refuses an update over a remote commit this clone lacks, and says fetch first", () => {
    install();
    const other = join(dir, "other");
    git(dir, "clone", "-q", remote, other);
    git(other, "commit", "-q", "--allow-empty", "-m", "elsewhere");
    git(other, "push", "-q", "origin", "main");
    commit("b");
    const before = remoteRefs();
    const r = push("--force", "origin", "main");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("fetch first");
    expect(remoteRefs()).toBe(before);
  });

  it("--no-verify is the escape hatch", () => {
    install();
    git(work, "commit", "-q", "--amend", "--allow-empty", "-m", "b");
    expect(push("--no-verify", "--force", "origin", "main").status).toBe(0);
    expect(remoteRefs()).toContain(`refs/heads/main ${git(work, "rev-parse", "HEAD")}`);
  });

  it("runs a pre-push hook already in the clone's hooks folder, with the same input, after the check", () => {
    const old = join(work, ".git/hooks/pre-push");
    const marker = join(dir, "old-hook-ran");
    writeFileSync(old, `#!/bin/sh\ncat > "${marker}"\n`);
    chmodSync(old, 0o755);
    install();
    commit("b");
    expect(push("origin", "main").status).toBe(0);
    expect(readFileSync(marker, "utf8")).toContain(`refs/heads/main ${git(work, "rev-parse", "HEAD")} refs/heads/main`);

    rmSync(marker);
    git(work, "commit", "-q", "--amend", "--allow-empty", "-m", "c");
    expect(push("--force", "origin", "main").status).not.toBe(0);
    expect(existsSync(marker)).toBe(false);
  });

  // Known limit (SKILL.md, Known limits): git leaves a ref that --mirror
  // deletes out of the hook's input, so the hook cannot refuse it. If this
  // starts failing, git now reports it, and the limit can go.
  it("known gap: a branch --mirror deletes never reaches the hook", () => {
    install();
    const r = push("--mirror", "origin");
    expect(r.status).toBe(0);
    expect(remoteRefs()).not.toContain("refs/heads/tmp ");
  });

  it("SKILL.md's stanza adds the guard to a hook a set core.hooksPath already runs, which still reads its input", () => {
    const skill = readFileSync(fileURLToPath(new URL("../../SKILL.md", import.meta.url)), "utf8");
    const stanza = skill.match(/```sh\n( *# Push guard:[^]*?)\n *```/)?.[1].replace(/^ {2}/gm, "");
    expect(stanza).toBeTruthy();
    const marker = join(dir, "manager-hook-ran");
    mkdirSync(join(work, ".hooks-mgr"));
    writeFileSync(join(work, ".hooks-mgr/pre-push"), `#!/bin/sh\n${stanza}\ncat > "${marker}"\n`);
    chmodSync(join(work, ".hooks-mgr/pre-push"), 0o755);
    install();
    git(work, "config", "core.hooksPath", ".hooks-mgr");
    commit("b");
    expect(push("origin", "main").status).toBe(0);
    expect(readFileSync(marker, "utf8")).toContain(`refs/heads/main ${git(work, "rev-parse", "HEAD")} refs/heads/main`);

    rmSync(marker);
    git(work, "commit", "-q", "--amend", "--allow-empty", "-m", "c");
    const r = push("--force", "origin", "main");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("pre-push: refusing");
    expect(existsSync(marker)).toBe(false);
  });

  it("PUSH_GUARD_ONLY skips the older hook", () => {
    const old = join(work, ".git/hooks/pre-push");
    const marker = join(dir, "old-hook-ran");
    writeFileSync(old, `#!/bin/sh\ntouch "${marker}"\n`);
    chmodSync(old, 0o755);
    install();
    commit("b");
    const r = spawnSync("git", ["push", "origin", "main"], { cwd: work, env: { ...ENV, PUSH_GUARD_ONLY: "1" }, encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(existsSync(marker)).toBe(false);
  });
});
