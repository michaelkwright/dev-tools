#!/usr/bin/env bash
# Pre-push scrub gate for this repository.
#
# Scans exactly what gets published, never the working tree:
#   tracked   the index (git ls-files), so staged files count before a commit
#   history   every blob reachable from a published ref and not in the index
#   message   every commit message, and every annotated tag message
#   identity  every author, committer and tagger name and email
#   path      every tracked path and every path in published history
# Published refs are all local branches and tags, every ref on the remote, and
# any revision named with --rev (the pre-push hook passes the pushed tips).
# Untracked and gitignored files are never read.
#
# Config directory: $SCRUB_CONFIG_DIR, default ~/.config/dev-tools/scrub
#   denylist.d/*.txt    one term per line (case-insensitive, whole-word match)
#   sources.txt         one source repo per line: <repo path> <subpath>...
#                       File-name stems (8+ chars) ever tracked under those
#                       subpaths, across that repo's full history, are added to
#                       the denylist. Stems of 4-7 chars are review-only.
#   allow.txt           optional; generic words removed from generated stems
#   vocab.d/*.txt       review-only vocabulary (case-insensitive, whole-word)
#   identity-allow.txt  optional; emails that are not flagged as identities
#
# Checks. Blocking: gitleaks, the denylist, absolute home paths. Review-only
# (WARN, never failing): short stems, vocabulary, UUIDs and long hex IDs,
# version strings, and identities that are not a GitHub noreply address.
#
# Usage: scrub.sh [--show-terms] [--remote <name>] [--rev <rev>]...
#   --show-terms  print the matched text beside each hit's location, blocking
#                 and review-only. For a private terminal only: the output
#                 then contains denylist terms. Exit codes are unchanged.
#   --remote      the remote whose refs are published (default origin)
#   --rev         an extra revision to scan as published; repeatable
#
# Exit codes: 0 clean or review-only warnings, 1 any blocking hit, 2 config or
# tool error. Fails closed: anything missing or empty is exit 2, never a silent
# pass; so is a remote that cannot be listed or a remote ref not in this clone.
# Compatible with bash 3.2 (no mapfile, no associative arrays).

set -euo pipefail

CFG="${SCRUB_CONFIG_DIR:-$HOME/.config/dev-tools/scrub}"
MIN_LEN=8
REVIEW_MIN_LEN=4

HOME_PATH_RE='(/Users|/home)/[^/[:space:]]+/'
HEX_ID_RE='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-f]{12,}'
HEX_ID_ALLOW_RE='^0{8}-0{4}-0{4}-0{4}-0{12}$'
VERSION_RE='v[0-9]+\.[0-9]{2,}'
NOREPLY_RE='(@users\.noreply\.github\.com|^noreply@github\.com)$'

die() {
  echo "scrub: error: $*" >&2
  exit 2
}

SHOW_TERMS=0
REMOTE=origin
EXTRA_REVS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --show-terms) SHOW_TERMS=1 ;;
    --remote)
      [ $# -ge 2 ] && [ -n "$2" ] || die "--remote needs a value"
      REMOTE="$2"; shift ;;
    --rev)
      [ $# -ge 2 ] && [ -n "$2" ] || die "--rev needs a value"
      EXTRA_REVS="$EXTRA_REVS $2"; shift ;;
    *) die "unknown argument: $1 (usage: scrub.sh [--show-terms] [--remote <name>] [--rev <rev>]...)" ;;
  esac
  shift
done

# Guard: .githooks/pre-push runs this script with SCRUB_FROM_HOOK=1, and
# under it --show-terms is ignored, so push output (which can land in shared
# logs and transcripts) never carries a denylist term. There is deliberately
# no env var that turns the flag on: an exported one would reach the hook.
if [ "$SHOW_TERMS" -eq 1 ] && [ -n "${SCRUB_FROM_HOOK:-}" ]; then
  echo "scrub: --show-terms ignored under the pre-push hook" >&2
  SHOW_TERMS=0
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/scrub.XXXXXX")" || die "mktemp failed"
trap 'rm -rf "$TMP"' EXIT

