#!/usr/bin/env bash
# Pre-push scrub gate for this repository.
#
# Scans the working tree and the full git history for (1) secrets, via
# gitleaks, and (2) terms from a private denylist that lives outside the repo.
#
# Config directory: $SCRUB_CONFIG_DIR, default ~/.config/dev-tools/scrub
#   denylist.d/*.txt  one term per line (case-insensitive, whole-word match)
#   sources.txt       one source repo per line: <repo path> <subpath>...
#                     File-name stems (8+ chars) ever tracked under those
#                     subpaths, across that repo's full history, are added to
#                     the denylist. Stems of 4-7 chars are review-only.
#   allow.txt         optional; generic words removed from the denylist
#
# Exit codes: 0 clean, 1 any hit from checks (a)-(d), 2 config or tool error.
# Fails closed: anything missing or empty is exit 2, never a silent pass.
# Compatible with bash 3.2 (no mapfile, no associative arrays).

set -euo pipefail

CFG="${SCRUB_CONFIG_DIR:-$HOME/.config/dev-tools/scrub}"
MIN_LEN=8
REVIEW_MIN_LEN=4

die() {
  echo "scrub: error: $*" >&2
  exit 2
}

TMP="$(mktemp -d "${TMPDIR:-/tmp}/scrub.XXXXXX")" || die "mktemp failed"
trap 'rm -rf "$TMP"' EXIT

# ---- config and tool checks (fail closed) -----------------------------------
[ -d "$CFG" ] || die "config dir not found: $CFG"
[ -d "$CFG/denylist.d" ] || die "missing $CFG/denylist.d"
[ -f "$CFG/sources.txt" ] || die "missing $CFG/sources.txt"
command -v gitleaks >/dev/null 2>&1 || die "gitleaks not found on PATH"
command -v git >/dev/null 2>&1 || die "git not found on PATH"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && git rev-parse --show-toplevel)" \
  || die "cannot resolve repository root"
cd "$REPO"

# ---- assemble the denylist ---------------------------------------------------
: > "$TMP/curated"
: > "$TMP/stems_long"
: > "$TMP/stems_short"
: > "$TMP/allow"

found_list=0
while IFS= read -r f; do
  found_list=1
  cat "$f" >> "$TMP/curated"
  echo >> "$TMP/curated"
done <<EOF
$(find "$CFG/denylist.d" -maxdepth 1 -type f -name '*.txt' | sort)
EOF
[ "$found_list" -eq 1 ] && [ -s "$TMP/curated" ] || die "no entries under $CFG/denylist.d/*.txt"

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

if [ -s "$TMP/allow" ]; then
  grep -v -x -F -f "$TMP/allow" "$TMP/stems_n" > "$TMP/stems_kept" || true
else
  cp "$TMP/stems_n" "$TMP/stems_kept"
fi

cat "$TMP/curated_n" "$TMP/stems_kept" | sort -u > "$TMP/deny"
[ -s "$TMP/deny" ] || die "assembled denylist is empty"

# review-only terms: short stems not already denied or allowed
norm < "$TMP/stems_short" > "$TMP/short_all"
grep -v -x -F -f "$TMP/deny" "$TMP/short_all" > "$TMP/short_a" || true
if [ -s "$TMP/allow" ]; then
  grep -v -x -F -f "$TMP/allow" "$TMP/short_a" > "$TMP/review" || true
else
  cp "$TMP/short_a" "$TMP/review"
fi

n_cur="$(count "$TMP/curated_n")"
n_stems="$(count "$TMP/stems_n")"
n_kept="$(count "$TMP/stems_kept")"
n_total="$(count "$TMP/deny")"
n_review="$(count "$TMP/review")"
echo "scrub: counts curated=$n_cur stems=$n_stems allow_removed=$((n_stems - n_kept)) overlap=$((n_cur + n_kept - n_total)) total=$n_total review_only=$n_review" >&2

status=0

# ---- (a) gitleaks, working tree ---------------------------------------------
echo "== (a) gitleaks: working tree"
rc=0
gitleaks dir --no-banner --redact --exit-code 10 "$REPO" || rc=$?
case "$rc" in
  0) ;;
  10) echo "HIT: gitleaks found secrets in the working tree"; status=1 ;;
  *) die "gitleaks dir failed (exit $rc)" ;;
esac

# ---- (b) gitleaks, full history ---------------------------------------------
echo "== (b) gitleaks: full history"
rc=0
gitleaks git --no-banner --redact --exit-code 10 "$REPO" || rc=$?
case "$rc" in
  0) ;;
  10) echo "HIT: gitleaks found secrets in history"; status=1 ;;
  *) die "gitleaks git failed (exit $rc)" ;;
esac

# ---- (c) denylist over the working tree -------------------------------------
echo "== (c) denylist: working tree"
rc=0
grep -r -n -I -i -w -F -f "$TMP/deny" --exclude-dir=.git . > "$TMP/out_c" 2>"$TMP/err_c" || rc=$?
case "$rc" in
  0) cut -d: -f1,2 "$TMP/out_c" | sed 's|^\./||' | sort -u | sed 's/^/HIT: /'; status=1 ;;
  1) ;;
  *) cat "$TMP/err_c" >&2; die "working-tree grep failed (exit $rc)" ;;
esac

# ---- (d) denylist over every revision ---------------------------------------
echo "== (d) denylist: all revisions"
git rev-list --all > "$TMP/revs" || die "git rev-list failed"
: > "$TMP/out_d"
while IFS= read -r rev; do
  [ -n "$rev" ] || continue
  rc=0
  git grep -n -I -i -w -F -f "$TMP/deny" "$rev" > "$TMP/one" 2>"$TMP/err_d" || rc=$?
  case "$rc" in
    0) cut -d: -f1-3 "$TMP/one" >> "$TMP/out_d" ;;
    1) ;;
    *) cat "$TMP/err_d" >&2; die "git grep failed at $rev (exit $rc)" ;;
  esac
done < "$TMP/revs"
if [ -s "$TMP/out_d" ]; then
  sort -u "$TMP/out_d" | sed 's/^/HIT: /'
  status=1
fi

# ---- (e) review only: short stems, never failing ----------------------------
echo "== (e) review only: short file-name stems (working tree)"
if [ -s "$TMP/review" ]; then
  rc=0
  grep -r -n -I -i -w -F -f "$TMP/review" --exclude-dir=.git . > "$TMP/out_e_wt" 2>/dev/null || rc=$?
  if [ "$rc" -eq 0 ]; then
    cut -d: -f1,2 "$TMP/out_e_wt" | sed 's|^\./||' | sort -u | sed 's/^/WARN: /'
  fi
fi

if [ "$status" -eq 0 ]; then
  echo "scrub: clean"
else
  echo "scrub: HITS FOUND (see above)" >&2
fi
exit "$status"
