// Fixed-index-read walker: every read of a model response's content array by a
// fixed position, plus the compliant reads beside them.
// Seeded from dev-tools @ {{DEV_TOOLS_SHA}}; this file is now the project's own.
//
// A thinking-capable model puts a thinking block first, so `content[0].text`
// comes back undefined and the reply is filed as malformed when the answer sat
// one block later. The fix is a trailing-text reader (the dev-tools
// llm-call-hygiene skill's helpers/message-reading.ts); the guard is
// fixed-index-read.test.ts, an invariant ratchet built on ../ratchet-core.ts.
//
// Every project-shaped value is in CONFIG below. Change CONFIG, not the walk.
//
// What it reports. Each site is keyed (file, symbol, name, ordinal):
//   violation       a fixed position read of an array named in CONFIG.arrays:
//                   `x.content[0]`, `x?.content?.[1]`, `x["content"][0]`, a
//                   bare `content[0]`, `content.at(0)` or `.at(-1)`, and a
//                   destructured element: `const [first] = x.content`,
//                   `const [, second] = x.content`, `const { content: [first] }
//                   = x`, the same in a parameter, and `[first] = x.content`
//   computed_index  compliant: the same array read by a computed position
//                   (`content[i]`, `content.at(n)`)
//   reader          compliant: a call to one of CONFIG.readers
// `name` is the array's property name for an index read, or the reader's name.
// The ordinal counts every site sharing (file, symbol, name) in source order,
// compliant ones included, so fixing one site does not re-key its neighbours.
//
// It is an AST walk with the TypeScript compiler's JS API, never a grep, and
// that is how comments are handled: a comment is not a node, so a mention of
// `content[0]` in a comment, a string, a template or a regex is never a site,
// and real code on the same line as such a comment still is.
// Why: a text scan needs a comment stripper, and a stripper that misses one
// form (a block comment, a URL holding "//") either buries the real read or
// flags the explanation, whose only remedy is deleting it.
//
// A file the parser reports errors for is a parse failure, never skipped. A
// root that does not exist is a parse failure. The walk reports how many files
// it read, and the core fails rule (g) on zero.
// Why: the parser recovers from errors silently, and a walk that read nothing
// must never read as a repo with nothing wrong.
//
// What it cannot see, recorded here rather than implied:
//   - an array reached under another name (`const blocks = res.content;
//     blocks[0]`): add the name to CONFIG.arrays, or exempt nothing and rename;
//   - a read through a helper that itself indexes (`first(res.content)`);
//   - `.find()` for the first text block, which reads past a thinking block but
//     takes the first text block of a search reply, not the answer;
//   - a `content` array that is not a response's (a request body's message
//     content): it is flagged, and an exemption with its reason is the answer;
//   - files outside CONFIG.roots, and test files, excluded by CONFIG.exclude
//     because their envelopes are written by hand.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "@typescript/typescript6";
import {
  checkRatchet,
  countShapes,
  type ParseFailure,
  type RatchetFailure,
  type RatchetSite,
  type ShapeConfig,
  type SnapshotEntry,
  type StatusConfig,
} from "../ratchet-core.ts";

if (typeof ts?.createSourceFile !== "function") {
  throw new Error(
    "walker.ts needs the TypeScript compiler's JS API, and the imported module has none " +
      "(TypeScript 7+ dropped it from the main entry): npm i -D @typescript/typescript6",
  );
}

export interface GuardConfig {
  /** Repo root, absolute. Every path below is relative to it. */
  root: string;
  /** Directories to walk. A root that does not exist is a parse failure. */
  roots: string[];
  /** Files to read, as globs (`**`, `*`, `?`, `{a,b}`). */
  include: string[];
  /** Files to skip, as globs. */
  exclude: string[];
  /** Property names whose fixed-index reads are flagged. */
  arrays: string[];
  /** Calls that read a reply the safe way; each is a compliant site. */
  readers: string[];
  /** The module exporting the readers, asserted by the guard test to do the job. */
  readerModule: string;
}

export const CONFIG: GuardConfig = {
  // The default assumes this file sits at src/test/ratchets/fixed-index-read/.
  root: fileURLToPath(new URL("../../../../", import.meta.url)),
  roots: ["supabase/functions", "scripts"],
  include: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
  exclude: ["**/node_modules/**", "**/*.test.*", "**/*.spec.*"],
  arrays: ["content"],
  readers: ["trailingText", "parseJsonReply"],
  readerModule: "supabase/functions/_shared/message-reading.ts",
};

