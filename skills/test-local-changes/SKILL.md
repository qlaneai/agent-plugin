---
name: test-local-changes
description: Test uncommitted local changes before opening a pull request. Asks Qlane to plan what should be tested for the current diff, then exercises those cases against the running app — driving the browser, reading logs and checking data where available — and reports suspected bugs for the developer to triage. Use when the user has local edits and asks to test them, check for regressions, verify a change before pushing, or find what their change might have broken.
license: MIT
compatibility: Requires git and a Qlane account. Browser cases need browser-automation tooling in the session; without it those cases are reported as not checked rather than skipped silently.
allowed-tools: mcp__plugin_qlane_qlane__resolve_project mcp__plugin_qlane_qlane__list_projects mcp__plugin_qlane_qlane__create_test_plan mcp__plugin_qlane_qlane__get_test_plan Bash(git diff:*) Bash(git remote:*) Bash(git rev-parse:*) Bash(git status:*) Read Grep
---

# Test local changes

Qlane decides **what** to test for the diff in front of you. You decide **how** to check each case against the running app, and report what looks wrong. You never decide whether the change is good — the developer does.

## The one rule that matters

**Report findings, never a verdict.** Do not say "all tests passed" or "the change is safe". Say what you checked, what you observed, and what looks wrong. A developer triages the list; you produce it.

This matters because you are judging your own work. You performed the actions, then assess whether they succeeded — and your own account of what you did is exactly what makes that assessment unreliable. A list of concrete observations a human can dismiss in one read is worth more than a confident summary they have to trust.

---

## Step 1 — Find the project

```bash
git remote get-url origin
```

Call `resolve_project` with the repository identity. It returns 0, 1, or several matches and **never picks one for you**.

- **One match** — use it.
- **Several** — show the names and ask which one.
- **None** — the repository is not connected to Qlane. Fall back to `list_projects` and ask the user to choose, or tell them to connect the repository first. Do not guess.

## Step 2 — Collect the diff, and ask before spending

```bash
git diff HEAD          # uncommitted work, staged and unstaged
```

If that is empty, check `git status` — there may be untracked files the user meant to include, or nothing to test at all. Say which, rather than planning an empty diff.

**Planning costs the user credits. Ask before you call `create_test_plan`.** Show them what you are about to submit — the project name and a one-line summary of the diff (files touched, rough size) — and wait for a yes.

Send a **focused** diff rather than everything you can find. Only the beginning and end of a large diff reach the planner, so a diff spanning unrelated work produces a worse plan than one scoped to the change being tested. If the working tree mixes several concerns, say so and offer to plan just the relevant paths.

Pass `title` and `description` when you can summarise the intent — they are prompt context and improve the plan. `baseSha` is also prompt context only; it is never resolved against the repository, so send a real value or omit it.

## Step 3 — Submit, then poll

`create_test_plan` returns a handle immediately. **Do not assume the status is `queued`** — an identical diff submitted before may return an already-finished plan straight away.

Poll `get_test_plan` until the status is **`ready` or `failed`**. Both are terminal. Waiting only for `ready` will spin forever on a run that failed.

Pick a polling interval and tell the user what you chose — a few seconds between calls is reasonable, backing off as it runs. **Do not promise a duration.** You do not know how long a plan takes.

On **`failed`**: report it and stop. Do not resubmit the same diff — you may simply reattach to the same failed run.

## Step 4 — Read the outcome, not the case count

A ready plan carries an `outcome`. **Read it before you look at the cases**, because an empty case list means two opposite things:

| `outcome`             | what it means                               | what to do                                                 |
| --------------------- | ------------------------------------------- | ---------------------------------------------------------- |
| `cases-planned`       | there are cases to exercise                 | go to step 5                                               |
| `nothing-to-test`     | nothing in this diff is reachable by a test | say so — this is a real, healthy answer                    |
| `analysis-incomplete` | **Qlane could not work out what to test**   | say the change is **unverified**. This is not an all-clear |

Never report "nothing to test" on the strength of an empty list alone. `analysis-incomplete` also arrives with no cases, and it means the opposite.

Also read `degraded`. They answer different questions: _did the analysis finish?_ → `degraded`. _Is there anything to run?_ → `outcome`.

The plan carries more than cases. `coverageNotes` records what was and was not covered, and `reviewSignals` names things a human should look at that no case covers — security-sensitive changes, data-loss risk, irreversible migrations. **Always relay `reviewSignals`.** They are the parts no amount of browser driving will catch.

## Step 5 — Exercise the cases

Each case carries `verifyVia`, which tells you how it is meant to be checked:

- **`browser`** — drive the running app. You need the app running locally and browser tooling in this session. If you have neither, do not improvise: mark the case **not checked** and say what was missing.
- **`shell`** — run it from the command line.
- **`review-only`** — read the code. Do not attempt to execute it.

Ask the user for the app's URL before the first browser case; do not guess a port.

Work each case through its numbered steps, comparing what you see against the case's `expectedResult`. Use whatever else you have to establish what actually happened — application logs, a database query, the network tab. A finding backed by a log line is worth several backed by a screenshot.

**Never modify the application to make a case pass.** If the app is broken, that is the finding. Changing code, relaxing an assertion, seeding data that hides the failure, or picking a different path that avoids it are all ways of reporting a green that is not real. If a case cannot be exercised as written, mark it not checked and say why.

Stop and ask before anything destructive or irreversible — deleting data, sending mail, charging a card, or writing to anything that is not obviously a local development environment.

## Step 6 — Report

Give the developer three lists, in this order:

**Suspected bugs.** For each: what you did, what you expected, what actually happened, and the evidence — the log line, the response, the screenshot. Say how confident you are and why. These are candidates, not conclusions; the developer decides which are real.

**Not checked.** Every case you could not exercise, and what stopped you — no browser tooling, app not running, needed credentials, ambiguous steps. **This list must never be silently empty.** A case you could not run is not a case that passed, and collapsing the two is the single most damaging thing you can do here.

**Checked, nothing found.** Briefly. What you exercised and observed nothing wrong in.

Then relay `reviewSignals` as things to look at by hand, and close with `coverageNotes` gaps — areas the plan itself flagged as uncovered.

End there. Do not summarise into a judgement.

---

## When something goes wrong

- **A payment or subscription error** — read the message. Most say retrying will not help; when they do, relay the message and stop rather than calling again. One or two are genuinely transient and say so.
- **"This organization is hosted in a different region"** — the message names the host to reconnect at. Re-authenticating will not fix it; the connection has to point at that host. Tell the user which one.
- **A not-found error** — this can mean the thing does not exist, or belongs to another organization, or that you lack access to it. The responses are deliberately identical, so do not tell the user which; suggest they check the project in Qlane.
- **A plan you cannot read back** — the handle is the only way to reach a plan. There is no way to list previous plans.
