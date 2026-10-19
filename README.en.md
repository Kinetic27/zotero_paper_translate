<p align="center">
  <img src="addon/chrome/content/icons/favicon.svg" width="96" height="96" alt="Zotero Translation Reader" />
</p>

# Zotero Translation Reader

[한국어](README.md) · [English](README.en.md)

Translate PDFs in Zotero and read them alongside the original equations, figures, and tables.

A PDF translation reader maintained by [Kinetic27](https://github.com/Kinetic27), based on [Translate for Zotero](https://github.com/windingwind/zotero-pdf-translate).

[Download the latest XPI](https://github.com/Kinetic27/zotero_paper_translate/releases/latest/download/zotero-translation-reader.xpi) · [Releases](https://github.com/Kinetic27/zotero_paper_translate/releases/latest) · [Report a bug](https://github.com/Kinetic27/zotero_paper_translate/issues)

## What it does

- Translates the current PDF page, or follows page changes when Auto is on.
- Renders recognized equations, figures, and tables from the PDF. Inline equations stay inside translated paragraphs.
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

The manifest permits installation on Zotero **7.9.9–10.9.9**. That is not a tested compatibility range. Reading and direct OAuth regression tests have run on **Linux with Zotero 10.0.6**. Windows, macOS, and the rest of that range remain unverified.

Installing the XPI does not require Node, npm, or a Codex executable.

## Use

Choose a translation service and the source and target languages. Set any required API key, then open **Config**, choose the endpoint and model, and save.

Settings contain service credentials, Config, languages, font size, line spacing, and product information. Font controls in the reader use the same saved setting. Changing the text size does not request another translation.

| Control                       | Action                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Read page**                 | Opens the saved translation for the current settings, or translates the page if none is available.       |
| **Translate**                 | Requests a new translation, even if a saved result exists. Replaces the saved result only after success. |
| **Auto**                      | Translates as you navigate when enabled. When off, navigation only restores saved results.               |
| **Original**                  | Shows or hides the extracted original text.                                                              |
| **Open in standalone window** | Opens a separate reading window.                                                                         |
| **Translate all**             | Processes the document, skipping valid saved pages. Can be cancelled.                                    |

Auto, Original, and font-size controls share the first toolbar row. Translate and Translate all are below them. Enabled switches have a colored indicator; controls wrap in narrow panels. Paragraphs use the available reader width.

Saved pages are restored after switching papers or restarting Zotero. Auto does not need to be on. The PDF and translation settings determine which saved result is used. PDF modification times, API-key changes, and login-state changes also affect that identity: a saved result may become unavailable even when the PDF text has not changed. The old saved file is not deleted.

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

ChatGPT and OpenAI Auth are different connections. ChatGPT uses an API key. OpenAI Auth uses your account's Codex access and limits. A ChatGPT subscription does not provide ordinary OpenAI API credits.

### ChatGPT account sign-in

1. Select **OpenAI Auth** and open **Config**.
2. Click **Sign in with ChatGPT** and finish signing in in your browser.
3. The model list loads after sign-in. Choose **Model** and **Reasoning effort**, then save.

Automatic selects the first available text model in the account catalog's priority order. Default effort leaves the override unset and uses the model or server default. Only advertised effort levels are offered. A model without capability information has Default only; changing to a model that does not support your selected effort resets it to Default.

Use **Check account and models** to reload the catalog, **Cancel sign-in** to cancel an unfinished login, and **Sign out** to disconnect.

Sign-in temporarily uses `localhost:1455`. If that port is busy, close the other login attempt and retry. The plugin does not ask you to paste passwords or tokens, or import another program's login files.

### API keys

For ChatGPT, Claude, or Gemini, enter the API key in the selected service's key field. Set the endpoint and model in Config.

- ChatGPT supports OpenAI Chat Completions, Responses, and Anthropic-compatible request formats. Select the format your server expects.
- Claude accepts a Messages API base URL or full endpoint and a model ID.
- Gemini has separate base-URL and model fields. Check both manually if an older configuration included the model in the URL.

Pricing, rate limits, and endpoint compatibility depend on the provider and server.

## Data and limitations

Translation text is sent to the selected service. Check your document's restrictions before sending sensitive material.

OpenAI Auth credentials are stored in Zotero's encrypted login manager. Ordinary API keys remain in plugin preferences and do not have the same protection. Sign out removes only this plugin's OAuth credentials; it does not change other programs' logins. OpenAI Auth does not run a local agent or give the model file-reading or shell tools.

Equations, figures, and tables are preserved by rendering PDF regions, not by OCR or LaTeX reconstruction. Complex layouts, scans, captions, and references can be misread. Check the translation and reading order against the PDF.

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

On headless Linux, native menu tests need both Xvfb and a window manager. The scaffold's default CI mode starts its own unmanaged Xvfb, which can dismiss GTK menus before they appear. Unset CI and GITHUB_ACTIONS only in the GUI test child process so it uses the managed display.

```bash
xvfb-run -a sh -c 'xfwm4 --compositor=off & env -u CI -u GITHUB_ACTIONS ZOTERO_PLUGIN_ZOTERO_BIN_PATH=/path/to/zotero npm test -- --no-watch'
```

The quit test checks external receipts after exiting the application during encrypted writes and logout. The restart test opens the same saved attachment in two separate Zotero processes and verifies restoration without another translation request. It restores the first process's test data and preferences after the scaffold resets its directories. These checks are separate from the ordinary test count.

When reporting a bug, include your OS, Zotero version, plugin version, and reproduction steps. Do not upload API keys, tokens, personal documents, or unredacted logs.

## License

[AGPL-3.0-or-later](LICENSE)
