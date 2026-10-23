<p align="center">
  <img src="addon/chrome/content/icons/favicon.svg" width="96" height="96" alt="Zotero Translation Reader" />
</p>

# Zotero Translation Reader

[한국어](README.md) · [English](README.en.md)

Translate a page as you read in Zotero. Equations, figures, and tables are shown from the original PDF.

[Download the latest XPI](https://github.com/Kinetic27/zotero_paper_translate/releases/latest/download/zotero-translation-reader.xpi) · [Releases](https://github.com/Kinetic27/zotero_paper_translate/releases/latest) · [Report a bug](https://github.com/Kinetic27/zotero_paper_translate/issues)

## What it does

- Translates the current PDF page, or follows page changes when Auto is on.
- Shows recognized equations, figures, and tables from the original PDF. Inline equations stay inside translated paragraphs.
- Includes the rest of a paragraph when it continues across a page boundary.
- Saves successful translations locally and reuses them when you reopen a paper.
- Offers a translation-only view, an original-text toggle, and a separate reader window.
- Translates a whole document with cancellation and resume from saved pages.
- Connects to a ChatGPT account through browser sign-in, with model and reasoning-effort selection.

## Install

1. [Download `zotero-translation-reader.xpi`](https://github.com/Kinetic27/zotero_paper_translate/releases/latest/download/zotero-translation-reader.xpi). This link follows the latest stable release. Each release also includes `SHA256SUMS.txt`.
2. In Zotero, open **Tools → Plugins → gear menu → Install Plugin From File** and select the XPI.
3. Open a PDF and select **Zotero Translation Reader** in the right sidebar.
4. Zotero can check the plugin's published update feed for later versions. Use the gear menu's update check to check immediately. Stable builds use `update.json`; beta builds use `update-beta.json`.

Installing the XPI does not require Node, npm, or a Codex executable.

## Use

Choose a translation service and the source and target languages. Set any required API key, then open **Config**, choose the endpoint and model, and save.

Set font size and line spacing in settings, alongside service credentials, languages, Config, and product information. The reader's font controls save to the same setting. Changing the text size sends no translation request.

| Control                       | Action                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Read page**                 | Opens the saved translation for the current settings, or translates the page if none is available.       |
| **Translate**                 | Requests a new translation, even if a saved result exists. Replaces the saved result only after success. |
| **Auto**                      | Translates as you navigate when enabled. When off, navigation only restores saved results.               |
| **Original**                  | Shows or hides the extracted original text.                                                              |
| **Open in standalone window** | Opens a separate reading window.                                                                         |
| **Translate all**             | Processes the document, skipping valid saved pages. Can be cancelled.                                    |

The first toolbar row holds Auto, Original, and font size, with Translate and Translate all on the row below. Enabled switches have a colored indicator. Controls wrap when the panel is narrow, while paragraphs fill the available reader width.

Saved translations return when you switch papers or restart Zotero, even with Auto off. The reader looks for a result that matches the PDF and translation settings.

PDF modification times, API-key changes, and login-state changes can also prevent it from finding an earlier result, even if the PDF text is unchanged. The saved file stays on disk.

## Translation services

There are eight sentence-translation services. Dictionary services remain separate.

| Service         | Setup                                                                           |
| --------------- | ------------------------------------------------------------------------------- |
| **Google**      | No API key required.                                                            |
| **Google(API)** | No API key required.                                                            |
| **Bing**        | No API key required.                                                            |
| **DeepLX**      | Set the request URL in Config.                                                  |
| **ChatGPT**     | API key, endpoint, and model. Supports OpenAI-compatible and Anthropic formats. |
| **Claude**      | API key, Messages API endpoint, and model.                                      |
| **Gemini**      | API key, base URL, and model.                                                   |
| **OpenAI Auth** | Sign in to a ChatGPT account in your browser.                                   |

Choose **ChatGPT** for an API-key connection, or **OpenAI Auth** to sign in to your ChatGPT account and use its Codex access and limits. A ChatGPT subscription does not provide ordinary OpenAI API credits.

### ChatGPT account sign-in

1. Select **OpenAI Auth** and open **Config**.
2. Click **Sign in with ChatGPT** and finish signing in in your browser.
3. The model list loads after sign-in. Choose **Model** and **Reasoning effort**, then save.

With Model set to **Automatic**, the reader picks the first available text model in the account catalog's priority order. **Default** effort leaves the override unset and uses the model or server default.

Only advertised effort levels appear in the list. A model without capability information has Default only. If you switch to a model that does not support your selected effort, the choice resets to Default.

Use **Check account and models** to reload the catalog, **Cancel sign-in** to cancel an unfinished login, and **Sign out** to disconnect.

Sign-in temporarily uses `localhost:1455`. If that port is busy, close the other login attempt and retry. The plugin does not ask you to paste passwords or tokens, or import another program's login files.

### API keys

For ChatGPT, Claude, or Gemini, enter the API key in the selected service's key field. Set the endpoint and model in Config.

- ChatGPT supports OpenAI Chat Completions, Responses, and Anthropic-compatible request formats. Select the format your server expects.
- Claude accepts a Messages API base URL or full endpoint and a model ID.
- Gemini has separate base-URL and model fields. Check both manually if an older configuration included the model in the URL.

Pricing, rate limits, and endpoint compatibility depend on the provider and server.

## Data and limitations

The selected translation service receives the text you translate. Check your document's restrictions before sending sensitive material.

OpenAI Auth uses Zotero's encrypted login manager to store credentials. Ordinary API keys remain in plugin preferences and do not have the same protection.

**Sign out** removes only this plugin's OAuth credentials, leaving other programs' logins unchanged. OpenAI Auth does not run a local agent or give the model file-reading or shell tools.

The reader renders PDF regions for equations, figures, and tables. It does not perform OCR or reconstruct LaTeX. Check the translation and reading order against the PDF, especially around complex layouts, scans, captions, and references that may be misread.

Account and service changes can break connectivity. Development checks used synthetic responses; they did not verify real authenticated translation with a personal ChatGPT account.

## Development

Node and npm are needed for development, not for installing the XPI.

```bash
npm ci
npm run build
```

The package is written to `build/zotero-translation-reader.xpi`.

### Releases

Update the versions in `package.json` and `package-lock.json`, commit, and push to main. Push a matching version tag, such as `v2.4.38`. GitHub Actions runs native checks before publishing the XPI, `SHA256SUMS.txt`, and the update feed for the stable or beta channel.

### Tests

Native tests use a dedicated profile and synthetic accounts and responses, not your normal Zotero profile.

```bash
env -u CI -u GITHUB_ACTIONS ZOTERO_PLUGIN_ZOTERO_BIN_PATH=/path/to/zotero npm test -- --no-watch
ZOTERO_PLUGIN_ZOTERO_BIN_PATH=/path/to/zotero npm run test:codex-quit
ZOTERO_PLUGIN_ZOTERO_BIN_PATH=/path/to/zotero npm run test:reader-restart
```

For headless Linux menu tests, run Xvfb with a window manager. The scaffold's default CI mode starts its own unmanaged Xvfb. GTK menus can close before they appear in that display. Unset CI and GITHUB_ACTIONS only in the GUI test child process so it uses the managed display already running.

```bash
xvfb-run -a sh -c 'xfwm4 --compositor=off & env -u CI -u GITHUB_ACTIONS ZOTERO_PLUGIN_ZOTERO_BIN_PATH=/path/to/zotero npm test -- --no-watch'
```

`test:codex-quit` exits Zotero during encrypted writes and logout, then checks the completion records left outside the application.

`test:reader-restart` opens the same saved attachment in two separate Zotero processes. The second process must restore the first one's translation without another request. Because the scaffold resets its directories, the test restores the first process's test data and preferences between runs. Both checks are separate from the ordinary test count and use no personal Zotero profile.

When reporting a bug, include your OS, Zotero version, plugin version, and reproduction steps. Do not upload API keys, tokens, personal documents, or unredacted logs.

## License

[AGPL-3.0-or-later](LICENSE)
