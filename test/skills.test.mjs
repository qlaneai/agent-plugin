import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"

// Every skill under skills/, read from disk rather than listed, so a skill added
// later is checked by every test here without anyone remembering to register it.
const SKILLS_DIR = new URL("../skills/", import.meta.url)
const skills = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => {
    const text = readFileSync(new URL(`${d.name}/SKILL.md`, SKILLS_DIR), "utf8")
    const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
    assert.ok(match, `skills/${d.name}/SKILL.md must open with a --- frontmatter block`)
    const frontmatter = Object.fromEntries(
      match[1].split("\n").map((line) => {
        const at = line.indexOf(":")
        return [line.slice(0, at).trim(), line.slice(at + 1).trim()]
      })
    )
    return { dir: d.name, frontmatter, body: match[2] }
  })

const SERVER_NAME = "qlane"
const SERVERS = ["qlane-eu", "qlane-us"]

// Every tool Qlane MCP serves, as its tools/list names them. A skill that names a
// tool not on this list is not checked by the grant test below, so a tool the
// server adds is added here before a skill uses it.
const TOOLS = [
  "resolve_project",
  "list_projects",
  "get_project",
  "list_environments",
  "create_test_plan",
  "get_test_plan",
  "list_test_sessions",
  "get_test_session",
  "list_defects",
  "get_test_result",
  "update_project",
  "list_source_repositories",
  "create_project",
  "get_environment",
  "create_environment",
  "update_environment",
  "request_environment_variables",
  "request_test_credentials",
  "start_boot_check",
  "get_boot_check",
]

// Tools a skill names on purpose without granting them, each with why. Naming a
// tool in a "never call" rule is how a skill forbids it, and a grant there would
// pre-approve exactly the call the rule forbids.
const NAMED_NOT_GRANTED = {
  bugs: {
    create_test_plan: "forbidden: the skill is read-only, and planning spends credits",
    start_boot_check: "forbidden: a configuration check spends credits",
    update_environment: "forbidden: it changes a test target; named in a blocked case's remedy",
    request_environment_variables: "forbidden: named in a blocked case's remedy only",
    request_test_credentials: "forbidden: named in a blocked case's remedy only",
    create_project: "forbidden: the skill is read-only",
    create_environment: "forbidden: the skill is read-only",
    update_project: "forbidden: the skill is read-only; named in a blocked case's remedy",
    get_environment: "named in a blocked case's remedy only; the skill reads no test target",
  },
}

/** The shared region step: from its heading to the next `## ` heading. */
function regionStep(body) {
  const start = body.indexOf("## Step 0 —")
  assert.ok(start >= 0, "a skill must carry the region step")
  const end = body.indexOf("\n## ", start + 1)
  return body.slice(start, end === -1 ? undefined : end)
}

const grantsOf = (skill) => new Set((skill.frontmatter["allowed-tools"] ?? "").split(/\s+/))
const grant = (server, tool) => `mcp__plugin_${SERVER_NAME}_${server}__${tool}`

test("finds the skills it checks", () => {
  // Every other test here loops over `skills`, so an empty list would pass them all.
  assert.ok(skills.length >= 2, `expected at least two skills, found ${skills.length}`)
})

test("every skill's frontmatter names it after its directory and describes it", () => {
  for (const s of skills) {
    assert.equal(s.frontmatter.name, s.dir, `skills/${s.dir} name`)
    const description = s.frontmatter.description ?? ""
    assert.ok(description.length > 0, `skills/${s.dir} must have a description`)
    // The agent-skills limit; a longer one is cut where an editor shows it.
    assert.ok(description.length <= 1024, `skills/${s.dir} description is ${description.length}`)
  }
})

test("every skill carries the region step word for word", () => {
  // A skill cannot include another's text, so the step is copied, and copies drift.
  // The step decides which server every later call goes to; a skill whose copy
  // drifted would route one region's users differently from the other skills.
  const [first, ...rest] = skills
  const reference = regionStep(first.body)
  for (const s of rest) {
    assert.equal(
      regionStep(s.body),
      reference,
      `skills/${s.dir} region step differs from ${first.dir}'s`
    )
  }
})

test("every tool a skill names is granted on both servers, unless it is named to forbid it", () => {
  for (const s of skills) {
    const grants = grantsOf(s)
    const exceptions = NAMED_NOT_GRANTED[s.dir] ?? {}
    // The region step names tools only to say what a connected server looks like.
    const body = s.body.replace(regionStep(s.body), "")
    const named = TOOLS.filter((t) => new RegExp(`\\b${t}\\b`).test(body))
    assert.ok(named.length > 0, `skills/${s.dir} names no Qlane tool`)
    for (const tool of named) {
      for (const server of SERVERS) {
        const g = grant(server, tool)
        if (tool in exceptions) {
          assert.ok(!grants.has(g), `skills/${s.dir} grants ${g}, which it names only to forbid`)
        } else {
          assert.ok(grants.has(g), `skills/${s.dir} is missing grant ${g}`)
        }
      }
    }
    // An exception for a tool the skill no longer names would silence nothing.
    for (const tool of Object.keys(exceptions)) {
      assert.ok(
        named.includes(tool),
        `skills/${s.dir} exception for ${tool}, which it does not name`
      )
    }
  }
})

// A plugin-bundled server's tools are namespaced `mcp__plugin_<plugin>_<server>__<tool>`,
// so renaming a server silently invalidates every grant naming it. Nothing else notices:
// a grant that matches nothing is not an error, it just brings back the permission
// prompts its author believed were suppressed.
test("every Qlane grant is a real tool, granted the same on both servers", () => {
  for (const s of skills) {
    const qlane = [...grantsOf(s)].filter((g) => g.startsWith(`mcp__plugin_${SERVER_NAME}_`))
    for (const g of qlane) {
      const m = g.match(/^mcp__plugin_qlane_(qlane-eu|qlane-us)__([a-z_]+)$/)
      // The retired single-server namespace, `mcp__plugin_qlane_qlane__…`, fails here:
      // left behind it matches nothing, so it is invisible except that it does not work.
      assert.ok(m, `skills/${s.dir} grant ${g} is not in a regional namespace`)
      assert.ok(TOOLS.includes(m[2]), `skills/${s.dir} grants ${m[2]}, which is not a Qlane tool`)
      const other = m[1] === "qlane-eu" ? "qlane-us" : "qlane-eu"
      assert.ok(
        qlane.includes(grant(other, m[2])),
        `skills/${s.dir} grants ${m[2]} on ${m[1]} only`
      )
    }
  }
})
