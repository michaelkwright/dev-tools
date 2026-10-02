// Fixture-date walker: every temporal-keyed property in the test tree, with a
// verdict on whether its value is a literal date.
// Seeded from dev-tools @ {{DEV_TOOLS_SHA}}; this file is now the project's own.
//
// A fixture carrying a literal date that the code compares against a cutoff
// computed from now is a test with an expiry date: two fixtures aged past a
// 30-day retention cutoff and turned CI red for days on commits that never
// touched them. The fix is clock.ts's daysAgo(n); the guard is
// fixture-date-anchoring.test.ts, built on this walk.
//
// Every project-shaped value is in CONFIG below. Change CONFIG, not the walk.
//
// What it reports. Every object-literal property whose key matches
// CONFIG.temporalKey is a site, keyed (file, symbol, key, ordinal):
//   violation        the value is a date-shaped string literal, or a template
//                    literal whose leading text is date-shaped
//   anchored         compliant: a call to one of CONFIG.anchorHelpers
//   computed         compliant: any other expression (a variable, new Date(),
//                    another call, null)
//   not_date_shaped  compliant: a string literal that is not a date
// A file that calls one of CONFIG.clockPinCalls derives CONFIG.clockPinnedStatus
// for its violations, which then need no snapshot entry.
//
// A template literal's head counts, and "YYYY-MM" is enough to be date-shaped.
// Why: a fixture written as `2000-01-${day}T…` has the partial head "2000-01-",
// and a pattern demanding a full YYYY-MM-DD misses exactly that shape.
//
// It is an AST walk with the TypeScript compiler's JS API, never a grep.
// Why: a grep cannot see the key, which is the whole signal, and it fires on a
// date in a comment, so its only remedy is deleting the explanation.
//
// The API is imported from @typescript/typescript6, the side-by-side build that
// installs next to any project TypeScript. From TypeScript 7 on, the plain
// "typescript" package no longer exposes the JS API; on 5.x or 6.x, importing
// "typescript" instead works too.
//
// The symbol is the path of named scopes around the site (functions, classes,
// methods, variables, and it/test/describe titles), never a line number.
// Why: a line number moves on every edit above it; a scope name moves only when
// the code it names does.
//
// A file the parser reports errors for is a parse failure, never skipped.
// Why: the TypeScript parser recovers from errors silently, and a file whose
// sites vanish reads as a file with nothing wrong.
//
// What it cannot see, recorded here rather than implied:
//   - a literal returned from a helper or held in a variable, then used as the
//     value (`created_at: OLD`), which reads as computed;
//   - a literal inside a call, e.g. `new Date("…")`, which reads as computed;
//   - a date literal under a key the regex does not match;
//   - golden baselines excluded by CONFIG.exclude, deliberately: anchoring one
//     defeats its purpose.
// It is a shape rule, not proof that a given field meets a rolling cutoff, so
// it errs toward flagging; FIXED_BY_DESIGN exists for the literal that is meant.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "@typescript/typescript6";
import type { ParseFailure, RatchetSite } from "../ratchet-core.ts";

if (typeof ts?.createSourceFile !== "function") {
  throw new Error(
    "walker.ts needs the TypeScript compiler's JS API, and the imported module has none " +
      "(TypeScript 7+ dropped it from the main entry): npm i -D @typescript/typescript6",
  );
}

export interface WalkerConfig {
  /** Repo root, absolute. Every path below is relative to it. */
  root: string;
  /** Directories to walk. A root that does not exist is a parse failure. */
  testRoots: string[];
  /** Files to read, as globs (`**`, `*`, `?`, `{a,b}`). */
  include: string[];
  /** Files to skip, as globs: golden baselines and generated output. */
  exclude: string[];
  /** The snapshot file, never walked. */
  snapshot: string;
  /** Keys whose values are dates. */
  temporalKey: RegExp;
  /** A value that reads as a date the moment it is read. */
  dateShaped: RegExp;
  /** Calls that anchor a fixture date to the clock. */
  anchorHelpers: string[];
  /** Calls that pin the clock for the whole file. */
  clockPinCalls: string[];
  /** The derived status a pinned file's violations carry. */
  clockPinnedStatus: string;
}

