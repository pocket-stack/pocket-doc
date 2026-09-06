import { existsSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
const root = resolve(import.meta.dir, "..");
for (const [name, target] of Object.entries({ "@pocketjs/framework": "runtime", "solid-js": "runtime/node_modules/solid-js", "@types": "runtime/node_modules/@types", "bun-types": "runtime/node_modules/bun-types" })) {
  const source = resolve(root, target), destination = resolve(root, "node_modules", name);
  if (!existsSync(source)) throw new Error(`Missing ${target}; initialize the submodule and install runtime dependencies`);
  mkdirSync(dirname(destination), { recursive: true }); rmSync(destination, { recursive: true, force: true });
  symlinkSync(relative(dirname(destination), source), destination, "dir");
}
