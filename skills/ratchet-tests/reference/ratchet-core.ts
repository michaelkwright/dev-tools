// Ratchet core: the generic half of a bidirectional snapshot ratchet test.
// Seeded from dev-tools @ {{DEV_TOOLS_SHA}}; this file is now the project's own.
//
// A ratchet test enumerates every site of one pattern from source, gives each a
// compliant/violation verdict, and holds the violations to a checked-in
// snapshot (the worklist). This module is the part every such test shares. It
// imports nothing: the caller's walker reads the source, and the caller's test
// reads the snapshot and hands both in. It never writes the snapshot or any
// other file.
// Why: a test that rewrites the file it asserts against is a log, not a ratchet.
//
// checkRatchet() returns one failure per problem, each naming the site's key,
// never a line number:
//   (a) a violation with no entry          new violation: fix it or add an entry
//   (b) an entry whose site is compliant   fixed: delete this entry
//   (c) an entry whose site is gone        stale: delete this entry
//   (d) an exempt entry with no justification, or an undeclared status
//   (e) an entry carrying a retired status
//   (f) an entry claiming a derived status
//   (g) zero enumerated sites (or fewer than minSites), or zero files walked
//       when the caller reports filesWalked
//   (h) any file the walker could not parse
//   (i) a required compliance shape with no sites, or an absent one with any
//   (j) a key field whose name or value looks like a line number
// plus "snapshot" for a malformed snapshot or duplicate entry keys, and
// "walker" for duplicate site keys or an undeclared derived status on a site.
//
// The rules behind them:
//
// The ratchet runs in both directions: (a) stops the list understating the
// problem, (b) and (c) stop it padding it.
// Why: a list that keeps entries for fixed sites stops being a worklist, and
// its count stops being a number anyone can trust.
//
// The guard fails on its own failure: (g), (h) and (i).
// Why: a walker that finds nothing and a repo with nothing wrong must never be
// indistinguishable.
//
// A shape declared absent is checked both ways: (i) also fails once it has a
// site.
// Why: a declaration is an entry; it goes stale like one.
//
// Keys are a declared tuple of fields, and none of them may be a line number.
// Why: a line number moves on every unrelated edit above it, which turns the
// ratchet into noise.
//
// A worklist status needs no justification; an exempt status requires one.
// Why: a hundred rubber-stamped justifications on a worklist are worse than
// none, while an exemption is permanent and should cost a sentence.
//
// A retired status fails by name.
// Why: an emptied worklist category left standing invites new debt to be
// parked in it rather than fixed or justified.
//
// A derived status is computed from source by the caller and never claimed by
// an entry; a site that derives one needs no entry.
// Why: a claimed status can outlive the fact it claims, and a derived one
// cannot.

export type Verdict = "compliant" | "violation";

/** worklist: open, target zero. exempt: permanent, justified. derived: computed from source, never in the snapshot. retired: rejected by name. */
export type StatusKind = "worklist" | "exempt" | "derived" | "retired";

export type StatusConfig = Record<string, { kind: StatusKind; note?: string }>;

/** "required": at least one compliant site must have this shape. { absent }: none may, for this reason. */
export type ShapeConfig = Record<string, "required" | { absent: string }>;

export type RuleId = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "snapshot" | "walker";

/**
 * One enumerated site. The key fields are top-level properties named by
 * keyFields; everything else below is the verdict and its context.
 */
export interface RatchetSite {
  verdict: Verdict;
  /** For a compliant site: which compliance shape it matched. */
  shape?: string;
  /** A status the walker derived from source; the site then needs no entry. */
  derivedStatus?: string;
  /** Shown beside the key in messages, e.g. the offending literal. Never part of the key. */
  detail?: string;
  [field: string]: unknown;
}

export interface SnapshotEntry {
  status: string;
  justification?: string;
  [field: string]: unknown;
}

export interface Snapshot {
  $comment?: string[];
  entries: SnapshotEntry[];
}

export interface ParseFailure {
  file: string;
  reason: string;
}

