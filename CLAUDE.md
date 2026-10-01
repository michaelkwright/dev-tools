# dev-tools: Claude Code Project Context

Portable Claude Code skills and project templates, offered as-is.

- `skills/<name>/SKILL.md`: one skill per folder. `install.sh` links each skill folder into `~/.claude/skills`.
- `skills/<name>/templates/`: files copied into a project, which then owns them; each carries a provenance line naming the dev-tools commit it was seeded from.
- `skills/<name>/<part>/test/`: a skill's own test harness. `npm test` runs every one, and `package.json` holds dev dependencies for them only.
- `scripts/scrub.sh`: the scrub gate. Read the script for what it checks; this file does not restate it.

---

## Anonymization

**Name no project, repo, company or person, and include no IDs, commit SHAs, run IDs, keys or account IDs.**
Why: this repo is public, and any one of those ties a rule back to where it was learned.

**Set every example in the orders/items domain.**
Why: one neutral domain reveals nothing and reads the same across every skill.

**Never use a source project's domain vocabulary, even in an example.**
Why: vocabulary identifies a project even when every name has been scrubbed.

**Distill each rule to a principle plus a one-line anonymized reason, never a precedent history.**
Why: a history of incidents is a fingerprint, and the principle is the only part that travels.

**A principle whose only evidence is a still-open issue in a source project stays out until that issue is fixed.**
Why: until the fix lands, the principle is unproven and points at a live weakness.

---

## Scrub Gate

The pre-push hook runs `scripts/scrub.sh` against a private config kept outside the repo.

**Before the scrub, run the sweep and judge every hit in context.** Each check is `grep -rnIE --exclude-dir=.git '<pattern>' .`, repeated as `git ls-files | grep -E '<pattern>'` for file names:
- Source-project vocabulary: the source's domain nouns joined with `|`, run with `-iw`, typed at the prompt and never saved in this repo.
- UUIDs and long hex IDs: `[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-f]{12,}`
- Version strings in the source's format: `v[0-9]+\.[0-9]{2,}`
- Specific dates: `20[0-9]{2}-[0-9]{2}`
- Absolute home paths: `(/Users|/home)/[^/[:space:]]+`

Why: a denylist matches only the names it holds, while vocabulary, IDs, formats, dates and paths identify a source without naming it.

**Use `scripts/scrub.sh --show-terms` only to triage hits, and never copy its output into a file or commit message.**
Why: it prints denylist terms, which exist only in the private config; the hook ignores the flag for the same reason.

**Run `scripts/scrub.sh` yourself before committing, in the foreground and unpiped, and read its exit code directly.**
Why: a hit caught before the commit costs an edit; a hit caught at push costs a history rewrite.

**Never push with `--no-verify`, and never edit `denylist.d` to make the gate pass.**
Why: either one turns the gate into a formality.

**`allow.txt` only filters generated file-name stems, and takes only plain dictionary words or public product names, never camelCase, coined names or domain vocabulary; report every addition.**
Why: a stem that looks like a common word can still be the one term that identifies a project, so every allowance needs a human's review.

**A hit in history means STOP and report; never rewrite history unasked.**
Why: rewriting pushed history breaks every clone, and whether to do it is the owner's call.

**To add a source project, create `denylist.d/<project>.txt` with its curated identifiers, and add a `sources.txt` line naming the repo and the subpaths whose file basenames the gate turns into denylist stems.**
Why: curated terms catch the names people use; generated stems catch the names the code uses.

---

## Skills

**A skill folder always ships with its `SKILL.md` in the same commit.**
Why: a folder without one is not a loadable skill, yet it still looks like one to anyone installing.
