<!-- Forward-looking only: nothing in this file has shipped, and it only ever shrinks. -->
<!-- When work ships, run the spec-update protocol in CLAUDE.md and remove it from here. Never add shipped detail. -->
<!-- Seeded from dev-tools @ {{DEV_TOOLS_SHA}}; this file is now the project's own. -->

# {{PROJECT_NAME}}: Roadmap

Unbuilt work, in one place. `PRODUCT_SPEC.md` is the source of truth for what exists and `CHANGELOG.md` for what changed.

---

## Order export (example epic; replace or delete)

Shop staff can export orders and their items for a date range as CSV. The reasoning lives in `docs/decisions/order-export-<date>.md`; write it before step 1.

### Sequence

The ordered remaining work. A session arriving on this epic needs only this subsection and the newest handoff. Delete a step when it ships; when the last one ships, delete the epic.

1. **Export query.** Orders with their items for a date range, paged, in a stable order.
2. **CSV writer.** One row per item, with the order's number, date and status repeated on each row.
3. **Export action on the orders list.** Uses the list's current status filter and date range.

---

## Deferred

Parked on purpose. Each item says why it waits and what would reopen it.

- **Scheduled exports.** Waits on a background job runner; reopen when one exists for another feature.
