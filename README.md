# Side chat for DeepSeek Harness

A right-sidebar conversation that runs **in parallel** with the main chat. Ask
about the task, explain an error, compare approaches, or check what the main
conversation is doing — without interrupting it, and without giving the side
chat any way to change your workspace.

![Side chat icon](assets/icon-180.png)

## Features

- **A real conversation, not a popup.** The side chat is an ordinary Session
  hosted in a right-sidebar tab, so it gets the native composer, streaming
  output, Markdown, Stop, model selection, and copy actions.
- **Knows the main conversation.** Every step carries a bounded excerpt of the
  main conversation's most recent user and assistant text (no tool calls, no
  tool results, at most 12 messages / ~6000 characters).
- **Read-only by composition.** The side chat runs the `side-chat` Agent
  preset, which composes only `read`, `read_image`, `glob`, `grep`,
  `web_search`, and `web_fetch`. There is no shell, no `write`/`edit`, and no
  patch tool.
- **Quote what you select.** Select text in the main conversation, then insert
  it into the side-chat draft as a blockquote. Long selections show a compact
  head…tail preview while the full text reaches the draft.
- **Persistent threads.** Each main conversation owns one current side thread;
  reopening the tab or reloading the page restores it.
- **Entry points.** A speech-bubble button in the main conversation header and
  a card on the right Sidebar's guide page.

## Install

### From the plugin market

Plugins → **Discover** → search for **Side chat** (available once the catalog
entry is merged), then install.

### From this directory

Plugins → **Add plugin** → choose this folder, or from an agent session:

```text
plugin_manager install_bundle <absolute path to this folder>
```

### From npm

After the package is published:

```sh
dsh plugin --profile <profile> add <npm-package-name>
```

## Usage

1. Open a conversation.
2. Click the speech-bubble button in the conversation header, or the **Side
   chat** card on the right Sidebar's guide page.
3. Ask a question. The side chat answers with the main conversation as
   background; the main conversation keeps running untouched.
4. Select text in the main conversation to make it the starting point of a
   question: the quote control appears in the side chat's composer.
5. **New chat** starts a fresh thread for the same main conversation.

## How it works

The two halves of the bundle share one contract: the side Session's id.

```text
sidechat__<mainSessionId>__<generation>
```

- The browser half creates that Session through `ctx.sessions.create` with
  `agentPreset: 'side-chat'` and the main Session's `cwd`, retains it, and
  renders the shared Conversation content (`conversation.content` Factory,
  `variant: 'embedded'`) inside a right-Sidebar tab.
- The Host half sees the Agent in `agent/created`, parses the main Session id
  out of the id, and registers one complete system-prompt section on that
  Agent's context. The section is rebuilt per step from the live main Session's
  trailing `user/message` and `assistant/message` text, cached until that
  Session's log advances.
- The preset composes only read-only tools, so "no side effects on the
  workspace" is a capability fact, not a prompt promise.

No Host Remote, custom event type, or tool is added. Everything else is an
existing public seam: `ctx.sidebarRightTabs`, `sidebar.right.pane.tab`,
`conversation.session.header.utilities`, `conversation.input.left`,
`ctx.sessions`, and `ctx.systemPrompt`.

## Requirements

- DeepSeek Harness `0.2.1` through `0.2.x` (`engines.dsh`).
- A model route configured in the profile (the side chat uses the profile's
  default model; the embedded composer can change it for that thread).

## Limitations

- The `side-chat` preset appears in the New Session preset picker (custom group,
  last position, labelled read-only), because presets have no hidden flag.
- A side Session is not a member of any Workspace, so it does not appear in the
  left sidebar's Session tree.
- Starting a new thread leaves the old thread on disk; there is no cleanup
  control yet.
- The plugin does not offer a "send back to the main conversation" button; that
  would change the main conversation, which this plugin deliberately does not
  do.

## Development

The package is plain JavaScript — no build step.

| File | Role |
|---|---|
| `index.js` | Host half: per-Agent prompt section with the main-conversation excerpt. |
| `client.js` | Browser half: tab type, tab body, guide card, header button, quote control, side-Session store. |
| `cordis.patch.yml` | Inserts the Host row and the `side-chat` Agent preset. |
| `locale/*.json` | Plugin title, description, and detail document path. |
| `docs/DETAIL.md` | Detail page shown in Plugins. |
| `icon.svg` | Plugin and guide artwork. |
| `assets/icon-180.png` | Catalog icon (180×180 PNG). |

Install the directory as a bundle to try a change; a page refresh loads the new
browser half.

## Publishing

See [docs/PUBLISH.md](docs/PUBLISH.md) for the npm and market submission steps.

## License

MIT — see [LICENSE](LICENSE).