# ---- config and tool checks (fail closed) -----------------------------------
[ -d "$CFG" ] || die "config dir not found: $CFG"
[ -d "$CFG/denylist.d" ] || die "missing $CFG/denylist.d"
[ -d "$CFG/vocab.d" ] || die "missing $CFG/vocab.d"
[ -f "$CFG/sources.txt" ] || die "missing $CFG/sources.txt"
command -v gitleaks >/dev/null 2>&1 || die "gitleaks not found on PATH"
command -v git >/dev/null 2>&1 || die "git not found on PATH"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && git rev-parse --show-toplevel)" \
  || die "cannot resolve repository root"
cd "$REPO"
[ "$(git rev-parse --is-shallow-repository)" = false ] \
  || die "shallow clone: history is incomplete; run git fetch --unshallow"

# ---- assemble the term lists -------------------------------------------------
: > "$TMP/curated"
: > "$TMP/vocab"
: > "$TMP/stems_long"
: > "$TMP/stems_short"
: > "$TMP/allow"
: > "$TMP/id_allow"

# cat_dir <dir> <out>: concatenates <dir>/*.txt into <out>; 1 if none
cat_dir() {
  local found=0 f
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    found=1
    cat "$f" >> "$2"
    echo >> "$2"
  done <<EOF
$(find "$1" -maxdepth 1 -type f -name '*.txt' | sort)
EOF
  [ "$found" -eq 1 ]
}

cat_dir "$CFG/denylist.d" "$TMP/curated" || die "no entries under $CFG/denylist.d/*.txt"
cat_dir "$CFG/vocab.d" "$TMP/vocab" || die "no entries under $CFG/vocab.d/*.txt"

nsrc=0
while IFS= read -r line || [ -n "$line" ]; do
  line="$(printf '%s' "$line" | tr -d '\r')"
  case "$line" in ''|'#'*) continue ;; esac
  repo="${line%% *}"
  subs="${line#"$repo"}"
  case "$repo" in
    '~') repo="$HOME" ;;
    '~/'*) repo="$HOME/$(printf '%s' "$repo" | cut -c3-)" ;;
  esac
  [ -n "${subs// /}" ] || die "sources.txt: no subpaths for a source repo"
  git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 || die "sources.txt: not a git repo: $repo"
  # Subpaths are whitespace-separated and intentionally word-split.
  set -f
  # shellcheck disable=SC2086
  git -C "$repo" log --all --name-only --format= -- $subs > "$TMP/paths" \
    || die "git log failed in source repo: $repo"
  set +f
  [ -s "$TMP/paths" ] || die "source yielded no tracked files: $repo"
  # Two forms per file: basename minus its last extension, and basename cut
  # at the first dot. Each is kept by length (long: >= MIN_LEN, short: review).
  sort -u "$TMP/paths" | awk -F/ -v min="$MIN_LEN" -v rmin="$REVIEW_MIN_LEN" \
    -v lf="$TMP/stems_long" -v sf="$TMP/stems_short" '
    function emit(s,   n) {
      s = tolower(s); n = length(s)
      if (n >= min) print s >> lf
      else if (n >= rmin) print s >> sf
    }
    { b = $NF
      a = b; sub(/\.[^.]*$/, "", a); emit(a)
      c = b; sub(/\..*$/, "", c); if (c != a) emit(c) }'
  nsrc=$((nsrc + 1))
done < "$CFG/sources.txt"
[ "$nsrc" -gt 0 ] || die "no source repos listed in $CFG/sources.txt"

# normalize: lowercase, no CR, no blanks or comments, unique
norm() { tr -d '\r' | tr 'A-Z' 'a-z' | grep -v -e '^[[:space:]]*$' -e '^#' | sort -u || true; }
count() { wc -l < "$1" | tr -d ' '; }
# minus <a> <b> <out>: lines of <a> not in <b>
minus() {
  if [ -s "$2" ]; then grep -v -x -F -f "$2" "$1" > "$3" || true; else cp "$1" "$3"; fi
}

