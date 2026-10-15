import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.join(import.meta.dirname, "..");

/** Every `router.<method>("<path>"` / `app.<method>("<path>"` in the server source. */
function routesInSource(): string[] {
  const files = [
    ...fs.readdirSync(path.join(root, "src/routes")).map((f) => path.join(root, "src/routes", f)),
    path.join(root, "src/auth.ts"),
    path.join(root, "src/app.ts"),
  ];
  const found = new Set<string>();
  for (const f of files) {
    for (const m of fs.readFileSync(f, "utf8").matchAll(/\b\w+\.(get|post|put|patch|delete)\("(\/[^"]+)"/g)) {
      found.add(`${m[1].toUpperCase()} ${m[2]}`);
    }
  }
  return [...found].sort();
}

/** Every `### \`METHOD /path\`` heading in docs/api.md. */
function routesInDocs(): string[] {
  const md = fs.readFileSync(path.join(root, "docs/api.md"), "utf8");
  return [...md.matchAll(/^### `(GET|POST|PUT|PATCH|DELETE) (\/\S+)`/gm)].map((m) => `${m[1]} ${m[2]}`).sort();
}

describe("docs/api.md", () => {
  it("documents every HTTP route, and nothing that doesn't exist", () => {
    const src = routesInSource();
    const docs = routesInDocs();
    assert.ok(src.length > 30, `found only ${src.length} routes — is the scan broken?`);
    assert.deepEqual(docs.filter((r) => !src.includes(r)), [], "documented but not implemented");
    assert.deepEqual(src.filter((r) => !docs.includes(r)), [], "implemented but not documented");
  });
});
