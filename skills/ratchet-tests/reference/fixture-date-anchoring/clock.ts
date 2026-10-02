// Fixture dates anchored to the run's own clock.
// Seeded from dev-tools @ {{DEV_TOOLS_SHA}}; this file is now the project's own.
//
// Anchor a fixture date with daysAgo(n) / dateDaysAgo(n), never a literal date
// that a cutoff computed from now is compared against.
// Why: a literal date ages out of its window months later and fails on a
// commit that never touched it; `shipped_at: daysAgo(45)` states what the
// fixture means ("well past a 30-day window") on every day the suite runs.
//
// Keep the offset literal at every call site: daysAgo(45), never
// daysAgo(RETURN_WINDOW_DAYS + 15).
// Why: an offset derived from the constant under test moves with a bad change
// to that constant and lets it pass; a literal offset keeps the test an
// independent check on the constant rather than a restatement of it.
//
// When a test injects a pinned clock into the code under test (a `now` option
// set to a fixed instant), anchor both ends or neither: derive the injected
// `now` from Date.now() as well (const T0 = Date.now()), or keep both literal.
// Why: fixtures anchored to the real clock march forward while the injected
// cutoff stays put, which builds a new expiry date into the fix for the old one.
//
// Freezing the system clock (vi.setSystemTime / useFakeTimers) is the right
// tool when the subject IS a calendar day (a timezone boundary, a month-end
// window), and the walker derives CLOCK_PINNED for such a file. It is the wrong
// tool for anything that also measures elapsed wall-clock time.
// Why: a frozen clock never advances, so a timeout check can start passing
// because its deadline can no longer arrive.

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * An ISO timestamp `n` days before now, for timestamp fields (`*_at`).
 * Fractional and negative values are allowed: daysAgo(-1) is tomorrow.
 */
export function daysAgo(n: number): string {
  return new Date(Date.now() - n * DAY_MS).toISOString();
}

/**
 * `YYYY-MM-DD`, `n` days before now, for plain date fields (`*_date`, `*_on`).
 * Sliced from the UTC ISO string, so it agrees with a server-side cutoff built
 * the same way under any ambient TZ.
 */
export function dateDaysAgo(n: number): string {
  return daysAgo(n).slice(0, 10);
}
