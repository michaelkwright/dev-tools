// Regenerate the fixture-date anchoring snapshot.
// Seeded from dev-tools @ {{DEV_TOOLS_SHA}}; this file is now the project's own.
//
// Instantiated from regen-template.ts.
//
//   npm run regen:fixture-dates              write the snapshot, print the summary
//   npm run regen:fixture-dates -- --dry-run print the summary, write nothing
//
// The ratchet test never calls this; its diff is meant to be read.
// Why: a snapshot the test regenerates for itself absorbs every new violation
// silently, which deletes the ratchet it exists to be.
//
// Every surviving key keeps its status and justification; a new violation is
// added with the worklist status; a vanished key is dropped; a compliant site,
// or one whose status is derived from source, never gets an entry.
// Why: a re-key after a rename must not silently promote a worklist entry to
// an exemption, and an entry for a fixed site pads the worklist.
//
// It refuses to write when the walker reports a parse failure or finds nothing.
// Why: a file the walker cannot read loses its sites, and writing then would
// drop their entries as if they had been fixed.
import { readFileSync, writeFileSync } from "node:fs";
import { planRegen, serializeSnapshot, type Snapshot, type StatusConfig } from "../ratchet-core.ts";
import { KEY_FIELDS, SNAPSHOT_PATH, scan } from "./walker.ts";

const WORKLIST_STATUS = "KNOWN_OPEN";

// Keep in step with STATUSES in fixture-date-anchoring.test.ts.
const STATUSES: StatusConfig = {
  KNOWN_OPEN: { kind: "worklist" },
  CLOCK_PINNED: { kind: "derived" },
  FIXED_BY_DESIGN: { kind: "exempt" },
};

const COMMENT = [
  "Seeded by regen.ts, hand-maintained after; see fixture-date-anchoring.test.ts.",
  "Each entry is a literal date in a temporal fixture position: a test with an expiry date.",
  "KNOWN_OPEN: target zero. Anchor the fixture with daysAgo()/dateDaysAgo() from clock.ts,",
  "then delete its entry. CI fails on a literal site with no entry, and on an entry whose",
  "site is anchored, clock-pinned or gone.",
  "FIXED_BY_DESIGN: literal forever, and requires a non-empty justification.",
  "CLOCK_PINNED is derived from source and never appears here.",
  "The test never rewrites this file; regenerate with npm run regen:fixture-dates and read the diff.",
];

const dryRun = process.argv.includes("--dry-run");

const result = scan();
if (result.parseFailures.length > 0) {
  console.error("regen: the walker could not parse these files; fix them first, nothing written:");
  for (const p of result.parseFailures) console.error(`  ${p.file}: ${p.reason}`);
  process.exit(1);
}
if (result.sites.length === 0) {
  console.error("regen: the walker found zero sites; check its roots before seeding, nothing written");
  process.exit(1);
}

let previous: Snapshot | null = null;
try {
  previous = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as Snapshot;
} catch (e) {
  if ((e as { code?: string }).code !== "ENOENT") throw e;
  // First run: nothing to carry forward.
}

const next = planRegen({
  keyFields: KEY_FIELDS,
  sites: result.sites,
  previous,
  worklistStatus: WORKLIST_STATUS,
  statuses: STATUSES,
});

const byStatus = new Map<string, number>();
for (const e of next.entries) byStatus.set(e.status, (byStatus.get(e.status) ?? 0) + 1);

console.log(`sites: ${result.sites.length}, entries: ${next.entries.length}`);
for (const [status, n] of [...byStatus].sort((a, b) => b[1] - a[1])) console.log(`  ${status.padEnd(18)} ${n}`);
for (const k of next.added) console.log(`  + ${k}`);
for (const k of next.removed) console.log(`  - ${k}`);
for (const w of next.warnings) console.log(`  ! ${w}`);
console.log(`added ${next.added.length}, removed ${next.removed.length}, kept ${next.kept.length}`);

if (dryRun) {
  console.log("dry run: nothing written");
} else {
  writeFileSync(SNAPSHOT_PATH, serializeSnapshot(KEY_FIELDS, next.entries, COMMENT));
  console.log(`wrote ${SNAPSHOT_PATH}`);
}
