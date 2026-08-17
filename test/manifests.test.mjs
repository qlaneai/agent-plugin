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
