# Qlane agent plugin

Installs [Qlane MCP](https://qlane.ai) into your AI coding editor, so your agent can reach
your Qlane projects, test targets and what Qlane found on your pull requests without leaving
the editor.

## One server, every region

Qlane keeps each organization's data in one region, EU or US. The plugin registers **one
server** for both:

| Server  | Endpoint                   |
| ------- | -------------------------- |
| `qlane` | `https://mcp.qlane.ai/mcp` |

You sign in once and choose your organization. Each request then goes to the region that hosts
it. There is no region to pick.

Until you sign in, the server contributes none of its own tools: your editor shows it with two
sign-in helpers and nothing else. That is not an error state.

It is a plain static URL, so this works identically on every editor. Nothing is configured,
substituted, or typed.

### More than one organization

The server is connected to one organization at a time: the one you chose when you signed in. To
switch, sign out of qlane.ai, then authenticate `qlane` again and choose the other organization.
To stay connected to organizations in both regions at once, add the regional URLs directly,
`https://mcp-eu.qlane.ai/api/mcp` and `https://mcp-us.qlane.ai/api/mcp`. They keep working.

### Updating from an earlier version

Earlier versions registered two servers, `qlane-eu` and `qlane-us`. The update replaces them
with `qlane`, so you authenticate once more after updating.

If you had also added a regional URL by hand with `claude mcp add`, Claude Code now shows every
Qlane tool twice. Remove the server you added by hand. The earlier instructions named it `qlane`:

```bash
claude mcp logout qlane
claude mcp remove qlane
```

## Install

Qlane MCP requires a Qlane account. Your editor prompts you to sign in the first time it calls
the server.

### Claude Code

```bash
claude plugin marketplace add qlaneai/agent-plugin
claude plugin install qlane@qlane-plugin
```

Then run `/mcp` and authenticate `qlane`. There is no configuration step and nothing to type.

### VS Code and GitHub Copilot

Add this repo to `chat.plugins.marketplaces`:

```json
{
  "chat.plugins.marketplaces": ["qlaneai/agent-plugin"]
}
```

If nothing appears after adding it, check that `chat.plugins.enabled` is `true`.

### Cursor

In Cursor's **Import Marketplace** dialog, enter the full repository URL,
`https://github.com/qlaneai/agent-plugin` — Cursor rejects the `qlaneai/agent-plugin` shorthand
there. Then install `qlane` and authenticate the `qlane` server.

Cursor also loads the plugin's `.cursor-plugin/plugin.json`, which gives the same server Qlane's
pre-registered Cursor client. So Cursor signs in as Qlane's verified Cursor client, and an
organization's default client policy admits it.

Connected a Qlane server with an earlier version of this plugin? After the update, authenticate
the `qlane` server. It signs in as the verified client.

Cursor can also import this plugin from a Claude Code installation. An imported copy stays at
the version Claude Code has installed, and only a version that carries
`.cursor-plugin/plugin.json` signs in as the verified client, so update it there first:
`claude plugin update qlane@qlane-plugin`.

### Kiro

In Kiro, choose **Import power from GitHub** and enter the plugin folder's URL,
`https://github.com/qlaneai/agent-plugin/tree/main/plugins/qlane`. Kiro reads the folder's
`plugin.json`, the portable manifest, and loads the plugin without changes. Then authenticate the
`qlane` server.

### Codex

Codex splits this across two places: you register the marketplace on the CLI, but you install
from it in the ChatGPT desktop app. There is no CLI install command.

```bash
codex plugin marketplace add qlaneai/agent-plugin
```

Then open the **Plugins Directory** in the ChatGPT desktop app and install `qlane` from it.
Codex prompts you to sign in the first time it calls the server.

## Without the plugin

Any MCP client can point at the endpoint directly. For Claude Code:

```bash
claude mcp add --transport http --scope user qlane https://mcp.qlane.ai/mcp
```

The same URL serves every region.

## What it can do

Set up a test target for a repository, read your projects and test targets, and see what Qlane
found when it tested your pull requests: each run's verdicts, the defects it saw and the
evidence behind them. Three skills put that to work:

- **`/qlane:setup-env`** takes a repository to a test target whose configuration check passed.
  It finds the Qlane project the repository belongs to, or creates one, prepares the
  repository from Qlane's published setup pages
  ([docs.qlane.ai/connect](https://docs.qlane.ai/connect/overview)), creates the
  test target, and has you enter
  its variables and test credentials on a Qlane page — they never pass through the editor. It
  asks before every change to your repository or to Qlane's configuration.
- **`/qlane:bugs`** shows what Qlane found on a pull request or a recent run — defects, failing
  and blocked cases, the steps to reproduce them and their evidence — then looks for the likely
  cause in your repository and proposes a fix. It only reads from Qlane, and it changes your
  code only when you say yes.
- **`/qlane:test-local-changes`** asks Qlane to plan tests for a local diff before a pull
  request exists, then exercises them against your running app.

## What it sends, and where

The plugin runs no code of its own: it has no hooks and no local servers. Everything below is
done by Claude, following the skills, in your session.

- **Qlane's server**, `mcp.qlane.ai`. It checks your sign-in and passes each request on to the
  region that hosts your organization, `mcp-eu.qlane.ai` or `mcp-us.qlane.ai`. Requests to Qlane
  pass through Cloudflare's global network on their way to your region, which can include
  locations outside it. Their content is not stored there. The skills send your repository's
  remote URL to find its Qlane project, and the identifiers of the projects, test targets, runs
  and pull requests they read. `/qlane:setup-env` sends a test target's configuration when it
  creates or changes one, including the repository's name and the branch the test target uses.
  `/qlane:test-local-changes` sends your local diff, with a short title and description, for
  Qlane to plan tests from. Variable values and test-credential passwords never pass through
  the plugin: you enter them on a Qlane page.
- **GitHub, through your own GitHub CLI.** If `gh` is installed, `/qlane:bugs` runs
  `gh pr view` to find the pull request for your current branch, with your own GitHub sign-in.
  Without it, the skill asks you for the pull request number.
- **docs.qlane.ai.** `/qlane:setup-env` downloads up to three public setup pages with `curl`.
  It sends nothing to them.
- **Your own git remote.** `/qlane:setup-env` commits the files it prepared and pushes them to
  the branch your test target uses, with your own git access, and only after you say yes.
- **Your local Docker.** `/qlane:setup-env` checks your Compose file with `docker compose config`
  and may start your app's main service to confirm it boots. Docker can then pull images from the
  registries your Compose file names.
- **Your running app.** `/qlane:test-local-changes` drives your locally running app in a browser,
  at the address you give it, when your session has browser tooling.

Everything else the skills read, such as `git log`, `git diff` and your files, stays in your
session.

## License

[MIT](LICENSE).
