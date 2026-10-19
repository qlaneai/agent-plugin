# Qlane agent plugin

Installs [Qlane MCP](https://qlane.ai) into your AI coding editor, so your agent can reach
your Qlane projects, test targets and what Qlane found on your pull requests without leaving
the editor.

## Which region?

Qlane runs two independent regional stacks. The plugin registers **one server for each**, and
you connect the one hosting your organization:

| Server     | Endpoint                          |
| ---------- | --------------------------------- |
| `qlane-eu` | `https://mcp-eu.qlane.ai/api/mcp` |
| `qlane-us` | `https://mcp-us.qlane.ai/api/mcp` |

Authenticate that one and leave the other alone. An unconnected server contributes none of
its own tools — your editor shows it with two sign-in helpers and nothing else — so it costs
you nothing and is not an error state. If you connect the wrong one, every call returns
a 403 naming the correct host — nothing is lost, and the fix is to connect the other server.

Both are plain static URLs, so this works identically on every editor. Nothing is configured,
substituted, or typed.

## Install

Qlane MCP requires a Qlane account. Your editor prompts you to sign in the first time it calls
the server.

### Claude Code

```bash
claude plugin marketplace add qlaneai/agent-plugin
claude plugin install qlane@qlane-plugin
```

Then run `/mcp` and authenticate `qlane-eu` **or** `qlane-us` — whichever hosts your
organization. There is no configuration step and nothing to type.

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
there. Then install `qlane` and authenticate the server for your region.

Cursor also loads the plugin's `.cursor-plugin/plugin.json`, which gives the same two servers Qlane's
pre-registered Cursor client. So Cursor signs in as Qlane's verified Cursor client, and an
organization's default client policy admits it.

Connected a Qlane server with an earlier version of this plugin? After the update, Cursor
should ask you to authenticate the server again; do, and it signs in as the verified client. If
it keeps working without asking, sign out of the server in Cursor (or remove its stored
authentication) and authenticate again.

Cursor can also import this plugin from a Claude Code installation. An imported copy stays at
the version Claude Code has installed, and only a version that carries
`.cursor-plugin/plugin.json` signs in as the verified client, so update it there first:
`claude plugin update qlane@qlane-plugin`.

### Kiro

In Kiro, choose **Import power from GitHub** and enter the plugin folder's URL,
`https://github.com/qlaneai/agent-plugin/tree/main/plugins/qlane`. Kiro reads the folder's
`plugin.json`, the portable manifest, and loads the plugin without changes. Then authenticate the
server for your region.

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
claude mcp add --transport http --scope user qlane https://mcp-eu.qlane.ai/api/mcp
```

Swap the host for `mcp-us.qlane.ai` if your organization is US-hosted.

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

## License

[MIT](LICENSE).
