import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

// Resolved against this file, not the cwd — same reason as the test files. It
// also fixes the paths `git ls-files` returns, which are relative to the
// directory git ran in rather than to the repo.
const ROOT = new URL("../", import.meta.url)
const readJson = (p) => JSON.parse(readFileSync(new URL(p, ROOT), "utf8"))

// WHAT THIS GUARDS, in two halves that partition the tracked files between them.
//
//   *.json         — STRUCTURAL. Which files declare a top-level `version` key,
//                    and does its value match the plugin's.
//   everything else — TEXTUAL. Which files contain the plugin version literal.
//
// NOTE: this file spells out no version literal of its own, in prose or in a
// reason string — one here would trip the textual half on whatever release it
// collided with, and the fix is always to reword rather than to exempt. That is
// not hypothetical: an earlier revision named a version in a comment and the
// audit reported itself.
//
// Neither half alone is the guard. The structural half exists because "contains
// the version string" misses an unregistered manifest whose version is already
// WRONG (a new vscode-manifest.json pinned to an older release contains no copy
// of the current version, so it reads clean) and because it turns unfixably red
// the plugin version collides with a dependency version, a vendored schema's
// $id, or the server's own identity. The textual half exists because the
// structural one only understands JSON, and the headline case this script is
// FOR — "you added a manifest and forgot to register it" — arrives just as
// easily as manifest.yaml or plugin.jsonc. Restricting the text scan to
// non-JSON files is what keeps it from re-introducing the collision problem:
// every known colliding file is a .json, so the text half never sees them.
//
// WHAT NEITHER HALF COVERS — real gaps, not oversights:
//   • A version NESTED inside a JSON document ({"plugin":{"version":"…"}}).
//     The structural half reads the top level only and the text half skips
//     *.json entirely. Deliberate: recursing would fire on package-lock.json,
//     which carries a `version` under every entry in `packages`.
//   • A non-JSON manifest carrying a WRONG version (a manifest.yaml pinned to
//     some other release).
//     The text half matches the current literal, so it sees presence, never
//     correctness. A non-JSON manifest that must track the plugin version needs
//     a real check of its own — TEXT_CARRIERS below is not that.
//   • Untracked files (`git ls-files` lists the index, so a new file is seen
//     once staged — which is a precondition of committing it) and binary or
//     unreadable files, which are skipped.
//
// Files that MUST declare the plugin version at their JSON top level. Adding a
// manifest means adding it here — and if you forget, this script is what tells
// you, because an undeclared file that declares a version at all is a finding
// whatever its value.
const DECLARED = ["plugin.json", ".claude-plugin/plugin.json", ".cursor-plugin/plugin.json"]

// Tracked JSON that legitimately declares a version that is NOT the plugin's.
// Per-file and explicit, so adding one is a decision rather than a default.
//
// ⚠️ NEVER add a plugin manifest here to quiet a failure. Unlike DECLARED, which
// forces `declared === version` and so cannot hide a wrong value, an entry here
// asserts NOTHING about the value — it exempts the file permanently and for
// every future version. This list is only for a file whose version legitimately
// belongs to something else. If the file should track the plugin version, it
// goes in DECLARED; if it disagrees, fix the file.
const FOREIGN_VERSIONS = {
  "server.json":
    "the MCP server's own identity — the Registry schema calls it 'equivalent of Implementation.version'. It tracks the deployed server, not this package, so the two are meant to differ and coupling them would force false bumps.",
}
// Deliberately NOT listed: package-lock.json declares no top-level `version` at
// all (npm omits it for a private package that declares none), so an entry
// would document something untrue — and the staleness half below would fail on
// it. If package.json ever gains a version, npm mirrors it into the lockfile
// and this is where that exemption goes. The vendored schemas under schemas/ are
// absent for the same reason: whatever version each carries lives in its $id or
// its filename, never in a top-level `version` key, so this audit never looks at
// them.

