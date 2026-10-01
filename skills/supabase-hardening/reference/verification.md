# Verification

How to prove a grant, a policy or a function does what the migration claims. A bootstrapped project's `CLAUDE.md` (project-bootstrap template, Database block) already carries the one-line rules: read `pg_catalog`, compare with `IS DISTINCT FROM`, prove by rolled-back execution, inspect the raw catalog before fixing a failed check, and trust a probe only once it has failed against a deliberate break (Gates block). This file holds the detail.

---

## Reading the catalog

**Read the raw ACL (`pg_class.relacl`, `pg_proc.proacl`, `pg_attribute.attacl`) and treat the privilege helpers as a second check, never the only one.**
Why: `has_function_privilege` and its siblings report the effective privilege, which stays `true` under `PUBLIC` inheritance long after the named-role revoke ran, so a half-done cleanup reads as done.

- Inspect entries with `aclexplode`, never a `LIKE` on the text: `PUBLIC` is grantee `0` and renders as a bare `=X/owner`, which a substring test reads past.

```sql
select a.grantee::regrole, a.privilege_type
from pg_proc p, aclexplode(p.proacl) a
where p.oid = 'public.submit_order(uuid)'::regprocedure;
-- grantee 0 prints as "-": that row is PUBLIC
```

**Never verify column grants with `information_schema.role_table_grants`; read `pg_attribute.attacl` and `has_column_privilege` instead.**
Why: `role_table_grants` reports table-level grants only, so a working column allowlist reads as "no `INSERT`, no `UPDATE`" and looks unapplied.

**Read grants, triggers and constraints from `pg_catalog` (`pg_attribute`, `pg_trigger`, `pg_constraint`), not from `information_schema`.**
Why: `information_schema` views show only rows tied to roles the current user belongs to, so through a diagnostic role that is not a member of `anon` or `authenticated` they return nothing, which reads exactly like "no grant".

**Compare a nullable catalog value with `IS NOT DISTINCT FROM`, and compare `proconfig` against the exact hardened text, `{"search_path=\"\""}` (20 characters).**
Why: `proconfig = '…'` is `NULL` on an unhardened function, which a `WHERE` or `IF` treats as false, and an empty `search_path` is stored as `search_path=""`, so a check against `search_path=` fails on every correct function.

- In a migration file, construct the value instead of typing it: `(array['search_path=""'])::text`. It leaves no escape sequence for a tool to decode on the way to disk or to the database.
- Give the predicate a positive control in both directions, one function that must read `true` and one that must read `false`; a predicate only ever seen returning one value proves nothing about the other.

**Pin `COLLATE "C"` on both sides when comparing or sorting catalog names against hand-written text.**
Why: `name` columns carry `C` collation while a text literal sorts under the database default, so two identical sets can sort differently and report a false drift.

## In the migration

**End every ACL migration with a `DO` block that re-checks each claim the migration made and raises on failure, inside the same transaction.**
Why: the raise rolls the whole paste back, and a rule that turned out to be incomplete is caught by its own check rather than shipped.

- The templates in `templates/` each end in one; copy the shape.
- After a `CREATE OR REPLACE`, assert the ACL it preserved rather than re-granting it.

## Behavioral probes

**Probe behavior in a rolled-back transaction as the target role, with both `SET LOCAL ROLE` and `SET LOCAL request.jwt.claims`; a catalog read proves what is granted, not what works.**
Why: policies and guards read `auth.uid()` from the claims, so a role switch without claims tests a caller that never exists, and a probe as `service_role` bypasses grants and RLS and proves nothing about them.

```sql
do $$
declare v_n integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
  update public.orders set note = note where true;        -- an allowlisted column
  get diagnostics v_n = row_count;
  raise notice 'own rows updated: %', v_n;
  raise exception 'ROLLBACK';                              -- nothing commits
end $$;
```

**Run several expected-failure probes in one `DO` block, each in its own `begin … exception when others then … end` sub-block, and read the outcomes from the final raise.**
Why: a plain `BEGIN … ROLLBACK` script aborts at the first failing statement, so every later probe reports "current transaction is aborted" instead of its own result.

**To probe a whole migration without committing it, run it as one `DO` block: check the body string's `md5` against the file's, `EXECUTE` the body, run the assertions, apply each deliberate break with `replace()` on the same string in its own sub-block, and end every sub-block and the whole block by raising.**
Why: one statement removes any question of whether the tool ran it as one transaction, the `md5` proves the probed text is the file's text, and the raise guarantees no DDL survives.

**Compare an applied function with its migration file by `md5(prosrc)` against the text between the function's dollar quotes, never by `md5(pg_get_functiondef(oid))`.**
Why: `pg_get_functiondef` re-renders the header from the catalog, so it never matches the pasted text, while `prosrc` is the stored body.

A probe counts only after it has been seen to fail against a deliberate break; that rule is in the project's `CLAUDE.md` (Gates) and applies to every probe above.

## The tools in between

**A read-only diagnostic role bypasses RLS and holds no `EXECUTE`: its successful reads prove nothing about the app roles, and its failed reads prove nothing about the app. Verify as the app role, and never grant a platform-managed role anything to make a check work.**
Why: a role with blanket `SELECT` reads past every policy and fails on any `security_invoker` view that calls a function, while the app's own roles see neither effect.

**Write each check as one statement (or one `DO` block): several MCP connectors and the dashboard SQL editor return only the last statement's result set.**
Why: a verification `SELECT` placed before or between other statements silently shows nothing, which reads as a pass.