norm < "$TMP/curated" > "$TMP/curated_n"
[ -s "$TMP/curated_n" ] || die "no entries under $CFG/denylist.d/*.txt"
norm < "$TMP/stems_long" > "$TMP/stems_n"

# The allowlist may only filter generated stems. An entry that is also a
# curated term is a configuration error.
if [ -f "$CFG/allow.txt" ]; then
  norm < "$CFG/allow.txt" > "$TMP/allow"
  tr -d '\r' < "$CFG/allow.txt" > "$TMP/allow_raw"
  rc=0
  grep -n -i -x -F -f "$TMP/curated_n" "$TMP/allow_raw" | cut -d: -f1 > "$TMP/conflict" || rc=$?
  if [ -s "$TMP/conflict" ]; then
    die "allow.txt line(s) $(tr '\n' ' ' < "$TMP/conflict")also appear in denylist.d; remove them from allow.txt"
  fi
fi
[ -f "$CFG/identity-allow.txt" ] && norm < "$CFG/identity-allow.txt" > "$TMP/id_allow"

minus "$TMP/stems_n" "$TMP/allow" "$TMP/stems_kept"
cat "$TMP/curated_n" "$TMP/stems_kept" | sort -u > "$TMP/deny"
[ -s "$TMP/deny" ] || die "assembled denylist is empty"

# review-only terms: short stems and vocabulary not already denied (stems
# also not allowed)
norm < "$TMP/stems_short" > "$TMP/short_all"
minus "$TMP/short_all" "$TMP/deny" "$TMP/short_a"
minus "$TMP/short_a" "$TMP/allow" "$TMP/review"
norm < "$TMP/vocab" > "$TMP/vocab_n"
[ -s "$TMP/vocab_n" ] || die "no entries under $CFG/vocab.d/*.txt"
minus "$TMP/vocab_n" "$TMP/deny" "$TMP/vocab_kept"

n_cur="$(count "$TMP/curated_n")"
n_stems="$(count "$TMP/stems_n")"
n_kept="$(count "$TMP/stems_kept")"
n_total="$(count "$TMP/deny")"
n_review="$(count "$TMP/review")"
n_vocab="$(count "$TMP/vocab_kept")"
echo "scrub: counts curated=$n_cur stems=$n_stems allow_removed=$((n_stems - n_kept)) overlap=$((n_cur + n_kept - n_total)) total=$n_total review_only=$n_review vocab=$n_vocab" >&2

# ---- published refs ----------------------------------------------------------
# tips: "<sha> <label>" for every published ref; tip_shas: the unique SHAs
git for-each-ref --format='%(objectname) %(refname)' refs/heads refs/tags > "$TMP/tips" \
  || die "git for-each-ref failed"
git ls-remote "$REMOTE" > "$TMP/remote_refs" 2>"$TMP/err_r" \
  || { cat "$TMP/err_r" >&2; die "cannot list refs on remote '$REMOTE'"; }
awk -F'\t' '$2 !~ /\^\{\}$/ { print $1 " " "remote:" $2 }' "$TMP/remote_refs" >> "$TMP/tips"
for r in $EXTRA_REVS; do
  sha="$(git rev-parse --verify --quiet "$r^{object}")" || die "--rev: not a revision: $r"
  echo "$sha pushed" >> "$TMP/tips"
done
while read -r sha label; do
  git cat-file -e "$sha" 2>/dev/null \
    || die "$label is at an object not in this clone; fetch it first (git fetch $REMOTE)"
done < "$TMP/tips"
cut -d' ' -f1 "$TMP/tips" | sort -u > "$TMP/tip_shas"

: > "$TMP/commits"
[ -s "$TMP/tip_shas" ] && git rev-list --stdin < "$TMP/tip_shas" > "$TMP/commits"
echo "== published refs: $(count "$TMP/tips") ref(s), $(count "$TMP/tip_shas") tip(s), $(count "$TMP/commits") commit(s), remote '$REMOTE'"