// Non-JSON tracked files PERMITTED to contain the version literal, with why.
// Same prohibition as above: this is not where a forgotten manifest goes.
//
// Unlike the two lists above, entries here are permissions rather than
// assertions, and are NOT staleness-checked — whether a file collides depends on
// the current version's value, so an entry matching nothing today is expected,
// not stale. scripts/validate.mjs is the case in point: it collides only while
// the plugin version happens to equal the vendored schemas' line.
const TEXT_CARRIERS = {
  "test/manifests.test.mjs":
    "pins the version literal in an assertion about plugin.json on purpose — that pin is what makes the plugin manifests' agreement test non-vacuous, and a bump that skips it fails `npm test` rather than passing quietly.",
  "scripts/validate.mjs":
    "names the vendored agent-plugins schemas, whose filenames and $id both carry the SCHEMA's own version line — unrelated to the plugin's, but a textual match on any release where the two happen to coincide.",
}
// A prose mention in a tracked non-JSON file (a README, a changelog) trips this
// too. That is the intended over-approximation: a manifest is far likelier than
// a comment, and the fix for a comment is to REWORD it — never to declare it.

// An exemption is only reviewable if it says why. Enforced rather than left to
// convention, because the two lists above are the only way to silence a finding
// and a blank string would silence one while looking deliberate.
const configErrors = []
for (const [name, list] of [
  ["FOREIGN_VERSIONS", FOREIGN_VERSIONS],
  ["TEXT_CARRIERS", TEXT_CARRIERS],
]) {
  for (const [file, reason] of Object.entries(list)) {
    if (typeof reason !== "string" || reason.trim() === "") {
      configErrors.push(`${name}["${file}"] has no reason — an exemption must say why it is exempt`)
    }
  }
}
if (configErrors.length) {
  for (const e of configErrors) console.error(`✗ ${e}`)
  process.exit(1)
}

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
    stdio: ["ignore", "pipe", "pipe"],
  })
    .split("\n")
    .filter(Boolean)
} catch (err) {
  // Reached in a `git archive` extraction or a source tarball, where the audit
  // cannot know what is tracked and so must refuse rather than pass vacuously —
  // but "not a work tree" is only one of the ways this fails, so report the one
  // that actually happened instead of asserting a cause we have not established.
  if (err.code === "ENOENT") {
    console.error("✗ `git` is not on PATH — the audit needs `git ls-files`")
  } else {
    const detail =
      String(err.stderr ?? "")
        .trim()
        .split("\n")[0] || `exit ${err.status}`
    console.error(`✗ \`git ls-files\` failed — the audit cannot tell what is tracked (${detail})`)
  }
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

// ── Textual half: every tracked file that is NOT JSON ────────────────────────
// Presence of the literal only. This is what catches manifest.yaml and
// plugin.jsonc, which the structural half cannot parse and would otherwise wave
// through — the exact "you added a manifest and forgot to register it" case.
let textCarriers = 0
for (const file of tracked.filter((f) => !f.endsWith(".json"))) {
  let text
  try {
    text = readFileSync(new URL(file, ROOT), "utf8")
  } catch {
    continue // binary or unreadable — cannot carry a version string we care about
  }
  if (!text.includes(version)) continue
  if (file in TEXT_CARRIERS) {
    textCarriers++
    continue
  }
  failures.push(
    `${file} contains the version literal ${version} but is not in TEXT_CARRIERS — ` +
      `a manifest needs a real check of its own; a file that legitimately names releases ` +
      `(a changelog) goes in TEXT_CARRIERS with a reason; prose that merely happens to ` +
      `mention the current version should be reworded`
  )
}

for (const f of failures) console.error(`✗ ${f}`)
if (!failures.length) {
  console.log(
    `✓ version ${version}: declared by exactly the ${DECLARED.length} declared JSON files, ` +
      `${Object.keys(FOREIGN_VERSIONS).length} foreign version(s) exempt, ` +
      `${textCarriers} non-JSON carrier(s) permitted`
  )
}
process.exit(failures.length ? 1 : 0)
