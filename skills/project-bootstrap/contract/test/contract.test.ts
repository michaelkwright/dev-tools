// Contract test for this skill's own text: the permission rules SKILL.md has
// the bootstrap write, the .gitignore line, the provenance wording, the push
// guard's harness, the auto-mode lines in the templates, the conventions
// document's pinned rules and the session-start template's shape. Agent proofs
// cover only judgment calls and Claude Code's permission engine (CLAUDE.md,
// Proofs); everything a script can decide is decided here.
import { existsSync, readFileSync, statSync } from "node:fs";
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
const CREDENTIAL_DENIES = [
  "Read(~/.config/<slug>/**)", "Edit(~/.config/<slug>/**)",
  "Bash(env *supabase*)", "Bash(npx supabase*)", "Bash(*SUPABASE_ACCESS_TOKEN*)",
  "Bash(printenv*)", "Bash(env)", "Bash(export)", "Bash(export -p*)", "Bash(declare -p*)", "Bash(set)",
];
// The list as round 8 proved it, before the npx deny joined.
const CREDENTIAL_DENIES_R8 = CREDENTIAL_DENIES.filter((r) => r !== "Bash(npx supabase*)");

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
  {
    // One child, slug order-desk, a stub supabase first on PATH. The Read deny
    // forms (`cat` of the token file, the Read tool) were proved there too, but
    // only Bash forms are modelled below.
    probe: "credential denies (stub supabase, real HOME, scratch settings)",
    lastProof: "round 8, commit 'project-bootstrap: cross-repo conventions, credential convention, session-start check; case study genericized'",
    deny: CREDENTIAL_DENIES_R8,
    ask: [] as string[],
    covered: [
      "echo $SUPABASE_ACCESS_TOKEN", "printenv", "env",
      "env -u SUPABASE_ACCESS_TOKEN supabase db push", "SUPABASE_ACCESS_TOKEN=x supabase db push",
    ],
  },
  {
    // One child, slug order-desk, stub supabase and stub npx first on PATH, the
    // real HOME, rules from a scratch settings file. The last form must be
    // allowed; it is checked by the plain-command test below.
    probe: "credential denies with npx supabase (stub supabase and npx, real HOME, scratch settings)",
    lastProof: "round 9, commit 'dev-tools adopts its own push guard, rules and pre-flight check; bootstrap follow-ups (CLI-token row, npx deny, profile files, probe record)'",
    deny: CREDENTIAL_DENIES,
    ask: [] as string[],
    covered: [
      "npx supabase db push", "npx supabase functions deploy demo", "env supabase db push",
      "env -u SUPABASE_ACCESS_TOKEN supabase db push",
    ],
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

  it("the credential denies are exactly these strings, in one block, kept with supabase-cli", () => {
    const blocks = blockWith("deny", CREDENTIAL_DENIES[0]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].permissions.deny).toEqual(CREDENTIAL_DENIES);
    expect(blocks[0].lead).toMatch(/^With the `supabase-cli` block kept/);
  });

  it("plain CLI calls and the session-start check pass the credential denies", () => {
    const bash = CREDENTIAL_DENIES.filter((r) => r.startsWith("Bash("));
    for (const cmd of ["supabase functions deploy demo", "supabase gen types typescript --linked", "sh scripts/session-start.sh", "set -e", "npx vitest run"])
      expect(matchesAny(bash, cmd), cmd).toBe(false);
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
      "Never ask a prompt for more test runs than CLAUDE.md allows",
      "Settle a design fork yourself",
    ])
      expect(t, line).toContain(line);
    expect(t).not.toContain("Settle decisions conversationally");
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