# ---- build the four surfaces -------------------------------------------------
# tracked: the index, exported (checkout-index writes nothing for gitlinks)
mkdir "$TMP/idx" "$TMP/hist" "$TMP/meta"
git checkout-index --all --prefix="$TMP/idx/" || die "git checkout-index failed"

# history: blobs reachable from any tip, minus those already in the index
: > "$TMP/blob_paths"
if [ -s "$TMP/tip_shas" ]; then
  git rev-list --objects --stdin < "$TMP/tip_shas" > "$TMP/objs" || die "git rev-list --objects failed"
  cut -d' ' -f1 "$TMP/objs" \
    | git cat-file --batch-check='%(objectname) %(objecttype)' \
    | awk '$2 == "blob" { print $1 }' | sort -u > "$TMP/blobs_all"
  awk '{ s = $1; p = substr($0, length(s) + 2); if (p != "" && !(s in seen)) { seen[s] = 1; print s "\t" p } }' \
    "$TMP/objs" > "$TMP/blob_paths"
  git ls-files -s | awk '{ print $2 }' | sort -u > "$TMP/blobs_idx"
  comm -23 "$TMP/blobs_all" "$TMP/blobs_idx" > "$TMP/blobs_hist"
  while IFS= read -r b; do
    git cat-file blob "$b" > "$TMP/hist/$b" || die "git cat-file failed: $b"
  done < "$TMP/blobs_hist"
fi

# message: one line per message line; msgs.map holds the matching location
: > "$TMP/meta/msgs.txt"
: > "$TMP/msgs.map"
: > "$TMP/ids_raw"
if [ -s "$TMP/tip_shas" ]; then
  git log --stdin --format='%x1e%H%n%B' < "$TMP/tip_shas" \
    | awk -v mf="$TMP/meta/msgs.txt" -v mp="$TMP/msgs.map" '
      substr($0, 1, 1) == "\036" { c = substr($0, 2, 12); n = 0; next }
      { n++; print > mf; print "commit " c ":" n > mp }'
  git log --stdin --format='%an <%ae>%n%cn <%ce>' < "$TMP/tip_shas" >> "$TMP/ids_raw"
  # annotated tags carry a message and a tagger of their own
  while read -r sha label; do
    [ "$(git cat-file -t "$sha")" = tag ] || continue
    git cat-file tag "$sha" | awk -v mf="$TMP/meta/msgs.txt" -v mp="$TMP/msgs.map" \
      -v idf="$TMP/ids_raw" -v t="$label" '
      body { n++; print > mf; print "tag " t ":" n > mp; next }
      /^$/ { body = 1; next }
      /^tagger / { s = substr($0, 8); sub(/> .*$/, ">", s); print s > idf }'
  done < "$TMP/tips"
fi
sort -u "$TMP/ids_raw" > "$TMP/meta/ids.txt"

# path: shown only as #<n> unless --show-terms, since a path can hold a term
{
  git ls-files
  if [ -s "$TMP/tip_shas" ]; then
    awk '{ s = $1; p = substr($0, length(s) + 2); if (p != "") print p }' "$TMP/objs"
  fi
} | sort -u > "$TMP/meta/paths.txt"

# ---- scanning ----------------------------------------------------------------
: > "$TMP/hits_all"
n_block=0
n_warn=0

# grep_into <out> <grep args...>: grep -n -o -I; exit 1 (no match) is fine
grep_into() {
  local out="$1" rc=0
  shift
  grep -n -o -I "$@" > "$out" 2>"$TMP/err_g" || rc=$?
  [ "$rc" -le 1 ] || { cat "$TMP/err_g" >&2; die "grep failed (exit $rc)"; }
}

