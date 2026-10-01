# Born-open defaults

Supabase ships default privileges that stock Postgres does not have. Every table, view and function created in `public` arrives already granted to the client roles, so a migration that only grants revokes nothing. The one-line form of the revoke rule is already in a bootstrapped project's `CLAUDE.md` (project-bootstrap template, Supabase block); this file holds the detail behind it.

---

**Read `pg_default_acl` before reasoning about what a new object holds: in a Supabase `public` schema, new tables, views and functions are granted to `anon` and `authenticated` at creation.**
Why: stock Postgres grants a new table nothing, so general knowledge predicts the opposite of what happens here.

```sql
select d.defaclobjtype, d.defaclacl::text
from pg_default_acl d
join pg_namespace n on n.oid = d.defaclnamespace
where n.nspname = 'public';
```

On a default project the `r` row (relations, which covers views too) reads `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}` and the `f` row reads `{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`. Read it live; a project can differ.

**Revoke all first, then grant the intended subset, in the same migration as the `CREATE`.**
Why: a grant of the subset alongside the defaults grants nothing new and revokes nothing, so the migration reads as correct while `anon` still holds `INSERT`, `UPDATE` and `DELETE`.

```sql
create table public.orders (...);
revoke all on table public.orders from public, anon, authenticated;   -- first
grant select, insert, update, delete on table public.orders to authenticated;   -- then the subset
```

The revoke is additive to `ENABLE ROW LEVEL SECURITY` and the policies, never a replacement: grants and RLS answer different questions (see `gates-that-lie.md`).

**On a function, revoke from `PUBLIC` and from the named roles in one statement: `REVOKE ALL ON FUNCTION public.fn(args) FROM PUBLIC, anon, authenticated;`, then grant `EXECUTE` to the intended roles.**
Why: these are two independent grants, the built-in `PUBLIC` `EXECUTE` (the bare `=X/owner` entry) and the per-role entries from default privileges. Revoking the named roles alone leaves `PUBLIC`, revoking `PUBLIC` alone leaves the named roles, and each half has been seen surviving on its own.

**After any `DROP` + `CREATE` of a hardened object, re-apply its revoke and grants and re-read its ACL. A return-type change and a view rebuild both force one.**
Why: `CREATE OR REPLACE` keeps the existing ACL, but a dropped and recreated object is a new object born with the defaults again, and Postgres refuses to change a function's return type or reorder a view's columns in place.

- A recreated view must also restate `with (security_invoker = true)`; it inherits nothing from the view it replaced.
- Check `pg_depend` for dependents before a drop, and never answer a dependency error with `CASCADE`, which silently drops every dependent view and its readers.
- After a `CREATE OR REPLACE`, assert the preserved ACL in the verification block rather than re-granting it. A re-grant would hide a reset you did not expect.

**Revoke and grant an overloaded function by exact signature, name every overload, and drop the overloads nothing calls.**
Why: `REVOKE` resolves one signature, and PostgREST dispatches overloads by the argument names a caller sends, so an untouched overload stays callable.

```sql
select p.oid::regprocedure, p.proacl::text
from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.proname = 'submit_order';
```

**`anon` never writes: never grant it `INSERT`, `UPDATE` or `DELETE` on any `public` table, and grant it `SELECT` only on data that is read before login.**
Why: `anon` is the key every visitor holds, so a write grant to it is an unauthenticated write endpoint held shut only by whatever the policies say today.