export const KEY_FIELDS = ["file", "symbol", "name", "ordinal"] as const;

/** The one status: an exemption, which needs a reason. There is no worklist; zero violations is the rule. */
export const STATUSES: StatusConfig = { EXEMPT: { kind: "exempt" } };

export type Shape = "reader" | "computed_index";

export interface ReadSite extends RatchetSite {
  /** Root-relative path, POSIX separators. */
  file: string;
  symbol: string;
  name: string;
  ordinal: number;
  shape?: Shape;
  /** The form matched, e.g. `content?.[0]`. Reported, never part of the key. */
  form: string;
}

export interface ScanResult {
  files: string[];
  sites: ReadSite[];
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
  if (/\.tsx$/.test(file)) return ts.ScriptKind.TSX;
  if (/\.jsx$/.test(file)) return ts.ScriptKind.JSX;
  if (/\.(c|m)?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function nameText(name: ts.PropertyName | ts.BindingName | undefined): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text;
  return null;
}

const TEST_FNS = new Set(["it", "test", "describe", "suite"]);

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
    if (
      ts.isParenthesizedExpression(e) ||
      ts.isAsExpression(e) ||
      ts.isNonNullExpression(e) ||
      ts.isTypeAssertionExpression(e) ||
      ts.isSatisfiesExpression(e)
    ) {
      e = e.expression;
    } else {
      return e;
    }
  }
}

/** The configured array name this expression reads (`x.content`, `x["content"]`, bare `content`), else null. */
function arrayRead(e: ts.Expression, arrays: readonly string[]): string | null {
  const u = unwrap(e);
  let name: string | null = null;
  if (ts.isPropertyAccessExpression(u)) name = u.name.text;
  else if (ts.isElementAccessExpression(u) && ts.isStringLiteralLike(u.argumentExpression)) name = u.argumentExpression.text;
  else if (ts.isIdentifier(u)) name = u.text;
  return name !== null && arrays.includes(name) ? name : null;
}

/** The literal text of a fixed position (`0`, `-1`, `"2"`), else null. */
function fixedIndex(e: ts.Expression): string | null {
  const u = unwrap(e);
  if (ts.isNumericLiteral(u)) return u.text;
  if (ts.isStringLiteralLike(u) && /^\d+$/.test(u.text)) return JSON.stringify(u.text);
  if (
    ts.isPrefixUnaryExpression(u) &&
    (u.operator === ts.SyntaxKind.MinusToken || u.operator === ts.SyntaxKind.PlusToken) &&
    ts.isNumericLiteral(u.operand)
  ) {
    return `${u.operator === ts.SyntaxKind.MinusToken ? "-" : "+"}${u.operand.text}`;
  }
  return null;
}

/** Does an array pattern take any element by position (anything but a lone rest)? */
function takesPosition(p: ts.ArrayBindingPattern | ts.ArrayLiteralExpression): boolean {
  const elements: readonly ts.Node[] = p.elements;
  return elements.some((el) => {
    if (ts.isOmittedExpression(el)) return false;
    if (ts.isBindingElement(el)) return el.dotDotDotToken === undefined;
    return !ts.isSpreadElement(el);
  });
}

function calleeName(call: ts.CallExpression): string | null {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
}

const snippet = (n: ts.Node) => {
  const t = n.getText().replace(/\s+/g, " ").trim();
  return t.length > 80 ? `${t.slice(0, 77)}...` : t;
};

/**
 * Every site in ONE source text. Exported so the harness can drive it with
 * synthetic sources and prove what it flags and what it does not.
 */
