import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"

// Resolved against this file, not the cwd, so the suite passes when run from
// inside test/ as well as from the repo root. Every path below is relative to the
// repository root.
const REPO = new URL("../../", import.meta.url)
const read = (p) => JSON.parse(readFileSync(new URL(p, REPO), "utf8"))
// The plugin folder: the one directory that ships. Everything a user installs is in it,
// and nothing else is — the marketplaces, server.json and tooling/ stay at the root.
const PLUGIN_DIR = "plugins/qlane/"
const PORTABLE_MANIFEST = `${PLUGIN_DIR}plugin.json`
const PORTABLE_MCP = `${PLUGIN_DIR}mcp.json`
const CLAUDE_MANIFEST = `${PLUGIN_DIR}.claude-plugin/plugin.json`
const CLAUDE_MCP = `${PLUGIN_DIR}.mcp.json`
const MARKETPLACE = ".claude-plugin/marketplace.json"
const CURSOR_MARKETPLACE = ".cursor-plugin/marketplace.json"
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
// Cursor's own manifest, and the MCP file it points at. The Cursor tests below read
// SIDECAR by this name; the test that resolves CURSOR_MANIFEST's `mcpServers` against it
// is what makes them tests of the file Cursor actually loads.
const CURSOR_MANIFEST = `${PLUGIN_DIR}.cursor-plugin/plugin.json`
const SIDECAR = `${PLUGIN_DIR}cursor-mcp.json`
// Qlane's pre-registered OAuth client for Cursor. One production sign-in environment
// serves both regions, so one id serves both servers. Public by design: it identifies a
// PKCE client with no secret, so publishing it grants nothing by itself.
const CURSOR_CLIENT_ID = "client_01M3PNDD11GZ6DYW6MMNXDZ1S0"

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
  for (const f of [PORTABLE_MCP, CLAUDE_MCP]) {
    assert.deepEqual(Object.keys(read(f).mcpServers), [EU_SERVER, US_SERVER], f)
  }
})

