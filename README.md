# Qlane agent plugin

Installs [Qlane MCP](https://qlane.ai) into your AI coding editor, so your agent can reach
your Qlane projects, test targets and coverage without leaving the editor.

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
editor you use. VS Code and GitHub Copilot can alternatively install either region from the
MCP Registry.

## Install

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

Agent plugins are a preview feature. Set `chat.plugins.enabled` to `true`, then add this repo
to `chat.plugins.marketplaces`:

```json
{
  "chat.plugins.enabled": true,
  "chat.plugins.marketplaces": ["qlaneai/agent-plugin"]
}
```

### Codex

```bash
codex marketplace add github:qlaneai/agent-plugin
```

Then run `/plugins` in Codex to install `qlane` from the browser, and sign in separately —
installing the plugin registers the server but does not authenticate it:

```bash
codex mcp login qlane
```

> **Opening this repository in Claude Code?** You will see a `qlane` server listed as
> **Pending approval**, with `${user_config.region_host}` sitting unresolved in its URL. That
> is expected and harmless. Claude Code reads a `.mcp.json` at a repository root as
> _project-scoped_ MCP configuration, and this repo's `.mcp.json` is the plugin's own manifest
> being read as if it were yours. The placeholder is only substituted when the file is loaded
> **as a plugin**, which is not what opening the directory does. Decline it, and install the
> plugin with the commands above instead.

## Without the plugin

Any MCP client can point at the endpoint directly. For Claude Code:

```bash
claude mcp add --transport http --scope user qlane https://mcp-eu.qlane.ai/api/mcp
```

Swap the host for `mcp-us.qlane.ai` if your organization is US-hosted.

## What it can do

Read your projects, test targets and coverage, and plan tests for a local diff before a pull
request exists. Planning a test consumes Qlane credits.

## Development

```bash
npm ci
npm run check
```

`check` runs Prettier, markdownlint, JSON Schema validation of the manifests, and the unit
tests. It makes no network calls, so it works offline and in a sandboxed CI runner.

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
