---
name: doc-system
description: Use to set up or adopt a spec / changelog / roadmap / decisions / handoffs doc system in a repo, to run the spec-update protocol after a ship, or to roll or seal a changelog archive.
---

# Doc system

Five kinds of document, each answering one question, held to shape by a vitest contract test so drift fails in seconds instead of surfacing sessions later.

| File | Answers |
|---|---|
| `PRODUCT_SPEC.md` | What the product does now: a Feature Index (map) and a Current Feature Set (detail) |
| `CHANGELOG.md` + `changelog/` | What changed, when, and why: a window of recent entries plus verbatim archives |
| `ROADMAP.md` | What is not built yet, and in what order |
| `docs/decisions/` | Why a settled design is the way it is |
| `docs/handoffs/` | Live state carried between sessions of multi-session work |
| `docs/audits/` | What a point-in-time investigation found |

## Modes

**SEED** (new repo): copy `templates/` into the repo root, fill the placeholders, install the contract test (below), and run it green before the first commit. Placeholders: `{{PROJECT_NAME}}` (default: the repo directory name), `{{SEED_DATE}}` (today, `Month D, YYYY`), `{{PRODUCT_SUMMARY}}` (one paragraph; ask), `{{DEV_TOOLS_SHA}}` (short HEAD of the dev-tools checkout).

**ADOPT** (existing repo, possibly scaffolded by another tool):
1. Inventory what already answers each question above: specs, changelogs (hand-written or tool-generated), roadmaps or TODO files, decision records or ADR folders, handoff or audit notes, and the agent-instructions file.
2. Never clobber: in this pass, create nothing that exists, and rename, move, reformat or rewrite nothing.
3. Propose a mapping to the user and wait for approval: each existing file → the role it takes, each gap → the template that fills it, each format conflict → the `CONFIG` change that fits the test to the repo.
4. Seed only what is missing. Fit the test to the repo through `CONFIG` (paths, heading shape, date format), never the repo to the test.
5. Leave out of the contract any changelog a release tool writes; hand edits there get overwritten.
6. Declare historical irregularities in `CONFIG` with a reason each, rather than editing history; a template token the repo already kept on purpose gets a `CONFIG.templateTokens.allow` entry the same way. Splitting an over-window changelog into archives is its own commit: entries move verbatim, reordered oldest-first, into sealed archives of exactly the seal size, and the remainder goes into one open archive.
7. Raise the `CONFIG.floors` to the adopted corpus's real size so a broken parse cannot pass.

## Installing the contract test

- Copy `reference/doc-contracts.test.ts` to `src/test/doc-contracts.test.ts`. Elsewhere works; adjust `CONFIG.root`, which resolves the repo root relative to the file.
- It needs vitest only and runs in the node environment. If the project's default environment is a DOM one, add `// @vitest-environment node` as its first line.
- Default command: `npx vitest run src/test/doc-contracts.test.ts`, run on its own, in the foreground, unpiped.
- In the project's `CLAUDE.md` (from the project-bootstrap template, or added to an existing one):
  - `{{DOC_CONTRACT_CMD}}`: the command above.
  - `{{CHANGELOG_WINDOW}}`: `CONFIG.limits.changelogWindow`.
  - `{{DOC_CONTRACT_LIMITS}}`: the list from `reference/limits.md` with `CONFIG`'s values and the command above filled in, between the `<!-- doc-contract-limits:start -->` and `<!-- doc-contract-limits:end -->` markers. The test fails when the block and `CONFIG` disagree, so change a limit in both places at once.
- The template-token check fails any double-brace `UPPER_SNAKE_CASE` token left outside code in the files `CONFIG.templateTokens.files` lists, by file and line. Fit that list to the repo's doc paths along with `CONFIG.paths`. Run the check alone with the command above plus `-t "template token"`.
- Prove it before trusting it: break one file (a Feature Index cell over the cap, say), watch the scoped run fail, restore from a copy and confirm with `diff`.

## Rules

**Once seeded, the Spec-Update Protocol in the project's `CLAUDE.md` is the single source; follow it there, not from here.** In outline: a changelog entry (rolling if needed), the spec's Feature Index row and Current Feature Set, the roadmap trim on roadmap ships, then the scoped contract run before any other gate.
Why: two copies of a protocol drift, and the project's copy is the one it edits.

**Roll: a new entry goes at the top of `CHANGELOG.md`; if the window is then exceeded, cut the bottom (oldest) entry and append it verbatim to the bottom of the open archive.**
Why: the active file stays readable, and a verbatim move keeps every version reachable by grep.

**Seal, in the same commit as the roll that brings the open archive to the seal size:**
1. Rename `changelog/v<first>-onward.md` to `v<first>-to-v<last>.md`, where first and last are its first and last entries.
2. Replace its preamble line with `Sealed archive: v<first> to v<last>, oldest first; never edited again.` and never touch the file again.
3. Create `changelog/v<next>-onward.md`, where next is the version after last, holding only the open-archive preamble line.
4. Restamp the spec and run the scoped contract test.

Why: the test requires exactly one open archive at all times, and a seal without the fresh archive fails it; the fresh one is exempt from the has-entries checks only while empty.

**Spec bullets state durable behavior, never implementation: "archived orders are hidden from the orders list", not "renders when `order.status !== 'archived'`".**
Why: an expression goes stale on the next refactor with nothing to catch it, and the cited version already points at the code.

**The roadmap only shrinks: when work ships, delete it from `ROADMAP.md`; shipped detail goes to the changelog and the spec.**
Why: shipped detail in a forward spec reads as work still owed.

**A decision record's STATUS moves PROPOSED → ACTIVE → SHIPPED (or SUPERSEDED), and SHIPPED only once its "Final state, verified" section records the shipped behavior, how it was verified, and when.**
Why: a record marked shipped on intent rather than evidence is the one the next session trusts wrongly.

**File a handoff at `docs/handoffs/<topic>-<date>-handoff.md`, and let each one fully supersede the previous one.**
Why: a new session should need only the epic's roadmap sequence and the newest handoff.

**A handoff carries only live state: live numbers with their verification time, the deploy pin, in-flight partial state, open questions with the evidence so far, the version table since the last handoff, and pointers.**
Why: that is exactly the state that goes stale between sessions and has no other home.

**Sequence, design and method notes never go in a handoff; they go in the roadmap, the decision record and `CLAUDE.md`.**
Why: anything left in a handoff chain disappears when the chain is superseded.

**Mark a superseded handoff at its top with where each surviving section now lives, and move it to `docs/handoffs/archive/`.**
Why: the chain stays readable as history without competing with the current snapshot.

## Files

- `templates/`: the seed set. `PRODUCT_SPEC.md`, `CHANGELOG.md` (one seed entry, v0.1), `changelog/v0.1-onward.md` (the empty open archive the seed entry will first roll into), `ROADMAP.md`, `docs/decisions/TEMPLATE.md`, `docs/handoffs/TEMPLATE.md`, `docs/audits/README.md`.
- `reference/doc-contracts.test.ts`: the contract test. Every project-shaped value is in its exported `CONFIG`; read that block before changing anything.
- `reference/test/`: this skill's harness, which runs the contract test against a seeded fixture.
- `reference/limits.md`: the canonical limits list pasted into `CLAUDE.md`.
