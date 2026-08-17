import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

// Resolved against this file, not the cwd, so the suite passes when run from
// inside test/ as well as from the repo root.
const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"))
const ENDPOINT_PATH = "/api/mcp"
const EU_HOST = "mcp-eu.qlane.ai"
const US_HOST = "mcp-us.qlane.ai"
const SERVER_NAME = "qlane"
// Deliberately NOT equal to SERVER_NAME — see the marketplace-name test at the
// bottom for why, before "fixing" them into agreement.
const MARKETPLACE_NAME = "qlane-plugin"
// The spec transport value. Claude Code's own manifest uses "http" instead —
// see the two transport tests below — but the Registry entry follows the spec.
const REMOTE_TYPE = "streamable-http"

// Compared as {type, url} pairs, never urls alone: a remote silently switched to
// "sse" keeps its url and would pass a url-only comparison here AND in the live
// test, against real production.
const endpoints = (o) =>
  o.remotes.map(({ type, url }) => ({ type, url })).sort((a, b) => (a.url < b.url ? -1 : 1))

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

// Claude Code substitutes `${user_config.<key>}` with a GLOBAL, UNANCHORED regex
// and a plain String.replace, so the placeholder may sit inside a larger string
// rather than being the whole value (verified by reading `replaceVariables` in
// the 2.1.233 bundle). That is what lets the user supply `eu` instead of the
// whole hostname — two characters instead of sixteen, and no dots to mistype.
const resolve = (template, region) => template.replaceAll("${user_config.region}", region)

test("Claude Code .mcp.json uses http and resolves to the real regional hosts", () => {
  const entry = read(".mcp.json").mcpServers[SERVER_NAME]
  // An entry with `url` and no `type` is read as a stdio server and skipped.
  assert.equal(entry.type, "http")
  // Asserted by RESOLVING rather than by comparing the template to a literal:
  // this pins what the user actually connects to, so a template that is
  // well-formed but wrong (`mcp${…}`, a missing dot, the wrong apex) fails here
  // instead of passing a string-equality check against itself.
  assert.equal(resolve(entry.url, "eu"), `https://${EU_HOST}${ENDPOINT_PATH}`)
  assert.equal(resolve(entry.url, "us"), `https://${US_HOST}${ENDPOINT_PATH}`)
  // And nothing is left unsubstituted — a second placeholder would silently
  // survive into the URL, which Claude Code does not treat as an error.
  assert.ok(!resolve(entry.url, "eu").includes("${"), "no placeholder may survive")
})

test("region is required and has NO default", () => {
  const opt = read(".claude-plugin/plugin.json").userConfig.region
  assert.equal(opt.required, true)
  // A default is silently used at connect time; `required` does not gate it.
  // `hasRequiredConfigMissing` counts only undefined/null/"" as missing, so a
  // default makes the field present and every US customer silently gets EU.
  assert.ok(!("default" in opt), "region must not declare a default")
  // The key is load-bearing: it must match the placeholder in .mcp.json, and
  // nothing else checks that the two agree.
  assert.ok(
    read(".mcp.json").mcpServers[SERVER_NAME].url.includes("${user_config.region}"),
    ".mcp.json must reference the userConfig key by its exact name"
  )
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
  assert.equal(read("plugin.json").version, "0.2.0")
  assert.equal(read("plugin.json").version, read(".claude-plugin/plugin.json").version)
})

// The product claim a user reads at install time, carried by FOUR manifests. It
// drifted once already: the wording changed upstream from "coverage" — Qlane
// produces test cases, it does not measure coverage — and the correction reached the
// live Server Card and server.json while all three plugin manifests kept the old
// word, so every non-Claude client was still being shown the retired claim.
//
// Pinned to the literal for the same reason `version` is, and for one more: the
// offline suite is the only guard a PR runs. live-card.test.mjs couples server.json
// to production, but it is network-gated behind `npm run test:live`, so an
// agreement-only assertion here would pass happily on four stale copies.
const CLAIM =
  "AI QA that runs your app in a browser on every pull request: projects, test targets, test cases."

test("every manifest makes the same product claim", () => {
  assert.equal(read("server.json").description, CLAIM)
  assert.equal(read(".claude-plugin/plugin.json").description, CLAIM)
  assert.equal(read(".claude-plugin/marketplace.json").plugins[0].description, CLAIM)
  // The portable manifest appends a region sentence — it has no userConfig to carry
  // that information — so it extends the claim rather than equalling it.
  assert.ok(
    read("plugin.json").description.startsWith(CLAIM),
    "portable plugin.json must open with the shared claim"
  )
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

test("server.json registers BOTH regions, as streamable-http", () => {
  // Pinned to the two-element literal, not merely "contains EU": every other
  // assertion here is satisfied by the EU remote alone, so dropping the US
  // remote from server.json passed the entire offline gate before this test
  // existed — and the Registry entry is the only place the US endpoint is
  // published to clients that do not read our dashboard.
  assert.deepEqual(endpoints(read("server.json")), [
    { type: REMOTE_TYPE, url: `https://${EU_HOST}${ENDPOINT_PATH}` },
    { type: REMOTE_TYPE, url: `https://${US_HOST}${ENDPOINT_PATH}` },
  ])
})

test("the portable manifest points at one of the registered remotes", () => {
  // Local half of the drift check, so it runs on every PR rather than only on
  // drift.yml's schedule: the network test pins server.json to production, and
  // this pins mcp.json to server.json. A regional host renamed in one file and
  // not the other fails here within the same commit.
  const url = read("mcp.json").mcpServers[SERVER_NAME].url
  assert.ok(
    read("server.json").remotes.some((r) => r.url === url),
    `mcp.json url ${url} is not among server.json's remotes`
  )
})

test("the marketplace is named `qlane-plugin`, so `qlane@qlane-plugin` installs", () => {
  // The README documents `claude plugin install qlane@qlane-plugin`. The half BEFORE
  // the `@` is the plugin, the half AFTER is the marketplace. Renaming either half
  // silently breaks that documented command, so both are pinned to literals — the
  // plugin name by the test above, the marketplace name here.
  //
  // The two are deliberately DIFFERENT, and this is the note for whoever later tries
  // to tidy them into agreement:
  //
  //   - The PLUGIN must stay `qlane` because it has to match MCP_SERVER_NAME in the
  //     main Qlane repo. If it drifts, a dashboard install and a marketplace install
  //     register two different servers instead of one, and the user gets both.
  //   - The MARKETPLACE is therefore the half free to move, and it is suffixed so
  //     `qlane@qlane-plugin` reads as "the qlane plugin, from the qlane-plugin
  //     marketplace" rather than the self-referential `qlane@qlane`.
  //
  // This also matches how shipped single-plugin vendor repos name the pair — Vanta's
  // MCP plugin repo, the closest analogue to this one, installs as `vanta@vanta-plugin`.
  assert.equal(read(".claude-plugin/marketplace.json").name, MARKETPLACE_NAME)
  // Pinned as an inequality too: the failure this guards against is someone collapsing
  // the two back to one name, which an equality against a constant would still catch
  // only if they also edited the constant. Stating the invariant makes the intent
  // survive a careless find-and-replace across both files.
  assert.notEqual(MARKETPLACE_NAME, SERVER_NAME)
})