export interface RatchetInput {
  /** The key tuple, in order, e.g. ["file", "symbol", "key", "ordinal"]. */
  keyFields: readonly string[];
  statuses: StatusConfig;
  shapes: ShapeConfig;
  sites: readonly RatchetSite[];
  /** The parsed snapshot file, as read by the caller. */
  snapshot: unknown;
  parseFailures: readonly ParseFailure[];
  /** Compliant-site count per shape, e.g. from countShapes(sites). */
  shapeCounts: Record<string, number>;
  /** The command that regenerates the snapshot, quoted in messages. */
  regenCommand?: string;
  /** Fewer enumerated sites than this fails rule (g). Default 1. */
  minSites?: number;
  /**
   * Files the walker read. When given, zero fails rule (g) on its own message,
   * which points at the roots and globs rather than the pattern.
   */
  filesWalked?: number;
}

export interface RatchetFailure {
  rule: RuleId;
  /** The display key of the site or entry, when the failure has one. */
  key?: string;
  message: string;
}

const LINE_NAME = new Set([
  "line", "lines", "lineno", "linenum", "linenumber", "ln", "lnum", "loc",
  "row", "col", "column", "pos", "position", "start", "end",
]);

// path:42, path:42:7, #L42, #L42-L50, or a bare "line 42" / "L42".
const LINE_VALUE = /\.[A-Za-z0-9]{1,6}:\d+(?::\d+)?$|#L\d+(?:-L?\d+)?$|^(?:line\s*|L)\d+$/i;

export class RatchetKeyError extends Error {}

function normName(name: string): string {
  return name.toLowerCase().replace(/[_\-\s]/g, "");
}

/** Throws RatchetKeyError if any key field is named like a line number. */
export function assertKeyFields(keyFields: readonly string[]): void {
  if (keyFields.length === 0) throw new RatchetKeyError("keyFields is empty: a key needs at least one field");
  for (const f of keyFields) {
    if (LINE_NAME.has(normName(f))) {
      throw new RatchetKeyError(
        `key field "${f}" looks like a line number. Key on a structural position instead ` +
          `(enclosing symbol plus an ordinal); a line number moves on every edit above it.`,
      );
    }
  }
}

/**
 * The display key of a site or entry: its key-field values joined by " :: ".
 * Throws RatchetKeyError on a missing field, a non-string/number value, or a
 * value that looks like a line reference.
 */
export function keyOf(keyFields: readonly string[], record: Record<string, unknown>): string {
  assertKeyFields(keyFields);
  const parts: string[] = [];
  for (const f of keyFields) {
    const v = record[f];
    if (typeof v !== "string" && typeof v !== "number") {
      throw new RatchetKeyError(`key field "${f}" is missing or not a string/number in ${JSON.stringify(record)}`);
    }
    if (typeof v === "string" && LINE_VALUE.test(v)) {
      throw new RatchetKeyError(
        `key field "${f}" has value ${JSON.stringify(v)}, which looks like a line reference; ` +
          `keys never carry line numbers`,
      );
    }
    parts.push(String(v));
  }
  return parts.join(" :: ");
}

/** Compliant-site count per shape. */
export function countShapes(sites: readonly RatchetSite[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of sites) {
    if (s.verdict === "compliant" && s.shape) counts[s.shape] = (counts[s.shape] ?? 0) + 1;
  }
  return counts;
}

