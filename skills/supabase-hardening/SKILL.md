---
name: supabase-hardening
description: Use when writing any Supabase migration; creating a table, view or function; writing Edge Function auth or secret handling; changing Storage bucket policies; adding a rate limit; or reviewing a Supabase project's security posture before launch.
---

# Supabase hardening

Database-side security for a Supabase project: what a new object is granted before you touch it, which gates look closed and are not, how Edge Functions and Storage authenticate and limit callers, and how to prove any of it. The checklist below always applies; each item points to the reference file that holds the detail and the SQL.

## Already in the project's `CLAUDE.md`

A project set up with the project-bootstrap skill carries some of these rules in its own `CLAUDE.md` (Supabase and Database blocks) and its committed `.claude/settings.json`: the `supabase db push` deny, schema changes applied by hand in the dashboard SQL editor, revoke-before-grant and its re-run after DROP + CREATE, and the raw-catalog, `IS DISTINCT FROM` and rolled-back-probe rules. Follow those there; this skill does not restate them. In a project that was not bootstrapped, read the same blocks in `skills/project-bootstrap/templates/CLAUDE.md.tmpl` in this dev-tools checkout.

## Checklist

**Revoke a function from `PUBLIC` and from the named roles in one statement, and revoke and grant each overload by its exact signature.**
Why: the built-in `PUBLIC` grant and the default-privilege role grants are independent, so either revoke alone leaves a caller in. → `reference/born-open-defaults.md`

**`anon` never writes, and holds `SELECT` only on data read before login.**
Why: `anon` is the key every visitor holds. → `reference/born-open-defaults.md`

**Create every view `with (security_invoker = true)` and revoke it before the intended grant.**
Why: a view runs as its owner, who bypasses RLS, and the option and the revoke close different holes. → `reference/gates-that-lie.md`

**Restrict client-writable columns with column grants, never with policies, and grant a new client-written column in the migration that adds it.**
Why: RLS is per row, and one ungranted column rejects the whole statement it rides in. → `reference/gates-that-lie.md`

**Grant a `SECURITY DEFINER` function that takes a user id to `service_role` only, or derive the user from `auth.uid()` inside it.**
Why: the definer bypasses RLS, so `EXECUTE` is its only gate. → `reference/gates-that-lie.md`

**Treat a caller as a trusted job only when it has no `request.jwt.claims` or a `service_role` claim, never because `auth.uid()` is null.**
Why: `anon` has no user id either. → `reference/gates-that-lie.md`

**Set `search_path = ''` and schema-qualify every reference whenever a function is already being edited, never in a pass of its own.**
Why: a missed qualification fails at run time, so each conversion needs a break probe, and touching a function twice pays that risk twice. → `reference/gates-that-lie.md`

**Compare Edge Function secrets fail-closed and in constant time, send them in a header, and give operator-only actions their own credential.**
Why: the self-disabling comparison admits everyone when the secret is unset, and a service-role key fails `getUser()`. → `reference/edge-functions-and-storage.md`

**A rate-limit RPC locks its counter row, buckets on the server clock with no date parameter, and is executable by `service_role` only; its caller fails closed and never returns a 500.**
Why: a caller-supplied date resets the limit at will, and a guard that reads a failed call as permission switches the limit off when it is broken. → `reference/edge-functions-and-storage.md`, `templates/new-function.sql.tmpl`

**When uploaded content must be vetted, the server owns the write and the client `INSERT` policies on `storage.objects` are dropped.**
Why: bucket MIME and size limits restrict the kind of file, not what it shows. → `reference/edge-functions-and-storage.md`

**End every ACL migration with a `DO` block that re-checks its claims against the raw ACL (`aclexplode`, `pg_attribute.attacl`) and raises.**
Why: privilege helpers stay `true` under `PUBLIC` inheritance, and the raise rolls an incomplete migration back. → `reference/verification.md`

**Probe behavior as the target role with both `SET LOCAL ROLE` and `SET LOCAL request.jwt.claims`, in a transaction that rolls back.**
Why: a catalog read proves what is granted, not what works, and a probe without claims tests a caller that never exists. → `reference/verification.md`

## Rate limits: where this skill stops

