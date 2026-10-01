# Gates that lie

Each entry is a protection that looks closed and is not, or a gap that looks open and is not. Read the one that matches before trusting a policy, a view or a function guard.

---

**RLS decides which rows a role may touch, never which columns. To restrict columns, revoke `INSERT` and `UPDATE` at the table level and grant them back per column, on an allowlist built from every column the client actually writes.**
Why: once a policy admits a caller to their own row, every column on it is writable, including a server-owned `status` or `paid_at` the app never exposes, so a caller could mark their own order paid.

```sql
revoke insert, update on table public.orders from anon, authenticated;
grant insert (user_id, title, note) on table public.orders to authenticated;
grant update (title, note) on table public.orders to authenticated;
```

- The allowlist is default-deny: a column added later is born server-only until a migration grants it. That fails loudly when a grant is forgotten, while a default-allow list fails silently when a revoke is forgotten.
- `service_role` and every `SECURITY DEFINER` function bypass column grants exactly as they bypass RLS, so server write paths are unaffected.

**One ungranted column rejects the whole statement with `42501`, so grant a client-written column in the same migration that adds it, before any client write names it.**
Why: grants are checked per statement, so adding one ungranted column to an existing multi-column write takes down every column in that payload, not just the new one.

**A missing `WITH CHECK` on an `UPDATE` policy is not the hole it looks like; Postgres reuses the `USING` expression as the check.**
Why: adding the clause restates what is already enforced, and the gap people mean by it, which columns may change, is closed only by column grants.

**RLS enabled with no policy for an operation is protection by absence; the grant is the layer that enforces "this role may not do this".**
Why: absence holds only until someone adds a policy, so a table with no `INSERT` policy and an `INSERT` grant to `anon` is one policy away from an open write endpoint.

**An `INSERT` or `UPDATE` policy checks only the columns its expression names; a foreign key proves the parent row exists, not who owns it.**
Why: with `WITH CHECK (auth.uid() = user_id)`, a caller can create an item row whose `order_id` points at another user's order, and only an explicit ownership check catches it.

**A view runs as its owner, who bypasses RLS. Create every view `with (security_invoker = true)` and revoke it from the client roles before the intended grant; each closes a different hole.**
Why: the revoke refuses the client roles outright, and invoker rights make a later stray grant still apply the caller's RLS. Either alone leaves a path: the owner of a dashboard paste is `postgres`, which reads straight past every policy.

**Inside a `SECURITY DEFINER` function, a `security_invoker` view runs as the definer, so the function's own guard is the real gate.**
Why: the view's invoker rights apply to whoever calls the view, and inside a definer function that is the function's owner, so the view's RLS does nothing on that path. Do not flip the view to owner mode on sight of this; confirm the function guards itself.

**A `SECURITY DEFINER` function that takes a caller-supplied user id is gated by `EXECUTE` alone. Grant it to `service_role` only, or derive the user from `auth.uid()` inside the body and never from a parameter.**
Why: the definer bypasses RLS, so whoever can execute it can act on any user's rows; a rate-limit function granted to `anon` lets anyone drain another user's quota with the public key.

**`auth.uid() IS NULL` also describes `anon`. A trusted caller is one with no `request.jwt.claims` at all (pg_cron, dashboard SQL) or claims whose `role` is `service_role`; refuse everything else that is not the row's owner.**
Why: `anon` carries a real JWT with no `sub`, so a guard that reads "no user id" as "trusted job" hands the public key the job's bypass.

```sql
v_claims := current_setting('request.jwt.claims', true);
if v_claims is null or v_claims = ''          -- no request at all: a scheduled or dashboard caller
   or (v_claims::jsonb ->> 'role') = 'service_role' then
  null;                                        -- trusted
elsif auth.uid() is distinct from v_owner then
  return;                                      -- anon and other users: a silent no-op
end if;
```

**Postgres does not check `EXECUTE` on a trigger function when the trigger fires, so revoking it from `PUBLIC`, `anon` and `authenticated` is safe.**
Why: only the triggering statement's own table privileges and RLS gate it, so ordinary writes keep firing the trigger, and a client loses only the ability to call the function directly.

**Set `search_path = ''` and schema-qualify every reference whenever a function is already being edited for another reason; never schedule it as a pass of its own.**
Why: a missed qualification raises `42P01` at run time, not at `CREATE`, so each conversion needs a rolled-back break probe (the unqualified body must raise), and a function touched twice pays that risk twice.

- On a trigger, the run-time failure breaks every write to its table; on a rate-limit function it fails closed and silently caps every caller.
- `ALTER FUNCTION … SET search_path = ''` changes only `proconfig`, leaving the body and the ACL untouched, which suits a function whose references are already qualified.
