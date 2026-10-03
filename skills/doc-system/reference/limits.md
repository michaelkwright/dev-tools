# Doc-contract limits

The canonical limits list. Fill each placeholder from the test's `CONFIG.limits` (`{{CHANGELOG_WINDOW}}` = `changelogWindow`, `{{SEAL_SIZE}}` = `sealSize`, `{{INDEX_CELL_MAX}}` = `indexCellMax`, `{{PREAMBLE_MAX_LINES}}` = `preambleMaxLines`) and `{{DOC_CONTRACT_CMD}}` from the scoped command that runs the test, then paste everything below the rule between the `doc-contract-limits:start` and `doc-contract-limits:end` markers in the project's `CLAUDE.md`. The test matches the wording of the numbered lines, so edit numbers, not phrasing.

---

**The limits the doc-contract test enforces; read them before writing, not after failing.**
1. `CHANGELOG.md` holds at most {{CHANGELOG_WINDOW}} entries; a new entry past that rolls the oldest active entry, verbatim, into the open archive.
2. Exactly one open archive, `changelog/v<first>-onward.md`, exists at all times.
3. The open archive holds fewer than {{SEAL_SIZE}} entries; at {{SEAL_SIZE}} it seals, and a fresh `v<next>-onward.md` opens in the same commit.
4. Every sealed archive, `changelog/v<first>-to-v<last>.md`, holds exactly {{SEAL_SIZE}} entries and is never edited again.
5. The `PRODUCT_SPEC.md` "Last updated" stamp names the same version as the top `CHANGELOG.md` entry.
6. Every Feature Index description cell is at most {{INDEX_CELL_MAX}} characters: a behavior statement plus one version pointer.
7. Every entry heading reads `### vMAJOR.MINOR — <title> (<Month D, YYYY>)`, unless the test declares it by name with a reason.
8. No version appears twice across `CHANGELOG.md` and `changelog/`.
9. Within each major version, minor versions are contiguous across `CHANGELOG.md` and `changelog/`.
10. Entries run strictly newest-first in `CHANGELOG.md` and strictly oldest-first in every archive.
11. No entry-body line ends with a heading-style `(<Month D, YYYY>)` date parenthetical.
12. Every entry heading is followed by a non-empty body.
13. At most {{PREAMBLE_MAX_LINES}} non-blank preamble lines, none shaped like entry body, precede a file's first entry.
14. Each changelog file's newest entry sorts below the next file's oldest, unless the test declares the entry by name with a reason.
15. The template-token check: no double-brace `UPPER_SNAKE_CASE` template token is left outside code fences and inline code in the files `CONFIG.templateTokens.files` lists, unless `CONFIG.templateTokens.allow` names its file and token with a reason. Run it alone with `{{DOC_CONTRACT_CMD}} -t "template token"`.
16. This block states the same numbers as the test's `CONFIG`.
