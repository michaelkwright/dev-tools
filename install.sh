#!/usr/bin/env bash
# Link every skill under skills/ into ~/.claude/skills/ as an absolute symlink.
# Idempotent. A symlink pointing elsewhere is repointed; a real file or
# directory is never touched (refused, and the script exits non-zero). A
# folder without a SKILL.md is not a loadable skill and is skipped.
set -u

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
skills_src="$repo_dir/skills"
skills_dst="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"

if [ ! -d "$skills_src" ]; then
  echo "error: $skills_src not found" >&2
  exit 1
fi

mkdir -p "$skills_dst"

linked=0 unchanged=0 repointed=0 refused=0 skipped=0

for dir in "$skills_src"/*/; do
  [ -d "$dir" ] || continue
  name="$(basename "$dir")"
  target="$skills_src/$name"
  link="$skills_dst/$name"

  if [ ! -f "$target/SKILL.md" ]; then
    echo "skipped    $name: no SKILL.md, not a loadable skill"
    skipped=$((skipped + 1))
    continue
  fi

  if [ -L "$link" ]; then
    current="$(readlink "$link")"
    if [ "$current" = "$target" ]; then
      echo "ok         $name -> $target"
      unchanged=$((unchanged + 1))
    else
      ln -sfn "$target" "$link"
      echo "repointed $name: $current -> $target"
      repointed=$((repointed + 1))
    fi
  elif [ -e "$link" ]; then
    echo "refused    $name: $link exists and is not a symlink; move it aside and re-run" >&2
    refused=$((refused + 1))
  else
    ln -s "$target" "$link"
    echo "linked     $name -> $target"
    linked=$((linked + 1))
  fi
done

echo "summary: $linked linked, $repointed repointed, $unchanged unchanged, $refused refused, $skipped skipped"

[ "$refused" -eq 0 ]
