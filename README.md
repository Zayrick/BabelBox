<div align="center">

# BabelBox · 翻译机

### Make every webpage feel native to read.

An open-source browser extension for bilingual webpages, instant selection translation, and flexible translation services.

**[Install](#install)** · **[Explore features](#what-you-can-do)** · **[Read the docs](./docs/index.md)** · **[简体中文](./misc/README_ZH.md)**

</div>

BabelBox brings translation into the reading flow. Keep the original text beside the translation, translate only the sentence you need, or translate the whole page without opening another tab. Choose a traditional translation engine, an AI provider, or the built-in free fallback, then tune the experience to your reading habits.

## What you can do

| Read naturally | Stay in control |
| --- | --- |
| **Bilingual pages** — Keep original text and translation together for study, research, and technical reading. | **Many translation services** — Use Microsoft Translator, Google Translate, DeepL, DeepLX, Chrome Translator, or AI providers such as OpenAI, DeepSeek, Gemini, Claude, Kimi, Ollama-compatible endpoints, and more. |
| **Whole-page translation** — Use the floating ball, context menu, or a customizable shortcut. In Settings, choose progressive translation or translate all currently loaded content to the page bottom. | **Custom models and endpoints** — Configure compatible APIs, models, prompts, request bodies, proxies, and credentials from the settings page. |
| **Selection translation** — Select text and get a focused translation card with copy and speech actions. | **Privacy controls** — Preferences and cache stay in extension-private storage. API credentials are session-only by default; cloud translation sends text to the selected provider. |
| **Hover and gesture triggers** — Translate with a hover shortcut, double click, long press, middle click, or touch gestures. | **Reader-friendly controls** — Choose translation styles, themes, animation, cache behavior, concurrency, and separate shortcuts for page and selection translation. |

### Also included

- **Free Translation**: a built-in fallback chain that tries Microsoft first, then DeepLX, then Google when a service returns an error or empty result.
- **Image translation (Beta)**: local OCR for text in images, with downloadable language packs and a reversible translated overlay.
- **Translation cache**: reuse recent results for the same service, model, language pair, and request settings.
- **Explicit data handling**: review what each feature sends and stores in the [data and privacy guide](./docs/guide/privacy.md).
- **Cross-browser support**: WXT build targets for Chromium browsers (Manifest V3) and Firefox (Manifest V2).

## Interface overview

The popup contains the everyday controls: enable or pause translation, choose the language pair and service, translate or restore the current page, and open feature-specific settings. The full settings page separates reading preferences, providers and models, shortcuts, site rules, image translation, vocabulary, advanced behavior, and configuration history.

## Install

Download the appropriate BabelBox artifact from [GitHub Releases](https://github.com/Zayrick/BabelBox/releases), or build it locally from source.

For a local build, install dependencies with pnpm and load the generated `./.output/chrome-mv3` directory as an unpacked extension. See the [documentation](./docs/guide/getting-started.md) for setup and configuration details.

An experimental userscript target for Via, Tampermonkey, and Violentmonkey can be generated with `pnpm build:userscript`. It produces the self-contained `./.output/userscript/babelbox.user.js`; see the [userscript build guide](./docs/guide/userscript.md) for the supported feature matrix and browser-extension-only limitations.

## Project links

- [Documentation](./docs/index.md) — features, setup, services, shortcuts, and FAQ.
- [GitHub Issues](https://github.com/Zayrick/BabelBox/issues) — report a problem or suggest an improvement.
- [UNICEF](https://www.unicef.org/) — support the United Nations Children's Fund.

## Development

Local development requires Node.js `^22.13 || >=24`. Enable Corepack (install it separately if your Node distribution does not include it); the repository's `packageManager` pin then selects pnpm 12.

```bash
corepack enable
pnpm install
pnpm dev
pnpm test
pnpm test:architecture
pnpm compile
pnpm build
pnpm build:userscript
```

Run `pnpm test:regression:all` for the deterministic one-command regression pipeline (types, tests, cross-browser/userscript builds, and docs). Coverage is available separately with `pnpm test:coverage`. Isolated browser and live-network layers are explicit gates; see the [architecture](./docs/architecture.md) and [testing guide](./docs/testing.md) before contributing a feature.

BabelBox uses Vue 3, TypeScript, Element Plus, and WXT, targeting Chromium Manifest V3 and Firefox Manifest V2. The project is licensed under [GPL-3.0](./LICENSE).

## Upstream acknowledgement

BabelBox is based on [FluentRead](https://github.com/FluentRead/FluentRead). We thank its maintainers and contributors for the upstream project. See [UPSTREAM.md](./UPSTREAM.md) for attribution details.