# scan <tag> <check> <mode> <pattern> [<drop-regex>]
#   mode terms: <pattern> is a file of fixed strings, case-insensitive whole
#   words. mode regex: <pattern> is a case-sensitive extended regex. Matches
#   equal to <drop-regex> are discarded.
scan() {
  local tag="$1" check="$2" mode="$3" pat="$4" drop="${5:-}" lower=0
  if [ "$mode" = terms ]; then
    [ -s "$pat" ] || return 0
    set -- -i -w -F -f "$pat"; lower=1
  else
    set -- -E -e "$pat"
  fi
  grep_into "$TMP/g_idx" -r "$@" "$TMP/idx"
  grep_into "$TMP/g_hist" -r "$@" "$TMP/hist"
  grep_into "$TMP/g_msg" "$@" "$TMP/meta/msgs.txt"
  grep_into "$TMP/g_id" "$@" "$TMP/meta/ids.txt"
  grep_into "$TMP/g_path" "$@" "$TMP/meta/paths.txt"

  # normalize every surface to "surface<TAB>location<TAB>match"
  {
    awk -v p="$TMP/idx/" '{ s = substr($0, length(p) + 1)
      i = index(s, ":"); f = substr(s, 1, i - 1); s = substr(s, i + 1)
      i = index(s, ":"); print "tracked\t" f ":" substr(s, 1, i - 1) "\t" substr(s, i + 1) }' "$TMP/g_idx"
    awk -v p="$TMP/hist/" '{ s = substr($0, length(p) + 1)
      i = index(s, ":"); f = substr(s, 1, i - 1); s = substr(s, i + 1)
      i = index(s, ":"); print "history\t" f ":" substr(s, 1, i - 1) "\t" substr(s, i + 1) }' "$TMP/g_hist"
    awk -v mp="$TMP/msgs.map" 'BEGIN { while ((getline l < mp) > 0) m[++k] = l }
      { i = index($0, ":"); print "message\t" m[substr($0, 1, i - 1)] "\t" substr($0, i + 1) }' "$TMP/g_msg"
    awk '{ i = index($0, ":"); print "identity\t#" substr($0, 1, i - 1) "\t" substr($0, i + 1) }' "$TMP/g_id"
    awk -v pf="$TMP/meta/paths.txt" -v show="$SHOW_TERMS" '
      BEGIN { while ((getline l < pf) > 0) m[++k] = l }
      { i = index($0, ":"); n = substr($0, 1, i - 1)
        print "path\t" (show ? m[n] : "#" n) "\t" substr($0, i + 1) }' "$TMP/g_path"
  } > "$TMP/hits"

  if [ -n "$drop" ]; then
    awk -F'\t' -v d="$drop" '$3 !~ d' "$TMP/hits" > "$TMP/hits_k"
    mv "$TMP/hits_k" "$TMP/hits"
  fi
  [ -s "$TMP/hits" ] || return 0

  # history locations name a blob; show the first commit and path instead
  awk -F'\t' '$1 == "history" { split($2, a, ":"); print a[1] }' "$TMP/hits" | sort -u > "$TMP/hit_blobs"
  : > "$TMP/blob_loc"
  while IFS= read -r b; do
    [ -n "$b" ] || continue
    git log --reverse --format=%H --find-object="$b" --stdin < "$TMP/tip_shas" > "$TMP/fo"
    c="$(head -n 1 "$TMP/fo" | cut -c1-12)"
    p="$(awk -F'\t' -v b="$b" '$1 == b { print $2; exit }' "$TMP/blob_paths")"
    printf '%s\t%s:%s\n' "$b" "${c:-?}" "${p:-?}" >> "$TMP/blob_loc"
  done < "$TMP/hit_blobs"
  awk -F'\t' -v OFS='\t' -v bl="$TMP/blob_loc" '
    BEGIN { while ((getline l < bl) > 0) { split(l, a, "\t"); m[a[1]] = a[2] } }
    $1 == "history" { i = index($2, ":"); $2 = m[substr($2, 1, i - 1)] substr($2, i) }
    { print }' "$TMP/hits" > "$TMP/hits_m"

  awk -F'\t' -v c="$check" '{ print c "\t" $0 }' "$TMP/hits_m" >> "$TMP/hits_all"
  if [ "$SHOW_TERMS" -eq 1 ]; then
    awk -F'\t' -v t="$tag" -v lo="$lower" '{ m = lo ? tolower($3) : $3
      print t ": [" $1 "] " $2 "  [" m "]" }' "$TMP/hits_m" | sort -u > "$TMP/lines"
  else
    awk -F'\t' -v t="$tag" '{ print t ": [" $1 "] " $2 }' "$TMP/hits_m" | sort -u > "$TMP/lines"
  fi
  cat "$TMP/lines"
  if [ "$tag" = HIT ]; then
    n_block=$((n_block + $(count "$TMP/lines")))
  else
    n_warn=$((n_warn + $(count "$TMP/lines")))
  fi
}

