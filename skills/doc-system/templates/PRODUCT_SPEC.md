<!-- Last updated: {{SEED_DATE}} (v0.1) -->
<!-- Current behavior only. History: CHANGELOG.md. Unbuilt work: ROADMAP.md. Reasoning: docs/decisions/. -->
<!-- Seeded from dev-tools @ {{DEV_TOOLS_SHA}}; this file is now the project's own. -->

# {{PROJECT_NAME}}: Product Spec

{{PRODUCT_SUMMARY}}

---

## Feature Index

A map, not a history: one row per feature area, a short statement of durable behavior plus the version that introduced it or last changed it significantly. The detail lives in the changelog entry that version names.

| Feature Area | Version |
|---|---|
| Doc system: a current-behavior spec, a windowed changelog with sealed archives, a forward-only roadmap, decision records and handoffs, held to shape by a contract test | v0.1 |

<!-- Example row: | Orders list: newest first, filterable by status; archived orders hidden by default | v1.4 | -->

---

## Current Feature Set

One subsection per feature area. Bullets state durable behavior, never implementation: "archived orders are hidden from the orders list", not "renders when `order.status !== 'archived'`".

### Doc system (v0.1)

- `PRODUCT_SPEC.md` states current behavior and carries one "Last updated" stamp naming the newest changelog version.
- `CHANGELOG.md` holds the most recent entries, newest first; older entries live verbatim in `changelog/`.
- `ROADMAP.md` lists only unbuilt work and shrinks as work ships.
- `docs/decisions/` records why a settled design is the way it is; `docs/handoffs/` carries live state between sessions; `docs/audits/` holds point-in-time investigations.
