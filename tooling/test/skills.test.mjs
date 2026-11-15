import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"

// Every skill under plugins/qlane/skills/, read from disk rather than listed, so a skill added
// later is checked by every test here without anyone remembering to register it.
const SKILLS_DIR = new URL("../../plugins/qlane/skills/", import.meta.url)
const skills = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => {
    const text = readFileSync(new URL(`${d.name}/SKILL.md`, SKILLS_DIR), "utf8")
    const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
    assert.ok(
      match,
      `plugins/qlane/skills/${d.name}/SKILL.md must open with a --- frontmatter block`
    )
    const frontmatter = Object.fromEntries(
      match[1].split("\n").map((line) => {
        const at = line.indexOf(":")
        return [line.slice(0, at).trim(), line.slice(at + 1).trim()]
      })
    )
    return { dir: d.name, text, frontmatter, body: match[2] }
  })

const SERVER_NAME = "qlane"
// The plugin's one server. Its tools are namespaced `mcp__plugin_<plugin>_<server>__<tool>`,
// so this name is half of every grant below.
const SERVER = "qlane"
// The two regional servers the plugin registered before it had one. No skill may still
// name either: a grant on one matches nothing, and advice naming one sends the user to a
// server that is no longer installed.
const RETIRED_SERVERS = ["qlane-eu", "qlane-us"]

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

// Tools a skill names on purpose without granting them, each with why. Two reasons
// recur. Naming a tool in a "never call" rule is how a skill forbids it, and a grant
// there would pre-approve exactly the call the rule forbids. And a skill that does
// call a tool that writes leaves it ungranted so the editor's own permission
// prompt confirms each call a second time, beside the skill's own ask. A tool that
// only runs work, such as a configuration check or a test plan, is granted.
const NAMED_NOT_GRANTED = {
  "setup-env": {
    create_project:
      "writes: the editor's prompt confirms it, after the user said no project is theirs",
    create_environment: "writes: the editor's prompt confirms each test target created",
    update_environment:
      "writes: switching a trigger on changes which pull requests start a test run, and linking a repository can register it on a GitLab connection",
  },
  bugs: {
    create_test_plan: "forbidden: the skill is read-only",
    start_boot_check: "forbidden: the skill is read-only",
    update_environment: "forbidden: it changes a test target; named in a blocked case's remedy",
    request_environment_variables: "forbidden: named in a blocked case's remedy only",
    request_test_credentials: "forbidden: named in a blocked case's remedy only",
    create_project: "forbidden: the skill is read-only",
    create_environment: "forbidden: the skill is read-only",
    update_project: "forbidden: the skill is read-only; named in a blocked case's remedy",
    get_environment: "named in a blocked case's remedy only; the skill reads no test target",
  },
}

/** The shared connection step: from its heading to the next `## ` heading. */
const connectionStep = (body) => stepOf(body, 0)

/** A step's text on one line: the step is hard-wrapped, and a pin must not depend on where. */
const flat = (text) => text.replace(/\s+/g, " ")

/** The shared entry for a `403` in a skill's "When something goes wrong" list, as one line. */
const refusalEntry = (skill) => {
  const section = skill.body.split("## When something goes wrong")[1] ?? ""
  const entries = section.split("\n").filter((line) => line.startsWith("- **A `403`"))
  assert.equal(
    entries.length,
    1,
    `plugins/qlane/skills/${skill.dir} must have one \`403\` entry under "When something goes wrong"`
  )
  return entries[0]
}

const grantsOf = (skill) => new Set((skill.frontmatter["allowed-tools"] ?? "").split(/\s+/))
const grant = (tool) => `mcp__plugin_${SERVER_NAME}_${SERVER}__${tool}`

test("finds the skills it checks", () => {
  // Every other test here loops over `skills`, so an empty list would pass them all.
  assert.ok(skills.length >= 2, `expected at least two skills, found ${skills.length}`)
  // An exception list keyed on a skill that does not exist checks nothing.
  for (const dir of Object.keys(NAMED_NOT_GRANTED)) {
    assert.ok(
      skills.some((s) => s.dir === dir),
      `NAMED_NOT_GRANTED names no skill called ${dir}`
    )
  }
})

