// Doc-contract test: enforces the shape of CHANGELOG.md, changelog/,
// PRODUCT_SPEC.md and the limits block in CLAUDE.md, that no listed doc
// keeps an unfilled template token, and that the committed permission rules
// CONFIG lists stay in place. Node environment, no DOM.
// Seeded from dev-tools @ {{DEV_TOOLS_SHA}}; this file is now the project's own.
//
// Every project-shaped value lives in CONFIG below. Change CONFIG, not the
// assertions; a changed limit must also change the CLAUDE.md limits block,
// and the last describe block fails until it does.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

type HeadingException = { file: string; heading: string; reason: string };
type PartitionException = { file: string; version: string; reason: string };
type TokenAllowance = { file: string; token: string; reason: string };

export const CONFIG = {
  // Repo root, relative to this file. The default assumes src/test/.
  root: fileURLToPath(new URL("../../", import.meta.url)),

  paths: {
    changelog: "CHANGELOG.md",
    archiveDir: "changelog",
    spec: "PRODUCT_SPEC.md",
    claudeMd: "CLAUDE.md",
  },

  // The open archive is v<first>-onward.md; every other archive is sealed.
  openArchiveSuffix: "-onward.md",

  // Numeric limits. Each one must also appear in the CLAUDE.md limits block.
  limits: {
    changelogWindow: 50, // max entries in CHANGELOG.md
    sealSize: 50, // entries per sealed archive; the open archive seals at this count
    indexCellMax: 300, // max characters in a Feature Index description cell
    preambleMaxLines: 3, // max non-blank lines above a file's first entry
  },

  // An entry heading is: marker + version + title + " (" + date + ")".
  // Default shape: "### v1.4 — Order totals include item discounts (March 4, 2026)".
  heading: {
    marker: "### ",
    // Numeric capture groups only; the last group must be contiguous within
    // the groups before it (default: MINOR contiguous within each MAJOR).
    version: String.raw`v(\d+)\.(\d+)`,
    title: String.raw` — \S.*`,
    date: String.raw`(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}`,
  },

  // PRODUCT_SPEC.md stamp: "<!-- Last updated: <date> (<version>) -->".
  specStampLabel: "Last updated",
  featureIndexHeading: "## Feature Index",

  claudeLimitsMarkers: {
    start: "<!-- doc-contract-limits:start -->",
    end: "<!-- doc-contract-limits:end -->",
  },

  // Non-vacuity floors. They pass on a freshly seeded repo (one entry, one
  // Feature Index row) and fail on an empty parse. Raise them as the corpus grows.
  floors: {
    corpusFiles: 1,
    entryHeadings: 1,
    indexRows: 1,
  },

  // Declared exceptions. Each entry names its file and carries a reason, must
  // still match something real, and is never added to make a new mistake pass.
  // file is repo-relative, e.g. "changelog/v0.1-to-v0.50.md".
  nonConformingHeadings: [] as HeadingException[], // heading: text after the marker
  partitionExceptions: [] as PartitionException[], // version: e.g. "v1.4"

  // The template-token check: no double-brace UPPER_SNAKE_CASE token outside
  // fenced code blocks and inline code spans in these files. A path ending in
  // "/" means every .md file directly in that directory. Run it alone with
  // -t "template token". An allowance names its file and the whole token,
  // braces included, and carries a reason, like the exceptions above.
  templateTokens: {
    files: ["CLAUDE.md", "PRODUCT_SPEC.md", "ROADMAP.md", "CHANGELOG.md", "changelog/"],
    allow: [] as TokenAllowance[],
  },

  // The settings ratchet: every permission rule listed here must stay in the
  // committed settings file, a listed ask rule in its ask or deny list. Empty
  // lists check nothing; a setup that writes rules lists each one. Remove an
  // entry only in the commit that removes its rule on purpose. Run it alone
  // with -t "settings ratchet".
  settingsRules: {
    file: ".claude/settings.json",
    deny: [] as string[],
    ask: [] as string[],
  },
};

// ─── derived patterns ───────────────────────────────────────────────────────