/** Every rule (a)-(j), checked; an empty array means the ratchet holds. Never throws, never writes. */
export function checkRatchet(input: RatchetInput): RatchetFailure[] {
  const failures: RatchetFailure[] = [];
  const fail = (rule: RuleId, message: string, key?: string) => failures.push({ rule, key, message });
  const regen = input.regenCommand ? `\`${input.regenCommand}\`` : "the regen script";

  // (j) the key tuple itself. Nothing below is meaningful without it.
  try {
    assertKeyFields(input.keyFields);
  } catch (e) {
    fail("j", (e as Error).message);
    return failures;
  }

  // Status declarations.
  const kindOf = (s: string) => (Object.hasOwn(input.statuses, s) ? input.statuses[s].kind : undefined);
  const declared = Object.keys(input.statuses);

  // (h) parse failures, each by name.
  for (const p of input.parseFailures) {
    fail("h", `could not parse ${p.file}: ${p.reason}. The walker never skips a file; fix the file or the walker.`);
  }

  // (g) non-vacuity floor.
  if (input.filesWalked === 0) {
    fail(
      "g",
      `walked 0 files. The roots or include globs match nothing, so no site could be seen; ` +
        `an empty walk must not read as a clean repo.`,
    );
  }
  const floor = input.minSites ?? 1;
  if (input.sites.length < floor) {
    fail(
      "g",
      `enumerated ${input.sites.length} site(s), below the floor of ${floor}. A walker that finds ` +
        `nothing must not read as a repo with nothing wrong: check the walker's roots and patterns.`,
    );
  }

  // (i) every required compliance shape is represented, and no absent one is.
  for (const [shape, decl] of Object.entries(input.shapes)) {
    const n = input.shapeCounts[shape] ?? 0;
    if (decl === "required") {
      if (n < 1) {
        fail(
          "i",
          `compliance shape "${shape}" has no sites. Either the walker stopped recognising it, or the ` +
            `shape is genuinely gone; then declare it { absent: "<reason>" }.`,
        );
      }
      continue;
    }
    if (typeof decl?.absent !== "string" || decl.absent.trim() === "") {
      fail("i", `compliance shape "${shape}" is declared absent with an empty reason; say why it has no sites.`);
    }
    if (n >= 1) {
      fail("i", `compliance shape "${shape}" is declared absent but has ${n} site(s): change it to required.`);
    }
  }
  for (const shape of Object.keys(input.shapeCounts)) {
    if (!Object.hasOwn(input.shapes, shape)) {
      fail("i", `compliance shape "${shape}" is counted but not declared; declare it so its absence is checked too.`);
    }
  }

  // Sites, keyed.
  const siteByKey = new Map<string, RatchetSite>();
  for (const s of input.sites) {
    let key: string;
    try {
      key = keyOf(input.keyFields, s);
    } catch (e) {
      fail("j", (e as Error).message);
      continue;
    }
    if (siteByKey.has(key)) {
      fail("walker", `two sites share the key ${key}; the walker's ordinal is not disambiguating them.`, key);
      continue;
    }
    if (s.derivedStatus !== undefined && kindOf(s.derivedStatus) !== "derived") {
      fail("walker", `site ${key} derives status "${s.derivedStatus}", which is not declared as derived.`, key);
    }
    if (s.verdict === "compliant" && s.shape !== undefined && !Object.hasOwn(input.shapes, s.shape)) {
      fail("i", `site ${key} is compliant via undeclared shape "${s.shape}".`, key);
    }
    siteByKey.set(key, s);
  }

  // The snapshot.
  const snap = input.snapshot as Partial<Snapshot> | null;
  if (!snap || typeof snap !== "object" || !Array.isArray(snap.entries)) {
    fail("snapshot", `the snapshot is not an object with an "entries" array; run ${regen} to seed it.`);
    return failures;
  }

  const entryByKey = new Map<string, SnapshotEntry>();
  for (const raw of snap.entries) {
    const e = raw as SnapshotEntry;
    let key: string;
    try {
      key = keyOf(input.keyFields, e);
    } catch (err) {
      fail("j", (err as Error).message);
      continue;
    }
    if (entryByKey.has(key)) {
      fail("snapshot", `duplicate entry ${key}; delete one.`, key);
      continue;
    }
    entryByKey.set(key, e);

    const kind = kindOf(e.status);
    if (kind === undefined) {
      fail("d", `entry ${key} has undeclared status ${JSON.stringify(e.status)}; declared: ${declared.join(", ")}.`, key);
      continue;
    }
    if (kind === "retired") {
      const note = input.statuses[e.status].note;
      fail(
        "e",
        `entry ${key} carries ${e.status}, which is retired${note ? ` (${note})` : ""}. Fix the site, or ` +
          `give it a declared status; a retired status is never reused.`,
        key,
      );
      continue;
    }
    if (kind === "derived") {
      fail(
        "f",
        `entry ${key} claims ${e.status}, which is derived from source and never claimed by an entry: ` +
          `delete this entry (a site that derives it needs none).`,
        key,
      );
      continue;
    }
    if (kind === "exempt" && (typeof e.justification !== "string" || e.justification.trim() === "")) {
      fail("d", `entry ${key} is ${e.status}, which requires a non-empty justification; say why it is exempt.`, key);
    }

    // (b) and (c): does the entry still name a live violation?
    const site = siteByKey.get(key);
    if (!site) {
      fail("c", `stale: delete this entry: ${key}. No such site any more (deleted, renamed or moved); re-key with ${regen} and read the diff.`, key);
    } else if (site.verdict === "compliant") {
      fail("b", `fixed: delete this entry: ${key}. The site is now compliant${site.shape ? ` (${site.shape})` : ""}.`, key);
    } else if (site.derivedStatus !== undefined) {
      fail("b", `fixed: delete this entry: ${key}. The site now derives ${site.derivedStatus} from source, which needs no entry.`, key);
    }
  }

  // (a) every violation that derives no status has an entry.
  for (const [key, s] of siteByKey) {
    if (s.verdict !== "violation" || s.derivedStatus !== undefined) continue;
    if (!entryByKey.has(key)) {
      fail(
        "a",
        `new violation: fix it or add an entry: ${key}${s.detail ? `  ${s.detail}` : ""}. New code gets ` +
          `no entry; add one only for a deliberate exemption, via ${regen}.`,
        key,
      );
    }
  }

  return failures;
}

