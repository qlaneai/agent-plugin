import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p) => JSON.parse(readFileSync(p, "utf8"))
const ENDPOINT_PATH = "/api/mcp"
const EU_HOST = "mcp-eu.qlane.ai"
const SERVER_NAME = "qlane"

test("portable and Claude Code manifests name the same server", () => {
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
  assert.equal(read("plugin.json").version, read(".claude-plugin/plugin.json").version)
})

// The three below close gaps the JSON Schemas structurally cannot: the upstream
// schemas permit ANY server key, ANY url, an EMPTY mcpServers object, and any
// repository string. `npm run validate` passing therefore does NOT mean our
// constraints hold — these assertions are the only thing that does.
test("exactly one server is declared, and it is not zero", () => {
  // An empty mcpServers object is schema-VALID and installs nothing at all.
  assert.equal(Object.keys(read("mcp.json").mcpServers).length, 1)
  assert.equal(Object.keys(read(".mcp.json").mcpServers).length, 1)
})

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