const H = CONFIG.heading;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ENTRY_RE = new RegExp(`^${escape(H.marker)}`);
const CONFORMING_RE = new RegExp(
  `^${escape(H.marker)}(?<version>${H.version})${H.title} \\((?:${H.date})\\)\\s*$`,
);
const VERSION_RE = new RegExp(`^${H.version}$`);
const DATE_TAIL_RE = new RegExp(`\\((?:${H.date})\\)\\s*$`);
const SPEC_STAMP_RE = new RegExp(
  `^<!--\\s*${escape(CONFIG.specStampLabel)}: (?:${H.date}) \\((?<version>${H.version})\\)\\s*-->\\s*$`,
  "gm",
);
// Entry-body markers. A preamble is prose and markdown headings only.
const BODY_SHAPE_RE = /^(?:[-*+]\s|\d+[.)]\s|>\s|```|---\s*$|\*\*)/;
const TABLE_SEPARATOR_RE = /^\|[\s:|-]+\|$/;
const SECTION_RE = /^## /;

const L = CONFIG.limits;
const P = CONFIG.paths;
const abs = (rel: string) => resolve(CONFIG.root, rel);
const read = (rel: string) => readFileSync(abs(rel), "utf-8");

// ─── corpus parsing ─────────────────────────────────────────────────────────

type CorpusFile = { label: string; lines: string[]; descending: boolean };
type Heading = { file: string; line: number; text: string };
type Versioned = Heading & { version: string; tuple: number[] };

function archiveFiles(): string[] {
  return readdirSync(abs(P.archiveDir))
    .filter((f) => f.endsWith(".md"))
    .sort();
}

const isOpenArchive = (name: string) => name.endsWith(CONFIG.openArchiveSuffix);

function headingsIn(file: CorpusFile): Heading[] {
  const out: Heading[] = [];
  file.lines.forEach((text, i) => {
    if (ENTRY_RE.test(text)) out.push({ file: file.label, line: i + 1, text });
  });
  return out;
}

function tupleOf(version: string): number[] {
  const m = version.match(VERSION_RE);
  return m ? m.slice(1).map(Number) : [];
}

function compareTuples(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function isDeclaredNonConforming(file: string, text: string): boolean {
  const body = text.slice(H.marker.length).trim();
  return CONFIG.nonConformingHeadings.some((e) => e.file === file && e.heading === body);
}

function versionedIn(file: CorpusFile): Versioned[] {
  return headingsIn(file).flatMap((h) => {
    const version = h.text.match(CONFORMING_RE)?.groups?.version;
    return version ? [{ ...h, version, tuple: tupleOf(version) }] : [];
  });
}

// A seal opens a fresh open archive in the same commit, and it holds no entry
// until the next roll. Only that exact state is excused: the open-archive
// name AND zero entry headings. Anything with content is checked in full.
function isFreshEmptyOpenArchive(file: CorpusFile): boolean {
  const name = file.label.slice(P.archiveDir.length + 1);
  return isOpenArchive(name) && headingsIn(file).length === 0;
}

function corpusFiles(): CorpusFile[] {
  const archives = archiveFiles().map((f) => ({
    label: `${P.archiveDir}/${f}`,
    lines: read(`${P.archiveDir}/${f}`).split("\n"),
    descending: false,
  }));
  return [
    { label: P.changelog, lines: read(P.changelog).split("\n"), descending: true },
    ...archives.filter((a) => !isFreshEmptyOpenArchive(a)),
  ];
}

// Read lazily, so a run filtered with -t to one block never parses the others.
function lazy<T>(make: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= make());
}

const entriesIn = (rel: string) => headingsIn({ label: rel, lines: read(rel).split("\n"), descending: false });
const at = (h: Heading) => `${h.file}:${h.line}`;

// ─── CHANGELOG.md window and archive shape ──────────────────────────────────

describe("changelog window and archives", () => {
  it(`CHANGELOG.md holds at most ${L.changelogWindow} entries`, () => {
    const count = entriesIn(P.changelog).length;
    expect(
      count,
      `${P.changelog} has ${count} entries, over the ${L.changelogWindow}-entry window. Roll the ` +
        `oldest active entry (the bottom one) verbatim into the open archive until ` +
        `${L.changelogWindow} remain.`,
    ).toBeLessThanOrEqual(L.changelogWindow);
  });

  it("has exactly one open archive", () => {
    const open = archiveFiles().filter(isOpenArchive);
    expect(
      open,
      `Expected exactly one ${P.archiveDir}/*${CONFIG.openArchiveSuffix}, found ${open.length}: ` +
        `${JSON.stringify(open)}. A seal renames the full archive to v<first>-to-v<last>.md and ` +
        `creates the fresh v<next>${CONFIG.openArchiveSuffix} in the same commit.`,
    ).toHaveLength(1);
  });

  it(`the open archive holds fewer than ${L.sealSize} entries`, () => {
    for (const name of archiveFiles().filter(isOpenArchive)) {
      const label = `${P.archiveDir}/${name}`;
      const count = entriesIn(label).length;
      expect(
        count,
        `${label} has ${count} entries, at or over the ${L.sealSize}-entry seal size. Rename it to ` +
          `v<first>-to-v<last>.md (never edited again) and create a fresh ` +
          `v<next>${CONFIG.openArchiveSuffix} in the same commit.`,
      ).toBeLessThan(L.sealSize);
    }
  });

  it(`every sealed archive holds exactly ${L.sealSize} entries`, () => {
    for (const name of archiveFiles().filter((f) => !isOpenArchive(f))) {
      const label = `${P.archiveDir}/${name}`;
      const count = entriesIn(label).length;
      expect(
        count,
        `${label} has ${count} entries, not ${L.sealSize}. A sealed archive is never appended to ` +
          `or renamed after sealing; another count means it sealed at the wrong size or was edited.`,
      ).toBe(L.sealSize);
    }
  });
});

// ─── PRODUCT_SPEC.md ────────────────────────────────────────────────────────

type IndexRow = { line: number; description: string; version: string };

function featureIndexRows(text: string): IndexRow[] {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === CONFIG.featureIndexHeading);
  if (start === -1) return [];
  const rel = lines.slice(start + 1).findIndex((l) => SECTION_RE.test(l));
  const end = rel === -1 ? lines.length : start + 1 + rel;

  const rows: IndexRow[] = [];
  let seenSeparator = false;
  for (let i = start + 1; i < end; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("|")) continue;
    if (TABLE_SEPARATOR_RE.test(line)) {
      seenSeparator = true;
      continue;
    }
    if (!seenSeparator) continue; // header row
    // Split on the LAST pipe, so an escaped pipe in the description still parses.
    const body = line.replace(/^\|/, "").replace(/\|$/, "");
    const cut = body.lastIndexOf("|");
    if (cut === -1) continue;
    rows.push({ line: i + 1, description: body.slice(0, cut).trim(), version: body.slice(cut + 1).trim() });
  }
  return rows;
}

describe("PRODUCT_SPEC.md", () => {
  it("carries one stamp naming the same version as CHANGELOG.md's top entry", () => {
    const stamps = [...read(P.spec).matchAll(SPEC_STAMP_RE)];
    expect(
      stamps.length,
      `${P.spec} must carry exactly one "<!-- ${CONFIG.specStampLabel}: <date> (<version>) -->" ` +
        `stamp in the configured date format; found ${stamps.length}. An unparseable stamp is ` +
        `the same failure as a stale one.`,
    ).toBe(1);

    const top = entriesIn(P.changelog)[0];
    const topVersion = top?.text.match(CONFORMING_RE)?.groups?.version ?? null;
    expect(
      topVersion,
      `Could not parse a version from ${P.changelog}'s top entry heading.`,
    ).not.toBeNull();

    const specVersion = stamps[0].groups!.version;
    expect(
      specVersion,
      `${P.spec} is stamped ${specVersion} but ${P.changelog}'s top entry is ${topVersion}. Every ` +
        `ship restamps the spec, docs-only ships included, in the same commit as the entry.`,
    ).toBe(topVersion);
  });

  it(`keeps every Feature Index description cell at or under ${L.indexCellMax} characters`, () => {
    const rows = featureIndexRows(read(P.spec));
    expect(
      rows.length,
      `Parsed ${rows.length} Feature Index rows, below the floor of ${CONFIG.floors.indexRows}. ` +
        `Check that "${CONFIG.featureIndexHeading}" still heads a pipe table in ${P.spec}; ` +
        `otherwise the cap below passes vacuously.`,
    ).toBeGreaterThanOrEqual(CONFIG.floors.indexRows);

    const oversized = rows
      .filter((r) => r.description.length > L.indexCellMax)
      .map((r) => `  ${P.spec}:${r.line} (${r.description.length} chars) ${r.version}`);
    expect(
      oversized,
      `${oversized.length} Feature Index row(s) exceed ${L.indexCellMax} characters:\n` +
        `${oversized.join("\n")}\n\nA row is a short statement of durable behavior plus one ` +
        `version pointer; the detail belongs in the changelog entry that version names. Trim ` +
        `the cell, or split it into one row per feature area.`,
    ).toEqual([]);
  });
});

// ─── changelog corpus structure ─────────────────────────────────────────────

describe("changelog corpus structure", () => {
  const files = lazy(corpusFiles);
  const all = lazy(() => files().flatMap(headingsIn));
  const versioned = lazy(() => files().flatMap(versionedIn));

  it("parses a corpus large enough for the assertions to mean anything", () => {
    // Every check below is filter-and-expect-empty, which passes on an empty parse.
    expect(files().length, `Enumerated ${files().length} changelog files.`).toBeGreaterThanOrEqual(
      CONFIG.floors.corpusFiles,
    );
    expect(
      all().length,
      `Parsed ${all().length} entry headings, below the floor of ${CONFIG.floors.entryHeadings}. ` +
        `Check that entries still start with "${H.marker}".`,
    ).toBeGreaterThanOrEqual(CONFIG.floors.entryHeadings);
    expect(
      versioned().length,
      `Parsed ${versioned().length} versioned headings, below the floor of ${CONFIG.floors.entryHeadings}.`,
    ).toBeGreaterThanOrEqual(CONFIG.floors.entryHeadings);
  });

  it("every declared exception carries a reason", () => {
    const missing = [...CONFIG.nonConformingHeadings, ...CONFIG.partitionExceptions]
      .filter((e) => !e.reason || e.reason.trim() === "")
      .map((e) => `  ${JSON.stringify(e)}`);
    expect(missing, `Declared exception(s) without a reason:\n${missing.join("\n")}`).toEqual([]);
  });

  it("every entry heading conforms, or is declared by name", () => {
    const bad = all()
      .filter((h) => !CONFORMING_RE.test(h.text) && !isDeclaredNonConforming(h.file, h.text))
      .map((h) => `  ${at(h)}  ${h.text.slice(0, 120)}`);
    expect(
      bad,
      `${bad.length} entry heading(s) do not match the configured shape:\n${bad.join("\n")}\n\n` +
        `A non-conforming heading drops out of every sequence check below without a sound. A ` +
        `heading that stopped parsing usually means an edit merged text into it; fix the ` +
        `heading rather than declaring it.`,
    ).toEqual([]);
  });

  it("every declared non-conforming heading still exists exactly once, in its file", () => {
    const stale = CONFIG.nonConformingHeadings
      .filter((e) => all().filter((h) => h.file === e.file && h.text.slice(H.marker.length).trim() === e.heading).length !== 1)
      .map((e) => `  ${e.file}  ${e.heading}`);
    expect(
      stale,
      `Declared non-conforming heading(s) not found exactly once where declared:\n` +
        `${stale.join("\n")}\n\nA stale exception widens the rule for nothing; delete it. A ` +
        `moved one means a sealed archive was edited.`,
    ).toEqual([]);
  });

  it("no two entries share a version", () => {
    const byVersion = new Map<string, Versioned[]>();
    for (const v of versioned()) byVersion.set(v.version, [...(byVersion.get(v.version) ?? []), v]);
    const dup = [...byVersion.entries()]
      .filter(([, vs]) => vs.length > 1)
      .map(([ver, vs]) => `  ${ver} appears at ${vs.map(at).join(" and ")}`);
    expect(
      dup,
      `${dup.length} version(s) appear more than once:\n${dup.join("\n")}\n\nA version names ` +
        `exactly one ship. A duplicate was misnumbered, or copied rather than moved in a roll.`,
    ).toEqual([]);
  });

  it("versions are contiguous in their last component across the corpus", () => {
    const groups = new Map<string, Versioned[]>();
    for (const v of versioned()) {
      const key = v.tuple.slice(0, -1).join(".");
      groups.set(key, [...(groups.get(key) ?? []), v]);
    }
    const gaps: string[] = [];
    for (const vs of groups.values()) {
      const sorted = [...vs].sort((a, b) => compareTuples(a.tuple, b.tuple));
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const cur = sorted[i];
        const step = cur.tuple[cur.tuple.length - 1] - prev.tuple[prev.tuple.length - 1];
        if (step > 1)
          gaps.push(`  ${step - 1} missing between ${prev.version} (${at(prev)}) and ${cur.version} (${at(cur)})`);
      }
    }
    expect(
      gaps,
      `${gaps.length} gap(s) in the version sequence:\n${gaps.join("\n")}\n\nEvery ship writes an ` +
        `entry, so the sequence is contiguous by construction. A gap usually means an entry's ` +
        `heading line was lost in an edit, leaving its body under the entry above. Recover the ` +
        `heading from git history; do not renumber and do not add an exception.`,
    ).toEqual([]);
  });

  it("entries are strictly ordered within every file", () => {
    const bad: string[] = [];
    for (const file of files()) {
      const vs = versionedIn(file);
      for (let i = 1; i < vs.length; i++) {
        const d = compareTuples(vs[i].tuple, vs[i - 1].tuple);
        if (file.descending ? d >= 0 : d <= 0)
          bad.push(
            `  ${at(vs[i])}: ${vs[i].version} follows ${vs[i - 1].version}; this file reads ` +
              `${file.descending ? "newest-first" : "oldest-first"}`,
          );
      }
    }
    expect(
      bad,
      `${bad.length} out-of-order entr(ies):\n${bad.join("\n")}\n\n${P.changelog} reads ` +
        `newest-first (new entries at the top); every archive reads oldest-first (rolled ` +
        `entries append at the bottom).`,
    ).toEqual([]);
  });

  it("no body line ends with a heading-style date parenthetical", () => {
    const merged: string[] = [];
    for (const file of files())
      file.lines.forEach((text, i) => {
        if (!ENTRY_RE.test(text) && DATE_TAIL_RE.test(text))
          merged.push(`  ${file.label}:${i + 1}  ${text.slice(0, 160)}`);
      });
    expect(
      merged,
      `${merged.length} body line(s) end the way only an entry heading ends:\n` +
        `${merged.join("\n")}\n\nThat is a heading whose text survived an edit but whose ` +
        `"${H.marker.trim()}" marker did not. Split the line and restore the heading from git history.`,
    ).toEqual([]);
  });

  it("every entry heading is followed by a non-empty body", () => {
    const empty: string[] = [];
    for (const file of files())
      file.lines.forEach((text, i) => {
        if (!ENTRY_RE.test(text)) return;
        let j = i + 1;
        while (j < file.lines.length && file.lines[j].trim() === "") j++;
        if (j >= file.lines.length || ENTRY_RE.test(file.lines[j]))
          empty.push(`  ${file.label}:${i + 1}  ${text.slice(0, 120)}`);
      });
    expect(
      empty,
      `${empty.length} entry heading(s) have no body:\n${empty.join("\n")}\n\nThe body was ` +
        `clipped, usually by a mis-targeted roll. Recover it from git history.`,
    ).toEqual([]);
  });

  it(`at most ${L.preambleMaxLines} preamble lines, none body-shaped, precede a file's first entry`, () => {
    const bad: string[] = [];
    for (const file of files()) {
      const first = file.lines.findIndex((l) => ENTRY_RE.test(l));
      if (first === -1) {
        bad.push(`  ${file.label}: contains no entry headings`);
        continue;
      }
      const pre = file.lines
        .slice(0, first)
        .map((text, i) => ({ text, line: i + 1 }))
        .filter((l) => l.text.trim() !== "");
      if (pre.length > L.preambleMaxLines)
        bad.push(`  ${file.label}:1-${first}: ${pre.length} non-blank preamble lines`);
      for (const l of pre)
        if (BODY_SHAPE_RE.test(l.text))
          bad.push(`  ${file.label}:${l.line}: body-shaped line above the first entry: ${l.text.slice(0, 120)}`);
    }
    expect(
      bad,
      `${bad.length} preamble problem(s):\n${bad.join("\n")}\n\nA changelog file opens with a ` +
        `short preamble only. Body content above the first entry is a body that lost its heading, ` +
        `and the top of ${P.changelog} is where every insert happens.`,
    ).toEqual([]);
  });
});

// ─── changelog chain partition ──────────────────────────────────────────────
//
// The pooled checks above cannot see an entry filed in the wrong file: it is
// still in the pool, so the pool stays complete and gap-free. Each file owns a
// contiguous, disjoint slice of version space, so every file's newest entry
// must sort strictly below the next file's oldest. Chain order is derived from
// content (each file's oldest version), never from file names.

type Span = { label: string; min: Versioned; max: Versioned };

function chainSpans(files: CorpusFile[], excluded: (file: string, version: string) => boolean): Span[] {
  return files
    .flatMap((f) => {
      const vs = versionedIn(f).filter((h) => !excluded(f.label, h.version));
      if (vs.length === 0) return [];
      const sorted = [...vs].sort((a, b) => compareTuples(a.tuple, b.tuple));
      return [{ label: f.label, min: sorted[0], max: sorted[sorted.length - 1] }];
    })
    .sort((a, b) => compareTuples(a.min.tuple, b.min.tuple) || a.label.localeCompare(b.label));
}

function partitionViolations(chain: Span[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < chain.length; i++) {
    const prev = chain[i - 1];
    const cur = chain[i];
    if (compareTuples(prev.max.tuple, cur.min.tuple) < 0) continue;
    out.push(
      `  ${prev.label} runs up to ${prev.max.version} (${at(prev.max)}) but ${cur.label} starts ` +
        `at ${cur.min.version} (${at(cur.min)}); the files overlap`,
    );
  }
  return out;
}

const isPartitionException = (file: string, version: string) =>
  CONFIG.partitionExceptions.some((e) => e.file === file && e.version === version);

describe("changelog chain partition", () => {
  const files = lazy(corpusFiles);

  it("every file's newest entry sorts below the next file's oldest", () => {
    const chain = chainSpans(files(), isPartitionException);
    expect(
      chain.length,
      `Derived a ${chain.length}-file chain from ${files().length} corpus files. Every changelog ` +
        `file must contribute at least one versioned heading, or it drops out of this check.`,
    ).toBe(files().length);

    const violations = partitionViolations(chain);
    expect(
      violations,
      `${violations.length} partition violation(s):\n${violations.join("\n")}\n\nAn entry is filed ` +
        `in the wrong file. A roll takes the OLDEST active entry, which is the one at the bottom ` +
        `of ${P.changelog}. Move the entry, verbatim; do not renumber and do not add an exception.`,
    ).toEqual([]);
  });

  it("every declared partition exception is real and load-bearing", () => {
    for (const e of CONFIG.partitionExceptions) {
      const found = files().flatMap((f) =>
        versionedIn(f)
          .filter((h) => h.version === e.version)
          .map((h) => f.label),
      );
      expect(
        found,
        `Partition exception ${e.version} is declared in ${e.file} but found in ` +
          `${JSON.stringify(found)}. Delete a stale exception; a moved one means a sealed archive was edited.`,
      ).toEqual([e.file]);

      const without = partitionViolations(
        chainSpans(files(), (file, version) => isPartitionException(file, version) && !(file === e.file && version === e.version)),
      );
      expect(
        without.length,
        `Removing the ${e.version} exception no longer breaks the partition, so it does nothing; delete it.`,
      ).toBeGreaterThan(0);
    }
  });
});

// ─── CLAUDE.md limits block ─────────────────────────────────────────────────
//
// The written limits must never drift from the enforced ones. Each CONFIG
// limit is matched by the phrase(s) its line in the skill's limits.md uses,
// and every captured number must equal the CONFIG value.

const LIMIT_PHRASES: Record<keyof typeof CONFIG.limits, RegExp[]> = {
  changelogWindow: [/holds at most (\d+) entries/],
  sealSize: [/fewer than (\d+) entries/, /at (\d+) it seals/, /holds exactly (\d+) entries/],
  indexCellMax: [/at most (\d+) characters/],
  preambleMaxLines: [/at most (\d+) non-blank preamble lines/i],
};

describe("CLAUDE.md limits block", () => {
  it("states every CONFIG limit, with CONFIG's value", () => {
    const { start, end } = CONFIG.claudeLimitsMarkers;
    expect(existsSync(abs(P.claudeMd)), `${P.claudeMd} not found at the repo root.`).toBe(true);
    const text = read(P.claudeMd);
    const s = text.split(start).length - 1;
    const e = text.split(end).length - 1;
    expect(
      [s, e],
      `${P.claudeMd} must carry "${start}" and "${end}" exactly once each; found ${s} and ${e}.`,
    ).toEqual([1, 1]);
    const block = text.slice(text.indexOf(start) + start.length, text.indexOf(end));
    expect(text.indexOf(start), `"${start}" must come before "${end}".`).toBeLessThan(text.indexOf(end));
    expect(block, `The limits block still holds an unfilled {{placeholder}}.`).not.toMatch(/\{\{/);

    const problems: string[] = [];
    for (const [key, value] of Object.entries(CONFIG.limits)) {
      const phrases = LIMIT_PHRASES[key as keyof typeof CONFIG.limits];
      if (!phrases) {
        problems.push(`  ${key}: no phrase registered in LIMIT_PHRASES`);
        continue;
      }
      for (const re of phrases) {
        const found = [...block.matchAll(new RegExp(re.source, re.flags + "g"))].map((m) => Number(m[1]));
        if (found.length === 0) problems.push(`  ${key}: no line matching ${re}`);
        for (const n of found.filter((n) => n !== value))
          problems.push(`  ${key}: block says ${n} (${re}), CONFIG says ${value}`);
      }
    }
    expect(
      problems,
      `The ${P.claudeMd} limits block disagrees with CONFIG:\n${problems.join("\n")}\n\nRegenerate ` +
        `the block from the doc-system skill's reference/limits.md with CONFIG's values.`,
    ).toEqual([]);
  });
});

// ─── template tokens ────────────────────────────────────────────────────────
//
// A seeded doc that keeps a template token reads as finished while a value is
// missing. Code is exempt, since a fence or an inline span may show a token on
// purpose. Code spans are matched within one line.

const TOKEN_RE = /\{\{[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*\}\}/g;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const CODE_SPAN_RE = /(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;
const T = CONFIG.templateTokens;

type TokenHit = { file: string; line: number; token: string };

function tokenFiles(): { listed: string; files: string[] }[] {
  return T.files.map((listed) => {
    if (!listed.endsWith("/")) return { listed, files: existsSync(abs(listed)) ? [listed] : [] };
    if (!existsSync(abs(listed))) return { listed, files: [] };
    const dir = listed.slice(0, -1);
    return { listed, files: readdirSync(abs(dir)).filter((f) => f.endsWith(".md")).sort().map((f) => `${dir}/${f}`) };
  });
}

function tokenHitsIn(file: string): TokenHit[] {
  const hits: TokenHit[] = [];
  let fence: string | null = null;
  read(file)
    .split("\n")
    .forEach((text, i) => {
      const m = text.match(FENCE_RE);
      if (fence) {
        if (m && m[1][0] === fence[0] && m[1].length >= fence.length && text.trim() === m[1]) fence = null;
        return;
      }
      if (m) {
        fence = m[1];
        return;
      }
      for (const token of text.replace(CODE_SPAN_RE, " ").match(TOKEN_RE) ?? [])
        hits.push({ file, line: i + 1, token });
    });
  return hits;
}

const isAllowedToken = (h: TokenHit) => T.allow.some((a) => a.file === h.file && a.token === h.token);

describe("template tokens", () => {
  const hits = lazy(() => tokenFiles().flatMap((t) => t.files.flatMap(tokenHitsIn)));

  it("every file listed for the template token check exists", () => {
    const missing = tokenFiles()
      .filter((t) => t.files.length === 0)
      .map((t) => `  ${t.listed}`);
    expect(
      missing,
      `Listed in CONFIG.templateTokens.files but not found (or, for a directory, holding no .md ` +
        `file):\n${missing.join("\n")}\n\nA listed path that matches nothing is checked by nothing. ` +
        `Fix the path, or remove it if the doc no longer exists.`,
    ).toEqual([]);
  });

  it("no doc keeps an unfilled template token outside code", () => {
    const bad = hits()
      .filter((h) => !isAllowedToken(h))
      .map((h) => `  ${h.file}:${h.line}  ${h.token}`);
    expect(
      bad,
      `${bad.length} unfilled template token(s) outside code:\n${bad.join("\n")}\n\nFill each one ` +
        `with its real value. If the text is meant to show the token, put it in inline code or a ` +
        `fence; if the project keeps it on purpose, add a CONFIG.templateTokens.allow entry with ` +
        `its file, the token and a reason.`,
    ).toEqual([]);
  });

  it("every allowed template token carries a reason", () => {
    const missing = T.allow.filter((a) => !a.reason || a.reason.trim() === "").map((a) => `  ${JSON.stringify(a)}`);
    expect(missing, `Template token allowance(s) without a reason:\n${missing.join("\n")}`).toEqual([]);
  });

  it("every allowed template token is still present in its file", () => {
    const stale = T.allow
      .filter((a) => !hits().some((h) => h.file === a.file && h.token === a.token))
      .map((a) => `  ${a.file}  ${a.token}`);
    expect(
      stale,
      `Template token allowance(s) matching nothing outside code:\n${stale.join("\n")}\n\nA stale ` +
        `allowance widens the rule for nothing; delete it.`,
    ).toEqual([]);
  });
});

// ─── settings ratchet ───────────────────────────────────────────────────────
//
// In auto mode an edit under .claude/ is judged by a classifier, not shown to
// the user, so a deleted rule would go unnoticed until the action it gated ran.

const S = CONFIG.settingsRules;

describe("settings ratchet", () => {
  it("every listed deny and ask rule is still in the committed settings file", () => {
    const listed = S.deny.length + S.ask.length;
    if (listed === 0) return;
    expect(existsSync(abs(S.file)), `${S.file} not found; CONFIG.settingsRules lists ${listed} rule(s) for it.`).toBe(true);
    let perms: Record<string, unknown> = {};
    try {
      perms = (JSON.parse(read(S.file)) as { permissions?: Record<string, unknown> }).permissions ?? {};
    } catch (e) {
      expect.fail(`${S.file} does not parse as JSON: ${(e as Error).message}`);
    }
    const list = (kind: string) => (Array.isArray(perms[kind]) ? (perms[kind] as unknown[]) : []);
    const missing = [
      ...S.deny.filter((r) => !list("deny").includes(r)).map((r) => `  deny  ${r}`),
      ...S.ask.filter((r) => !list("ask").includes(r) && !list("deny").includes(r)).map((r) => `  ask   ${r}`),
    ];
    expect(
      missing,
      `${missing.length} permission rule(s) listed in CONFIG.settingsRules are missing from ` +
        `${S.file}:\n${missing.join("\n")}\n\nPut each rule back. If one was removed on purpose, ` +
        `remove its CONFIG entry in the same commit, with the reason in the commit message.`,
    ).toEqual([]);
  });
});