test("portable mcp.json uses the SPEC transport value, not Claude Code's", () => {
  // Claude Code silently drops "streamable-http"; the spec rejects "http". Asserted on
  // EVERY server: a second entry added later is exactly where the wrong spelling lands,
  // and it fails as a missing server rather than an error.
  for (const s of [EU_SERVER, US_SERVER]) {
    assert.equal(read(PORTABLE_MCP).mcpServers[s].type, "streamable-http", s)
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
  for (const f of [PORTABLE_MCP, CLAUDE_MCP]) {
    for (const [server, url] of Object.entries(expected)) {
      assert.equal(read(f).mcpServers[server].url, url, `${f} -> ${server}`)
    }
  }
})

test("Claude Code .mcp.json uses http, its own transport spelling", () => {
  for (const s of [EU_SERVER, US_SERVER]) {
    // An entry with `url` and no `type` is read as a stdio server and skipped.
    assert.equal(read(CLAUDE_MCP).mcpServers[s].type, "http", s)
  }
})

// ── Cursor signs in as Qlane's verified client ───────────────────────────────
// Cursor loads BOTH the plugin's Agent Plugins manifest and CURSOR_MANIFEST when both exist,
// and only the second can reach an MCP file that names an OAuth client: the portable
// mcp.json cannot carry one (Agent Plugins' streamableHttpServer is
// `additionalProperties: false`). Without the sidecar, Cursor registers itself
// dynamically, is not a verified client, and an organization's default client policy
// stops it past the metadata reads.
//
// What Cursor does with two same-named servers is MEASURED, not documented: a live
// Cursor install (2026-09-30), checked against which client the server recorded for
// each sign-in. Re-measure before relaxing anything below on the strength of docs.

test("the Cursor manifest's mcpServers resolves to the sidecar, which exists", () => {
  const ref = read(CURSOR_MANIFEST).mcpServers
  assert.equal(typeof ref, "string", `${CURSOR_MANIFEST} mcpServers must be a path`)
  // Resolved against the PLUGIN folder, not .cursor-plugin/ — Cursor's own published plugins
  // keep the file their `mcpServers` names at the plugin root, beside .cursor-plugin/.
  // Compared as resolved URLs, so `./cursor-mcp.json` and `cursor-mcp.json` are the same
  // answer. Pointing it at the portable mcp.json would also name a file that exists, and
  // would quietly undo this whole block; this is what fails it.
  const target = new URL(ref, new URL(PLUGIN_DIR, REPO))
  assert.equal(target.href, new URL(SIDECAR, REPO).href)
  assert.ok(existsSync(target), `${ref} must exist`)
})

test("cursor-mcp.json registers exactly the portable manifest's server names", () => {
  // THE load-bearing invariant. When both manifests declare a server under the same name,
  // Cursor keeps ONE entry — the sidecar's, the only one carrying the client id — whether
  // or not the URLs agree. Under a DIFFERENT name at the same URL it keeps the portable
  // entry instead. So a sidecar server renamed on its own still installs and still
  // connects; it just signs in unverified again, and nothing else here would notice.
  //
  // Sorted, because entry order means nothing to Cursor. The portable names themselves
  // are pinned to the two regional literals by the first test in this file.
  const names = (f) => Object.keys(read(f).mcpServers).sort()
  assert.deepEqual(names(SIDECAR), names(PORTABLE_MCP))
})

test("every cursor-mcp.json server has the portable manifest's URL for that name", () => {
  // Same name is what makes Cursor keep the sidecar entry; this is what makes the entry it
  // keeps the right region. Cursor prefers the sidecar even when the URLs differ, so a URL
  // drifted here would silently replace the portable manifest's correct one.
  const portable = read(PORTABLE_MCP).mcpServers
  const sidecar = read(SIDECAR).mcpServers
  for (const s of [EU_SERVER, US_SERVER]) {
    assert.equal(sidecar[s]?.url, portable[s].url, s)
  }
})

test("every cursor-mcp.json server signs in as Qlane's Cursor client, with no secret", () => {
  for (const s of [EU_SERVER, US_SERVER]) {
    const auth = read(SIDECAR).mcpServers[s]?.auth
    assert.equal(auth?.CLIENT_ID, CURSOR_CLIENT_ID, `${s} auth.CLIENT_ID`)
    // A public PKCE client has no secret to ship, and a CLIENT_SECRET key in a public
    // repository reads as a leaked credential whatever it holds.
    assert.ok(!("CLIENT_SECRET" in auth), `${s} must carry no CLIENT_SECRET`)
  }
})

test("every cursor-mcp.json server keeps the shape that was measured", () => {
  // `url` and `auth`, nothing else — in particular no `type`. That is the one shape the
  // live install measured. Cursor's own plugins write `auth` both beside `"type": "http"`
  // and with no `type` at all, so adding one is probably harmless — but it is unmeasured
  // HERE, and "tidying" the sidecar into another dialect should cost a re-measure first.
  for (const s of [EU_SERVER, US_SERVER]) {
    assert.deepEqual(Object.keys(read(SIDECAR).mcpServers[s] ?? {}).sort(), ["auth", "url"], s)
  }
})

test("the portable mcp.json carries no auth on any server", () => {
  // The client id is Cursor's, so it lives in the Cursor-only sidecar. In the portable
  // manifest, any other editor that honoured the field would sign in claiming to be
  // Cursor. `npm run validate` rejects the key too, but a schema says only that it is
  // invalid — not why moving the id here is wrong.
  for (const [name, server] of Object.entries(read(PORTABLE_MCP).mcpServers)) {
    assert.ok(!("auth" in server), `${PORTABLE_MCP} ${name} must carry no auth`)
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
  for (const f of [
    PORTABLE_MCP,
    CLAUDE_MCP,
    SIDECAR,
    PORTABLE_MANIFEST,
    CLAUDE_MANIFEST,
    CURSOR_MANIFEST,
  ]) {
    const raw = readFileSync(new URL(f, REPO), "utf8")
    assert.ok(!raw.includes("${"), `${f} must contain no placeholder`)
  }
})

// `userConfig` is a Claude Code CLI-only feature, and declaring one is not harmless
// decoration: it is the mechanism whose values no other surface can supply, and
// re-adding it is how region would creep back into configuration.
test("no plugin manifest declares userConfig", () => {
  for (const f of [PORTABLE_MANIFEST, CLAUDE_MANIFEST]) {
    assert.ok(!("userConfig" in read(f)), `${f} must not declare userConfig`)
  }
})

test("every plugin manifest declares the same plugin name and version", () => {
  // Pin ONE side to the literal. Comparing the sides alone is vacuous on mutual absence:
  // deleting `version` from every file compares undefined === undefined and passes, and
  // no schema catches it — Agent Plugins requires only ["$schema", "name"], Cursor's
  // only ["name"], and .claude-plugin/plugin.json is validated by nothing.
  // The name half needs no such pin: a test below anchors plugin.json's name to the
  // literal, which transitively pins the other sides through these agreement lines.
  assert.equal(read(PORTABLE_MANIFEST).version, "0.6.7")
  for (const f of [CLAUDE_MANIFEST, CURSOR_MANIFEST]) {
    assert.equal(read(f).name, read(PORTABLE_MANIFEST).name, `${f} name`)
    assert.equal(read(f).version, read(PORTABLE_MANIFEST).version, `${f} version`)
  }
})

// The product claims a user reads at install time. They drifted once already: the
// wording changed upstream from "coverage" — Qlane produces test cases, it does not
// measure coverage — and the correction reached the live Server Card and
// server.json while all three plugin manifests kept the old word, so every
// non-Claude client was still being shown the retired claim.
//
// TWO claims, on purpose. server.json describes the SERVER and must equal the live
// Server Card (live-card.test.mjs), so it changes only when the server's own card
// does. The four plugin manifests describe the PLUGIN, which also ships skills the
// server does not, so they say what an install can do.
//
// Both pinned to the literal for the same reason `version` is, and for one more: the
// offline suite is the only guard a PR runs. live-card.test.mjs couples server.json
// to production, but it is network-gated behind `npm run test:live`, so an
// agreement-only assertion here would pass happily on stale copies.
const SERVER_CLAIM =
  "AI QA that runs your app in a browser on every pull request: projects, test targets, test cases."
const PLUGIN_CLAIM =
  "AI QA that runs your app in a browser on every pull request: set up a test target, read what it found on a pull request, and plan tests for a local diff."

test("server.json makes the server's claim, and every plugin manifest the plugin's", () => {
  assert.equal(read("server.json").description, SERVER_CLAIM)
  assert.equal(read(CLAUDE_MANIFEST).description, PLUGIN_CLAIM)
  assert.equal(read(MARKETPLACE).plugins[0].description, PLUGIN_CLAIM)
  // The portable manifest appends a region sentence — it has no userConfig to carry
  // that information — so it extends the claim rather than equalling it.
  assert.ok(
    read(PORTABLE_MANIFEST).description.startsWith(PLUGIN_CLAIM),
    "portable plugin.json must open with the plugin's claim"
  )
  // Cursor's manifest ships the same two servers with no userConfig either, so it
  // carries the portable description, region sentence and all.
  assert.equal(read(CURSOR_MANIFEST).description, read(PORTABLE_MANIFEST).description)
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
  assert.equal(read(PORTABLE_MANIFEST).name, SERVER_NAME)
})

test("the repository points at the org that exists", () => {
  // `qlane-ai` is a real GitHub App slug but NOT a GitHub org — it 404s.
  for (const f of [PORTABLE_MANIFEST, CLAUDE_MANIFEST, CURSOR_MANIFEST]) {
    assert.equal(read(f).repository, "https://github.com/qlaneai/agent-plugin")
  }
})

// Shared so a missing entry fails by name in EVERY test that needs one, rather
// than throwing a TypeError on property access in whichever test forgot the guard.
const marketplaceEntry = () => {
  const entry = read(MARKETPLACE).plugins.find((p) => p.name === SERVER_NAME)
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
  // A relative path means "the plugin is in a folder of the repo this marketplace came
  // from", so `claude plugin marketplace add qlaneai/agent-plugin` clones once and the
  // installed plugin is pinned to the same commit as the marketplace entry that
  // described it. Codex and VS Code read this same file, and Codex accepts only the
  // `./` form here. A `{ source: "github", repo: "qlaneai/agent-plugin" }` entry also
  // validates, but re-fetches the default branch — so a released tag could serve a
  // plugin newer than the marketplace entry's own `version` field, which is exactly
  // the disagreement the test above exists to prevent.
  //
  // NOTE the key is `source`, not `type`: `{ type: "github", owner, repo }` is
  // rejected outright by `claude plugin validate` (verified 2026-08-17, Claude Code
  // CLI). `claude plugin validate` checks this field's SHAPE only — it does not
  // resolve the path — so nothing but this assertion pins the value.
  assert.equal(entry.source, `./${PLUGIN_DIR.replace(/\/$/, "")}`)
  // `claude plugin validate` checks the path's shape only, never that it resolves.
  assert.ok(existsSync(new URL(`${entry.source}/.claude-plugin/plugin.json`, REPO)))
})

// Cursor reads only its own marketplace file, and a plugin in a folder needs one at the
// repository root. Its documented form is a bare relative path; nothing else reads it.
test("the Cursor marketplace lists the same plugin from the same folder", () => {
  const cursor = read(CURSOR_MARKETPLACE)
  assert.equal(cursor.name, MARKETPLACE_NAME)
  assert.deepEqual(
    cursor.plugins.map((p) => ({ name: p.name, source: p.source })),
    [{ name: SERVER_NAME, source: PLUGIN_DIR.replace(/\/$/, "") }]
  )
  assert.equal(cursor.plugins[0].description, PLUGIN_CLAIM)
  assert.ok(existsSync(new URL(`${cursor.plugins[0].source}/.cursor-plugin/plugin.json`, REPO)))
})

test("both READMEs exist and are not empty", () => {
  // `lint:md` exits 0 when its glob matches ZERO files (measured), so deleting or
  // renaming a README would leave the markdown gate green while the repo's public
  // face is gone. Same vacuity class as a bare `node --test` discovering no test
  // files. This assertion is what makes the lint gate non-vacuous, so it belongs in
  // the suite rather than in the linter's config.
  for (const f of ["README.md", `${PLUGIN_DIR}README.md`]) {
    const readme = readFileSync(new URL(f, REPO), "utf8")
    assert.ok(readme.trim().length > 0, `${f} must exist and be non-empty`)
  }
})

// Anthropic's directory shows the PLUGIN folder's README as the listing's description,
// and blocks a submission whose README has fewer than 40 words outside code blocks.
test("the plugin README is long enough to be the directory listing", () => {
  const readme = readFileSync(new URL(`${PLUGIN_DIR}README.md`, REPO), "utf8")
  const prose = readme.replace(/```[\s\S]*?```/g, " ")
  const words = prose.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length
  assert.ok(words >= 40, `${PLUGIN_DIR}README.md has ${words} words outside code blocks`)
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
    const url = read(PORTABLE_MCP).mcpServers[s].url
    assert.ok(remotes.includes(url), `${PORTABLE_MCP} ${s} url ${url} is not a server.json remote`)
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
  assert.equal(read(MARKETPLACE).name, MARKETPLACE_NAME)
  // Pinned as an inequality too: the failure this guards against is someone collapsing
  // the two back to one name, which an equality against a constant would still catch
  // only if they also edited the constant. Stating the invariant makes the intent
  // survive a careless find-and-replace across both files.
  assert.notEqual(MARKETPLACE_NAME, SERVER_NAME)
})

// Anthropic's directory reads these four links, and the icon below, for the plugin's
// listing; Claude Code ignores them. The portal warns when privacyPolicyUrl is missing.
// Only the Claude manifest carries them: the portable schema is
// `additionalProperties: false`.
test("the Claude manifest carries the directory listing's links", () => {
  const manifest = read(CLAUDE_MANIFEST)
  assert.deepEqual(
    {
      documentationUrl: manifest.documentationUrl,
      supportUrl: manifest.supportUrl,
      privacyPolicyUrl: manifest.privacyPolicyUrl,
      termsOfServiceUrl: manifest.termsOfServiceUrl,
    },
    {
      documentationUrl: "https://docs.qlane.ai",
      supportUrl: "https://qlane.ai/contact",
      privacyPolicyUrl: "https://qlane.ai/privacy",
      termsOfServiceUrl: "https://qlane.ai/terms",
    }
  )
})

// The portal takes the icon only the FIRST time a submission is saved or submitted, so
// a file it rejects cannot be fixed later by replacing it. Its rule: a square PNG,
// 512 to 2048 px a side, under 2 MB. The manifest names it explicitly — the documented
// `icon` field — and the file checked is the one it names. Width and height are read
// from the PNG header.
test("the listing icon is a square PNG the directory accepts", () => {
  const { icon } = read(CLAUDE_MANIFEST)
  assert.equal(icon, "./.claude-plugin/icon.png")
  const png = readFileSync(new URL(icon, new URL(PLUGIN_DIR, REPO)))
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  assert.equal(width, height, "icon must be square")
  assert.ok(width >= 512 && width <= 2048, `icon is ${width}px a side`)
  assert.ok(png.length < 2 * 1024 * 1024, `icon is ${png.length} bytes`)
})

// Claude Code runs a package install for any plugin whose ROOT holds a package.json
// beside a lockfile, and nothing can switch it off; the directory holds every such
// version for a reviewer ("Dependencies install from a lockfile").
test("the plugin folder holds no package.json, so installing the plugin installs nothing", () => {
  assert.equal(existsSync(new URL(`${PLUGIN_DIR}package.json`, REPO)), false)
})

// Everything in the plugin folder ships to every user, and is everything Anthropic's
// directory scans. Dev tooling inside it ships too, and its scanner reads CI scripts as
// the plugin's own behaviour — a `git ls-files` in a version audit was held for a
// reviewer as a credential read. So the folder holds an exact list of entries, and
// anything else belongs at the repository root.
test("the plugin folder holds only what ships", () => {
  const entries = readdirSync(new URL(PLUGIN_DIR, REPO)).sort()
  assert.deepEqual(entries, [
    ".claude-plugin",
    ".cursor-plugin",
    ".mcp.json",
    "LICENSE",
    "README.md",
    "cursor-mcp.json",
    "mcp.json",
    "plugin.json",
    "skills",
  ])
})

// The plugin folder is all an install receives, so it carries its own copy of the
// license text; GitHub reads only the root one. The two must be the same license.
test("the plugin folder's LICENSE is the repository's", () => {
  const text = (f) => readFileSync(new URL(f, REPO), "utf8")
  assert.equal(text(`${PLUGIN_DIR}LICENSE`), text("LICENSE"))
})
