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
const MIGRATION_ASK = ["mcp__supabase-<slug>-rw__apply_migration"];
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
    // Two stub servers in one child: one keyed as on the dashboard path
    // (apply_migration denied), one as on the Claude path (apply_migration
    // asked), each also allowed server-wide so an ask is seen to beat an allow.
    probe: "writable-connector asks, apply_migration deny and ask, and push asks (stub servers)",
    lastProof: "round 6, commit 'project-bootstrap: existing-files commit, apply_migration ask, auto-mode start'",
    deny: MIGRATION_DENY,
    ask: [...CONNECTOR_ASKS, ...MIGRATION_ASK, ...PUSH_ASKS],
    covered: ["git push", "git push origin main"],
  },
];

// Each cold case's last proof and the strings it exercised, in SKILL.md and
// the instructions template. When one stops matching, the case is due: rerun
// it, then update its record here in the same commit.
const COLD_PROOFS = [
  {
    case: "a new empty repo with a GitHub https origin, no database, just for the user",
    lastProof: "round 7, commit 'project-bootstrap: planning chats read the repo by sparse clone; sync is search only'",
    covered: [
      "owner/repo detected from an https origin ending in .git",
      "repo-clone kept and filled, repo-search stripped, no marker lines or unfilled tokens left",
      "the report's sync line",
    ],
    skill: [
      "git remote get-url origin 2>/dev/null | sed -nE 's#^(https://github\\.com/|git@github\\.com:|ssh://git@github\\.com/)([^/]+/[^/]+)$#\\2#p' | sed 's#\\.git$##'    # GITHUB_REPO",
      "- A GitHub `origin` (step 2): fill it from origin, and keep `repo-clone`.",
      "- Repo reading, only when `repo-clone` was kept: \"Planning chats read the repo by cloning it, so linking the GitHub repo to the Claude.ai Project's knowledge is optional and search-only.\"",
    ],
    template: [
      "- `git clone --depth 1 --filter=blob:none --sparse https://github.com/{{GITHUB_REPO}} <dir>`",
      "<!-- BEGIN:repo-clone -->",
      "<!-- BEGIN:repo-search -->",
    ],
  },
];

