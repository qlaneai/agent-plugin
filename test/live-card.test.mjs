import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

// NETWORK TEST. Deliberately NOT part of `npm test` / `npm run check`, which must
// stay offline-clean: it is reached only by `npm run test:live`, which is what
// .github/workflows/drift.yml runs on a schedule and on demand. A production blip
// must never be able to block a docs PR.
//
// Resolved against this file, not the cwd — same reason as manifests.test.mjs.
const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"))
const CARD_URL = "https://qlane.ai/.well-known/mcp/server-card.json"

test("server.json agrees with the live Server Card", async () => {
  // A hung fetch has no natural ceiling in Node; fail the scheduled job in
  // seconds rather than occupying a runner until the job timeout.
  const res = await fetch(CARD_URL, { signal: AbortSignal.timeout(15_000) })
  assert.equal(res.status, 200)
  const card = await res.json()
  const ours = read("server.json")

  assert.equal(ours.name, card.name, "card name must match ai.qlane/qlane")

  // {type, url} pairs, not urls alone: a remote switched from streamable-http to
  // sse keeps its url, so a url-only comparison passes that against production.
  const endpoints = (o) =>
    o.remotes.map(({ type, url }) => ({ type, url })).sort((a, b) => (a.url < b.url ? -1 : 1))
  assert.deepEqual(
    endpoints(ours),
    endpoints(card),
    "regional endpoint set — type and url — must match production"
  )

  // NOT asserted: version. server.json tracks the server identity, plugin.json
  // tracks the package, and coupling them forces false bumps.
})
