import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

// Resolved against this file, not the cwd, so the suite passes when run from
// inside test/ as well as from the repo root.
const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"))
const ENDPOINT_PATH = "/api/mcp"
const EU_HOST = "mcp-eu.qlane.ai"
const SERVER_NAME = "qlane"

test("portable and Claude Code manifests name the same server", () => {
  // deepEqual against the literal key list also rules out an EMPTY mcpServers object,
  // which is schema-valid and installs nothing. A separate length check would add no
  // coverage — any key list that fails one fails the other.
  assert.deepEqual(Object.keys(read("mcp.json").mcpServers), [SERVER_NAME])
  assert.deepEqual(Object.keys(read(".mcp.json").mcpServers), [SERVER_NAME])
})

test("portable mcp.json uses the SPEC transport value, not Claude Code's", () => {
  // Claude Code silently drops "streamable-http"; the spec rejects "http".
  assert.equal(read("mcp.json").mcpServers[SERVER_NAME].type, "streamable-http")
})

test("Claude Code .mcp.json uses http and substitutes the region host", () => {
  const entry = read(".mcp.json").mcpServers[SERVER_NAME]
  // An entry with `url` and no `type` is read as a stdio server and skipped.
  assert.equal(entry.type, "http")
  assert.equal(entry.url, `https://\${user_config.region_host}${ENDPOINT_PATH}`)
})

test("region_host is required and has NO default", () => {
  const opt = read(".claude-plugin/plugin.json").userConfig.region_host
  assert.equal(opt.required, true)
  // A default is silently used at connect time; `required` does not gate it,
  // so a default would give every US customer an EU URL and a 403.
  assert.ok(!("default" in opt), "region_host must not declare a default")
})

test("the portable manifest is pinned to EU and carries the full endpoint path", () => {
  assert.equal(read("mcp.json").mcpServers[SERVER_NAME].url, `https://${EU_HOST}${ENDPOINT_PATH}`)
})

test("both manifests declare the same plugin name and version", () => {
  assert.equal(read("plugin.json").name, read(".claude-plugin/plugin.json").name)
  // Pin ONE side to the literal. Comparing the two sides alone is vacuous on mutual
  // absence: deleting `version` from both files compares undefined === undefined and
  // passes, and nothing backstops it — the Agent Plugins schema requires only
  // ["$schema", "name"], and .claude-plugin/plugin.json is validated by nothing.
  // The name half needs no such pin: a test below anchors plugin.json's name to the
  // literal, which transitively pins the other side through this agreement line.
  assert.equal(read("plugin.json").version, "0.1.0")
  assert.equal(read("plugin.json").version, read(".claude-plugin/plugin.json").version)
})

// The two below close gaps the JSON Schemas structurally cannot: the upstream
// schemas permit ANY server key, ANY url, an EMPTY mcpServers object, and any
// repository string. `npm run validate` passing therefore does NOT mean our
// constraints hold — these assertions are the only thing that does.
test("the plugin is named exactly `qlane`", () => {
  // Must match MCP_SERVER_NAME in the monorepo, or a dashboard install and a
  // marketplace install produce two servers instead of one.
  assert.equal(read("plugin.json").name, SERVER_NAME)
})

test("the repository points at the org that exists", () => {
  // `qlane-ai` is a real GitHub App slug but NOT a GitHub org — it 404s.
  for (const f of ["plugin.json", ".claude-plugin/plugin.json"]) {
    assert.equal(read(f).repository, "https://github.com/qlaneai/agent-plugin")
  }
})

// Shared so a missing entry fails by name in EVERY test that needs one, rather
// than throwing a TypeError on property access in whichever test forgot the guard.
const marketplaceEntry = () => {
  const entry = read(".claude-plugin/marketplace.json").plugins.find((p) => p.name === SERVER_NAME)
  assert.ok(entry, `marketplace must list a plugin named ${SERVER_NAME}`)
  return entry
}

test("the marketplace entry declares no version, deferring to plugin.json", () => {
  const entry = marketplaceEntry()
  // No `version` here on purpose. At install time plugin.json WINS and the entry's
  // value is silently ignored (Claude Code's `calculatePluginVersion` precedence),
  // so a version here can only ever be right or silently wrong — it can never be
  // load-bearing. Omitting it deletes that drift class instead of policing it, and
  // removes a fourth copy of the version literal from the repo. 95% of the 286
  // entries in Anthropic's own marketplace omit it, as does Vanta's plugin.
  //
  // `claude plugin validate --strict .` is what enforces this from the tool side —
  // it is NOT wired into `npm run check`, because the claude CLI is not installed on
  // the CI runner and `check` must stay runnable offline. This assertion is the part
  // that runs everywhere.
  assert.ok(!("version" in entry), "marketplace entry must not declare a version")
})

test("the marketplace ships the plugin from this repo, not a second fetch", () => {
  const entry = marketplaceEntry()
  // `"./"` means "the plugin is at the root of the repo this marketplace came from",
  // so `claude plugin marketplace add qlaneai/agent-plugin` clones once and the
  // installed plugin is pinned to the same commit as the marketplace entry that
  // described it. A `{ source: "github", repo: "qlaneai/agent-plugin" }` entry also
  // validates, but re-fetches the default branch — so a released tag could serve a
  // plugin newer than the marketplace entry's own `version` field, which is exactly
  // the disagreement the test above exists to prevent.
  //
  // NOTE the key is `source`, not `type`: `{ type: "github", owner, repo }` is
  // rejected outright by `claude plugin validate` (verified 2026-08-17, Claude Code
  // CLI). `claude plugin validate` checks this field's SHAPE only — it does not
  // resolve the path — so nothing but this assertion pins the value.
  assert.equal(entry.source, "./")
})

test("README.md exists and is not empty", () => {
  // `lint:md` exits 0 when its glob matches ZERO files (measured), so deleting or
  // renaming the README would leave the markdown gate green while the repo's public
  // face — and this task's main deliverable — is gone. Same vacuity class as a bare
  // `node --test` discovering no test files. This assertion is what makes the lint
  // gate non-vacuous, so it belongs in the suite rather than in the linter's config.
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8")
  assert.ok(readme.trim().length > 0, "README.md must exist and be non-empty")
})

test("the marketplace is named `qlane`, so `qlane@qlane` installs", () => {
  // The README documents `claude plugin install qlane@qlane`, where the half after
  // the `@` is the MARKETPLACE name, not the plugin name. Renaming the marketplace
  // silently breaks that documented command.
  assert.equal(read(".claude-plugin/marketplace.json").name, SERVER_NAME)
})
