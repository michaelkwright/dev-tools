# The environment split

Default for new projects: run everything under `node`, and use jsdom only where a file needs a DOM. Costs a config block, a guarded setup file and one guard test, and every node-eligible test added later takes the fast path with no list to maintain.

## Design

- `node` is the default environment. `.tsx` tests run under jsdom by include pattern. A DOM-using `.ts` test opts in with the vitest environment docblock, set to jsdom, on line 1.
- Use `projects`. `environmentMatchGlobs` is marked deprecated in vitest 3.x (and logs a deprecation at runtime).

```ts
// vitest.config.ts (shape only)
test: {
  environment: "node",
  setupFiles: ["./src/test/setup.ts"],
  projects: [
    { extends: true, test: { name: "node",  environment: "node",  include: ["src/**/*.{test,spec}.ts"] } },
    { extends: true, test: { name: "jsdom", environment: "jsdom", include: ["src/**/*.{test,spec}.tsx"] } },
  ],
}
```

## Traps found

- **`extends: true` concatenates arrays.** A root-level `include` is appended to each project's own, so every file is in both projects and runs twice, once per environment (the jsdom copy can even crash importing the config). Keep `include` only in the projects, and pin its absence with a test on the config's shape.
- **A docblock changes a file's environment, not its `setupFiles`.** A docblocked `.ts` file stays in the node project but runs under jsdom, and the shared setup file runs for everyone. So setup must follow the ENVIRONMENT the file resolved to, not the project: put all DOM setup inside `if (typeof window !== "undefined")` (Node defines `navigator` but not `window`, so `window` is the discriminator). Import jest-dom dynamically only there: `await import("@testing-library/jest-dom")`. Its types file is a global augmentation, not a module, so the dynamic import needs one narrow `@ts-expect-error` (TS2306); no triple-slash type reference is needed, since the `import()` still pulls the types into the program (typecheck stayed green without one).
- **Vitest scans the WHOLE file text for the environment directive** (its regex is `@(?:vitest|jest)-environment\s+([\w-]+)\b`, matched anywhere, not only in a leading comment). So a guard test that quotes the docblock as one literal switches its own environment. Build the string from two pieces (`"// @" + "vitest-environment jsdom"`), and never spell the directive in a comment. Line 1 is your convention, enforced by the guard, not vitest's requirement.
- **A missing docblock is loud, except in one case.** A DOM-using `.ts` test that loses its docblock fails immediately under node (`window is not defined`). The silent case is a node test importing a module that BRANCHES on the environment: it passes by taking the other branch and has stopped testing the path it was written for. That is what the guard test below is for.

## The ratchet (guard test)

1. Find non-test modules with environment-sensing branches: `typeof window`, `typeof document`, `typeof navigator`, `typeof localStorage`, `"window" in globalThis`, `globalThis.window`. Exclude the setup file(s), read from the config.
2. For every test that resolves to node, resolve its runtime imports (relative paths plus the alias map read from the config, not hard-coded) and fail if it directly imports a sensing module. Name the test, the specifier, the module, the branch line and the docblock fix in the failure message.
3. Detection must include dynamic `import()`, plus `require`, `export ... from` and `vi.importActual`, and skip type-only imports and `vi.mock` factories (a factory replaces the module). A static-only grep missed a real case. Use the TypeScript AST, not a regex.
4. Enforce one docblock convention: jsdom only, alone on line 1, `.ts` files only.
5. Add non-vacuity floors so it cannot pass by silently seeing nothing: the sensing set contains a known module, the node set is non-empty and contains the guard itself, and at least one docblocked test is seen importing a sensing module.
6. Say in its header that it checks DIRECT imports only, not the transitive graph. Execution is the backstop.
7. Pin its copy of vitest's directive regex against the installed vitest source, so an upgrade that changes how vitest reads the directive fails here.

## Classify by execution, not grep alone

Run the candidate files under both environments and diff per-file counts. A grep for DOM markers is only a first pass: one file used `FileReader`/`Blob` (through a helper) and failed 15 of 22 assertions under node, matching none of the six markers. Then re-check the timezone-sensitive files under both timezones if any are moved.

## Worked example results

Full suite (`TZ=America/New_York`, one run each, same conditions): Duration 375.64 s before, 286.39 s after. The `environment` phase fell 170.26 s (315.94 s to 145.68 s) and `setup` fell 26.98 s; divided by the pre-run's own parallelism (2.738) that is about 72 s of wall-clock. The measured Duration delta was 89 s against a pre-change projection of about 58.5 s; with 50 to 60 s of run-to-run noise, wall-clock alone cannot pin the saving, and the phase figures carry the conclusion. Final files: 133 resolve to node, 83 `.tsx` run jsdom by pattern, 72 `.ts` files carry the docblock (288 total). One file the direct-import audit's grep missed (a dynamic `import()`) was caught by the guard on its first run and took the docblock. Per-file counts were identical before and after across 287 files.

The saving grows with the suite: of the 38 test files added after the Sep 21 baseline, 23 of the 36 still live (about 64%) were node-eligible on first classification.