describe("the conventions document", () => {
  const conv = () => read("reference/conventions.md");

  it("states the propagation rule and the plain-command rule", () => {
    expect(conv()).toContain(
      "**Skills under `skills/` reach every project live through `install.sh`; files under `templates/` are copied, stamped with the dev-tools commit and become the project's own, so a convention change reaches an existing repo only through a per-project change.**",
    );
    expect(conv()).toContain(
      "**Every CLI call is the plain command, `supabase ...`, never prefixed by `env`, an inline assignment, `npx`, `sh -c` or any wrapper.**",
    );
  });

  it("bootstrap reads it, and the CLI row and the credential limit point at it", () => {
    expect(skill()).toContain("Read every template from this checkout: `templates/` next to this file, `reference/conventions.md`,");
    expect(skill()).toContain("the report gives the setup from `reference/conventions.md` section 1 | the project exists |");
    expect(skill()).toContain("- **The credential denies match command text and named paths, so these pass them:**");
  });
});

describe("the session-start check", () => {
  const tmpl = () => read("templates/session-start.sh.tmpl");

  it("carries the provenance wording and its three blocks", () => {
    expect(tmpl()).toContain(
      "# Session-start check. Seeded from dev-tools @ {{DEV_TOOLS_SHA}}; this file is\n# now the project's own, and a later port of dev-tools changes updates that\n# commit to the one ported from.",
    );
    for (const name of ["supabase-cli", "push-guard", "scheduled-ci"])
      for (const m of [`# BEGIN:${name}`, `# END:${name}`]) expect(tmpl().split(`\n${m}\n`), m).toHaveLength(2);
  });

  it("tests the token only for being set, and never expands it anywhere else", () => {
    expect(tmpl()).toContain('if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then');
    expect(tmpl().split("SUPABASE_ACCESS_TOKEN:-")).toHaveLength(2);
    expect(tmpl()).not.toMatch(/\$SUPABASE_ACCESS_TOKEN|\$\{SUPABASE_ACCESS_TOKEN\}/);
  });

  it("SKILL.md writes it to every target, and CLAUDE.md runs it at pre-flight", () => {
    expect(skill()).toContain("**Write the session-start check in every target: `templates/session-start.sh.tmpl`, filled, as `scripts/session-start.sh`, executable and committed");
    const t = read("templates/CLAUDE.md.tmpl");
    expect(t).toContain("a session runs the session-start check (`sh scripts/session-start.sh`) at pre-flight, which fails when `git config core.hooksPath` does not print `.githooks`.**");
    expect(t).toContain("<!-- BEGIN:supabase-cli -->\n- The Supabase CLI's credential, `SUPABASE_ACCESS_TOKEN`, is already in the environment; a session never prints, sets, unsets or overrides it.\n<!-- END:supabase-cli -->");
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

describe("round-9 follow-ups in the text", () => {
  const conv = () => read("reference/conventions.md");
  const gs = () => readFileSync(fileURLToPath(new URL("../../../../GETTING-STARTED.md", import.meta.url)), "utf8");
  const rows = () => skill().split("\n").filter((l) => l.startsWith("| "));
  const rowIndex = (start: string) => rows().findIndex((l) => l.startsWith(start));

  it("the CLI-token row is a project-exists follow-up after the connector-names row, and the early paths skip it", () => {
    const cli = rowIndex('| "Will Claude Code run the Supabase CLI');
    expect(cli).toBeGreaterThan(rowIndex('| "What are their names?'));
    expect(rows()[cli].endsWith("| the project exists |")).toBe(true);
    expect(skill()).toContain("strip its `connectors`, `migration-deny` and `supabase-cli` blocks");
    expect(skill()).toContain("do not ask the CLI-token question, and give");
    expect(skill()).toContain("(not asked with no backend or no connectors yet: the block stripped, and the report says the question waits until the connectors exist)");
  });

  it("step 5c names npx beside env as unstripped, and denies the npx form", () => {
    expect(skill()).toContain("`env` and `npx` are not among the wrappers Claude Code strips before matching, so `env ... supabase ...` is matched as an `env` command and `npx supabase ...` as an `npx` command");
    expect(CREDENTIAL_DENIES.indexOf("Bash(npx supabase*)")).toBe(CREDENTIAL_DENIES.indexOf("Bash(env *supabase*)") + 1);
    const bash = CREDENTIAL_DENIES.filter((r) => r.startsWith("Bash("));
    for (const cmd of ["npx supabase db push", "npx supabase functions deploy demo", "env supabase db push"])
      expect(matchesAny(bash, cmd), cmd).toBe(true);
  });

  it("step 5c has the third merge case with the stanza's path parameter", () => {
    expect(skill()).toContain("- `core.hooksPath` already names `.githooks` and `.githooks/pre-push` exists: write the guard as `.githooks/push-guard`, and add the stanza to `.githooks/pre-push` with `<guard path>` set to `.githooks/push-guard`. The setup line is unchanged.");
    expect(skill()).toContain("# Push guard: refuses force pushes and remote ref deletions (<guard path>)");
  });

  it("step 2 lists the session-start script among the pieces", () => {
    expect(skill()).toContain("or its stanza in an existing hook); `scripts/session-start.sh`; and the `.gitignore` lines.");
  });

  it("step 6 report says to run the scrub gate after a registration", () => {
    expect(skill()).toContain("(`scripts/scrub.sh` from the dev-tools checkout, in the foreground, unpiped) and the new stems triaged before its next push.");
    expect(conv()).toContain("so dev-tools' scrub gate is run after any registration and the new stems triaged before its next push.");
  });

  it("the profile file is the one the shell reads, in conventions and GETTING-STARTED", () => {
    const names = "`~/.zshrc` for zsh";
    expect(conv()).toContain("the file your shell reads when it starts: `~/.zshrc` for zsh (the Mac default), `~/.bash_profile` for bash on a Mac, `~/.bashrc` for bash on Linux; check it with `zsh -n` or `bash -n` to match");
    expect(gs()).toContain(names);
    expect(gs()).toContain("`~/.bash_profile` for bash on a Mac; `~/.bashrc` for bash on Linux; check it with `zsh -n` or `bash -n` to match");
    expect(gs()).not.toContain("`~/.bashrc` on Linux)");
  });

  it("Known limits says blockReadsOutsideWorkingDirectories is not the answer", () => {
    expect(conv()).toContain("`permissions.blockReadsOutsideWorkingDirectories` is not the answer: with it on, a skill still loads through its `~/.claude/skills` symlink but cannot read its own files, which breaks any skill that reads its templates, project-bootstrap included.");
  });
});

describe("open items after the conventions round", () => {
  const conv = () => read("reference/conventions.md");
  const gs = () => readFileSync(fileURLToPath(new URL("../../../../GETTING-STARTED.md", import.meta.url)), "utf8");
  const section = (text: string, from: string, to?: string) => {
    const start = text.indexOf(from);
    expect(start, from).toBeGreaterThanOrEqual(0);
    const rest = text.slice(start);
    if (!to) return rest;
    const end = rest.indexOf(to, from.length);
    expect(end, to).toBeGreaterThan(0);
    return rest.slice(0, end);
  };
  const MARKER = "not yet in the template";
  const GUARD = "**Every paste file opens with a guard that checks the live state it was written against (each object it creates is absent, each one it alters matches what was read, a function by `md5(prosrc)`) and raises if any differs, so the paste fails whole instead of applying.**";

  it("the profile check names zsh first and every bash file after", () => {
    const s7 = section(gs(), "### CLI token", "## 8.");
    expect(s7).toContain("zsh -n ~/.zshrc");
    expect(s7).toContain("For `~/.bash_profile` or `~/.bashrc`, run `bash -n` on that file instead.");
    expect(s7).not.toContain("For `~/.bashrc`:");
  });

  it("the section 9 Why line and the scrub-registration sentence are separate paragraphs", () => {
    expect(conv()).toContain("lands in all of them.\n\nRegistering a project's file names in the scrub config");
  });

  it("the paste guard is in the schema-by-hand block of the Supabase section, once in the file", () => {
    const t = read("templates/CLAUDE.md.tmpl");
    const sup = section(t, "## Supabase", "## Running in auto mode");
    expect(sup.split("<!-- BEGIN:schema-by-hand -->").length - 1).toBe(1);
    const block = section(sup, "<!-- BEGIN:schema-by-hand -->", "<!-- END:schema-by-hand -->");
    expect(block).toContain(GUARD);
    expect(t.split(GUARD).length - 1).toBe(1);
  });

  it("convention section 5 moved into the template; sections 3, 7 and 9 still wait", () => {
    const c = conv();
    const s5 = section(c, "## 5.", "## 6.");
    expect(s5).toContain("**A paste block guards the exact live state it was written against, so it fails rather than applies when that state has moved.**");
    expect(s5).toContain("the paste guard on the by-hand path");
    expect(s5).not.toContain(MARKER);
    expect(section(c, "## 3.", "## 4.")).toContain(MARKER);
    expect(section(c, "## 7.", "## 8.")).toContain(MARKER);
    expect(section(c, "## 9.", "## 10.")).toContain(MARKER);
    expect(section(c, "## 1.").split(MARKER).length - 1).toBe(3);
    expect(section(c, "## 0.", "## 1.")).toContain('A line marked "convention; not yet in the template"');
  });
});

// dev-tools' own copies of what it publishes. PIN_ROOT points the checks at a
// scratch copy of the repo root, for the break-and-restore proof.
describe("dev-tools adopts its own push guard, rules and pre-flight check", () => {
  const root = process.env.PIN_ROOT ?? fileURLToPath(new URL("../../../../", import.meta.url));
  const own = (rel: string) => readFileSync(`${root}${rel}`, "utf8");
  // Everything below the first comment block after the shebang.
  const belowHeader = (src: string) => {
    const lines = src.split("\n");
    let i = 1;
    while (i < lines.length && lines[i].startsWith("#")) i++;
    return lines.slice(i).join("\n");
  };

  it(".claude/settings.json holds exactly the push denies and the push asks", () => {
    const settings = JSON.parse(own(".claude/settings.json"));
    expect(Object.keys(settings)).toEqual(["permissions"]);
    expect(Object.keys(settings.permissions).sort()).toEqual(["ask", "deny"]);
    expect(settings.permissions.deny).toEqual(PUSH_DENIES);
    expect(settings.permissions.ask).toEqual(PUSH_ASKS);
  });

  it(".gitignore keeps settings.local.json out", () => {
    expect(own(".gitignore").split("\n")).toContain(".claude/settings.local.json");
  });

  it(".githooks/push-guard is the template below its header, with its own provenance line, and executable", () => {
    const guard = own(".githooks/push-guard");
    expect(guard.split("\n")[0]).toBe("#!/bin/sh");
    expect(guard).toContain("# Push guard. A copy of this repo's own templates/pre-push.tmpl, held\n# byte-identical to it below that line by the project-bootstrap contract test.\n");
    expect(guard).not.toMatch(/\{\{|[0-9a-f]{40}/);
    expect(belowHeader(guard)).toBe(belowHeader(read("templates/pre-push.tmpl")));
    expect(belowHeader(guard).length).toBeGreaterThan(500);
    expect(statSync(`${root}.githooks/push-guard`).mode & 0o111).toBeGreaterThan(0);
  });

  it(".githooks/pre-push runs the guard's stanza first, then the scrub gate", () => {
    const hook = own(".githooks/pre-push");
    const stanza = skill().match(/```sh\n( *# Push guard:[^]*?)\n *```/)?.[1].replace(/^ {2}/gm, "").replaceAll("<guard path>", ".githooks/push-guard");
    expect(stanza).toContain('/.githooks/push-guard" "$@"');
    expect(hook.split("\n").slice(1).join("\n").startsWith(`${stanza}\n`)).toBe(true);
    expect(hook).toContain("scripts/scrub.sh");
    expect(statSync(`${root}.githooks/pre-push`).mode & 0o111).toBeGreaterThan(0);
  });

  it("scripts/session-start.sh is the template's push-guard block, executable", () => {
    const script = own("scripts/session-start.sh");
    const block = read("templates/session-start.sh.tmpl").split("# BEGIN:push-guard\n")[1].split("# END:push-guard\n")[0];
    expect(script).toContain(block);
    expect(script).not.toMatch(/\{\{|^# (BEGIN|END):|TEMPLATE NOTES|SUPABASE/m);
    expect(statSync(`${root}scripts/session-start.sh`).mode & 0o111).toBeGreaterThan(0);
  });
});