test("every skill's frontmatter names it after its directory and describes it", () => {
  for (const s of skills) {
    assert.equal(s.frontmatter.name, s.dir, `plugins/qlane/skills/${s.dir} name`)
    const description = s.frontmatter.description ?? ""
    assert.ok(description.length > 0, `plugins/qlane/skills/${s.dir} must have a description`)
    // The agent-skills limit; a longer one is cut where an editor shows it.
    assert.ok(
      description.length <= 1024,
      `plugins/qlane/skills/${s.dir} description is ${description.length}`
    )
  }
})

test("every skill carries the connection step word for word", () => {
  // A skill cannot include another's text, so the step is copied, and copies drift.
  // The step decides what a skill does before its first call; a skill whose copy
  // drifted would treat an unconnected server differently from the other skills.
  const [first, ...rest] = skills
  const reference = connectionStep(first.body)
  for (const s of rest) {
    assert.equal(
      connectionStep(s.body),
      reference,
      `plugins/qlane/skills/${s.dir} connection step differs from ${first.dir}'s`
    )
  }
})

// Everyone who updates the plugin meets the not-connected branch once, because the
// server's name and URL changed, so it is pinned and not only compared: three copies that
// all lost it would still agree with each other.
test("the connection step sends an unconnected user to authenticate `qlane`", () => {
  for (const s of skills) {
    const step = flat(connectionStep(s.body))
    const at = `plugins/qlane/skills/${s.dir} step 0`
    assert.match(step, /The plugin registers one server, `qlane`/, at)
    // How a skill tells: an unconnected server shows only the client's two sign-in helpers.
    assert.match(step, /exposes only `authenticate` and `complete_authentication`/, at)
    assert.match(step, /\*\*Not connected\.\*\*/, at)
    assert.match(step, /run `\/mcp` and authenticate `qlane`/, at)
    assert.match(step, /a one-time step you cannot perform for them/, at)
  }
})

// One URL means one sign-in, so one organization at a time. A person in several has no
// second server to notice the difference on, and the skill is what tells them.
test("the connection step says which organization is connected, when the user is in several", () => {
  for (const s of skills) {
    const step = flat(connectionStep(s.body))
    const at = `plugins/qlane/skills/${s.dir} step 0`
    assert.match(step, /\*\*Which organization\.\*\*/, at)
    assert.match(step, /one organization at a time/, at)
    assert.match(step, /say which organization is connected/, at)
  }
})

test("every tool a skill names is granted, unless it is named to forbid it", () => {
  for (const s of skills) {
    const grants = grantsOf(s)
    const exceptions = NAMED_NOT_GRANTED[s.dir] ?? {}
    // The connection step names tools only to say what a connected server looks like.
    const body = s.body.replace(connectionStep(s.body), "")
    const named = TOOLS.filter((t) => new RegExp(`\\b${t}\\b`).test(body))
    assert.ok(named.length > 0, `plugins/qlane/skills/${s.dir} names no Qlane tool`)
    for (const tool of named) {
      const g = grant(tool)
      if (tool in exceptions) {
        assert.ok(
          !grants.has(g),
          `plugins/qlane/skills/${s.dir} grants ${g}, which it names only to forbid`
        )
      } else {
        assert.ok(grants.has(g), `plugins/qlane/skills/${s.dir} is missing grant ${g}`)
      }
    }
    // An exception for a tool the skill no longer names would silence nothing.
    for (const tool of Object.keys(exceptions)) {
      assert.ok(
        named.includes(tool),
        `plugins/qlane/skills/${s.dir} exception for ${tool}, which it does not name`
      )
    }
  }
})

// A plugin-bundled server's tools are namespaced `mcp__plugin_<plugin>_<server>__<tool>`,
// so renaming a server silently invalidates every grant naming it. Nothing else notices:
// a grant that matches nothing is not an error, it just brings back the permission
// prompts its author believed were suppressed.
test("every Qlane grant is a real tool, in the one server's namespace", () => {
  for (const s of skills) {
    const qlane = [...grantsOf(s)].filter((g) => g.startsWith(`mcp__plugin_${SERVER_NAME}_`))
    // Without this, a skill whose grants were all deleted would pass the loop below.
    assert.ok(qlane.length > 0, `plugins/qlane/skills/${s.dir} grants no Qlane tool`)
    for (const g of qlane) {
      const m = g.match(/^mcp__plugin_qlane_qlane__([a-z_]+)$/)
      // The retired regional namespaces, `mcp__plugin_qlane_qlane-eu__…` and
      // `mcp__plugin_qlane_qlane-us__…`, fail here: left behind they match nothing, so
      // they are invisible except that they do not work.
      assert.ok(m, `plugins/qlane/skills/${s.dir} grant ${g} is not in the server's namespace`)
      assert.ok(
        TOOLS.includes(m[1]),
        `plugins/qlane/skills/${s.dir} grants ${m[1]}, which is not a Qlane tool`
      )
    }
  }
})

