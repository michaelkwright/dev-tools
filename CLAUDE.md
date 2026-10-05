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

**Never name or describe any project the maintainer works on, including the one whose run produced a finding; describe that run only generically ("a first run by a new user").**
Why: a finding's origin is as identifying as a name in a rule, and it is the part most tempting to cite.

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

**The gate scans exactly the published surface: the index, the history of every local branch and tag and of every ref on the remote, commit and tag messages, author and committer identities, and every path.**
Why: a working-tree scan floods on what is never published, like `node_modules`, and misses what is, like other refs, messages and identities.

**The denylist, absolute home paths and gitleaks block; short stems, `vocab.d` vocabulary, UUIDs and long hex IDs, source-format version strings and non-noreply identities are review-only, so judge every WARN in context.**
Why: vocabulary, IDs, formats and paths identify a source without naming it, but each check also matches innocent text that only a reader can clear.

**Write home paths in published files as `~/`, never as an absolute path.**
Why: an absolute home path names the account it came from, so the gate blocks it.

**Before the scrub, sweep for specific dates and judge every hit in context: `git grep -nIE '20[0-9]{2}-[0-9]{2}'`, and `git ls-files | grep -E '20[0-9]{2}-[0-9]{2}'` for file names.**
Why: dates are the one identifying pattern the gate does not check, since most dates in a doc are harmless.

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

**To add a source project, create `denylist.d/<project>.txt` with its curated identifiers, `vocab.d/<project>.txt` with its distinctive domain nouns, and a `sources.txt` line naming the repo and the subpaths whose file basenames the gate turns into denylist stems.**
Why: curated terms catch the names people use, vocabulary catches the domain they work in, and generated stems catch the names the code uses.

**A non-noreply commit identity is a WARN until its email is added to the private `identity-allow.txt`, and only the owner adds one.**
Why: an identity is published with every commit, and only its owner can say it is meant to be public.

---

## Skills

**A skill folder always ships with its `SKILL.md` in the same commit.**
Why: a folder without one is not a loadable skill, yet it still looks like one to anyone installing.

**A subagent is not a cold reader, so never count its run as a cold-agent proof.**
Why: it inherits user-level context, including identity details the host injects and the descriptions of account-level skills, so what it knows need not come from the repo.

---

## Proofs

**In a proof or leak check, call grep as `command grep`, and record `type grep` with the proof, from the shell the proof ran in.**
Why: a grep that honors `.gitignore` skips ignored files, the very files a leak check exists to cover, and a session shell's `grep` can be that wrapper; a script run under `bash` gets the system grep, because a shell function reaches it only when exported.

**Point npm's cache into scratch (`npm_config_cache=<scratch>/npm-cache`) for every proof run, and delete it with the scratch clones.**
Why: a proof's installs otherwise fill the user's own npm cache, outside scratch, where nothing cleans them up.

**Run a cold proof as `claude -p` children, one per case, each continued turn by turn with `--resume` and the `session_id` its JSON output gives; the parent answers only from the case's fixed answer sheet, and any question not on the sheet is a finding.**
Why: a child starts with none of the parent's context, so what it does comes from the repo, and an answer improvised mid-run tests the parent's judgment instead of the skill; a subagent still does not count (Skills, above).

**Start every child with `--strict-mcp-config` and an empty MCP config (`--mcp-config '{"mcpServers":{}}'`), and confirm from its init output (`--output-format stream-json --verbose`) that it has no MCP servers and no `mcp__` tools.**
Why: otherwise a child loads the account's connectors, and a proof that can reach a real database is neither cold nor safe.

**Give every child an explicit `--allowedTools` list, have it read the skill from the detached proof clone (`--add-dir <clone>`, with `--disable-slash-commands` so the installed copy is not offered), and have it write its report to a file in scratch; record every tool it was refused.**
Why: with an explicit list each refusal is a recorded fact, the installed skill need not be the commit under test, and a report already in a file survives a child cut off mid-answer.

**Run no child while `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` is set: report the cold proofs as not run, and never unset either to get around it.**
Why: with a key set, children bill the API instead of the subscription login, and unsetting a key overrides a choice that is the user's.

**After every child's last turn, delete the transcript directories its sessions wrote under `~/.claude/projects/`, chosen by the scratch cwd their transcripts record and nothing else; run a single-turn child with `--no-session-persistence`, which writes none.**
Why: a child's transcript outlives its scratch folder, and nothing else ever cleans it up, while every other directory there belongs to some other session.

---

## Scripts

**Match whole words with `grep -w`, `git grep -P` or a JS regex, never with `\b`, `\<`, `\>` or `\B` in `grep -E`, `git grep -E`, `sed -E` or `awk`.**
Why: on macOS, `git grep -E`, `sed -E` and `awk` accept those escapes and silently match nothing, so a check written with them passes without checking.
