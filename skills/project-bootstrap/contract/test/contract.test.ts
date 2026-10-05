// Contract test for this skill's own text: the permission rules SKILL.md has
// the bootstrap write, the .gitignore line, the provenance wording, the push
// guard's harness, and the auto-mode lines in the templates. Agent proofs
// cover only judgment calls and Claude Code's permission engine (CLAUDE.md,
// Proofs); everything a script can decide is decided here.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SKILL_DIR = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(`${SKILL_DIR}${rel}`, "utf8");
const skill = () => read("SKILL.md");

const PUSH_DENIES = [
  "Bash(git push*--force*)", "Bash(git push* -f*)", "Bash(git push* +*)",
  "Bash(git push*--de*)", "Bash(git push* -d*)", "Bash(git push* :**)",
  "Bash(git push*--m*)", "Bash(git push*--pru*)",
  "Bash(git*--no-veri*)", "Bash(git*-c*core.hooksPath*)", "Bash(git*-c*core.hookspath*)",
];
const DB_PUSH_DENIES = ["Bash(supabase db push:*)", "Bash(npx supabase db push:*)"];
const MIGRATION_DENY = ["mcp__supabase-<slug>-rw__apply_migration"];
const CONNECTOR_ASKS = ["mcp__supabase-<slug>-rw__execute_sql", "mcp__supabase-<slug>-rw__deploy_edge_function"];
const PUSH_ASKS = ["Bash(git push)", "Bash(git push *)"];

// Each permission-engine probe's last proof and the exact rule strings it
// proved. When SKILL.md's strings stop matching these, the probe is due:
// rerun it, then update its record here in the same commit.
const PROBES = [
  {
    probe: "push denies and push guard",
    lastProof: "round 5, commit 'project-bootstrap: Supabase follow-up questions wait for the project; proof fixes'",
    deny: PUSH_DENIES,
    ask: [] as string[],
    // Commands the denies stop, as SKILL.md step 5c names them. The last one
    // was seen caught in a later real run, not by the probe.
    covered: [
      "git push --force origin main", "git push -f origin main", "git push --force-with-lease origin main",
      "git push --force-if-includes origin main", "git push origin +main", "git push --delete origin tmp",
      "git push --del origin tmp", "git push -d origin tmp", "git push origin :tmp", "git push --mirror origin",
      "git push --mir origin", "git push --prune origin", "git push --pru origin", "git push --no-verify origin main",
      "git push --no-verif origin main", "git push --no-veri origin main", "git commit --no-verify -m x",
      "git -c core.hooksPath=/dev/null push origin main", "git -c core.hookspath=/dev/null push origin main",
      "git --config-env=core.hooksPath=HOOKS push origin main",
    ],
  },
  {
    probe: "writable-connector asks, apply_migration deny and push asks (stub server)",
    lastProof: "close-out round, commit 'project-bootstrap: auto-mode setup, settings ratchet, proof policy'",
    deny: MIGRATION_DENY,
    ask: [...CONNECTOR_ASKS, ...PUSH_ASKS],
    covered: ["git push", "git push origin main"],
  },
];

// Every ```json block in SKILL.md, parsed.
function jsonBlocks(): { permissions: { deny?: string[]; ask?: string[] } }[] {
  return [...skill().matchAll(/```json\n([^]*?)\n```/g)].map((m) => JSON.parse(m[1]));
}
const blockWith = (kind: "deny" | "ask", rule: string) =>
  jsonBlocks().filter((b) => b.permissions[kind]?.includes(rule));