test("no skill names a retired regional server", () => {
  // Read over the whole file, frontmatter included: a grant, a step and a line of error
  // advice are three places one of these names used to stand.
  for (const s of skills) {
    for (const server of RETIRED_SERVERS) {
      assert.ok(!s.text.includes(server), `plugins/qlane/skills/${s.dir} still names ${server}`)
    }
  }
})

// Through the one URL a wrong region cannot happen, so the old "switch to the other
// server" advice has nothing to switch to. What can still come back is a `403` whose
// message says where to go next, and which signing in again does not fix: an agent that
// re-authenticates on it loops.
test("every skill tells the agent to relay a `403` that re-authenticating cannot fix", () => {
  const [first, ...rest] = skills
  const reference = refusalEntry(first)
  assert.match(reference, /^- \*\*A `403` that names the Qlane dashboard/)
  assert.match(reference, /re-authenticating will not fix it/)
  assert.match(reference, /Relay the message word for word and stop/)
  for (const s of rest) {
    assert.equal(
      refusalEntry(s),
      reference,
      `plugins/qlane/skills/${s.dir} \`403\` entry differs from ${first.dir}'s`
    )
  }
  for (const s of skills) {
    assert.ok(
      !/hosted in a different region/.test(s.body),
      `plugins/qlane/skills/${s.dir} still carries the wrong-region advice`
    )
  }
})

// One numbered step of a skill, from its heading to the next one, so a pin reads the
// step it is about and cannot be satisfied by the same words in another step.
function stepOf(body, n) {
  const start = body.indexOf(`## Step ${n} —`)
  assert.ok(start >= 0, `a skill must carry step ${n}`)
  const end = body.indexOf("\n## ", start + 1)
  return body.slice(start, end === -1 ? undefined : end)
}

