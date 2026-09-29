<!--
Seeded from dev-tools @ {{DEV_TOOLS_SHA}}; this file is now the project's own.
Copy to docs/decisions/<topic>-<YYYY-MM>.md and delete this comment.
Lifecycle of the STATUS line, updated in place:
  PROPOSED   under discussion; nothing built
  ACTIVE     settled; being built (name the versions shipped so far)
  SHIPPED    vX.Y–vX.Z, closed <date>; only once "Final state, verified" below is filled
  SUPERSEDED by <file>; leave the body as history
-->
# Item quantity limits: decision record

STATUS: PROPOSED, <date>

A reasoning log, not a findings log: the current behavior is in `PRODUCT_SPEC.md`; this file records why it is shaped that way.

## 1. Context

What forced the decision: orders could carry any quantity of an item, and oversized orders failed at fulfilment instead of at checkout.

## 2. Decision

The rule, stated so it can be checked: each item carries a per-order maximum; checkout rejects an order over it with a message naming the item.

## 3. Alternatives considered

Each option not taken, and the reason it lost.

## 4. Consequences

What this makes easier, what it makes harder, and what it rules out.

## 5. As built

Filled at close: every difference between this record and what shipped, with the version and the reason.

## 6. Final state, verified

Filled at close: the shipped behavior, how it was verified, and when. The STATUS line moves to SHIPPED only after this section is written.