// A model of a Bash rule's wildcard: `*` matches any text, spaces included.
// It checks the strings against the forms they are meant to cover; whether
// Claude Code's own engine agrees is what the probe proves.
const bashRule = (rule: string) => {
  const body = rule.match(/^Bash\((.*)\)$/)?.[1] ?? "";
  const pattern = body.endsWith(":*") && !body.endsWith("::*") ? `${body.slice(0, -2)}*` : body;
  return new RegExp(`^${pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
};
const matchesAny = (rules: string[], cmd: string) => rules.some((r) => bashRule(r).test(cmd));

describe("permission rules SKILL.md writes", () => {
  it("the push and guard denies are exactly these strings, in one block", () => {
    const blocks = blockWith("deny", PUSH_DENIES[0]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].permissions.deny).toEqual(PUSH_DENIES);
  });

  it("the supabase db push denies are exactly these strings", () => {
    expect(blockWith("deny", DB_PUSH_DENIES[0])[0]?.permissions.deny).toEqual(DB_PUSH_DENIES);
  });

  it("the apply_migration deny is keyed to the writable connector's name", () => {
    expect(blockWith("deny", MIGRATION_DENY[0])[0]?.permissions.deny).toEqual(MIGRATION_DENY);
  });

  it("the writable connector's execute_sql and deploy_edge_function are ask rules keyed the same way", () => {
    expect(blockWith("ask", CONNECTOR_ASKS[0])[0]?.permissions.ask).toEqual(CONNECTOR_ASKS);
  });

  it("the push asks cover both forms, bare and with arguments", () => {
    expect(blockWith("ask", PUSH_ASKS[0])[0]?.permissions.ask).toEqual(PUSH_ASKS);
    expect(matchesAny(PUSH_ASKS, "git push")).toBe(true);
    expect(matchesAny(PUSH_ASKS, "git push origin main")).toBe(true);
  });

  it("the step-3 push question is asked in plain words", () => {
    expect(skill()).toContain('"Does pushing to your main branch publish or deploy your app?');
  });

  it("every rule step 5c writes is listed in the settings ratchet", () => {
    expect(skill()).toMatch(/\*\*List every deny and ask rule this step writes, and only those, in the contract test's `CONFIG\.settingsRules`/);
    const ref = readFileSync(fileURLToPath(new URL("../../../doc-system/reference/doc-contracts.test.ts", import.meta.url)), "utf8");
    expect(ref).toContain("settingsRules: {");
    expect(ref).toContain('describe("settings ratchet"');
  });

  it("plain pushes pass the denies", () => {
    for (const cmd of ["git push", "git push origin main", "git push -u origin feature", "git config core.hooksPath .githooks"])
      expect(matchesAny(PUSH_DENIES, cmd), cmd).toBe(false);
  });
});

describe("probe records", () => {
  it.each(PROBES)("$probe: SKILL.md's rule strings match the last proof's", ({ deny, ask }) => {
    for (const rule of deny) expect(blockWith("deny", rule), `deny ${rule}`).toHaveLength(1);
    for (const rule of ask) expect(blockWith("ask", rule), `ask ${rule}`).toHaveLength(1);
  });

  it.each(PROBES)("$probe: every covered Bash form matches a recorded rule", ({ deny, ask, covered }) => {
    const bash = [...deny, ...ask].filter((r) => r.startsWith("Bash("));
    for (const cmd of covered) expect(matchesAny(bash, cmd), cmd).toBe(true);
  });
});

describe("files the bootstrap writes", () => {
  it(".gitignore gets .claude/settings.local.json", () => {
    expect(skill()).toContain("**List `.claude/settings.local.json` in the repo's own `.gitignore`, even when this machine already ignores it.**");
    expect(skill()).toContain("It holds the step-5d line and `.claude/settings.local.json`");
  });

  it("every seeded file carries the provenance wording", () => {
    expect(read("templates/CLAUDE.md.tmpl")).toContain(
      "Seeded from dev-tools @ {{DEV_TOOLS_SHA}} — this file is now the project's own; edit freely. A later port of dev-tools changes updates this line to the commit ported from.",
    );
    expect(read("templates/claude-ai-project-instructions.md.tmpl")).toContain(
      "Seeded from dev-tools @ {{DEV_TOOLS_SHA}} — these instructions are now the project's own; edit freely.",
    );
    expect(read("templates/pre-push.tmpl")).toContain(
      "# Push guard. Seeded from dev-tools @ {{DEV_TOOLS_SHA}}; this file is now the\n# project's own, and a later port of dev-tools changes updates that commit to\n# the one ported from.",
    );
    expect(readFileSync(fileURLToPath(new URL("../../../doc-system/reference/doc-contracts.test.ts", import.meta.url)), "utf8")).toContain(
      "// Seeded from dev-tools @ {{DEV_TOOLS_SHA}}; this file is now the project's own.",
    );
  });

  it("the hook template exists and the hook harness runs it", () => {
    expect(existsSync(`${SKILL_DIR}templates/pre-push.tmpl`)).toBe(true);
    expect(read("hook/test/pre-push.test.ts")).toContain('new URL("../../templates/pre-push.tmpl", import.meta.url)');
    expect(skill()).toContain("`templates/pre-push.tmpl`, filled, as `.githooks/pre-push`");
  });
});

describe("auto-mode lines in the templates", () => {
  it("CLAUDE.md template: the Running in auto mode section and its blocks", () => {
    const t = read("templates/CLAUDE.md.tmpl");
    for (const line of [
      "## Running in auto mode",
      "deny rules block in every mode, and its ask rules force a prompt in every mode, auto included",
      "**Never remove or loosen a rule in `.claude/settings.json`;",
      "<!-- BEGIN:push-deploys -->",
      "<!-- BEGIN:push-safe -->",
      "- The production database is Supabase project `{{SUPABASE_PROJECT_REF}}`",
      "- Schema changes are applied by hand, by the user,",
      "- Throwaway targets are only",
      "**When auto mode blocks an action, stop that line of work and report the block",
    ])
      expect(t, line).toContain(line);
  });

  it("instructions template: the prompt-drafting lines", () => {
    const t = read("templates/claude-ai-project-instructions.md.tmpl");
    for (const line of [
      "**A hard limit lives in a committed deny or ask rule in `.claude/settings.json`, never only in a prompt's prose;",
      "**Each prompt names its throwaway targets (scratch folders, test copies, stub servers) and asks for any auto-mode blocks in its report.**",
      "**A prompt whose work hits an ask rule (a push that deploys, a writable database call) is not unattended:",
      "**Every deletion in a prompt names its exact paths, never a pattern or a variable.**",
    ])
      expect(t, line).toContain(line);
  });
});
