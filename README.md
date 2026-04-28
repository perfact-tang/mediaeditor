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
- FFmpeg must be available on `PATH` for both Node and Tauri modes.
- Whisper transcription uses the local OpenAI Whisper CLI. Install it before using the transcription checkbox:

```bash
python3 -m pip install -U openai-whisper
```

OR

```bash
python3 -m venv .venv-whisper
source .venv-whisper/bin/activate
python -m pip install -U pip
python -m pip install -U openai-whisper

WHISPER_COMMAND="$PWD/.venv-whisper/bin/whisper" npm run tauri:dev
```

Optional environment:

- `WHISPER_COMMAND`: path/name of the Whisper CLI command. Defaults to `whisper`.

CI build:

- `.github/workflows/tauri-build.yml` builds both `macos-latest` and `windows-latest`.
- Artifacts are uploaded from `src-tauri/target/release/bundle/**`.

## Static HTML version

`htmlver/index.html` is a no-server version. It can prepare segments and export JSON/FFmpeg commands, but browser-only HTML cannot execute local FFmpeg directly.
