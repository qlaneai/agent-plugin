# Qlane agent plugin

Installs [Qlane MCP](https://qlane.ai) into your AI coding editor, so your agent can reach
your Qlane projects, test targets and what Qlane found on your pull requests without leaving
the editor.

**To install and use it, see [the plugin's README](plugins/qlane/README.md).**

## Repository layout

| Path                              | What it is                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| `plugins/qlane/`                  | The plugin: everything that ships to an editor, and the folder Anthropic's directory reviews. |
| `.claude-plugin/marketplace.json` | The marketplace Claude Code, Codex and VS Code install from. It points at `./plugins/qlane`.  |
| `.cursor-plugin/marketplace.json` | Cursor's marketplace, pointing at the same folder.                                            |
| `server.json`                     | The server's entry in the official MCP Registry, as `ai.qlane/qlane`.                         |
| `glama.json`                      | Maintainer claim for the server's listing on Glama.                                           |
| `tooling/`                        | Development tooling: formatting, linting, schema validation, tests. None of it ships.         |

## Development

The development tooling lives in `tooling/`, its own npm package, outside the plugin folder, so
none of it ships. A test pins the plugin folder to the files that do.

```bash
npm ci --prefix tooling
npm run check --prefix tooling
```

`check` runs Prettier, markdownlint, JSON Schema validation of the portable manifests, and the
unit tests, over the whole repository. It makes no network calls, so it works offline and in a
sandboxed CI runner.

```bash
npm run format --prefix tooling      # apply Prettier
npm run lint:md:fix --prefix tooling # apply markdownlint's safe fixes
```

Two checks need the Claude Code CLI and so are not part of `check`, which has to run on a
runner that does not have it:

```bash
claude plugin validate --strict .               # the marketplace; --strict makes warnings fatal
claude plugin validate --strict plugins/qlane   # the plugin itself
claude plugin tag --dry-run plugins/qlane       # what the next release tag would be
```

The version lives in the plugin's manifests only. The marketplace entry deliberately declares no
`version` of its own: `plugin.json` wins at install time, so a second copy could only ever
agree or be silently ignored.

**No manifest may contain a placeholder.** Both regional URLs are literal strings in every
manifest. `${user_config.*}` resolves only in the Claude Code CLI — the portable Agent Plugins
schema cannot even express `userConfig` (`additionalProperties: false`), and claude.ai treats
an MCP `url` as an opaque connector identity, so a templated host reaches registration verbatim
and fails to resolve. A test enforces this.

## License

[MIT](LICENSE).
