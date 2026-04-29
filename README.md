# MediaSplitter AI MVP

Phase 1 implementation:

- Video/audio import by click or drag and drop
- Local playback with speed control
- Manual segment creation and editing
- FFmpeg stream-copy batch splitting
- Exported files saved to `exports/<project-name>/`
- Tauri desktop shell for Mac/Windows builds

## Browser/Node MVP

```bash
npm run dev
```

Open `http://localhost:5173`.

## Tauri desktop app

Prerequisites:

- Node.js 20+
- Rust/Cargo
- FFmpeg available on `PATH`

Run the desktop app:

```bash
npm run tauri:dev
```

Build a local desktop package:

```bash
npm run tauri:build
```

Build output is written under `src-tauri/target/release/bundle/`.

Notes:

- On macOS, this project uses `src-tauri/tauri.macos.conf.json` to produce a `.app` bundle.
- On Windows, run the same repository on Windows to produce the Windows bundle targets from the main Tauri config.
- Tauri mode uses a native file picker, previews the selected media, and writes exports next to the source file in `<project-name>_exports/`.
- Tauri builds bundle FFmpeg automatically through `ffmpeg-static`; no separate FFmpeg install is required for the installed app.
- Node browser mode still expects FFmpeg on `PATH`.
- Whisper transcription is built into the Rust/Tauri app through `whisper-rs` and a bundled whisper.cpp model.
- The default bundled model is `src-tauri/resources/models/ggml-base.bin`.
- Python and `openai-whisper` are not required on the installed computer.

To bundle additional models, place them in `src-tauri/resources/models/` and add them to `bundle.resources` in `src-tauri/tauri.conf.json`.

CI build:

- `.github/workflows/tauri-build.yml` builds both `macos-latest` and `windows-latest`.
- Artifacts are uploaded from `src-tauri/target/release/bundle/**`.

## Static HTML version

`htmlver/index.html` is a no-server version. It can prepare segments and export JSON/FFmpeg commands, but browser-only HTML cannot execute local FFmpeg directly.
