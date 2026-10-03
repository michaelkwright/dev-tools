// Not copied into a project. In this checkout it stands where the project's own
// ratchet-core.ts sits after install, so the guard's `../ratchet-core.ts`
// import resolves to the one core in the dev-tools ratchet-tests skill instead
// of a fork. In a project, copy that skill's reference/ratchet-core.ts here.
export * from "../../ratchet-tests/reference/ratchet-core.ts";
