import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

// Resolved against this file, not the cwd — same reason as the test files. It
// also fixes the paths `git ls-files` returns, which are relative to the
// directory git ran in rather than to the repo.
const ROOT = new URL("../", import.meta.url)
const readJson = (p) => JSON.parse(readFileSync(new URL(p, ROOT), "utf8"))

// WHAT THIS GUARDS: not "which files contain a version string". That predicate
// both MISSES an unregistered manifest whose version is already wrong (a new
// vscode-manifest.json pinned to 0.0.9 contains no copy of the current version,
// so it looks clean) and turns unfixably red the day the plugin version
// collides with a dependency version, a vendored schema's $id, or the server's
// own identity — with no legal way to silence it. The predicate is instead
// "which tracked JSON files DECLARE a top-level `version`", which is the
// property actually being kept in sync.
//
// Files that MUST declare the plugin version at their JSON top level. Adding a
// manifest means adding it here — and if you forget, this script is what tells
// you, because an undeclared file that declares a version at all is a finding
// whatever its value.
const DECLARED = ["plugin.json", ".claude-plugin/plugin.json"]

// Tracked JSON that legitimately declares a version that is NOT the plugin's.
// Per-file and explicit, so adding one is a decision rather than a default.
const FOREIGN_VERSIONS = {
  "server.json":
    "the MCP server's own identity — the Registry schema calls it 'equivalent of Implementation.version'. It tracks the deployed server, not this package, so the two are meant to differ and coupling them would force false bumps.",
}
// Deliberately NOT listed: package-lock.json declares no top-level `version` at
// all (npm omits it for a private package that declares none), so an entry
// would document something untrue — and the staleness half below would fail on
// it. If package.json ever gains a version, npm mirrors it into the lockfile
// and this is where that exemption goes. The three vendored schemas are absent
// for the same reason: they carry versions in their $id and filenames, never in
// a top-level `version` key, so this audit never looks at them.
//
// test/manifests.test.mjs pins the version literal too, but it is not JSON and
// so is out of scope here by construction. Nothing is lost: that literal sits
// in an assertion about plugin.json, so a bump that skips it fails `npm test`.

const source = "plugin.json"
const version = readJson(source).version
if (!version) {
  console.error(`✗ ${source} has no version`)
  process.exit(1)
}

// `git ls-files`, never a filesystem walk: a walk counts node_modules and any
// build output, which makes the audit both slow and wrong.
let tracked
try {
  tracked = execFileSync("git", ["ls-files"], {
    cwd: fileURLToPath(ROOT),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  })
    .split("\n")
    .filter(Boolean)
} catch {
  // Reached in a `git archive` extraction or a source tarball, where the audit
  // cannot know what is tracked and so must refuse rather than pass vacuously.
  console.error("✗ not a git work tree — the audit needs `git ls-files`")
  process.exit(1)
}

const failures = []
const declaresVersion = new Map() // tracked JSON path -> its top-level version

for (const file of tracked.filter((f) => f.endsWith(".json"))) {
  let doc
  try {
    doc = readJson(file)
  } catch (err) {
    failures.push(`${file} — tracked JSON that does not parse (${err.message})`)
    continue
  }
  // Top level only. A NESTED `version` (a lockfile's dependency, a schema's
  // example) belongs to someone else, and reading those is precisely how the
  // string-matching form of this audit went wrong.
  if (doc !== null && typeof doc === "object" && !Array.isArray(doc) && "version" in doc) {
    declaresVersion.set(file, doc.version)
  }
}

for (const [file, declared] of declaresVersion) {
  if (DECLARED.includes(file)) {
    if (declared !== version) {
      failures.push(`${file} declares version ${declared}, but the plugin version is ${version}`)
    }
  } else if (!(file in FOREIGN_VERSIONS)) {
    failures.push(
      `${file} declares a top-level "version" (${declared}) but is in neither DECLARED nor FOREIGN_VERSIONS`
    )
  }
}

// The other half of the same failure — a list gone stale in the opposite
// direction, because a file stopped declaring a version, was untracked, or was
// moved. Both lists are checked, or an exemption could outlive its reason.
for (const file of DECLARED) {
  if (!declaresVersion.has(file)) {
    failures.push(`${file} is DECLARED but is not a tracked JSON file declaring a "version"`)
  }
}
for (const file of Object.keys(FOREIGN_VERSIONS)) {
  if (!declaresVersion.has(file)) {
    failures.push(`${file} is exempt in FOREIGN_VERSIONS but no longer declares a "version"`)
  }
}

for (const f of failures) console.error(`✗ ${f}`)
if (!failures.length) {
  console.log(
    `✓ version ${version} is declared by exactly the ${DECLARED.length} declared files, ` +
      `plus ${Object.keys(FOREIGN_VERSIONS).length} documented foreign version(s)`
  )
}
process.exit(failures.length ? 1 : 0)