/** The failures as one readable block, for an assertion message. */
export function formatFailures(failures: readonly RatchetFailure[]): string {
  return failures.map((f) => `(${f.rule}) ${f.message}`).join("\n");
}

// ── Regeneration planning ────────────────────────────────────────────────────
// Pure functions the regen script calls. They compute the next snapshot; the
// script, never this module, writes it.

export interface RegenPlan {
  entries: SnapshotEntry[];
  added: string[];
  removed: string[];
  kept: string[];
  /** Kept entries the test will still reject (retired, derived, undeclared or unjustified status). */
  warnings: string[];
}

/**
 * The next snapshot: every surviving key keeps its status and justification,
 * every new violation is added with the worklist status, vanished keys drop,
 * and no compliant or derived-status site ever gets an entry.
 */
export function planRegen(args: {
  keyFields: readonly string[];
  sites: readonly RatchetSite[];
  previous: Snapshot | null;
  worklistStatus: string;
  statuses?: StatusConfig;
}): RegenPlan {
  const { keyFields, sites, worklistStatus, statuses } = args;
  const prior = new Map<string, SnapshotEntry>();
  for (const e of args.previous?.entries ?? []) prior.set(keyOf(keyFields, e), e);

  const entries: SnapshotEntry[] = [];
  const added: string[] = [];
  const kept: string[] = [];
  const warnings: string[] = [];
  const live = new Set<string>();

  for (const s of sites) {
    if (s.verdict !== "violation" || s.derivedStatus !== undefined) continue;
    const key = keyOf(keyFields, s);
    live.add(key);
    const entry: SnapshotEntry = { status: worklistStatus };
    for (const f of keyFields) entry[f] = s[f];
    const old = prior.get(key);
    if (old) {
      entry.status = old.status;
      if (old.justification !== undefined) entry.justification = old.justification;
      kept.push(key);
      const kind = statuses && Object.hasOwn(statuses, old.status) ? statuses[old.status].kind : undefined;
      if (statuses && (kind === undefined || kind === "retired" || kind === "derived")) {
        warnings.push(`${key} keeps status ${old.status}, which the test rejects; fix it by hand`);
      } else if (kind === "exempt" && !(old.justification ?? "").trim()) {
        warnings.push(`${key} keeps ${old.status} with no justification, which the test rejects`);
      }
    } else {
      added.push(key);
    }
    entries.push(reorder(keyFields, entry));
  }

  const removed = [...prior.keys()].filter((k) => !live.has(k));
  return { entries: sortEntries(keyFields, entries), added, removed, kept, warnings };
}

function reorder(keyFields: readonly string[], e: SnapshotEntry): SnapshotEntry {
  const out: Record<string, unknown> = {};
  for (const f of keyFields) out[f] = e[f];
  out.status = e.status;
  if (e.justification !== undefined) out.justification = e.justification;
  return out as SnapshotEntry;
}

function cmp(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Entries in stable order: by each key field in declared order (numbers numerically, strings by code unit). */
export function sortEntries(keyFields: readonly string[], entries: readonly SnapshotEntry[]): SnapshotEntry[] {
  return [...entries].sort((p, q) => {
    for (const f of keyFields) {
      const c = cmp(p[f], q[f]);
      if (c !== 0) return c;
    }
    return 0;
  });
}

/** The snapshot file's text: two-space JSON, stable order, trailing newline. */
export function serializeSnapshot(keyFields: readonly string[], entries: readonly SnapshotEntry[], comment: readonly string[]): string {
  const body: Snapshot = { $comment: [...comment], entries: sortEntries(keyFields, entries).map((e) => reorder(keyFields, e)) };
  return `${JSON.stringify(body, null, 2)}\n`;
}
