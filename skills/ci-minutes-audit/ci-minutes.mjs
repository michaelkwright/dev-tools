#!/usr/bin/env node
// ci-minutes.mjs — read-only GitHub Actions minutes analyzer.
//
// Single file, Node 22+, no npm dependencies, no imports from any repo. It
// shells out to the `gh` CLI and only ever issues GET requests (asserted in
// `assertReadOnly`, the single choke point every `gh` invocation goes through).
//
// Usage:
//   node ci-minutes.mjs [--repo owner/name] [--since YYYY-MM-DD] [--until YYYY-MM-DD]
//        [--docs-only-job "<job name>"]... [--out report.md] [--cache-dir DIR]
//        [--step-regex category=REGEX]... [--refresh]
//
// All dates are UTC. Nothing here is specific to any one repository.

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------- arguments

const HELP = `ci-minutes.mjs — read-only GitHub Actions minutes analyzer

  --repo owner/name        default: the current repo (gh repo view)
  --since YYYY-MM-DD       default: first of the current UTC month
  --until YYYY-MM-DD       default: today (UTC), inclusive
  --docs-only-job NAME     job name that marks a docs-only run (repeatable, optional)
  --out PATH.md            also write PATH.md and a sibling PATH.json of raw aggregates
  --cache-dir DIR          default: <tmp>/ci-minutes-audit/<owner>__<repo>
  --step-regex CAT=REGEX   override a step-category regex (repeatable); CAT is one of
                           setup, install, build, test
  --refresh                ignore cached API responses
`;

function parseArgs(argv) {
  const a = { docsOnlyJobs: [], stepRegex: {}, refresh: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => {
      if (i + 1 >= argv.length) throw new Error(`${k} needs a value`);
      return argv[++i];
    };
    if (k === "--repo") a.repo = v();
    else if (k === "--since") a.since = v();
    else if (k === "--until") a.until = v();
    else if (k === "--docs-only-job") a.docsOnlyJobs.push(v());
    else if (k === "--out") a.out = v();
    else if (k === "--cache-dir") a.cacheDir = v();
    else if (k === "--step-regex") {
      const s = v();
      const eq = s.indexOf("=");
      if (eq < 1) throw new Error("--step-regex expects CATEGORY=REGEX");
      a.stepRegex[s.slice(0, eq)] = s.slice(eq + 1);
    } else if (k === "--refresh") a.refresh = true;
    else if (k === "--help" || k === "-h") {
      process.stdout.write(HELP);
      process.exit(0);
    } else throw new Error(`unknown argument ${k}`);
  }
  return a;
}

// ------------------------------------------------------------------ gh (GET only)

let apiCalls = 0;
let cacheHits = 0;

/** Every gh invocation passes through here. Reads only. */
function assertReadOnly(args) {
  const head = args[0];
  if (head === "api") {
    const mi = args.indexOf("--method");
    if (mi < 0 || args[mi + 1] !== "GET") throw new Error("read-only violation: gh api must carry --method GET");
    const forbidden = ["-X", "-f", "-F", "--field", "--raw-field", "--input", "--method=POST", "--method=PUT", "--method=PATCH", "--method=DELETE"];
    for (const f of args) if (forbidden.includes(f)) throw new Error(`read-only violation: forbidden gh api flag ${f}`);
    if (args.filter((x) => x === "--method").length !== 1) throw new Error("read-only violation: duplicate --method");
  } else if (head === "repo") {
    if (args[1] !== "view") throw new Error("read-only violation: only `gh repo view` is allowed");
  } else {
    throw new Error(`read-only violation: gh ${head} is not allowed`);
  }
}

function runGh(args) {
  assertReadOnly(args);
  return new Promise((resolve, reject) => {
    const p = spawn("gh", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => resolve({ code, out, err }));
  });
}

let CACHE_DIR = null;
let REFRESH = false;

/** GET one endpoint. Returns { status, data, message }. Caches 200s on disk. */
async function api(endpoint, params = {}, { cacheable = true } = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = qs ? `${endpoint}${endpoint.includes("?") ? "&" : "?"}${qs}` : endpoint;
  const file = path.join(CACHE_DIR, crypto.createHash("sha1").update(url).digest("hex") + ".json");
  if (cacheable && !REFRESH && fs.existsSync(file)) {
    cacheHits++;
    return { status: 200, data: JSON.parse(fs.readFileSync(file, "utf8")), message: "" };
  }
  const { code, out, err } = await runGh(["api", "--method", "GET", "-H", "Accept: application/vnd.github+json", url]);
  apiCalls++;
  let data = null;
  try {
    data = JSON.parse(out);
  } catch {
    /* non-JSON body */
  }
  const m = err.match(/HTTP (\d{3})/);
  const status = code === 0 ? 200 : m ? Number(m[1]) : data && Number(data.status) ? Number(data.status) : 0;
  const message = (data && data.message) || err.trim();
  if ((status === 403 || status === 429) && /rate limit/i.test(message)) {
    throw new Error(`GitHub rate limit hit (${message}). Completed responses are cached in ${CACHE_DIR}; re-run later to resume.`);
  }
  if (cacheable && status === 200 && data !== null) fs.writeFileSync(file, JSON.stringify(data));
  return { status, data, message };
}

async function apiPaged(endpoint, params, listKey, opts) {
  const perPage = 100;
  const all = [];
  for (let page = 1; ; page++) {
    const r = await api(endpoint, { ...params, per_page: perPage, page }, opts);
    if (r.status !== 200) return { status: r.status, items: all, message: r.message };
    const items = listKey ? r.data[listKey] : r.data;
    all.push(...items);
    if (items.length < perPage) break;
  }
  return { status: 200, items: all, message: "" };
}