export function sitesInSource(
  file: string,
  src: string,
  config: GuardConfig = CONFIG,
): { sites: ReadSite[]; parseFailure?: ParseFailure } {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, scriptKind(file));
  const diags = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (diags.length > 0) {
    return { sites: [], parseFailure: { file, reason: ts.flattenDiagnosticMessageText(diags[0].messageText, " ") } };
  }
  const seen = new Map<string, number>();
  const sites: ReadSite[] = [];
  const add = (node: ts.Node, name: string, form: string, shape?: Shape) => {
    const symbol = enclosingSymbol(node);
    const k = `${symbol}\u0000${name}`;
    const ordinal = seen.get(k) ?? 0;
    seen.set(k, ordinal + 1);
    const site: ReadSite = { file, symbol, name, ordinal, form, verdict: shape ? "compliant" : "violation" };
    if (shape) site.shape = shape;
    else site.detail = `${form} in \`${snippet(node)}\``;
    sites.push(site);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isElementAccessExpression(node)) {
      const name = arrayRead(node.expression, config.arrays);
      if (name !== null) {
        const idx = fixedIndex(node.argumentExpression);
        if (idx !== null) add(node, name, `${name}${node.questionDotToken ? "?." : ""}[${idx}]`);
        else add(node, name, `${name}[<computed>]`, "computed_index");
      }
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const reader = calleeName(node);
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "at") {
        const name = arrayRead(callee.expression, config.arrays);
        if (name !== null) {
          const idx = node.arguments[0] ? fixedIndex(node.arguments[0]) : null;
          if (idx !== null) add(node, name, `${name}.at(${idx})`);
          else add(node, name, `${name}.at(<computed>)`, "computed_index");
        }
      } else if (reader !== null && config.readers.includes(reader)) {
        add(node, reader, `${reader}()`, "reader");
      }
    } else if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.initializer) {
      const name = arrayRead(node.initializer, config.arrays);
      if (name !== null && takesPosition(node.name)) add(node, name, `[...] = ${name}`);
    } else if (ts.isBindingElement(node) && ts.isArrayBindingPattern(node.name)) {
      const prop = nameText(node.propertyName);
      if (prop !== null && config.arrays.includes(prop) && takesPosition(node.name)) add(node, prop, `{ ${prop}: [...] }`);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isArrayLiteralExpression(node.left)
    ) {
      const name = arrayRead(node.right, config.arrays);
      if (name !== null && takesPosition(node.left)) add(node, name, `[...] = ${name}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { sites };
}

/** Files under the roots that the walk reads, root-relative; a missing root is reported, never skipped. */
export function listFiles(config: GuardConfig = CONFIG): { files: string[]; parseFailures: ParseFailure[] } {
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
      if (!include.some((r) => r.test(rel))) continue;
      if (exclude.some((r) => r.test(rel))) continue;
      files.push(rel);
    }
  };

  for (const r of config.roots) {
    const abs = resolve(config.root, r);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) {
      parseFailures.push({ file: r, reason: "root does not exist or is not a directory" });
      continue;
    }
    walk(abs);
  }
  return { files: [...new Set(files)].sort(), parseFailures };
}

/** The whole walk: every file, every site, every parse failure. */
export function scan(config: GuardConfig = CONFIG): ScanResult {
  const { files, parseFailures } = listFiles(config);
  const sites: ReadSite[] = [];
  for (const rel of files) {
    const one = sitesInSource(rel, readFileSync(resolve(config.root, rel), "utf8"), config);
    if (one.parseFailure) parseFailures.push(one.parseFailure);
    sites.push(...one.sites);
  }
  return { files, sites, parseFailures };
}

export interface Exemption extends SnapshotEntry {
  file: string;
  symbol: string;
  name: string;
  ordinal: number;
  status: "EXEMPT";
  /** Why this read is not a response read, or why it must stay fixed. Required. */
  justification: string;
}

/**
 * The guard's verdict: ratchet-core over the walk, with the exemption list as
 * the snapshot. A violation with no exemption fails (a); an exemption whose
 * site is now compliant (b) or gone (c) is stale and fails; one with no reason
 * fails (d); zero files walked or zero sites fails (g); a parse failure (h).
 */
export function guardFailures(
  result: ScanResult,
  options: { exemptions: readonly Exemption[]; shapes: ShapeConfig; minSites?: number; exemptionsAt?: string },
): RatchetFailure[] {
  return checkRatchet({
    keyFields: KEY_FIELDS,
    statuses: STATUSES,
    shapes: options.shapes,
    sites: result.sites,
    snapshot: { entries: [...options.exemptions] },
    parseFailures: result.parseFailures,
    shapeCounts: countShapes(result.sites),
    regenCommand: options.exemptionsAt ?? "EXEMPTIONS in fixed-index-read.test.ts",
    minSites: options.minSites,
    filesWalked: result.files.length,
  });
}