// Every ```json block in SKILL.md, parsed, with the paragraph that leads into it.
type Block = { permissions: { deny?: string[]; ask?: string[]; allow?: string[] }; lead: string };
function jsonBlocks(): Block[] {
  return [...skill().matchAll(/([^\n]*)\n\n```json\n([^]*?)\n```/g)].map((m) => ({ ...JSON.parse(m[2]), lead: m[1] }));
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

  it("the apply_migration ask is keyed the same way, in a block of its own", () => {
    expect(blockWith("ask", MIGRATION_ASK[0])[0]?.permissions.ask).toEqual(MIGRATION_ASK);
  });

  it("apply_migration is denied on the dashboard path and asked on the Claude path, never unruled or allowed", () => {
    const [deny] = blockWith("deny", MIGRATION_DENY[0]);
    const [ask] = blockWith("ask", MIGRATION_ASK[0]);
    expect(deny.lead).toMatch(/^With the `migration-deny` block kept \(the project exists, and the user applies schema changes by hand\)/);
    expect(ask.lead).toMatch(/^With the `schema-by-claude` block kept \(the project exists, and the user lets Claude apply schema changes\)/);
    for (const b of jsonBlocks()) expect(JSON.stringify(b.permissions.allow ?? [])).not.toContain("apply_migration");
    expect(skill()).toContain("**With the project existing, write the writable connector's `apply_migration` as a deny on the dashboard path and as an ask on the Claude path; never leave it unruled, and never allow it.**");
    expect(skill()).toContain("yourself, or no answer: the `schema-by-hand` and `migration-deny` blocks and the step-5c `apply_migration` deny; Claude: the `schema-by-claude` block and the step-5c `apply_migration` ask");
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

describe("cold proof records", () => {
  it.each(COLD_PROOFS)("$case: the strings it exercised still match", ({ skill: lines, template }) => {
    for (const line of lines) expect(skill(), line).toContain(line);
    for (const line of template) expect(read("templates/claude-ai-project-instructions.md.tmpl"), line).toContain(line);
  });
});

describe("files the bootstrap writes", () => {
  it(".gitignore keeps secret-bearing files out", () => {
    expect(skill()).toContain("**Every `.gitignore` this bootstrap writes or merges keeps secret-bearing files out: `.env*` with `!.env.example` after it, `*.pem` and `*.key`, each added when missing.**");
    expect(skill()).toContain("`.claude/settings.local.json`, the secret-file lines below,");
  });

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

  it("CLAUDE.md template: the run budget", () => {
    const t = read("templates/CLAUDE.md.tmpl");
    expect(t).toContain("The full suite runs once per session");
    expect(t).toContain("a full run under `{{SECOND_TZ}}`");
    expect(t).toContain("more than eight in a session needs a one-line reason");
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

describe("a folder that is not a repository but holds files", () => {
  const step = () => skill().split("## 5. Write, in this order")[1].split("**a. `CLAUDE.md`**")[0];

  it("writes .gitignore and runs git init before listing, ahead of every other write", () => {
    const s = step();
    expect(s).toContain("before any other write, the ADOPT pre-run included, write the whole `.gitignore` (step 4's lines, the step-5d line among them), run `git init`, and only then list what is there.**");
    expect(s.indexOf("A folder that is not a repository yet")).toBeLessThan(s.indexOf("**ADOPT only"));
  });

  it("asks the two options, commits existing files first, and stages by path", () => {
    const s = step();
    expect(s).toContain('"Commit these existing files as their own first commit (recommended)" or "Leave them uncommitted for now"');
    expect(s).toContain("commit them as `Existing app files before bootstrap`");
    expect(s).toContain("**Never stage with `git add -A`, `git add .` or `git commit -a`; stage by path.**");
    expect(s).toContain("An empty folder skips this step and gets no question; a folder that is already a repository is unchanged.");
  });

  it("the step-3 commit row and step 5f follow it", () => {
    expect(skill()).toContain("On a yes, before setting anything up I'll show you what's here and ask whether to save it as a commit of its own first.");
    expect(skill()).toContain("stage by path the files this bootstrap created or merged");
  });
});

describe("GETTING-STARTED", () => {
  const gs = () => readFileSync(fileURLToPath(new URL("../../../../GETTING-STARTED.md", import.meta.url)), "utf8");

  it("says auto mode may already be the starting mode, and never tells the reader to switch into it", () => {
    expect(gs()).toContain("In Claude Code v2.1.283 and later, auto mode may already be the mode a session starts in, so check the mode indicator before your first prompt");
    expect(gs()).not.toContain("You choose auto mode from the mode selector");
  });

  it("section 4 says linking the repo to the Project is optional and search-only", () => {
    const s4 = gs().split("## 4. Your first planning chat")[1].split("\n## 5. ")[0];
    expect(s4).toContain("Planning chats read your repo by cloning it");
    expect(s4).toContain("So the GitHub repo does not need to be linked to the Project's knowledge, and if you link it anyway, the chat uses it only for search.");
    expect(s4).toContain("A planning chat needs the repo tool to make that copy");
  });
});

describe("auto-mode lines for the schema paths", () => {
  it("each schema path has its fact, and the Claude path's says it asks", () => {
    const t = read("templates/CLAUDE.md.tmpl");
    expect(t).toContain("<!-- BEGIN:schema-by-claude -->\n- Schema changes are applied by Claude Code with the writable connector's `apply_migration`, and each one asks the user first; a headless run cannot apply one.\n<!-- END:schema-by-claude -->");
    expect(t).toContain("an ask rule in `.claude/settings.json` puts each call in front of the user");
    expect(read("templates/claude-ai-project-instructions.md.tmpl")).toContain("`apply_migration`; that call asks the user first, so the prompt is not unattended.**");
  });
});

describe("planning chats read the repo by sparse clone", () => {
  const tmpl = () => read("templates/claude-ai-project-instructions.md.tmpl");
  const block = (name: string) => tmpl().split(`<!-- BEGIN:${name} -->`)[1]?.split(`<!-- END:${name} -->`)[0] ?? "";

  it("the template holds both blocks, and TEMPLATE NOTES documents GITHUB_REPO and both", () => {
    const t = tmpl();
    for (const m of ["<!-- BEGIN:repo-clone -->", "<!-- END:repo-clone -->", "<!-- BEGIN:repo-search -->", "<!-- END:repo-search -->"])
      expect(t.split(m), m).toHaveLength(2);
    const notes = t.split("-->")[0];
    expect(notes).toMatch(/\n {2}GITHUB_REPO +GitHub owner\/repo \(repo-clone block\)\. +Default: detected from origin; see step 5d\n/);
    expect(notes).toMatch(/\n {2}repo-clone +Keep when the repo has a GitHub remote, or step 5f will create one/);
    expect(notes).toContain("exactly one of repo-clone and repo-search is kept");
    expect(notes).toMatch(/\n {2}repo-search +Keep only when repo-clone is stripped\.\n/);
    expect(block("repo-search")).toContain("**Search project knowledge before asserting feature state or canonical values.**\nWhy: repo docs arrive as searched chunks, so a fact not retrieved is a fact not known.");
    expect(block("repo-search")).not.toContain("git clone");
  });

  it("repo-clone holds both sparse-clone commands and forbids writes in the clone", () => {
    const b = block("repo-clone");
    expect(b).toContain("attach `{{GITHUB_REPO}}` read-only with the repo tool (`add_repo`, access `read`)");
    expect(b).toContain("`git clone --depth 1 --filter=blob:none --sparse https://github.com/{{GITHUB_REPO}} <dir>`");
    expect(b).toContain("`git -C <dir> sparse-checkout set --no-cone /CLAUDE.md /ROADMAP.md <newest handoff> <decision records they name>`");
    expect(b).toContain("Never edit, commit or push in the clone.");
    expect(b).toContain("State the clone's HEAD beside any fact that depends on it.");
    expect(tmpl()).toContain("**Never assert a current version, count or live value from any copy of the repo, synced or cloned; prompts tell Claude Code to read live files before anything builds on them.**");
  });

  it("SKILL.md step 5d names all three GITHUB_REPO paths, and step 7 the sync line", () => {
    const d = skill().split("**d. The Claude.ai instructions**")[1].split("**e. Run the scoped doc-contract command**")[0];
    expect(d).toContain("- A GitHub `origin` (step 2): fill it from origin, and keep `repo-clone`.");
    expect(d).toContain("- No remote, but a yes to the step-3 remote question: fill it as `<login>/<name>`, with the repo name that question settled and the login `gh api user --jq .login` reports, and keep `repo-clone`.");
    expect(d).toContain("If that command fails, strip `repo-clone`, keep `repo-search`, and have the report say to regenerate step 5d alone once the remote exists.");
    expect(d).toContain("- No GitHub remote, and none to be created: keep `repo-search`.");
    expect(skill().split("## 7. Report")[1]).toContain("- Repo reading, only when `repo-clone` was kept: \"Planning chats read the repo by cloning it, so linking the GitHub repo to the Claude.ai Project's knowledge is optional and search-only.\"");
  });

  it("kickoff-chat.md reads the toolkit by sparse clone, not web access", () => {
    const k = read("templates/kickoff-chat.md");
    expect(k).not.toContain("turn on web access");
    expect(k).toContain("attach `michaelkwright/dev-tools` read-only with the repo tool (`add_repo`, access `read`) and sparse-clone only `README.md`, `GETTING-STARTED.md` and `skills/project-bootstrap/`");
    expect(k).toContain("--filter=blob:none --sparse");
    expect(k).toContain("If this chat has no repo tool, ask me to paste the README.");
  });
});
