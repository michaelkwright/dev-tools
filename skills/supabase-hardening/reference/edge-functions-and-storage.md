# Edge Functions and Storage

Credentials, rate-limit RPCs and Storage policies. The rate-limit function itself is worked in `templates/new-function.sql.tmpl`.

---

## Credentials

**Compare an operator secret fail-closed: `if (!expected || !presented || !secretsMatch(presented, expected))` refuses, and the comparison runs in constant time.**
Why: the self-disabling shape, `if (expected && presented !== expected)`, admits every caller the moment the environment variable is unset or empty.

```ts
const expected = Deno.env.get("ORDERS_OPERATOR_SECRET");
const presented = req.headers.get("x-operator-secret");
if (!expected || !presented || !(await secretsMatch(presented, expected))) {
  return new Response(null, { status: 403 });
}
// secretsMatch: hash both sides with SHA-256 and compare the full digests, so timing reveals nothing.
```

**Send an operator secret in a header, never in the request body.**
Why: intermediate tooling is likelier to log a body than a header, and one convention per credential keeps every caller on the same path.

**Give an operator-only action its own credential; a service-role key sent as a bearer fails `auth.getUser()`.**
Why: `getUser()` expects a user session, so the service key is refused on every user-gated path and cannot double as an operator check.

**If an action also demands a service-role bearer, prove it by capability (one admin-only read with the presented bearer, admitted only on a 2xx, refused on any error or timeout), never by byte comparison against the function's injected key.**
Why: the key injected into an Edge Function is not byte-equal to the project's own service-role key, so a byte comparison refuses the legitimate caller while every refusal test still passes.

**Read the deployed function's `verify_jwt` setting before relying on the gateway; when it is off, the in-function gate is the only check.**
Why: a cron-invoked function needs it off to reach its own secret check, and then nothing in front of the handler verifies anything.

**A query moved onto a service-role client loses RLS scoping, including on embedded resources; put an explicit ownership filter on the top-level table and on every embed.**
Why: an embed such as `order_items(...)` was scoped by RLS with no line of code, so the same query text on a service-role client returns every user's rows.

## Rate-limit RPCs

**Shape a rate-limit RPC as one `SECURITY DEFINER` function that locks the caller's counter row (`SELECT … FOR UPDATE`), resets it on a new day, compares, and increments in the same transaction; grant `EXECUTE` to `service_role` only.**
Why: an unlocked read lets two concurrent calls both see the same count and both be admitted, and the caller-supplied user id means `EXECUTE` is the only thing stopping one user from draining another's quota.

**Bucket every rate limit on the server's clock; no request field informs the limit, so the RPC takes no date parameter and derives the day itself.**
Why: a counter resets whenever the date it is handed changes, so a caller-supplied date lets any caller reset every limit by sending a different day on each request. A caller's local date is fine for generated text, never for a limit.

```sql
v_today date := (now() at time zone 'utc')::date;   -- inside the function; never a parameter
```

**Fail closed: an RPC error, no row, or a result without a boolean `allowed` is a fault, and a fault blocks.**
Why: client libraries return database errors rather than throw them, so a guard written `if (result?.allowed === false)` reads a failed call as permission and switches the limit off exactly when the limiter is broken.

```ts
type Verdict = "allow" | "limit" | "fault";
function classify(data: unknown, error: unknown): Verdict {
  const allowed = (data as { allowed?: unknown } | null)?.allowed;
  if (error || typeof allowed !== "boolean") return "fault";
  return allowed ? "allow" : "limit";
}
```

**A limit and a fault return the same status and body to the caller and are never a 500; report the fault, never the limit, and give a fault no retry time.**
Why: a distinguishable fault lets a caller probe for a broken limiter, reporting ordinary over-limits buries real faults, and a retry time quoted for a window that was never taken tells a working user to wait for nothing.

**Run the limit before any paid egress.**
Why: a refused call that has already sent its request has already spent the money; checked first, a blocked call makes no outbound request at all.

## Storage

**Scope every `storage.objects` policy to the bucket and to the first path segment equalling the caller: `bucket_id = 'order-attachments' and (storage.foldername(name))[1] = auth.uid()::text`.**
Why: the first segment is the only ownership a path carries, so every object path starts with the owner's id and the server, not the client, builds it.

**Bucket MIME and size limits restrict the kind of file, not what it shows. When content must be vetted, the server owns the write and the client `INSERT` policies are dropped.**
Why: with a client `INSERT` policy, any session can upload straight to the bucket and skip a client-side check, and a policy cannot call the vetting service.

- Prove the drop with a rolled-back `INSERT` as `authenticated` into each bucket failing `42501`, alongside an owner-scoped `SELECT` that still returns rows.

**With no `UPDATE` policy on a bucket, a client cannot upsert onto an existing path.**
Why: overwriting an object needs `UPDATE`, so a client upsert that worked for new paths fails on the first repeat.

**Storage objects do not cascade with the rows that reference them; delete them explicitly, including the whole of a user's folder when the account is deleted.**
Why: a database cascade removes the rows and leaves every object behind, which is both a cost and a data-deletion failure.