// A stored test credential whose username is the account's NAME, where the sign-in form
// takes the email the seed created, signs in nowhere: every case that needs it is blocked,
// and the configuration check cannot see it. The skill closes that in two places, and each
// is pinned in the step it belongs to.
test("setup-env establishes the sign-in identifier, and tells the developer what to enter", () => {
  const setup = skills.find((s) => s.dir === "setup-env")
  assert.ok(setup, "the setup-env skill exists")
  const step4 = stepOf(setup.body, 4)
  assert.match(step4, /establish what the sign-in form takes as the account's identifier/)
  assert.match(step4, /record the exact value it creates for that field/)
  assert.match(step4, /For an account that already exists, record which kind of identifier/)
  assert.match(step4, /A credential's name is only a label, never the identifier\./)
  const step6 = stepOf(setup.body, 6)
  assert.match(step6, /tell the developer exactly what to enter as each account's username/)
  // Asked, not waited for: Qlane never shows a stored username back, so a wrong one is
  // caught here or by the first run that tries to sign in.
  assert.match(step6, /ask which username they entered/)
  assert.match(step6, /tell them it will not sign in/)
})

// On a sandbox target the tester signs itself up through its own inbox and setup creates
// the state a case needs, so a stored account or a seed is the exception step 4 has to
// justify, not the default. An agent that reads it the other way writes seed scripts for an
// app that needed none, or calls a target with no credentials untestable.
test("setup-env makes signing up and setup the default, and stored accounts the exception", () => {
  const setup = skills.find((s) => s.dir === "setup-env")
  assert.ok(setup, "the setup-env skill exists")
  const step4 = stepOf(setup.body, 4)
  assert.match(step4, /most applications need neither a stored test account nor a seed/)
  assert.match(step4, /an empty `testCredentials` list in `get_environment` is not a problem/)
  assert.match(step4, /check the application rather than assume: does it have self sign-up/)
  // The default is a check, so the conditions it checks for are pinned with it.
  assert.match(step4, /Plan a stored account only where the answer is no/)
  assert.match(
    step4,
    /invite-only, created by an administrator or signed in through single sign-on/
  )
  assert.match(step4, /a role or a plan that a new sign-up does not get/)
  assert.match(step4, /the variables it sends mail with belong with those it needs to start/)
  assert.match(step4, /Plan a seed only for state the application's pages cannot create/)
  assert.match(step4, /they must point at a real sender: a mail catcher/)
  assert.match(step4, /except the mail that signing up depends on, which needs real settings/)
  assert.match(step4, /point its variables at a test or staging instance, never production/)
  assert.match(step4, /A `SimpleSandbox` target has no step that runs once the application is up/)
  // A URL target is the exception: nothing is set up and its sign-ups persist, so every
  // account its tests sign in with is a stored one, and 0.6.2's identifier check covers it.
  assert.match(step4, /A `URL` target has no setup/)
  assert.match(step4, /plan a stored account for each account the tests sign in with/)
  assert.match(step4, /for every stored account you plan on any kind of target, establish/)
  const step6 = stepOf(setup.body, 6)
  assert.match(step6, /Call `request_test_credentials` only for the stored accounts step 4 planned/)
  assert.match(step6, /If step 4 planned none, skip it: on a `SimpleSandbox` or `Compose` target/)
  const step9 = stepOf(setup.body, 9)
  assert.match(step9, /ask whether a tester can get an account and the state a case needs/)
  assert.match(step9, /no tool here reads it: ask the developer to confirm it is on/)
  assert.match(step9, /On a `URL` target nothing is set up before testing/)
  assert.match(step9, /each account the tests sign in with needs a test credential through step 6/)
})

// A URL target runs no code of its own, so chat reads the application's code only through
// the repositories linked to it, at the branch the deployed site is built from. A skill that
// never asks leaves chat reading nothing, or reading each repository's default branch while
// the deployment runs another. Pinned in step 5, where a URL target is created or finished,
// and in step 8, where the skill lists what update_environment can change.
test("setup-env asks a URL target's linked repositories and deployed-from branch", () => {
  const setup = skills.find((s) => s.dir === "setup-env")
  assert.ok(setup, "the setup-env skill exists")
  const step5 = stepOf(setup.body, 5)
  assert.match(step5, /put the answers in `target` as `agentLinkedRepos` and `deployedFromBranch`/)
  assert.match(step5, /Which repositories, as owner\/name, Qlane's agent may read the code of/)
  assert.match(step5, /Which branch the deployed site is built from/)
  assert.match(step5, /leaving it empty reads each repository's default branch/)
  assert.match(step5, /one that is not refuses the whole call, and no test target is created/)
  assert.match(step5, /On a GitLab connection, repositories checked before a refusal may/)
  assert.match(step5, /A null `repositories` stops only the linking/)
  assert.match(step5, /If there is no owner\/name to link/)
  // The pre-flight refuses the whole create, so an unlisted repository is the developer's
  // call before the create is sent, never a refusal found afterwards.
  assert.match(step5, /fetch the next `page` while `hasMore` is true/)
  assert.match(step5, /ask the developer whether to leave it out, and never send a create/)
  assert.match(step5, /On GitLab an absent entry proves nothing/)
  // A reading, not a read: and a check repeated by creating again makes a second target.
  assert.match(
    step5,
    /It is a reading of what Qlane's chat would read now, not a read that happened/
  )
  assert.match(step5, /To check again, never create the test target again/)
  // Sending the list again would check, and on GitLab register, every repository again.
  assert.match(step5, /set the same `deployedFromBranch`, and only that field/)
  assert.match(step5, /one the connection can't reach refuses the whole update/)
  assert.match(step5, /If it names `environment`, call `get_environment`/)
  assert.match(
    step5,
    /call `update_environment` with the `environmentId` and its `linkedRepositories`/
  )
  assert.match(step5, /`deployedFromBranch` sets the branch, and `null` clears it/)
  // A dropped link is unregistered on the customer's GitLab when no other test target still
  // references it, a side effect on their own system that the developer hears before the yes.
  assert.match(
    step5,
    /On a GitLab connection, when a repository is dropped from the list, or cleared with `\[\]`, Qlane also tries to unregister it from that connection/
  )
  assert.match(
    step5,
    /unless another test target in a project on that connection still references it; say so when you say what you will change\./
  )
  // "Chat" alone reads as the editor's own chat; the first use names Qlane's.
  assert.match(
    step5,
    /Qlane's chat, in the Qlane app, reads the linked repositories at that branch/
  )
  const step8 = stepOf(setup.body, 8)
  assert.match(
    step8,
    /`linkedRepositories`: `agentLinkedRepos` and, on a `URL` target only, `deployedFromBranch`/
  )
  assert.match(step8, /names `deployedFromBranch` on any other kind is refused whole/)
  assert.match(step8, /no configuration check reads linked repositories/)
})

// Step 1 decides whether to fix an existing test target or create another. A URL target
// names a repository only through agentLinkedRepos, never through pullRequestRepoFullNames,
// and one that links none names no repository at all, so neither resolve_project nor a
// check of pullRequestRepoFullNames finds it. Without these rules, step 5's path for an
// existing URL target is reached only by guessing (CodeRabbit's review of #18).
test("setup-env step 1 finds an existing URL target before offering another", () => {
  const setup = skills.find((s) => s.dir === "setup-env")
  assert.ok(setup, "the setup-env skill exists")
  const step1 = stepOf(setup.body, 1)
  assert.match(
    step1,
    /its `pullRequestRepoFullNames` lists this repository, or, on a `URL` target, its `agentLinkedRepos` does/
  )
  // On any other kind a linked repository is one the agent may read, never one whose pull
  // requests reach the target, so counting it as coverage would recommend pull-request
  // testing on a target that repository never triggers (review of 48e2c687).
  assert.match(step1, /On any other kind, a repository in `agentLinkedRepos` is one/)
  // list_environments returns 50 by default, so "every URL test target" needs the maximum.
  assert.match(step1, /`list_environments` with `limit` 100/)
  assert.match(step1, /Show the developer every `URL` test target in the project by its `baseUrl`/)
  assert.match(step1, /ask whether one of them is this application's deployed site/)
  assert.match(step1, /before you offer to create another/)
})

// Anthropic's directory asks whether any skill sends data to a service other than the
// declared connectors, and its security scan fails a version that contacts somewhere the
// README does not disclose. So every outside service a skill reaches is named in the
// plugin README's "What it sends, and where" section: each host a skill names, in its
// granted commands or in its instructions, and GitHub whenever a skill may run the GitHub
// CLI. Derived from the skills, so a skill that gains a new destination fails here until
// the README says so.
test("the plugin README discloses every outside service a skill reaches", () => {
  const readme = readFileSync(new URL("../../plugins/qlane/README.md", import.meta.url), "utf8")
  const section = readme.split("## What it sends, and where")[1]?.split("\n## ")[0]
  assert.ok(section, "plugins/qlane/README.md must have a 'What it sends, and where' section")
  const granted = skills.map((s) => s.frontmatter["allowed-tools"] ?? "").join(" ")
  const named = [granted, ...skills.map((s) => s.body)].join("\n")
  const hosts = new Set([...named.matchAll(/https?:\/\/([^/\s)`"<>]+)/g)].map((m) => m[1]))
  assert.ok(hosts.size > 0, "expected at least one named host (docs.qlane.ai)")
  for (const host of hosts) assert.ok(section.includes(host), `README does not disclose ${host}`)
  if (/Bash\(gh /.test(granted)) {
    assert.ok(section.includes("GitHub CLI"), "a skill may run gh; README must disclose GitHub")
  }
})

// Run outside the application's repository, the skill has nothing to inspect and a URL
// target is the only kind it can propose, so the developer ends up with no code plan and
// no pull-request testing without having chosen that (qlaneai/poc#5145). Step 1 reads the
// remotes and stops the repository path only on a signal that has one cause, or with a
// remedy that holds for every cause; a check that cannot run never stops it. Each rule is
// pinned inside its own bullet, so a rule moved to, or swapped with, another bullet fails.
const bulletOf = (text, lead) => {
  const start = text.indexOf(`- **${lead}`)
  assert.ok(start >= 0, `step 1 has the bullet "${lead}"`)
  const end = text.indexOf("\n", start)
  return text.slice(start, end === -1 ? undefined : end)
}

test("setup-env stops outside the application's repository, and offers a URL target as a choice", () => {
  const setup = skills.find((s) => s.dir === "setup-env")
  assert.ok(setup, "the setup-env skill exists")
  const step1 = stepOf(setup.body, 1)
  // The approved copy, word for word: each is what the developer reads, in its own bullet.
  const NOT_A_REPOSITORY =
    "\"This folder isn't the application's repository, so I can't set up a code-based test target from here. Open your editor in the application's repository folder and run /qlane:setup-env again.\""
  const NO_REMOTE =
    '"This repository has no remote on GitHub or GitLab, so Qlane can\'t reach its code. Push it to GitHub or GitLab, then run /qlane:setup-env again."'
  const NOT_VISIBLE =
    "\"I couldn't find <owner/name> among the repositories Qlane's GitHub App can see. If that is the application's repository and it belongs to the account or organization the App is installed on, someone who manages the App's installation on GitHub, usually an owner, can give it access there; a Qlane admin can open that page from Connections, in the GitHub card's menu, with Manage on GitHub. Otherwise, open your editor in the application's repository, then run /qlane:setup-env again.\""
  // TODO(qlaneai/poc#5898): "its QA baseline explores without a code plan" holds only while
  // the baseline answers no-repository for a URL target. The PR that lands #5898 (the
  // baseline reads a URL target's linked repositories) rewrites this sentence and this pin.
  const URL_TRADE_OFF =
    '"A URL test target tests one running deployment. Qlane reads code only from the repositories you link to the target, and its QA baseline explores without a code plan; it can\'t test pull requests; and the data the tests need must already exist in that deployment, and so must its test accounts unless you let Qlane sign up its own there."'

  // (1) The remotes: names only, and each case its own bullet with its own outcome.
  assert.match(step1, /```bash\ngit remote\n```/)
  assert.doesNotMatch(step1, /git remote -v|git remote get-url origin/)
  const notRepo = bulletOf(step1, "It fails, and git says `not a git repository`**")
  assert.ok(notRepo.includes(NOT_A_REPOSITORY), "not a repository says its own message")
  assert.match(notRepo, /Then offer a URL test target/)
  const otherFailure = bulletOf(step1, "It fails any other way**")
  assert.match(otherFailure, /relay git's message as it is and stop/)
  assert.match(otherFailure, /does not mean the folder is the wrong one/)
  assert.doesNotMatch(otherFailure, /isn't the application's repository|offer a URL/)
  const noRemote = bulletOf(step1, "It prints nothing**")
  assert.ok(noRemote.includes(NO_REMOTE), "no remote says its own message")
  assert.match(noRemote, /Then offer a URL test target/)
  assert.match(bulletOf(step1, "It lists `origin`**"), /— use `origin`\.$/)
  const otherRemotes = bulletOf(step1, "It lists other remotes but no `origin`**")
  assert.match(otherRemotes, /ask the developer which one is the application's repository/)
  assert.match(otherRemotes, /If none of them is, stop the repository path as for a folder/)
  // Without a remote there is nothing to resolve and no provider to read.
  assert.match(step1, /skip `resolve_project` \(there is no remote to resolve\)/)
  assert.match(step1, /if they then create one, leave out `sourceControl`/)
  assert.match(step1, /Call `resolve_project` with that `owner\/name`\./)

  // (2) The source-visibility check: queried by name, matched exactly, by name not host.
  assert.match(step1, /and if the remote step succeeded, check that/)
  assert.match(step1, /the repository's name \(the last part of `owner\/name`\) as `query`/)
  assert.match(step1, /and page while `hasMore`/)
  assert.match(step1, /an entry whose `fullName` matches `owner\/name` exactly, ignoring case/)
  assert.match(step1, /Compare names only, never hosts:/)
  assert.match(step1, /these rules take precedence over "When something goes wrong" below:/)
  const rules = step1.slice(step1.indexOf("these rules take precedence"))
  const nullList = bulletOf(rules, "`repositories` is null**")
  assert.match(nullList, /— relay `source\.message`, then offer a URL test target/)
  assert.match(nullList, /Do not create a code-based test target until the connection is fixed/)
  const refused = bulletOf(rules, "The call is refused, for any reason, or errors**")
  assert.match(refused, /— say nothing about it and carry on; this check never stops setup/)
  // `gitlab`, not "not github": an unavailable source reports sourceControl null together
  // with a null list, and the null-list rule must win there.
  const gitlab = bulletOf(rules, "`source.sourceControl` is `gitlab`**")
  assert.match(gitlab, /— carry on without the comparison below/)
  assert.doesNotMatch(step1, /is not `github`/)
  const notVisible = bulletOf(rules, "You read the whole list and this repository is not in it**")
  assert.ok(notVisible.includes(NOT_VISIBLE), "not visible says its own message")
  assert.match(notVisible, /first ask whether one of them is the application's repository/)
  assert.match(notVisible, /\." Then offer a URL test target, as below\.$/)
  // The GitLab rule comes before the not-visible stop it exempts GitLab from.
  assert.ok(rules.indexOf(gitlab) < rules.indexOf(notVisible), "the GitLab rule comes first")

  // (3) The URL target: the alternative, never the first offer; declining it stops.
  const urlOffer = step1.slice(step1.indexOf("**Testing a deployed URL instead.**"))
  assert.ok(urlOffer.includes(URL_TRADE_OFF), "the trade-off sentence, word for word")
  assert.match(
    urlOffer,
    /^\*\*Testing a deployed URL instead\.\*\* Offer this when the check above or the remote step stopped the repository path, or when the developer asks for it\./
  )
  assert.match(
    urlOffer,
    /Create one only if they choose it, with kind `URL` from step 2\. If they decline, stop/
  )
  assert.doesNotMatch(step1, /credit/i)
})

// A remote URL can carry a password or a token before `@` (https://user:token@host/…).
// Step 1 reads it through the skill's own command, which must strip that part before the
// agent sees it, so it never reaches the transcript or a Qlane tool. The command is run
// here, on a credential-shaped value built at runtime so no secret scanner reads one.
test("setup-env reads a remote URL with its credential stripped", async () => {
  const { execFileSync } = await import("node:child_process")
  const setup = skills.find((s) => s.dir === "setup-env")
  assert.ok(setup, "the setup-env skill exists")
  const step1 = stepOf(setup.body, 1)
  const command = step1.match(/```bash\ngit remote get-url <remote> \| (sed .*)\n```/)?.[1]
  assert.ok(command, "step 1 reads the URL through a stripping command")
  assert.match(
    step1,
    /\*\*Never send or repeat anything before `@` in an `https:\/\/` remote URL\*\*/
  )
  // A denied prompt or a shell without sed must not fall back to the bare command, which
  // `Bash(git remote:*)` pre-approves and which prints the credential.
  assert.match(
    step1,
    /If that command can't run, don't run `git remote get-url` on its own; ask the developer for owner\/name\./
  )
  const secret = ["tok", "en"].join("") + "_" + "x".repeat(24)
  const strip = (url) =>
    execFileSync("sh", ["-c", `printf '%s\\n' "$URL" | ${command}`], {
      env: { ...process.env, URL: url },
    })
      .toString()
      .trim()
  // owner/name, read as step 1 says: from the SSH (scp, `user@host:owner/name`) or the URL
  // form, without a trailing `.git`. In the scp form `git@` is a user, not a secret, and
  // the strip leaves it; in a URL form the strip removes whatever precedes `@`.
  const ownerName = (url) =>
    (url.includes("://")
      ? url.replace(/^[^:]+:\/\/[^/]+\//, "")
      : url.replace(/^[^:]+:/, "")
    ).replace(/\.git$/, "")
  const cases = [
    [`https://someone:${secret}@github.com/acme/app.git`, "https://github.com/acme/app.git"],
    [
      `https://${secret}@gitlab.example.com/group/app.git`,
      "https://gitlab.example.com/group/app.git",
    ],
    ["https://github.com/acme/app.git", "https://github.com/acme/app.git"],
    ["ssh://git@github.com/acme/app.git", "ssh://github.com/acme/app.git"],
    ["git@github.com:acme/app.git", "git@github.com:acme/app.git"],
    ["deploy@gitlab.example.com:acme/app", "deploy@gitlab.example.com:acme/app"],
    // An `@` inside the credential: the strip runs to the last `@` before the path.
    [`https://someone:p@${secret}@github.com/acme/app.git`, "https://github.com/acme/app.git"],
    // A scheme in capitals.
    [`HTTPS://someone:${secret}@github.com/acme/app.git`, "HTTPS://github.com/acme/app.git"],
  ]
  for (const [url, expected] of cases) {
    const out = strip(url)
    assert.equal(out, expected)
    assert.ok(!out.includes(secret), "no credential survives")
    assert.equal(
      ownerName(out),
      url.includes("gitlab.example.com/group") ? "group/app" : "acme/app"
    )
  }
})
