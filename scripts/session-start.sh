#!/bin/sh
# Session-start check. A copy of this repo's own templates/session-start.sh.tmpl,
# kept to its push-guard block.
#
# Run at session pre-flight, from the repo root: sh scripts/session-start.sh
# Each failed check prints one line on stderr, and the exit status is non-zero
# when any check failed. It tests a credential only for being set, and never
# prints, compares or logs its value.

status=0
fail() {
  echo "session-start: $1" >&2
  status=1
}

if [ "$(git config core.hooksPath)" != ".githooks" ]; then
  fail "git config core.hooksPath does not print .githooks, so the push guard is off; run: git config core.hooksPath .githooks"
fi

exit "$status"
