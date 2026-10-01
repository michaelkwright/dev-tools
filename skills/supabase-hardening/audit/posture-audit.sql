-- posture-audit.sql: a read-only audit of a Supabase project's grants and RLS posture.
--
-- One SELECT statement. It returns one row per finding, with the columns
-- rule_id, severity (high, medium, low, info), object_type, object, detail and
-- fix_hint, ordered by severity and then object. No rows above info means
-- no finding, not that the project is safe.
--
-- WHAT IT CHECKS, in the schemas listed in exposed_schemas below. Objects owned
-- by an extension and the system schemas are skipped. PUBLIC, anon and
-- authenticated are the client roles.
--   T1  high/low   a table with RLS disabled. High when a client role holds any
--                  privilege on it, low when none does.                  [born-open-defaults]
--   T2  high       anon or PUBLIC holds table-level INSERT, UPDATE or DELETE on
--                  a table or view. anon never writes.                   [born-open-defaults]
--   T3  medium     any client role holds TRUNCATE, REFERENCES, TRIGGER or
--                  MAINTAIN on a table or view, the mark of a default grant
--                  that was never revoked. The Data API issues none of them,
--                  but TRUNCATE ignores RLS. A table can fire both T2 and T3.
--                  Revoke first, then grant the subset.                  [born-open-defaults]
--   T4  medium     RLS enabled with no policy at all while a client role holds
--                  a privilege, which is protection by absence.          [gates-that-lie]
--   C1  high       anon or PUBLIC holds a column-level INSERT or UPDATE. [gates-that-lie]
--   V1  high/med   a view without security_invoker = true. High when a client
--                  role can SELECT it.                                   [gates-that-lie]
--   F1  high/low   a function that PUBLIC or anon can EXECUTE. High when it is
--                  SECURITY DEFINER, whose only gate is EXECUTE.  [born-open-defaults, gates-that-lie]
--   F2  medium     a SECURITY DEFINER function whose proconfig lacks the exact
--                  hardened entry search_path="".                 [gates-that-lie, verification]
--   D1  info       a default-privilege entry that grants new objects to anon
--                  or authenticated, so the born-open trap is live here. [born-open-defaults]
--   EXCEPTION      info for each active exception, low for one ignored because
--                  it has no reason.
-- The bracketed names are files in the supabase-hardening skill's reference/ folder.
--
-- WHAT IT DOES NOT CHECK. It reads grants and RLS posture, not policy logic:
-- whether a policy's expression is right, what a function body does, Edge
-- Functions, Storage policies, or schemas left out of exposed_schemas. A
-- clean result is not proof of safety. Prove behavior with rolled-back probes
-- as the app roles (reference/verification.md).
--
-- HOW TO RUN IT. Run the whole file as is. It is a single statement, so a tool
-- that shows only the last result set still shows the audit.
--   psql:              psql "$DATABASE_URL" -f posture-audit.sql
--   An MCP read-only connector, or the dashboard SQL editor: paste the whole file.
--   The test harness:  npx vitest run skills/supabase-hardening/audit/test
-- Any read-only role works. The audit reads pg_catalog only, calls built-in
-- catalog functions only and executes no project function. The file holds no
-- semicolon except the final one, so a client that splits text on semicolons
-- still sends a single statement.
--
-- CONFIGURE the two lists directly below. exposed_schemas holds the schemas the
-- Data API serves (default: public). exceptions holds accepted findings.

with
exposed_schemas (nspname) as (
  values
    ('public')
),

-- An exception is (rule_id, object, reason). Copy object exactly from the
-- finding's object column. A matching finding is suppressed, and an info row
-- shows each active exception, so nothing is hidden silently. The reason is
-- required: a row without one is ignored, its finding stays, and a low row
-- reports it. To add an exception, write a new line like the commented one
-- below and remove its leading dashes.
exceptions (rule_id, object, reason) as (
  values
    (null::text, null::text, null::text)  -- placeholder row, keep it
    -- , ('V1', 'public.order_summaries', 'one line on why this is safe, and who reviewed it')
),

client_roles (oid, rolname) as (
  select 0::oid, 'PUBLIC'::text
  union all
  select r.oid, r.rolname::text
  from pg_roles r
  where r.rolname in ('anon', 'authenticated')
),

schemas as (
  select n.oid, n.nspname
  from pg_namespace n
  join exposed_schemas e on e.nspname = n.nspname::text
  where n.nspname::text <> 'information_schema'
    and n.nspname::text !~ '^pg_'  -- every system schema, and no user schema may start with pg_
),

-- A NULL acl means the built-in defaults apply, and aclexplode(NULL) returns no
-- rows, so every ACL is expanded through acldefault first.
rels as (
  select c.oid, c.relkind, c.relrowsecurity, c.reloptions, c.relowner,
         format('%I.%I', s.nspname, c.relname) as object,
         case c.relkind
           when 'v' then 'view'
           when 'm' then 'materialized view'
           when 'f' then 'foreign table'
           else 'table'
         end as object_type,
         coalesce(c.relacl, acldefault('r', c.relowner)) as acl
  from pg_class c
  join schemas s on s.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'f')
    and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
),