export const CONFIG: WalkerConfig = {
  // The default assumes this file sits at src/test/ratchets/fixture-date-anchoring/.
  root: fileURLToPath(new URL("../../../../", import.meta.url)),
  testRoots: ["src/test"],
  include: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,json}"],
  exclude: ["**/node_modules/**", "**/__snapshots__/**", "**/fixtures/**/*.json", "**/*.golden.json"],
  snapshot: "src/test/ratchets/fixture-date-anchoring/snapshot.json",
  // Fields ending _at, _date or _on, plus the bare names a query or a fixture
  // uses for a window bound. For camelCase fields add e.g. (At|Date|On)$.
  temporalKey: /(_at|_date|_on)$|^(date|since|until|cutoff)$/i,
  dateShaped: /^\d{4}-\d{2}(-|$)/,
  anchorHelpers: ["daysAgo", "dateDaysAgo"],
  clockPinCalls: ["setSystemTime", "useFakeTimers"],
  clockPinnedStatus: "CLOCK_PINNED",
};

export const KEY_FIELDS = ["file", "symbol", "key", "ordinal"] as const;

export const SNAPSHOT_PATH = resolve(CONFIG.root, CONFIG.snapshot);

export type Shape = "anchored" | "computed" | "not_date_shaped";

export interface DateSite extends RatchetSite {
  /** Root-relative path, POSIX separators. */
  file: string;
  symbol: string;
  key: string;
  /** Index among sites sharing (file, symbol, key), in source order, compliant sites included. */
  ordinal: number;
  shape?: Shape;
  /** The literal, for a violation. Reported, never part of the key. */
  literal?: string;
}

export interface ScanResult {
  files: string[];
  sites: DateSite[];
  parseFailures: ParseFailure[];
}

/** A glob as an anchored RegExp: `**` spans directories, `*` and `?` do not, `{a,b}` takes literal alternatives. */
export function globToRegExp(glob: string): RegExp {
  const esc = (s: string) => s.replace(/[.+^$()|[\]\\]/g, "\\$&");
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") {
        i++;
        re += "(?:.*/)?";
      } else {
        re += ".*";
      }
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) throw new Error(`unclosed { in glob ${glob}`);
      re += `(?:${glob.slice(i + 1, end).split(",").map(esc).join("|")})`;
      i = end;
    } else {
      re += esc(c);
    }
  }
  return new RegExp(`^${re}$`);
}

function scriptKind(file: string): ts.ScriptKind {
  if (/\.(tsx)$/.test(file)) return ts.ScriptKind.TSX;
  if (/\.(jsx)$/.test(file)) return ts.ScriptKind.JSX;
  if (/\.(c|m)?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function calleeName(call: ts.CallExpression): string | null {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
}

function nameText(name: ts.PropertyName | ts.BindingName | undefined): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text;
  return null;
}

const TEST_FNS = new Set(["it", "test", "describe", "suite"]);

/** it / it.only / test.skip / describe.concurrent … → the base name, else null. */
function testFnName(call: ts.CallExpression): string | null {
  let e: ts.Expression = call.expression;
  while (ts.isPropertyAccessExpression(e)) e = e.expression;
  return ts.isIdentifier(e) && TEST_FNS.has(e.text) ? e.text : null;
}

/** The path of named scopes enclosing a node, outermost first. */
function enclosingSymbol(node: ts.Node): string {
  const names: string[] = [];
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    let name: string | null = null;
    if (ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n) || ts.isFunctionExpression(n)) {
      name = n.name ? n.name.text : null;
    } else if (ts.isMethodDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n) || ts.isPropertyDeclaration(n)) {
      name = nameText(n.name);
    } else if (ts.isVariableDeclaration(n)) {
      name = ts.isIdentifier(n.name) ? n.name.text : null;
    } else if (ts.isCallExpression(n)) {
      const fn = testFnName(n);
      const first = n.arguments[0];
      if (fn && first && ts.isStringLiteralLike(first)) name = `${fn}:${first.text}`;
    }
    if (name) names.push(name);
  }
  return names.length ? names.reverse().join(" > ") : "<module>";
}

/** Strip wrappers that do not change the value: parentheses, `as`, `satisfies`, `!`. */
function unwrap(e: ts.Expression): ts.Expression {
  for (;;) {
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isTypeAssertionExpression(e)) {
      e = e.expression;
    } else if (ts.isSatisfiesExpression(e)) {
      e = e.expression;
    } else {
      return e;
    }
  }
}

/** The literal text of a value, or its head for a template with substitutions; null if not a string literal. */
function literalText(e: ts.Expression): string | null {
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (ts.isTemplateExpression(e)) return e.head.text;
  return null;
}

