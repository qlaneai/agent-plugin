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
// One server per data region, both static. NOT one server whose host varies: no
// surface but the Claude Code CLI can substitute anything into a `url`.
const EU_SERVER = "qlane-eu"
const US_SERVER = "qlane-us"
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

test("both manifests register the same two regional servers", () => {
  // deepEqual against the literal key list also rules out an EMPTY mcpServers object,
  // which is schema-valid and installs nothing. A separate length check would add no
  // coverage — any key list that fails one fails the other.
  //
  // It also pins the COUNT at two. Dropping the US server is the failure that costs a
  // whole region its install path while every other assertion here still passes.
  for (const f of ["mcp.json", ".mcp.json"]) {
    assert.deepEqual(Object.keys(read(f).mcpServers), [EU_SERVER, US_SERVER], f)
  }
})

test("portable mcp.json uses the SPEC transport value, not Claude Code's", () => {
  // Claude Code silently drops "streamable-http"; the spec rejects "http". Asserted on
  // EVERY server: a second entry added later is exactly where the wrong spelling lands,
  // and it fails as a missing server rather than an error.
  for (const s of [EU_SERVER, US_SERVER]) {
    assert.equal(read("mcp.json").mcpServers[s].type, "streamable-http", s)
  }
})

test("every server URL is the real regional endpoint, in BOTH dialects", () => {
  // The whole point of the two-server shape: these are literal strings, so every
  // client gets a working URL without expanding anything. Asserted per dialect
  // because the two files are edited independently and only this compares them.
  const expected = {
    [EU_SERVER]: `https://${EU_HOST}${ENDPOINT_PATH}`,
    [US_SERVER]: `https://${US_HOST}${ENDPOINT_PATH}`,
  }
  for (const f of ["mcp.json", ".mcp.json"]) {
    for (const [server, url] of Object.entries(expected)) {
      assert.equal(read(f).mcpServers[server].url, url, `${f} -> ${server}`)
    }
  }
})

test("Claude Code .mcp.json uses http, its own transport spelling", () => {
  for (const s of [EU_SERVER, US_SERVER]) {
    // An entry with `url` and no `type` is read as a stdio server and skipped.
    assert.equal(read(".mcp.json").mcpServers[s].type, "http", s)
  }
})

// THE regression guard for the two-server design. A placeholder in a `url` resolves in
// exactly one place — the Claude Code CLI — and silently fails everywhere else: the
// portable Agent Plugins schema is `additionalProperties: false` and cannot even
// express `userConfig`, and claude.ai treats an MCP `url` as an opaque connector
// identity, so a templated host reaches registration verbatim and NXDOMAINs. This
// shipped in 0.1.0 and 0.2.0 and broke every non-CLI install.
//
// Scanned as raw TEXT over whole files, not over parsed `url` fields: the same mistake
// in `headers`, nested deeper, or in a server added later is the same bug, and a
// field-scoped check would not see it.
test("no manifest contains a placeholder of any kind", () => {
  for (const f of ["mcp.json", ".mcp.json", "plugin.json", ".claude-plugin/plugin.json"]) {
    const raw = readFileSync(new URL(`../${f}`, import.meta.url), "utf8")
    assert.ok(!raw.includes("${"), `${f} must contain no placeholder`)
  }
})

// `userConfig` is a Claude Code CLI-only feature, and declaring one is not harmless
// decoration: it is the mechanism whose values no other surface can supply, and
// re-adding it is how region would creep back into configuration.
test("no plugin manifest declares userConfig", () => {
  for (const f of ["plugin.json", ".claude-plugin/plugin.json"]) {
    assert.ok(!("userConfig" in read(f)), `${f} must not declare userConfig`)
  }
})

test("both manifests declare the same plugin name and version", () => {
  assert.equal(read("plugin.json").name, read(".claude-plugin/plugin.json").name)
  // Pin ONE side to the literal. Comparing the two sides alone is vacuous on mutual
  // absence: deleting `version` from both files compares undefined === undefined and
  // passes, and nothing backstops it — the Agent Plugins schema requires only
  // ["$schema", "name"], and .claude-plugin/plugin.json is validated by nothing.
  // The name half needs no such pin: a test below anchors plugin.json's name to the
  // literal, which transitively pins the other side through this agreement line.
  assert.equal(read("plugin.json").version, "0.3.0")
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
  // Matches MCP_SERVER_NAME in the main Qlane repo, so a dashboard install and a
  // plugin install are recognisably the same product.
  //
  // It no longer makes them ONE server, and nothing can: a plugin's servers are keyed
  // `plugin:<plugin>:<server>`, so a dashboard install (`qlane`) and this plugin
  // (`plugin:qlane:qlane-eu`) are distinct entries whatever they are called. Users do
  // one or the other; the dashboard already emits a region-correct install of its own.
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
  const remotes = read("server.json").remotes.map((r) => r.url)
  // EVERY server, not just one: the published Registry entry is where a client that
  // never sees our dashboard learns the US endpoint exists, so a US host renamed in
  // mcp.json and not in server.json has to fail here, in the same commit.
  for (const s of [EU_SERVER, US_SERVER]) {
    const url = read("mcp.json").mcpServers[s].url
    assert.ok(remotes.includes(url), `mcp.json ${s} url ${url} is not a server.json remote`)
  }
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
  //     main Qlane repo, and because it is half of the tool namespace every skill
  //     grants against: `mcp__plugin_qlane_<server>__<tool>`.
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

// The trap this exists for: a plugin-bundled server's tools are namespaced
// `mcp__plugin_<plugin>_<server>__<tool>`, so renaming the SERVER silently invalidates
// every grant in every skill. Nothing else notices — a grant that matches nothing is
// not an error, it just produces permission prompts the author believed were
// suppressed. PostHog and MongoDB both ship skills with this bug today.
//
// The `qlane-eu`/`qlane-us` rename is exactly that event, which is why this landed with
// it rather than after the next one.
test("the skill grants the tool namespaces that actually exist", () => {
  const skill = readFileSync(
    new URL("../skills/test-local-changes/SKILL.md", import.meta.url),
    "utf8"
  )
  const line = skill.split("\n").find((l) => l.startsWith("allowed-tools:"))
  assert.ok(line, "SKILL.md must declare allowed-tools")

  // Every tool the skill actually calls, on BOTH servers — either region's user must
  // get the same suppression.
  for (const server of [EU_SERVER, US_SERVER]) {
    for (const tool of ["resolve_project", "list_projects", "create_test_plan", "get_test_plan"]) {
      const grant = `mcp__plugin_${SERVER_NAME}_${server}__${tool}`
      assert.ok(line.includes(grant), `missing grant: ${grant}`)
    }
  }

  // And the retired single-server namespace must be gone. Left behind it matches
  // nothing, so it is invisible in every way except that it does not work.
  const dead = `mcp__plugin_${SERVER_NAME}_${SERVER_NAME}__`
  assert.ok(!line.includes(dead), `stale pre-regional grant left in place: ${dead}`)
})