rel_grants as (
  select r.oid, cr.rolname as grantee, a.privilege_type
  from rels r
  cross join lateral aclexplode(r.acl) a
  join client_roles cr on cr.oid = a.grantee
),

col_grants as (
  select r.oid, att.attname::text as column_name, cr.rolname as grantee, a.privilege_type
  from rels r
  join pg_attribute att on att.attrelid = r.oid and att.attnum > 0 and not att.attisdropped
  cross join lateral aclexplode(coalesce(att.attacl, acldefault('c', r.relowner))) a
  join client_roles cr on cr.oid = a.grantee
),

rel_access as (
  select g.oid,
         string_agg(g.grantee || ' ' || g.privs, ', ' order by g.grantee collate "C", g.privs collate "C") as summary,
         bool_or(g.can_select) as can_select
  from (
    select oid, grantee,
           string_agg(privilege_type, ' ' order by privilege_type collate "C") as privs,
           bool_or(privilege_type = 'SELECT') as can_select
    from rel_grants
    group by oid, grantee
    union all
    select oid, grantee,
           string_agg(privilege_type || '(' || column_name || ')', ' ' order by column_name collate "C", privilege_type collate "C"),
           bool_or(privilege_type = 'SELECT')
    from col_grants
    group by oid, grantee
  ) g
  group by g.oid
),

