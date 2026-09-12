Mozilla PDF.js 6.3.289, Apache 2.0.
Bundled locally; no third-party document service or CDN is used.
Source: https://github.com/mozilla/pdf.js/releases/tag/v6.3.289
API: https://mozilla.github.io/pdf.js/examples/
legacy/build main and worker are unmodified. Font/WASM files retain licenses.
cmaps.json packs original .bcmap bytes as base64 by basename to reduce file count.
Care Web uses canvas rendering with eval and XFA disabled. PDF scripting is not loaded.
