# Qlane agent plugin

Installs [Qlane MCP](https://qlane.ai) into your AI coding editor, so your agent can reach
your Qlane projects, test targets and test-case counts without leaving the editor.

## Which region?

Qlane runs two independent regional stacks, `mcp-eu.qlane.ai` and `mcp-us.qlane.ai`. Your
editor must connect to the one hosting your organization. Connect to the wrong one and every
call returns a 403 naming the correct host — nothing is lost, but nothing works either.

Only Claude Code's plugin format can ask you which region you want. Every other editor reads
this plugin's portable manifest, which is pinned to the EU host:

| Editor                                       | Region this plugin connects to                        |
| -------------------------------------------- | ----------------------------------------------------- |
| Claude Code                                  | **Either** — you are prompted for the host at install |
| VS Code, GitHub Copilot, Cursor, Codex, Kiro | **EU only** (`mcp-eu.qlane.ai`)                       |

**US-hosted organizations on any editor except Claude Code**: open the **Editor** page in your
Qlane dashboard. It always renders a region-correct install for your organization, whichever
editor you use.

## Install

Qlane MCP requires a Qlane account. Whichever editor you use, it prompts you to sign in the
first time the server is called.

### Claude Code

```bash
claude plugin marketplace add qlaneai/agent-plugin
claude plugin install qlane@qlane
```

You are prompted for your region host. To skip the prompt — useful in a dotfiles script or a
devcontainer — pass it directly:

```bash
claude plugin install qlane@qlane --config region_host=mcp-eu.qlane.ai
```

### VS Code and GitHub Copilot

Add this repo to `chat.plugins.marketplaces`:

```json
{
  "chat.plugins.marketplaces": ["qlaneai/agent-plugin"]
}
```

### Cursor

Open the **Editor** page in your Qlane dashboard and use the one-click install. It builds a
region-correct link for your organization, which is what you want here — Cursor reads the
EU-pinned manifest otherwise.

### Codex

Codex splits this across two places: you register the marketplace on the CLI, but you install
from it in the ChatGPT desktop app. There is no CLI install command.

```bash
codex plugin marketplace add qlaneai/agent-plugin
```

Then open the **Plugins Directory** in the ChatGPT desktop app and install `qlane` from it.
Once it is installed, authenticate the server:

```bash
codex mcp login qlane
```

Sign-in is a separate step on purpose: installing the plugin registers the server but does not
authenticate it.

## Opening this repository in Claude Code

You will see a `qlane` server listed as **Pending approval**, with
`${user_config.region_host}` sitting unresolved in its URL. That is expected and harmless, and
it is not specific to any one editor feature — Claude Code reads a `.mcp.json` at a repository
root as _project-scoped_ MCP configuration, so this repo's `.mcp.json` is the plugin's own
manifest being read as if it were yours. The placeholder is only substituted when the file is
loaded **as a plugin**, which is not what opening the directory does. Decline it, and install
the plugin with the commands above instead.

## Without the plugin

Any MCP client can point at the endpoint directly. For Claude Code:

```bash
claude mcp add --transport http --scope user qlane https://mcp-eu.qlane.ai/api/mcp
```

Swap the host for `mcp-us.qlane.ai` if your organization is US-hosted.

## What it can do

Read your projects, test targets and test-case counts, and plan tests for a local diff before
a pull request exists. Planning a test consumes Qlane credits.

## Development

```bash
npm ci
npm run check
```

`check` runs Prettier, markdownlint, JSON Schema validation of the portable manifests, and the
unit tests. It makes no network calls, so it works offline and in a sandboxed CI runner.

```bash
npm run format      # apply Prettier
npm run lint:md:fix # apply markdownlint's safe fixes
```

Two checks need the Claude Code CLI and so are not part of `check`, which has to run on a
runner that does not have it:

```bash
claude plugin validate --strict .   # manifest shapes; --strict makes warnings fatal
claude plugin tag --dry-run         # what the next release tag would be
```

The version lives in `plugin.json` only. The marketplace entry deliberately declares no
`version` of its own: `plugin.json` wins at install time, so a second copy could only ever
agree or be silently ignored.

## License

[MIT](LICENSE).