funcs as (
  select p.oid, p.prosecdef, p.proconfig,
         format('%I.%I(%s)', s.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as object,
         case p.prokind when 'p' then 'procedure' else 'function' end as object_type,
         coalesce(p.proacl, acldefault('f', p.proowner)) as acl
  from pg_proc p
  join schemas s on s.oid = p.pronamespace
  where p.prokind in ('f', 'p')
    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
),

func_grants as (
  select f.oid, cr.rolname as grantee, a.privilege_type
  from funcs f
  cross join lateral aclexplode(f.acl) a
  join client_roles cr on cr.oid = a.grantee
),

findings (rule_id, severity, object_type, object, detail, fix_hint) as (
  -- T1: RLS disabled on a table.
  select 'T1'::text,
         case when ra.oid is null then 'low' else 'high' end,
         r.object_type, r.object,
         'RLS is disabled. ' || coalesce('Client grants: ' || ra.summary, 'No client role holds a privilege.'),
         format('alter table %s enable row level security, add owner-scoped policies, and revoke all from public, anon, authenticated before the intended grant (templates/new-table.sql.tmpl)', r.object)
  from rels r
  left join rel_access ra on ra.oid = r.oid
  where r.relkind in ('r', 'p') and not r.relrowsecurity

  union all
  -- T2: anon or PUBLIC can write rows through a table-level grant.
  select 'T2', 'high', r.object_type, r.object,
         'anon or PUBLIC can write: ' || string_agg(g.grantee || ' ' || g.privilege_type, ', ' order by g.grantee collate "C", g.privilege_type collate "C"),
         format('revoke all on table %s from public, anon, then grant anon select only on data read before login', r.object)
  from rels r
  join rel_grants g on g.oid = r.oid
  where g.grantee in ('PUBLIC', 'anon') and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  group by r.oid, r.object_type, r.object

  union all
  -- T3: a client role still holds the never-intended part of the default grant.
  select 'T3', 'medium', r.object_type, r.object,
         'Client roles hold ' || string_agg(g.grantee || ' ' || g.privilege_type, ', ' order by g.grantee collate "C", g.privilege_type collate "C")
           || ', the mark of a default grant that was never revoked. These are not reachable through the Data API today, but TRUNCATE ignores RLS if any SQL path ever reaches it',
         format('revoke all on table %s from public, anon, authenticated, then grant the intended subset. Not reachable through the Data API today, but TRUNCATE ignores RLS if any SQL path ever reaches it', r.object)
  from rels r
  join rel_grants g on g.oid = r.oid
  where g.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
  group by r.oid, r.object_type, r.object

  union all
  -- T4: RLS on, no policy, and a client grant: protection by absence.
  select 'T4', 'medium', r.object_type, r.object,
         'RLS is enabled with no policy, so only the absence of a policy refuses: ' || ra.summary,
         format('revoke from the client roles every privilege on %s they should not use. The grant, not the missing policy, must refuse them', r.object)
  from rels r
  join rel_access ra on ra.oid = r.oid
  where r.relkind in ('r', 'p') and r.relrowsecurity
    and not exists (select 1 from pg_policy pol where pol.polrelid = r.oid)

  union all
  -- C1: anon or PUBLIC can write a column.
  select 'C1', 'high', 'column', format('%s.%I', r.object, g.column_name),
         'anon or PUBLIC holds a column grant: ' || string_agg(g.grantee || ' ' || g.privilege_type, ', ' order by g.grantee collate "C", g.privilege_type collate "C"),
         format('revoke insert, update (%I) on table %s from public, anon', g.column_name, r.object)
  from rels r
  join col_grants g on g.oid = r.oid
  where g.grantee in ('PUBLIC', 'anon') and g.privilege_type in ('INSERT', 'UPDATE')
  group by r.oid, r.object, g.column_name

  union all
  -- V1: a view that runs as its owner, who bypasses RLS.
  select 'V1',
         case when coalesce(ra.can_select, false) then 'high' else 'medium' end,
         r.object_type, r.object,
         'The view runs as its owner, who bypasses RLS (reloptions ' || coalesce(r.reloptions::text, 'none') || '). '
           || coalesce('Client grants: ' || ra.summary, 'No client role holds a privilege.'),
         format('alter view %s set (security_invoker = true), and revoke all from public, anon, authenticated before the intended grant (templates/new-view.sql.tmpl)', r.object)
  from rels r
  left join rel_access ra on ra.oid = r.oid
  where r.relkind = 'v'
    and not exists (
      select 1 from unnest(r.reloptions) o(opt)
      where lower(opt) in ('security_invoker=true', 'security_invoker=on', 'security_invoker=yes', 'security_invoker=1',
                           'security_invoker=t', 'security_invoker=tr', 'security_invoker=tru',
                           'security_invoker=y', 'security_invoker=ye'))

  union all
  -- F1: PUBLIC or anon can execute a function.
  select 'F1',
         case when f.prosecdef then 'high' else 'low' end,
         f.object_type, f.object,
         'EXECUTE held by ' || string_agg(g.grantee, ', ' order by g.grantee collate "C")
           || case when f.prosecdef then '. SECURITY DEFINER bypasses RLS, so EXECUTE is its only gate' else '' end,
         format('revoke all on %s %s from public, anon, authenticated, then grant execute to the intended roles', f.object_type, f.object)
  from funcs f
  join func_grants g on g.oid = f.oid
  where g.grantee in ('PUBLIC', 'anon') and g.privilege_type = 'EXECUTE'
  group by f.oid, f.prosecdef, f.object_type, f.object

  union all
  -- F2: SECURITY DEFINER without the exact hardened search_path entry.
  select 'F2', 'medium', f.object_type, f.object,
         'SECURITY DEFINER without search_path="" (proconfig ' || coalesce(f.proconfig::text, 'NULL') || ')',
         'Set search_path = '''' and schema-qualify every reference the next time this function is edited for another reason, proven by a break probe. Never do it as a pass of its own'
  from funcs f
  where f.prosecdef
    and not exists (
      select 1 from unnest(f.proconfig) c(setting)
      where c.setting is not distinct from 'search_path=""')

  union all
  -- D1: default privileges that grant new objects to a client role.
  select 'D1', 'info', 'default privileges',
         format('%s %s created by %s',
                coalesce(s.nspname::text, 'every schema'),
                case d.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences' when 'f' then 'functions'
                                     when 'T' then 'types' when 'n' then 'schemas' else d.defaclobjtype::text end,
                d.defaclrole::regrole::text),
         'New objects are born granted: ' || string_agg(cr.rolname || ' ' || a.privilege_type, ', ' order by cr.rolname collate "C", a.privilege_type collate "C"),
         'Revoke first in every CREATE migration, then grant the intended subset and verify the raw ACL (templates/)'
  from pg_default_acl d
  left join schemas s on s.oid = d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) a
  join client_roles cr on cr.oid = a.grantee
  where (d.defaclnamespace = 0 or s.oid is not null)
    and cr.rolname in ('anon', 'authenticated')
  group by d.oid, s.nspname, d.defaclobjtype, d.defaclrole
),

active_exceptions as (
  select e.rule_id, e.object, e.reason
  from exceptions e
  where e.rule_id is not null and nullif(btrim(e.reason), '') is not null
),

reported as (
  select f.rule_id, f.severity, f.object_type, f.object, f.detail, f.fix_hint
  from findings f
  where not exists (
    select 1 from active_exceptions x
    where x.rule_id = f.rule_id and x.object = f.object)

  union all
  select 'EXCEPTION', 'info', 'exception', x.object,
         format('%s suppressed (%s matching finding%s). Reason: %s',
                x.rule_id, m.n, case when m.n = 1 then '' else 's' end, x.reason),
         case when m.n = 0 then 'Matches no current finding. Delete it if it is stale'
              else 'Re-check the reason whenever this object changes' end
  from active_exceptions x
  cross join lateral (
    select count(*) as n from findings f
    where f.rule_id = x.rule_id and f.object = x.object) m

  union all
  select 'EXCEPTION', 'low', 'exception', coalesce(e.object, ''),
         format('Ignored: the %s exception has no reason, and a reason is required', e.rule_id),
         'Add a one-line reason, or delete the row'
  from exceptions e
  where e.rule_id is not null and nullif(btrim(e.reason), '') is null
)

select rule_id, severity, object_type, object, detail, fix_hint
from reported
order by case severity when 'high' then 0 when 'medium' then 1 when 'low' then 2 else 3 end,
         object collate "C",
         rule_id collate "C";
