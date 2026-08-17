import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

// Files that are ALLOWED to contain the plugin version. Adding a manifest means
// adding it here — and if you forget, this script is what tells you.
//
// A fixed list of files to keep in sync — ours, or anyone's — structurally
// cannot catch "you added a seventh manifest and forgot to register it". This
// script closes that hole by scanning every tracked file instead, and it is the
// only guard here that does.
//
// server.json is NOT on this list on purpose: it carries the SERVER's version
// ("equivalent of Implementation.version"), not the plugin package's. The two
// identities are meant to differ, so server.json will never match and must
// never be declared.
//
// Note the scan is over raw text, so a version literal in a COMMENT counts too
// — which is why neither number is spelled out anywhere in this file. That is
// the intended over-approximation: a manifest is far likelier than a comment,
// and the fix for a comment is to reword it.
const DECLARED = ["plugin.json", ".claude-plugin/plugin.json", "test/manifests.test.mjs"]

const version = JSON.parse(readFileSync("plugin.json", "utf8")).version
if (!version) {
  console.error("✗ plugin.json has no version")
  process.exit(1)
}

// `git ls-files`, never a filesystem walk: a walk counts node_modules and any
// build output, which makes the audit both slow and wrong.
const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean)

const found = tracked.filter((f) => {
  try {
    return readFileSync(f, "utf8").includes(version)
  } catch {
    return false // binary or unreadable — cannot carry a version string we care about
  }
})

const undeclared = found.filter((f) => !DECLARED.includes(f))
const missing = DECLARED.filter((f) => !found.includes(f))

let failed = false
for (const f of undeclared) {
  console.error(`✗ ${f} contains version ${version} but is not in DECLARED`)
  failed = true
}
for (const f of missing) {
  // A declared file that has STOPPED carrying the version is the other half of
  // the same failure: the list has gone stale in the opposite direction.
  console.error(`✗ ${f} is declared but no longer contains version ${version}`)
  failed = true
}
if (!failed)
  console.log(`✓ version ${version} appears in exactly the ${DECLARED.length} declared files`)
process.exit(failed ? 1 : 0)
