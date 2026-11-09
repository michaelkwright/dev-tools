// The two script templates, filled as the bootstrap fills them and written to
// scripts/ in a directory the caller owns.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const tmpl = (name: string) => readFileSync(fileURLToPath(new URL(`../../templates/${name}`, import.meta.url)), "utf8");

export const filled = (name: string) => tmpl(name).replaceAll("{{DEV_TOOLS_SHA}}", "abc1234");

export function writeScripts(dir: string) {
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, "scripts/functions-deploy.mjs"), filled("functions-deploy.mjs.tmpl"));
  writeFileSync(join(dir, "scripts/functions-readback.mjs"), filled("functions-readback.mjs.tmpl"));
}