async function mapPool(items, n, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ------------------------------------------------------------------ helpers

const DAY_MS = 86400000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const parseDay = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`bad date ${s}, want YYYY-MM-DD`);
  return Date.parse(`${s}T00:00:00Z`);
};
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const round1 = (x) => Math.round(x * 10) / 10;
const round2 = (x) => Math.round(x * 100) / 100;
const pct = (n, d) => (d > 0 ? `${round1((n / d) * 100)}%` : "n/a");
function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function table(headers, rows) {
  const line = (cells) => `| ${cells.join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n");
}

// Minutes multipliers per GitHub's classic minutes rule (Linux 1, Windows 2,
// macOS 10). GitHub's current docs quote per-minute dollar rates instead
// (Linux 2-core $0.006, Windows $0.010, macOS $0.062); the report says which
// runner families it saw so a non-Linux repo can be sanity-checked.
function runnerFamily(labels) {
  const l = (labels || []).map((x) => x.toLowerCase());
  if (l.includes("self-hosted")) return "self-hosted";
  if (l.some((x) => x.startsWith("windows"))) return "windows";
  if (l.some((x) => x.startsWith("macos"))) return "macos";
  if (l.some((x) => x.startsWith("ubuntu") || x === "linux")) return "linux";
  return "unknown";
}
const MULTIPLIER = { linux: 1, windows: 2, macos: 10, unknown: 1, "self-hosted": 0 };

const DEFAULT_STEP_REGEX = {
  setup: /^(set up job|complete job|post |run actions\/(checkout|setup-|cache|upload|download)|checkout|.*(setup-\w+|actions\/cache))/i,
  install: /(npm (ci|install|i)\b|pnpm|yarn|pip3? install|pip\b|bundle install|\binstall\b)/i,
  build: /(build|typecheck|tsc\b|lint)/i,
  test: /(test|vitest|jest|pytest)/i,
};
const STEP_CATEGORIES = ["setup", "install", "build", "test", "other"];

function makeStepClassifier(overrides) {
  const res = { ...DEFAULT_STEP_REGEX };
  for (const [k, v] of Object.entries(overrides)) {
    if (!(k in DEFAULT_STEP_REGEX)) throw new Error(`--step-regex category must be one of ${Object.keys(DEFAULT_STEP_REGEX).join(", ")}`);
    res[k] = new RegExp(v, "i");
  }
  return (name) => {
    for (const cat of ["setup", "install", "build", "test"]) if (res[cat].test(name)) return cat;
    return "other";
  };
}

const BLOCK_RE = /not started because|spending limit|payments have failed/i;

// ------------------------------------------------------------------ main

async function main() {
  const args = parseArgs(process.argv.slice(2));
  REFRESH = args.refresh;

  let repo = args.repo;
  if (!repo) {
    const r = await runGh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
    if (r.code !== 0) throw new Error(`could not determine repo (${r.err.trim()}); pass --repo owner/name`);
    repo = r.out.trim();
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`bad --repo ${repo}`);

  const nowMs = Date.now();
  const todayMs = parseDay(isoDay(nowMs));
  const sinceMs = args.since ? parseDay(args.since) : Date.parse(`${isoDay(nowMs).slice(0, 7)}-01T00:00:00Z`);
  const untilMs = args.until ? parseDay(args.until) : todayMs;
  if (untilMs < sinceMs) throw new Error("--until is before --since");
  const since = isoDay(sinceMs);
  const until = isoDay(untilMs);
  const days = [];
  for (let t = sinceMs; t <= untilMs; t += DAY_MS) days.push(isoDay(t));

  CACHE_DIR = args.cacheDir || path.join(os.tmpdir(), "ci-minutes-audit", repo.replace("/", "__"));
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const classifyStep = makeStepClassifier(args.stepRegex);
  const docsOnlyNames = new Set(args.docsOnlyJobs);

  const log = (m) => process.stderr.write(`${m}\n`);

  // rate limit (this endpoint does not count against the core limit)
  const rl0 = await api("/rate_limit", {}, { cacheable: false });
  apiCalls--;
  const rateBefore = rl0.status === 200 ? rl0.data.resources.core : null;

  // repository metadata: visibility and owner type drive billing rules
  const repoInfo = await api(`/repos/${repo}`, {}, { cacheable: false });
  if (repoInfo.status !== 200) throw new Error(`cannot read ${repo}: HTTP ${repoInfo.status} ${repoInfo.message}`);
  const isPrivate = repoInfo.data.private === true;
  const owner = repoInfo.data.owner.login;
  const ownerType = repoInfo.data.owner.type; // "User" | "Organization"

  // ---- a. every workflow run, fetched one UTC day at a time (dodges the
  // 1000-result cap GitHub puts on a filtered listing)
  log(`Fetching runs ${since}..${until} for ${repo}`);
  const runsByDay = await mapPool(days, 6, async (d) => {
    const r = await apiPaged(`/repos/${repo}/actions/runs`, { created: `${d}..${d}` }, "workflow_runs", { cacheable: parseDay(d) < todayMs });
    if (r.status !== 200) throw new Error(`runs list failed for ${d}: HTTP ${r.status} ${r.message}`);
    return r.items;
  });
  const rawRuns = runsByDay.flat();
  const seenRun = new Set();
  const runs = rawRuns.filter((r) => (seenRun.has(r.id) ? false : seenRun.add(r.id)));

  // sanity: the single-range listing should report the same total
  const rangeTotal = await api(`/repos/${repo}/actions/runs`, { created: `${since}..${until}`, per_page: 1 }, { cacheable: false });
  const rangeTotalCount = rangeTotal.status === 200 ? rangeTotal.data.total_count : null;

  // ---- b. jobs, timing, block confirmation
  log(`Fetching jobs and timing for ${runs.length} runs`);
  const perRun = await mapPool(runs, 8, async (run) => {
    const done = run.status === "completed";
    const jr = await apiPaged(`/repos/${repo}/actions/runs/${run.id}/jobs`, { filter: "all" }, "jobs", { cacheable: done });
    const tr = await api(`/repos/${repo}/actions/runs/${run.id}/timing`, {}, { cacheable: done });
    return { run, jobs: jr.status === 200 ? jr.items : [], jobsStatus: jr.status, timing: tr };
  });

  // candidates for "blocked before start": failed, no steps, no runner ever assigned
  const isBlockCandidate = (j) => j.conclusion === "failure" && (!j.steps || j.steps.length === 0) && (!j.runner_id || j.runner_id === 0);
  const candidates = [];
  for (const pr of perRun) for (const j of pr.jobs) if (isBlockCandidate(j)) candidates.push(j);
  log(`Confirming ${candidates.length} pre-start failures via check-run annotations`);
  const blockedIds = new Set();
  const startupFailIds = new Set();
  const blockMessages = new Map();
  await mapPool(candidates, 8, async (j) => {
    const r = await api(`/repos/${repo}/check-runs/${j.id}/annotations`, {}, { cacheable: true });
    const texts = r.status === 200 ? r.data.map((a) => a.message || "") : [];
    const hit = texts.find((t) => BLOCK_RE.test(t));
    if (hit) {
      blockedIds.add(j.id);
      blockMessages.set(hit.slice(0, 160), (blockMessages.get(hit.slice(0, 160)) || 0) + 1);
    } else startupFailIds.add(j.id);
  });

  // ---- compute per-job / per-run figures
  const families = new Map();
  const rows = []; // one per run
  const jobRows = []; // one per job that consumed or could have consumed minutes
  for (const { run, jobs, jobsStatus, timing } of perRun) {
    const rj = [];
    let skipped = 0;
    let blockedJobs = 0;
    let incomplete = 0;
    for (const j of jobs) {
      const family = runnerFamily(j.labels);
      families.set(family, (families.get(family) || 0) + 1);
      const startMs = j.started_at ? Date.parse(j.started_at) : null;
      const endMs = j.completed_at ? Date.parse(j.completed_at) : null;
      let kind = "ran";
      if (j.conclusion === "skipped") kind = "skipped";
      else if (blockedIds.has(j.id)) kind = "blocked";
      else if (startupFailIds.has(j.id)) kind = "prestart-failure";
      else if (startMs === null || endMs === null) kind = "incomplete";
      if (kind === "skipped") skipped++;
      if (kind === "blocked") blockedJobs++;
      if (kind === "incomplete") incomplete++;
      const rawSec = kind === "ran" ? Math.max(0, (endMs - startMs) / 1000) : 0;
      const mult = MULTIPLIER[family];
      const free = !isPrivate || family === "self-hosted";
      const billed = kind === "ran" && !free && rawSec > 0 ? Math.ceil(rawSec / 60) * mult : 0;
      const stepSec = Object.fromEntries(STEP_CATEGORIES.map((c) => [c, 0]));
      if (kind === "ran") {
        for (const s of j.steps || []) {
          if (!s.started_at || !s.completed_at) continue;
          const sec = Math.max(0, (Date.parse(s.completed_at) - Date.parse(s.started_at)) / 1000);
          stepSec[classifyStep(s.name)] += sec;
        }
      }
      rj.push({
        id: j.id, name: j.name, family, kind, conclusion: j.conclusion, startMs, endMs, rawSec, rawMinWeighted: (rawSec / 60) * mult,
        billed, mult, free, stepSec, docsOnly: docsOnlyNames.has(j.name),
      });
    }
    const ran = rj.filter((j) => j.kind === "ran");
    const nonSkipped = rj.filter((j) => j.kind !== "skipped");
    const allBlocked = nonSkipped.length > 0 && nonSkipped.every((j) => j.kind === "blocked");
    let cls;
    if (rj.length === 0) cls = "no-jobs";
    else if (allBlocked) cls = "blocked";
    else if (ran.some((j) => j.docsOnly)) cls = "docs-only";
    else if (ran.length === 0) cls = "no-billable";
    else cls = "full";
    const ends = rj.filter((j) => j.endMs && j.kind === "ran").map((j) => j.endMs);
    const runEndMs = ends.length ? Math.max(...ends) : Date.parse(run.updated_at);
    rows.push({
      id: run.id, workflowId: run.workflow_id, workflow: run.name, event: run.event, branch: run.head_branch, sha: run.head_sha,
      status: run.status, conclusion: run.conclusion, attempt: run.run_attempt, createdAt: run.created_at,
      startMs: Date.parse(run.run_started_at || run.created_at), endMs: runEndMs, day: run.created_at.slice(0, 10), cls,
      billed: sum(rj.map((j) => j.billed)), rawMinWeighted: sum(rj.map((j) => j.rawMinWeighted)),
      jobs: rj, skippedJobs: skipped, blockedJobs, incompleteJobs: incomplete, jobsStatus,
      timing: { status: timing.status, data: timing.status === 200 ? timing.data : null, message: timing.message },
    });
    for (const j of rj) jobRows.push({ ...j, runId: run.id, event: run.event, day: run.created_at.slice(0, 10), runCls: cls });
  }

  const totalBilled = sum(rows.map((r) => r.billed));
  const totalRawWeighted = sum(rows.map((r) => r.rawMinWeighted));

  // ---- c. timing endpoint cross-check
  let timingUsable = 0;
  let timingUnusable = 0;
  let timingTotalMs = 0;
  let timingJobs = 0;
  let timingJobDisagree = 0;
  let timingZeroFilled = 0; // timing says 0 ms for a job the jobs endpoint shows ran for > 0 s
  let timingRawAbsDeltaSec = 0;
  let timingBilledFromTiming = 0;
  let timingBilledComputedSameJobs = 0;
  const timingProblems = new Map();
  for (const r of rows) {
    const t = r.timing;
    if (t.status !== 200 || !t.data || !t.data.billable) {
      timingUnusable++;
      timingProblems.set(`HTTP ${t.status} ${t.message}`.slice(0, 120), (timingProblems.get(`HTTP ${t.status} ${t.message}`.slice(0, 120)) || 0) + 1);
      continue;
    }
    timingUsable++;
    const byId = new Map(r.jobs.map((j) => [j.id, j]));
    for (const fam of Object.values(t.data.billable)) {
      timingTotalMs += fam.total_ms || 0;
      for (const jr of fam.job_runs || []) {
        timingJobs++;
        const mine = byId.get(jr.job_id);
        const myMs = mine ? mine.rawSec * 1000 : 0;
        if (jr.duration_ms === 0 && myMs > 0) timingZeroFilled++;
        if (Math.abs(myMs - jr.duration_ms) > 0) {
          timingJobDisagree++;
          timingRawAbsDeltaSec += Math.abs(myMs - jr.duration_ms) / 1000;
        }
        timingBilledFromTiming += jr.duration_ms > 0 ? Math.ceil(jr.duration_ms / 60000) : 0;
        timingBilledComputedSameJobs += mine ? mine.billed : 0;
      }
    }
  }
  const timingRawMin = timingTotalMs / 60000;

  // ---- d. account-level usage
  const usage = { attempted: [], totalMinutes: null, repoMinutes: null, refused: null, note: "" };
  const months = [];
  for (let t = Date.parse(`${since.slice(0, 7)}-01T00:00:00Z`); t <= untilMs; ) {
    const d = new Date(t);
    months.push({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 });
    t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  const usageBase = ownerType === "Organization" ? `/organizations/${owner}/settings/billing/usage` : `/users/${owner}/settings/billing/usage`;
  let acctTotal = 0;
  let acctRepo = 0;
  let acctOk = true;
  const acctBySku = new Map();
  for (const { y, m } of months) {
    const r = await api(usageBase, { year: y, month: m }, { cacheable: false });
    usage.attempted.push({ endpoint: `${usageBase}?year=${y}&month=${m}`, status: r.status, message: r.status === 200 ? "" : r.message });
    if (r.status !== 200) {
      acctOk = false;
      usage.refused = `HTTP ${r.status}: ${r.message}`;
      break;
    }
    for (const it of r.data.usageItems || []) {
      if (String(it.product).toLowerCase() !== "actions") continue;
      if (String(it.unitType).toLowerCase() !== "minutes") continue;
      const q = Number(it.quantity ?? it.netQuantity ?? 0);
      acctTotal += q;
      acctBySku.set(it.sku, (acctBySku.get(it.sku) || 0) + q);
      if (String(it.repositoryName || "").toLowerCase() === repo.split("/")[1].toLowerCase()) acctRepo += q;
    }
  }
  if (acctOk) {
    usage.totalMinutes = acctTotal;
    usage.repoMinutes = acctRepo;
    usage.bySku = Object.fromEntries(acctBySku);
    usage.note = `Calendar-month totals for ${months.map((x) => `${x.y}-${String(x.m).padStart(2, "0")}`).join(", ")} (the API is monthly; the report range may be narrower).`;
  }

  // ---- workflow-file facts (current default branch, not historical)
  const wf = { files: [], cancelInProgress: false, cacheSteps: 0, concurrencyDeclared: false };
  const dir = await api(`/repos/${repo}/contents/.github/workflows`, {}, { cacheable: false });
  if (dir.status === 200 && Array.isArray(dir.data)) {
    for (const f of dir.data.filter((x) => /\.ya?ml$/.test(x.name))) {
      const c = await api(`/repos/${repo}/contents/${f.path}`, {}, { cacheable: false });
      if (c.status !== 200) continue;
      const text = Buffer.from(c.data.content, "base64").toString("utf8");
      const noComments = text.replace(/^\s*#.*$/gm, "");
      const cancel = /cancel-in-progress:\s*true/.test(noComments);
      const conc = /^\s*concurrency:/m.test(noComments);
      const setupCache = (noComments.match(/^\s+cache:\s*\S+/gm) || []).length;
      const actionsCache = (noComments.match(/uses:\s*actions\/cache@/g) || []).length;
      wf.files.push({ file: f.path, cancelInProgress: cancel, concurrency: conc, setupNodeCacheLines: setupCache, actionsCacheSteps: actionsCache });
      wf.cancelInProgress ||= cancel;
      wf.concurrencyDeclared ||= conc;
      wf.cacheSteps += setupCache + actionsCache;
    }
  }

  // ---- e. totals
  const group = (items, keyFn, init, add) => {
    const m = new Map();
    for (const it of items) {
      const k = keyFn(it);
      if (!m.has(k)) m.set(k, init());
      add(m.get(k), it);
    }
    return m;
  };
  const byEvent = group(rows, (r) => r.event, () => ({ runs: 0, billed: 0, raw: 0 }), (a, r) => { a.runs++; a.billed += r.billed; a.raw += r.rawMinWeighted; });
  const byConclusion = group(rows, (r) => r.conclusion || r.status, () => ({ runs: 0, billed: 0 }), (a, r) => { a.runs++; a.billed += r.billed; });
  const byClass = group(rows, (r) => r.cls, () => ({ runs: 0, billed: 0 }), (a, r) => { a.runs++; a.billed += r.billed; });
  const byDay = new Map(days.map((d) => [d, { runs: 0, billed: 0, blocked: 0 }]));
  for (const r of rows) {
    const a = byDay.get(r.day) || { runs: 0, billed: 0, blocked: 0 };
    a.runs++;
    a.billed += r.billed;
    if (r.cls === "blocked") a.blocked++;
    byDay.set(r.day, a);
  }
  const byJob = group(
    jobRows.filter((j) => j.kind !== "skipped"),
    (j) => j.name,
    () => ({ jobs: 0, ranJobs: 0, blockedJobs: 0, billed: 0, raw: 0 }),
    (a, j) => {
      a.jobs++;
      if (j.kind === "ran") a.ranJobs++;
      if (j.kind === "blocked") a.blockedJobs++;
      a.billed += j.billed;
      a.raw += j.rawMinWeighted;
    },
  );
  const skippedByJob = group(jobRows.filter((j) => j.kind === "skipped"), (j) => j.name, () => ({ n: 0 }), (a) => a.n++);

  const stepTotals = Object.fromEntries(STEP_CATEGORIES.map((c) => [c, 0]));
  let jobSecTotal = 0;
  for (const j of jobRows) {
    if (j.kind !== "ran") continue;
    jobSecTotal += j.rawSec;
    for (const c of STEP_CATEGORIES) stepTotals[c] += j.stepSec[c];
  }
  const stepSecTotal = sum(Object.values(stepTotals));

  // ---- f. rounding overhead
  const ranBilledJobs = jobRows.filter((j) => j.kind === "ran" && j.billed > 0);
  const roundingOverhead = sum(ranBilledJobs.map((j) => j.billed - j.rawMinWeighted));
  const shortJobs = ranBilledJobs.filter((j) => j.rawSec < 60);
  const shortJobBilled = sum(shortJobs.map((j) => j.billed));

  // ---- g. cadence + superseded
  const perDayCounts = [...byDay.entries()].map(([d, v]) => ({ d, n: v.runs }));
  const activeDays = perDayCounts.filter((x) => x.n > 0);
  const maxDay = perDayCounts.reduce((a, b) => (b.n > a.n ? b : a), { d: "", n: 0 });
  const grouped = group(rows, (r) => `${r.workflowId}|${r.branch}|${r.event}`, () => [], (a, r) => a.push(r));
  const superseded = [];
  for (const list of grouped.values()) {
    list.sort((a, b) => a.startMs - b.startMs);
    for (let i = 0; i < list.length - 1; i++) {
      const r = list[i];
      const next = list[i + 1];
      if (r.cls === "blocked" || r.billed === 0) continue;
      if (next.startMs < r.endMs) {
        // raw minutes r would not have spent had it been cancelled when `next` started
        let avoidable = 0;
        for (const j of r.jobs) {
          if (j.kind !== "ran" || j.free) continue;
          const from = Math.max(j.startMs, next.startMs);
          avoidable += (Math.max(0, j.endMs - from) / 60000) * j.mult;
        }
        superseded.push({ id: r.id, event: r.event, branch: r.branch, conclusion: r.conclusion, billed: r.billed, cancelled: r.conclusion === "cancelled", avoidableMin: avoidable });
      }
    }
  }
  const supCancelled = superseded.filter((s) => s.cancelled);
  const supCompleted = superseded.filter((s) => !s.cancelled);

  // ---- h. what-ifs
  const docsOnlyRuns = rows.filter((r) => r.cls === "docs-only");
  const whatIf1 = { given: docsOnlyNames.size > 0, runs: docsOnlyRuns.length, saved: sum(docsOnlyRuns.map((r) => r.billed)) };

  const whatIf2 = {
    alreadyConfigured: wf.cancelInProgress,
    supersededRuns: superseded.length,
    supersededBilled: sum(superseded.map((s) => s.billed)),
    alreadyCancelledRuns: supCancelled.length,
    alreadyCancelledBilled: sum(supCancelled.map((s) => s.billed)),
    completedRuns: supCompleted.length,
    completedBilled: sum(supCompleted.map((s) => s.billed)),
    savedEstimate: sum(supCompleted.map((s) => s.avoidableMin)),
  };

  const pushRows = rows.filter((r) => r.event === "push");
  const fullPush = pushRows.filter((r) => r.cls === "full");
  const fullMedianAll = median(fullPush.filter((r) => r.conclusion === "success" || r.conclusion === "failure").map((r) => r.billed));
  const nightlyDays = [];
  const pushByDay = group(pushRows, (r) => r.day, () => [], (a, r) => a.push(r));
  for (const [d, list] of [...pushByDay.entries()].sort()) {
    const full = list.filter((r) => r.cls === "full");
    if (!full.length) continue;
    const settled = full.filter((r) => r.conclusion === "success" || r.conclusion === "failure");
    const med = median((settled.length ? settled : full).map((r) => r.billed));
    nightlyDays.push({ day: d, fullRuns: full.length, median: med });
  }
  const whatIf3 = {
    pushBilled: sum(pushRows.map((r) => r.billed)),
    pushRuns: pushRows.length,
    nightlyDays: nightlyDays.length,
    nightlyCost: sum(nightlyDays.map((d) => d.median)),
    fallbackMedian: fullMedianAll,
  };
  whatIf3.saved = whatIf3.pushBilled - whatIf3.nightlyCost;

  const installShare = stepSecTotal > 0 ? stepTotals.install / stepSecTotal : 0;
  const whatIf4 = {
    installSeconds: stepTotals.install,
    stepSeconds: stepSecTotal,
    shareOfStepTime: installShare,
    installMinutesApportioned: installShare * totalBilled,
    cacheStepsInWorkflow: wf.cacheSteps,
  };

  // blocked bookkeeping
  const blockedRuns = rows.filter((r) => r.cls === "blocked");
  const blockedDays = blockedRuns.map((r) => r.day).sort();
  const firstBlockedRun = [...blockedRuns].sort((a, b) => a.startMs - b.startMs)[0] || null;
  const billedRunsSorted = rows.filter((r) => r.billed > 0).sort((a, b) => a.startMs - b.startMs);
  const lastBilledRun = billedRunsSorted[billedRunsSorted.length - 1] || null;
  const unblockedByEventMedian = (ev) => median(rows.filter((r) => r.event === ev && r.billed > 0 && r.cls !== "blocked").map((r) => r.billed));
  const imputedBlocked = sum(blockedRuns.map((r) => unblockedByEventMedian(r.event)));

  // ---- rate limit after
  const rl1 = await api("/rate_limit", {}, { cacheable: false });
  apiCalls--;
  const rateAfter = rl1.status === 200 ? rl1.data.resources.core : null;

  // ------------------------------------------------------------------ render
  const agg = {
    repo, since, until, generatedAt: new Date().toISOString(), private: isPrivate, ownerType,
    apiCalls, cacheHits, rateBefore, rateAfter, rangeTotalCount, runsFetched: runs.length,
    totals: { runs: rows.length, billedMinutes: totalBilled, rawMinutesWeighted: round2(totalRawWeighted), jobsRan: jobRows.filter((j) => j.kind === "ran").length },
    runnerFamilies: Object.fromEntries(families),
    byEvent: Object.fromEntries(byEvent), byClass: Object.fromEntries(byClass), byConclusion: Object.fromEntries(byConclusion),
    byDay: Object.fromEntries(byDay), byJob: Object.fromEntries(byJob), skippedByJob: Object.fromEntries(skippedByJob),
    stepSecondsByCategory: stepTotals, jobSecondsTotal: jobSecTotal,
    rounding: { overheadMinutes: round2(roundingOverhead), shortJobs: shortJobs.length, shortJobBilled },
    cadence: { calendarDays: days.length, activeDays: activeDays.length, meanPerCalendarDay: days.length ? rows.length / days.length : 0, meanPerActiveDay: activeDays.length ? rows.length / activeDays.length : 0, max: maxDay },
    superseded: { list: superseded, whatIf2 },
    blocked: { runs: blockedRuns.length, jobs: sum(rows.map((r) => r.blockedJobs)), messages: Object.fromEntries(blockMessages), firstBlockedRun: firstBlockedRun && { id: firstBlockedRun.id, createdAt: firstBlockedRun.createdAt }, lastBilledRun: lastBilledRun && { id: lastBilledRun.id, createdAt: lastBilledRun.createdAt }, byDay: Object.fromEntries([...byDay].filter(([, v]) => v.blocked > 0).map(([d, v]) => [d, v.blocked])), imputedMinutesIfRun: round2(imputedBlocked), otherPrestartFailures: startupFailIds.size },
    timingCheck: { usableRuns: timingUsable, unusableRuns: timingUnusable, problems: Object.fromEntries(timingProblems), timingRawMinutes: round2(timingRawMin), jobsCompared: timingJobs, jobsDisagreeing: timingJobDisagree, zeroFilledJobs: timingZeroFilled, trusted: timingUsable > 0 && timingRawMin > 0, rawAbsDeltaSeconds: timingRawAbsDeltaSec, billedFromTiming: timingBilledFromTiming, billedComputedSameJobs: timingBilledComputedSameJobs },
    accountUsage: usage,
    workflowFiles: wf,
    whatIf: { whatIf1, whatIf2, whatIf3: { ...whatIf3, days: nightlyDays }, whatIf4 },
    docsOnlyJobNames: [...docsOnlyNames],
    runs: rows.map((r) => ({ id: r.id, event: r.event, branch: r.branch, sha: r.sha, conclusion: r.conclusion, day: r.day, createdAt: r.createdAt, cls: r.cls, billed: r.billed, jobs: r.jobs.map((j) => ({ name: j.name, kind: j.kind, conclusion: j.conclusion, rawSec: j.rawSec, billed: j.billed })) })),
  };

  const L = [];
  L.push(`# CI minutes audit — ${repo}`);
  L.push("");
  L.push(`Range: ${since} → ${until} (UTC, inclusive). Generated ${agg.generatedAt}. Repo visibility: ${isPrivate ? "private (billed)" : "PUBLIC (standard runners are free; billed minutes below are forced to 0)"}. Owner type: ${ownerType}.`);
  L.push("");
  L.push(`API calls made: ${apiCalls} (cache hits: ${cacheHits}). Core rate limit remaining: ${rateBefore ? rateBefore.remaining : "?"} → ${rateAfter ? rateAfter.remaining : "?"} of ${rateAfter ? rateAfter.limit : "?"}. Runs fetched: ${runs.length}${rangeTotalCount !== null ? ` (single-range listing reports total_count ${rangeTotalCount}${rangeTotalCount === runs.length ? ", matches" : ", DOES NOT MATCH"})` : ""}.`);
  L.push(`Runner families seen (jobs): ${[...families].map(([k, v]) => `${k}=${v}`).join(", ") || "none"}. Multipliers applied: linux 1, windows 2, macos 10, self-hosted free.`);
  L.push("");
  L.push("## Summary");
  L.push("");
  L.push(table(["Metric", "Value"], [
    ["Runs", rows.length],
    ["Billed minutes (computed)", totalBilled],
    ["Raw job minutes (multiplier-weighted)", round1(totalRawWeighted)],
    ["Blocked runs (never started: billing/spending block)", blockedRuns.length],
    ["Jobs that ran", jobRows.filter((j) => j.kind === "ran").length],
  ]));
  L.push("");

  L.push("## 2b/2e. By run class");
  L.push("");
  L.push(table(["Class", "Runs", "Billed min", "Share"], [...byClass].sort((a, b) => b[1].billed - a[1].billed).map(([k, v]) => [k, v.runs, v.billed, pct(v.billed, totalBilled)])));
  L.push("");
  L.push("Class rules: `blocked` = every non-skipped job never started because of a billing/spending block (zero spend); `docs-only` = a job named via `--docs-only-job` ran; `full` = anything else that billed minutes; `no-billable` = no job consumed minutes; `no-jobs` = run has no jobs.");
  L.push("");

  L.push("## 2e. By event");
  L.push("");
  L.push(table(["Event", "Runs", "Billed min", "Share"], [...byEvent].sort((a, b) => b[1].billed - a[1].billed).map(([k, v]) => [k, v.runs, v.billed, pct(v.billed, totalBilled)])));
  L.push("");

  L.push("## 2e. By job");
  L.push("");
  L.push(table(["Job", "Label", "Jobs", "Ran", "Blocked", "Billed min", "Share", "Avg billed / ran job"], [...byJob].sort((a, b) => b[1].billed - a[1].billed).map(([k, v]) => [k, docsOnlyNames.has(k) ? "docs-only" : "", v.jobs, v.ranJobs, v.blockedJobs, v.billed, pct(v.billed, totalBilled), v.ranJobs ? round1(v.billed / v.ranJobs) : "n/a"])));
  L.push("");
  if (skippedByJob.size) L.push(`Skipped jobs (zero cost): ${[...skippedByJob].map(([k, v]) => `${k} ×${v.n}`).join("; ")}.\n`);

  L.push("## 2e. By step category");
  L.push("");
  L.push(`Step time is raw seconds inside steps of jobs that ran; job time not inside any step (runner start-up, teardown) is not in this table. Steps cover ${round1(stepSecTotal / 60)} of ${round1(jobSecTotal / 60)} raw job minutes. Shares of billed minutes are that raw share applied to the billed total (an estimate).`);
  L.push("");
  L.push(table(["Category", "Raw min", "Share of step time", "≈ Billed min"], STEP_CATEGORIES.map((c) => [c, round1(stepTotals[c] / 60), pct(stepTotals[c], stepSecTotal), round1((stepSecTotal ? stepTotals[c] / stepSecTotal : 0) * totalBilled)])));
  L.push("");

  L.push("## 2e. By conclusion");
  L.push("");
  L.push(table(["Conclusion", "Runs", "Billed min", "Share"], [...byConclusion].sort((a, b) => b[1].billed - a[1].billed).map(([k, v]) => [k, v.runs, v.billed, pct(v.billed, totalBilled)])));
  L.push("");

  L.push("## 2e. By day (UTC)");
  L.push("");
  L.push(table(["Day", "Runs", "Blocked runs", "Billed min"], [...byDay].map(([d, v]) => [d, v.runs, v.blocked, v.billed])));
  L.push("");

  L.push("## 2b. Blocked runs");
  L.push("");
  L.push(`Blocked runs: ${blockedRuns.length} (${agg.blocked.jobs} jobs). Other failed-before-start jobs with no billing message: ${startupFailIds.size}.`);
  L.push(`First blocked run: ${firstBlockedRun ? `${firstBlockedRun.createdAt} (run ${firstBlockedRun.id})` : "none"}. Last run that billed minutes: ${lastBilledRun ? `${lastBilledRun.createdAt} (run ${lastBilledRun.id})` : "none"}.`);
  if (blockMessages.size) L.push(`Block message(s) from check-run annotations: ${[...blockMessages].map(([m, n]) => `"${m}" ×${n}`).join("; ")}.`);
  L.push(`If the blocked runs had run, an imputed cost at the median billed minutes of unblocked runs of the same event: ${round1(imputedBlocked)} min (an estimate; blocked runs are recorded above as zero spend).`);
  L.push("");

  L.push("## 2c. Timing-endpoint cross-check");
  L.push("");
  const timingTrusted = timingUsable > 0 && timingRawMin > 0;
  L.push(`GET .../actions/runs/{id}/timing answered for ${timingUsable} of ${rows.length} runs${timingUnusable ? ` (no usable answer: ${[...timingProblems].map(([k, v]) => `${k} ×${v}`).join("; ")})` : ""}. The endpoint returns milliseconds per job, not rounded minutes, and GitHub documents it as closing down.`);
  if (!timingTrusted) {
    L.push("");
    L.push(`**The endpoint is not usable as a cross-check here:** it reported ${round1(timingRawMin)} billable minutes in total across ${timingJobs} listed jobs, and returned 0 ms for ${timingZeroFilled} jobs that the jobs endpoint shows ran for more than 0 s (script raw total ${round1(sum(jobRows.filter((j) => j.kind === "ran" && !j.free).map((j) => j.rawSec)) / 60)} min). The report relies on the computed figure.`);
  } else {
    L.push("");
    L.push(table(["Measure", "Timing endpoint", "Script"], [
      ["Raw billable minutes (jobs the endpoint lists)", round1(timingRawMin), round1(sum(jobRows.filter((j) => j.kind === "ran" && !j.free).map((j) => j.rawSec)) / 60)],
      ["Billed minutes (per-job round-up of the endpoint's ms, Linux ×1)", timingBilledFromTiming, timingBilledComputedSameJobs],
    ]));
    L.push("");
    L.push(`Jobs compared: ${timingJobs}; jobs whose duration differs at all: ${timingJobDisagree} (of which returned as 0 ms: ${timingZeroFilled}); summed absolute difference: ${round2(timingRawAbsDeltaSec / 60)} min. Billed-minute disagreement over those jobs: ${timingBilledFromTiming - timingBilledComputedSameJobs} min.`);
  }
  L.push("");

  L.push("## 2d. Account-level usage");
  L.push("");
  for (const a of usage.attempted) L.push(`- \`GET ${a.endpoint}\` → HTTP ${a.status}${a.message ? ` — ${a.message}` : ""}`);
  L.push("");
  if (usage.totalMinutes !== null) {
    L.push(`Authoritative account total: ${round1(usage.totalMinutes)} Actions minutes (${usage.note}). Rows attributed to this repo: ${round1(usage.repoMinutes)}. Script computed for this repo/range: ${totalBilled}. Difference (account repo rows − script): ${round1(usage.repoMinutes - totalBilled)}.`);
    L.push(`By SKU: ${Object.entries(usage.bySku || {}).map(([k, v]) => `${k}=${round1(v)}`).join(", ") || "none"}.`);
  } else {
    L.push(`Account usage unavailable: ${usage.refused}. The report relies on the computed figure.`);
  }
  L.push("");

  L.push("## 2f. Rounding overhead");
  L.push("");
  L.push(`Billed ${totalBilled} min − raw ${round1(totalRawWeighted)} min = **${round1(roundingOverhead)} min** overhead (${pct(roundingOverhead, totalBilled)} of billed). Jobs under 60 s that still bill a whole minute: ${shortJobs.length} (${shortJobBilled} billed min).`);
  L.push("");

  L.push("## 2g. Cadence and superseded runs");
  L.push("");
  L.push(`Runs per calendar day: mean ${round1(agg.cadence.meanPerCalendarDay)} over ${days.length} days; mean ${round1(agg.cadence.meanPerActiveDay)} over ${activeDays.length} days with at least one run; max ${maxDay.n} on ${maxDay.d}.`);
  L.push("");
  L.push(`Superseded runs (same workflow + branch + event, next run started before this one finished; runs that billed nothing excluded): **${superseded.length}**, ${whatIf2.supersededBilled} billed min.`);
  L.push(`- Already cancelled (conclusion \`cancelled\`): ${supCancelled.length} runs, ${whatIf2.alreadyCancelledBilled} billed min — savings already being realised.`);
  L.push(`- Ran to completion despite being superseded: ${supCompleted.length} runs, ${whatIf2.completedBilled} billed min.`);
  L.push(`- Workflow files currently declare \`cancel-in-progress: true\`: ${wf.cancelInProgress ? "yes" : "no"} (read from the default branch today, not historical).`);
  L.push("");

  L.push("## 2h. What-if estimates (estimates, not measurements; not additive)");
  L.push("");
  L.push("**(1) Skip docs-only runs entirely.**");
  if (whatIf1.given) L.push(`Arithmetic: sum of billed minutes over ${whatIf1.runs} docs-only runs = ${whatIf1.saved} min → ${pct(whatIf1.saved, totalBilled)} of ${totalBilled}.`);
  else L.push("Not computed: no `--docs-only-job` name was supplied.");
  L.push("");
  L.push("**(2) cancel-in-progress.**");
  L.push(`Arithmetic: for each superseded run that ran to completion (${supCompleted.length}), the raw job minutes falling after the next run's start = ${round1(whatIf2.savedEstimate)} min → ${pct(whatIf2.savedEstimate, totalBilled)}. Whole-run billed minutes of those runs (upper bound): ${whatIf2.completedBilled}.${wf.cancelInProgress ? " The workflow already sets cancel-in-progress, so this is what still escapes it (different event, or ran before it was added)." : ""}`);
  L.push("");
  L.push("**(3) Nightly-only.**");
  L.push(`Arithmetic: ${nightlyDays.length} UTC days had at least one push run of class \`full\`; each is costed at that day's median billed minutes of full push runs that settled (success/failure): sum = ${round1(whatIf3.nightlyCost)} min. Push runs currently billed ${whatIf3.pushBilled} min over ${whatIf3.pushRuns} runs. Saved = ${whatIf3.pushBilled} − ${round1(whatIf3.nightlyCost)} = ${round1(whatIf3.saved)} min → ${pct(whatIf3.saved, totalBilled)}. Blocked runs count as zero spend and are not used to qualify a day, so a period with blocking understates the baseline.`);
  if (nightlyDays.length) L.push("\n" + table(["Day", "Full push runs", "Median billed min"], nightlyDays.map((d) => [d.day, d.fullRuns, d.median])));
  L.push("");
  L.push("**(4) Install share and caching.**");
  L.push(`Arithmetic: install steps = ${round1(stepTotals.install / 60)} raw min of ${round1(stepSecTotal / 60)} step min = ${pct(stepTotals.install, stepSecTotal)}; applied to ${totalBilled} billed min ≈ ${round1(whatIf4.installMinutesApportioned)} min. Cache configuration found in workflow files: ${wf.cacheSteps > 0 ? `yes (${wf.cacheSteps} cache setting/step(s): ${wf.files.map((f) => `${f.file}: setup cache lines ${f.setupNodeCacheLines}, actions/cache ${f.actionsCacheSteps}`).join("; ")})` : "no"}. The API does not say whether a cache hit occurred; a cache-restoring setup step is timed under \`setup\`, and install time that remains is what the cache did not remove.`);
  L.push("");
  L.push("## Method notes");
  L.push("");
  L.push("- Billed minutes per job = ceil(raw seconds / 60) × runner multiplier; skipped, blocked and zero-second jobs are 0; self-hosted and public-repo runs are free. Only GET requests are issued.");
  L.push("- Job durations come from `started_at`/`completed_at` on `GET /repos/{repo}/actions/runs/{id}/jobs?filter=all`; a job is blocked when it failed with no steps and no runner, and its check-run annotation says it was not started because of payment/spending-limit state.");
  L.push("- Days and months are UTC. Workflow-file facts are read from the default branch as it stands today.");
  const md = L.join("\n") + "\n";

  process.stdout.write(md);
  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, md);
    const jsonPath = args.out.replace(/\.md$/i, "") + ".json";
    fs.writeFileSync(jsonPath, JSON.stringify(agg, null, 2));
    log(`Wrote ${args.out} and ${jsonPath}`);
  }
}

main().catch((e) => {
  process.stderr.write(`ci-minutes: ${e.message}\n`);
  process.exit(1);
});