This skill owns the database side of a rate-limit RPC: its shape, its grants and its server-clock bucket. Whether every paid egress passes a rate limit before the request leaves is the application side, and belongs to the dev-tools `llm-call-hygiene` skill where that skill is installed. Where it is not, the one rule in `reference/edge-functions-and-storage.md` ("Run the limit before any paid egress") stands in for it.

## Templates

Copy one into the project's migrations folder, fill `{{DEV_TOOLS_SHA}}` with the short HEAD of this dev-tools checkout, rename the worked example, and apply it by hand in the dashboard SQL editor as one paste. Each runs in revoke-first order and ends in a `DO` block that raises on any failed check, which rolls the paste back.

The harness in `audit/test/` proves all three. Applied to a database with Supabase's default privileges, each one's `DO` block passes and the audit reports nothing. Each deliberate break (a missing revoke, the `PUBLIC` half of a function revoke, `search_path`, `security_invoker`) makes the block raise and the audit flag the matching rule. A renamed copy is new text, so its own `DO` block is still the check that counts.

- `templates/new-table.sql.tmpl`: revoke, subset grant, RLS, owner-scoped policies, an optional column-level write allowlist, and a check that `anon` holds nothing.
- `templates/new-view.sql.tmpl`: `security_invoker`, the revoke, the intended grant, and a check of `reloptions` and `relacl`.
- `templates/new-function.sql.tmpl`: a `SECURITY DEFINER` rate-limit RPC with an empty `search_path`, its server-only counter table, the two-part revoke, a `service_role` grant, and a check of `proacl` and `proconfig`.

## Audit

`audit/posture-audit.sql` is one read-only `SELECT` that lists a project's grant and RLS findings, one row per finding: `rule_id`, `severity` (high, medium, low or info), `object_type`, `object`, `detail` and `fix_hint`. Its header lists every rule and the reference principle behind each.

**Run it before launch, after any ACL migration, and when adopting an existing project.**
Why: grants drift silently. A DROP + CREATE resets one, and a stray grant reads exactly like an intended one until something lists them all.

- Run the whole file unchanged: `psql "$DATABASE_URL" -f posture-audit.sql`, or paste it into a read-only MCP connector or the dashboard SQL editor. It is one statement, so a tool that returns only the last result set still returns the audit.
- It needs only a read-only role. It reads `pg_catalog`, calls built-in catalog functions only and executes no project function.
- Set `exposed_schemas` at the top to the schemas the Data API serves. Schemas left out of it are not audited.

**Accept a finding only through the `exceptions` list at the top of the file: `(rule_id, object, reason)`, with `object` copied exactly from the finding.**
Why: an exception is visible where a deleted check is not. Each active one prints an info row, one that matches nothing is flagged as stale, and one without a reason is ignored and reported.

- Keep the project's exceptions in a copy of the file in the project. That copy is then the project's own.

**A clean result is not proof of safety; prove behavior with rolled-back probes as the app roles.**
Why: the audit reads grants and RLS posture, not policy logic, function bodies, Edge Functions or Storage. → `reference/verification.md`

The harness behind the audit and the templates is in `audit/test/`. It runs on PGlite (Postgres in WebAssembly), so it needs no Docker and no live database. From a dev-tools checkout, run `npm install` and then `npm test`. Every probe there first shows the clean case passing and then shows the break changing the result.

## Reference files

Open these from this folder when needed:

- `reference/born-open-defaults.md`: what Supabase's default privileges grant, revoke-first, the two halves of a function revoke, DROP + CREATE resets, overloads. Open before any `CREATE` and after any DROP + CREATE.
- `reference/gates-that-lie.md`: column grants versus RLS, policies by absence, views and definer functions, the trusted-caller test, trigger `EXECUTE`, `search_path`. Open before relying on any policy, view or function guard.
- `reference/edge-functions-and-storage.md`: secret comparison, operator credentials, service-role scoping, the rate-limit RPC and its caller, Storage policies. Open before writing Edge Function auth, a rate limit or a bucket policy.
- `reference/verification.md`: reading the catalog, the in-migration check, rolled-back probes, and the traps in the tools themselves. Open before verifying anything above.
