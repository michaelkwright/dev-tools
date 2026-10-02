// Regenerate the {{RATCHET_NAME}} snapshot.
// Seeded from dev-tools @ {{DEV_TOOLS_SHA}}; this file is now the project's own.
//
// TEMPLATE. Every value to fill is marked PLACEHOLDER below; nothing else needs
// to change. The walker module must export:
//   scan(): { sites: RatchetSite[]; parseFailures: ParseFailure[] }
//   KEY_FIELDS: readonly string[]
//   SNAPSHOT_PATH: string (absolute)
//
//   node <this file>            write the snapshot, print the summary
//   node <this file> --dry-run  print the summary, write nothing
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
import { planRegen, serializeSnapshot, type Snapshot, type StatusConfig } from "{{CORE_MODULE}}"; // PLACEHOLDER: path to ratchet-core.ts, relative to this file
import { KEY_FIELDS, SNAPSHOT_PATH, scan } from "{{WALKER_MODULE}}"; // PLACEHOLDER: path to the walker, relative to this file

// PLACEHOLDER: the worklist status new violations are added with.
const WORKLIST_STATUS = "{{WORKLIST_STATUS}}";

// PLACEHOLDER: the same status declarations as the test, so kept entries the
// test will reject are flagged here too. Leave {} to skip that warning.
const STATUSES: StatusConfig = {};

// PLACEHOLDER: the snapshot's $comment lines. State what an entry means, what
// the target is, and that the test never rewrites the file.
const COMMENT = ["{{SNAPSHOT_COMMENT}}"];

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
