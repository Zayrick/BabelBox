FluentRead bundles the following open-source OCR assets for local image text recognition:

- Tesseract.js 7.0.0, Apache-2.0
- tesseract.js-core 7.0.0, Apache-2.0

The worker and WebAssembly files are loaded from this extension's own resources.
Language data is downloaded on demand from Tesseract.js's default jsDelivr source
and cached locally; no executable OCR code is downloaded at runtime.