function isAnchorCall(e: ts.Expression, helpers: readonly string[]): boolean {
  return ts.isCallExpression(e) && helpers.includes(calleeName(e) ?? "");
}

/** Does this file call one of the clock-pinning functions? Calls only: a mention in a comment or string does not count. */
export function pinsClock(sf: ts.SourceFile, calls: readonly string[]): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(n) && calls.includes(calleeName(n) ?? "")) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/**
 * Every temporal-keyed site in ONE source text. Exported so the test can drive
 * it with synthetic sources and prove what it flags and what it does not.
 */
export function sitesInSource(
  file: string,
  src: string,
  config: WalkerConfig = CONFIG,
): { sites: DateSite[]; parseFailure?: ParseFailure } {
  const json = file.endsWith(".json");
  if (json) {
    // The TypeScript JSON parser tolerates what JSON.parse rejects (a trailing
    // comma), so strict JSON is checked first.
    try {
      JSON.parse(src);
    } catch (e) {
      return { sites: [], parseFailure: { file, reason: (e as Error).message } };
    }
  }
  const sf = json
    ? ts.parseJsonText(file, src)
    : ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, scriptKind(file));
  const diags = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (diags.length > 0) {
    return { sites: [], parseFailure: { file, reason: ts.flattenDiagnosticMessageText(diags[0].messageText, " ") } };
  }
  // JSON has no scopes (and parseJsonText sets no parent pointers), so its
  // sites are keyed under "<json>" and told apart by ordinal.
  const pinned = !json && pinsClock(sf, config.clockPinCalls);
  const seen = new Map<string, number>();
  const sites: DateSite[] = [];

  const visit = (node: ts.Node): void => {
    let key: string | null = null;
    let value: ts.Expression | null = null;
    if (ts.isPropertyAssignment(node)) {
      key = nameText(node.name);
      value = node.initializer;
    } else if (ts.isShorthandPropertyAssignment(node)) {
      key = node.name.text;
    }
    if (key !== null && config.temporalKey.test(key)) {
      const symbol = json ? "<json>" : enclosingSymbol(node);
      const k = `${symbol}\u0000${key}`;
      const ordinal = seen.get(k) ?? 0;
      seen.set(k, ordinal + 1);
      const site: DateSite = { file, symbol, key, ordinal, verdict: "compliant" };
      const v = value ? unwrap(value) : null;
      const literal = v ? literalText(v) : null;
      if (literal !== null && config.dateShaped.test(literal)) {
        site.verdict = "violation";
        site.literal = literal;
        site.detail = `= ${JSON.stringify(literal)}`;
        if (pinned) site.derivedStatus = config.clockPinnedStatus;
      } else if (literal !== null) {
        site.shape = "not_date_shaped";
      } else if (v && isAnchorCall(v, config.anchorHelpers)) {
        site.shape = "anchored";
      } else {
        site.shape = "computed";
      }
      sites.push(site);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { sites };
}

/** Files under the test roots that the walk reads, root-relative; a missing root is reported, never skipped. */
export function listFiles(config: WalkerConfig = CONFIG): { files: string[]; parseFailures: ParseFailure[] } {
  const include = config.include.map(globToRegExp);
  const exclude = config.exclude.map(globToRegExp);
  const files: string[] = [];
  const parseFailures: ParseFailure[] = [];
  const toRel = (abs: string) => relative(config.root, abs).split(sep).join("/");

  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      if (name === "node_modules" || name === ".git") continue;
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) {
        walk(abs);
        continue;
      }
      const rel = toRel(abs);
      if (rel === config.snapshot) continue;
      if (!include.some((r) => r.test(rel))) continue;
      if (exclude.some((r) => r.test(rel))) continue;
      files.push(rel);
    }
  };

  for (const r of config.testRoots) {
    const abs = resolve(config.root, r);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) {
      parseFailures.push({ file: r, reason: "test root does not exist or is not a directory" });
      continue;
    }
    walk(abs);
  }
  return { files: [...new Set(files)].sort(), parseFailures };
}

/** The whole walk: every file, every site, every parse failure. */
export function scan(config: WalkerConfig = CONFIG): ScanResult {
  const { files, parseFailures } = listFiles(config);
  const sites: DateSite[] = [];
  for (const rel of files) {
    const one = sitesInSource(rel, readFileSync(resolve(config.root, rel), "utf8"), config);
    if (one.parseFailure) parseFailures.push(one.parseFailure);
    sites.push(...one.sites);
  }
  return { files, sites, parseFailures };
}
