# Publishing to the DSH plugin market

The market is the community catalog **`awesome-dsh-plugin/awesome-dsh-plugin`**.
Its `data/plugins/*.yml` files generate
`https://awesome-dsh-plugin.com/plugins.json`, which the Discover page and the
`plugin_market` agent tool read. The market client (`dsh-market`) does **not**
accept entries — the only submission channel is a pull request against the
catalog repository.

## Prerequisites

- A **public** GitHub repository for this plugin.
- An **npm package** published from this repository. Its `package.json` must
  declare `dsh.bundle` and carry a root `cordis.patch.yml`.
- A **180×180 PNG** icon hosted on GitHub (`assets/icon-180.png`). SVG is
  rejected for the catalog entry; the package's own `icon.svg` only affects the
  Plugins list.
- A DSH compatibility range in `engines.dsh` (already set to
  `>=0.2.1 <0.3.0`).

## 1. Pick your names

The working copy is installed under the local-only name `@dsh-local/side-chat`.
Before publishing, replace it with your own npm name (for example
`@your-npm-name/dsh-side-chat`) in every place:

| File | Field |
|---|---|
| `package.json` | `name`, `repository`, `homepage`, `bugs`, `author` |
| `client.js` | the `PACKAGE` constant (the client module id and tab type id) |
| `cordis.patch.yml` | the Host row's `name` |
| `LICENSE` | the copyright holder |
| `README.md`, `README.zh.md` | repository links |
| `market/<owner>__dsh-side-chat.yml` | `url`, `name`, `icon` |

Then re-link the installed bundle so the profile follows the new name (ask the
agent, or use Plugins → remove, then Add plugin):

```text
plugin_manager remove_bundle @dsh-local/side-chat
plugin_manager install_bundle <absolute path to this folder>
```

Existing side-chat Sessions keep their ids and history; the open right-sidebar
tab may need to be reopened because the tab type id changed.

## 2. Create the GitHub repository and push

```sh
git remote add origin https://github.com/<owner>/dsh-side-chat.git
git push -u origin main
```

On GitHub, add the topic **`dsh-plugin`** to the repository. Some submissions
report that the repository must be public for at least a day before the catalog
PR is reviewed; opening the PR the same day is not harmful, it just waits.

## 3. Publish the npm package

```sh
npm publish --access public
```

The package has no build step and no install scripts: the files in `files` are
shipped as-is. Verify with `npm view <name> version` and, if the name is
scoped, that the scope exists on your npm account.

## 4. Open the catalog PR

1. Fork `awesome-dsh-plugin/awesome-dsh-plugin`.
2. Copy `market/<owner>__dsh-side-chat.yml` to `data/plugins/<owner>__dsh-side-chat.yml`
   in the fork, with `url`, `name`, and `icon` pointing at your repository.
3. Commit only that one file and open the pull request.

Rules the catalog CI enforces:

- One entry per plugin; a PR may add at most three entries and must only change
  your own entry.
- `description.en` is required and should be one sentence ending with a period.
  A description containing `: ` (colon + space) must be quoted, or YAML parses
  it as a nested key.
- The `icon` must be a GitHub-hosted bitmap (PNG/JPEG/WebP); SVG is rejected.
- The package must be resolvable from npm and declare `dsh.bundle`.

## 5. Verify

After the PR merges and the catalog regenerates:

```text
plugin_market list_plugins query "side chat"
```

Install it from Plugins → Discover, then confirm the header button, the guide
card, the read-only tool set, and the main-conversation excerpt behave as
documented.