# gitleaks_run <surface> <gitleaks args...>
# gitleaks can log an error, scan nothing and still exit 0, so any ERR line
# in its log is treated as a tool error.
gitleaks_run() {
  local surf="$1" rc=0
  shift
  gitleaks "$@" --no-banner --no-color --redact --exit-code 10 2>"$TMP/err_l" || rc=$?
  cat "$TMP/err_l" >&2
  grep -q ' ERR ' "$TMP/err_l" && die "gitleaks logged an error on $surf"
  case "$rc" in
    0) ;;
    10) echo "HIT: [$surf] gitleaks found secrets"; n_block=$((n_block + 1)) ;;
    *) die "gitleaks failed on $surf (exit $rc)" ;;
  esac
}

echo "== (1) gitleaks: tracked, history, messages and identities"
gitleaks_run tracked dir "$TMP/idx"
if [ -s "$TMP/tip_shas" ]; then
  gitleaks_run history git --log-opts="$(paste -s -d ' ' "$TMP/tip_shas")" "$REPO"
fi
gitleaks_run message dir "$TMP/meta"

echo "== (2) denylist"
scan HIT denylist terms "$TMP/deny"

echo "== (3) absolute home paths"
scan HIT home-path regex "$HOME_PATH_RE"

echo "== (4) review only: short file-name stems"
scan WARN stems terms "$TMP/review"

echo "== (5) review only: vocabulary"
scan WARN vocab terms "$TMP/vocab_kept"

echo "== (6) review only: UUIDs and long hex IDs"
scan WARN hex-id regex "$HEX_ID_RE" "$HEX_ID_ALLOW_RE"

echo "== (7) review only: version strings"
scan WARN version regex "$VERSION_RE"

# ---- identities --------------------------------------------------------------
# Every distinct identity is listed. One whose text matched a check above is
# shown only under --show-terms, so hook output never carries a listed term.
echo "== (8) identities: $(count "$TMP/meta/ids.txt") distinct"
awk -F'\t' '$2 == "identity" { print substr($3, 2) }' "$TMP/hits_all" | sort -u > "$TMP/id_hit"
n=0
while IFS= read -r ident; do
  n=$((n + 1))
  email="$(printf '%s' "$ident" | sed -n 's/.*<\([^<>]*\)>$/\1/p' | tr 'A-Z' 'a-z')"
  if printf '%s\n' "$email" | grep -q -E "$NOREPLY_RE"; then
    kind=noreply
  elif [ -n "$email" ] && grep -q -x -F -e "$email" "$TMP/id_allow"; then
    kind=allowlisted
  else
    kind=other
  fi
  shown="$ident"
  if [ "$SHOW_TERMS" -eq 0 ] && grep -q -x -F -e "$n" "$TMP/id_hit"; then
    shown="(matches a check above; see --show-terms)"
  fi
  if [ "$kind" = other ]; then
    echo "WARN: [identity] #$n $shown is not a GitHub noreply address"
    n_warn=$((n_warn + 1))
  else
    echo "identity: #$n $shown ($kind)"
  fi
done < "$TMP/meta/ids.txt"

echo "scrub: $n_block blocking, $n_warn review-only"
if [ "$n_block" -eq 0 ]; then
  echo "scrub: clean"
  exit 0
fi
echo "scrub: HITS FOUND (see above)" >&2
exit 1
