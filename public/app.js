const state = {
  file: null,
  uploadId: null,
  sourcePath: null,
  objectUrl: null,
  duration: 0,
  rangeStart: 0,
  rangeEnd: 0,
  segments: [],
  mediaEl: null,
  isVideo: true
};

const $ = (id) => document.getElementById(id);

const els = {
  fileInput: $("fileInput"),
  dropZone: $("dropZone"),
  editor: $("editor"),
  video: $("video"),
  audio: $("audio"),
  audioPoster: $("audioPoster"),
  playBtn: $("playBtn"),
  backBtn: $("backBtn"),
  setStartBtn: $("setStartBtn"),
  setEndBtn: $("setEndBtn"),
  addSegmentBtn: $("addSegmentBtn"),
  runSplitBtn: $("runSplitBtn"),
  exportTopBtn: $("exportTopBtn"),
  speedSelect: $("speedSelect"),
  timeline: $("timeline"),
  waveform: $("waveform"),
  selectedRange: $("selectedRange"),
  startLine: $("startLine"),
  endLine: $("endLine"),
  playhead: $("playhead"),
  segmentMarks: $("segmentMarks"),
  segmentList: $("segmentList"),
  statusLine: $("statusLine"),
  progress: $("progress"),
  uploadState: $("uploadState"),
  sessionName: $("sessionName"),
  projectName: $("projectName"),
  startInput: $("startInput"),
  endInput: $("endInput"),
  videoOutput: $("videoOutput"),
  audioOutput: $("audioOutput"),
  audioFormat: $("audioFormat"),
  transcriptOutput: $("transcriptOutput"),
  transcriptLanguage: $("transcriptLanguage"),
  whisperModel: $("whisperModel"),
  transcriptTxt: $("transcriptTxt"),
  transcriptSrt: $("transcriptSrt"),
  metaFile: $("metaFile"),
  metaDuration: $("metaDuration"),
  metaSize: $("metaSize"),
  metaResolution: $("metaResolution"),
  timeBadge: $("timeBadge"),
  progressModal: $("progressModal"),
  progressTitle: $("progressTitle"),
  progressDetail: $("progressDetail"),
  modalProgress: $("modalProgress"),
  progressPath: $("progressPath")
};

function tauriApi() {
  return window.__TAURI__?.core || null;
}

function isTauriApp() {
  return Boolean(tauriApi());
}

function formatTime(value) {
  const totalMs = Math.max(0, Math.round(value * 1000));
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function parseTime(value) {
  const match = String(value).trim().match(/^(\d+):([0-5]?\d)(?:\.(\d{1,3}))?$/);
  if (!match) return Number.NaN;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const ms = Number((match[3] || "0").padEnd(3, "0"));
  return minutes * 60 + seconds + ms / 1000;
}

function formatBytes(bytes) {
  if (!bytes) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function baseName(fileName) {
  return fileName.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
}

function setStatus(message, progress = null) {
  els.statusLine.textContent = message;
  if (progress !== null) els.progress.value = progress;
}

function showProgressModal(title, detail, progress = 0, path = "") {
  els.progressTitle.textContent = title;
  els.progressDetail.textContent = detail;
  els.modalProgress.value = progress;
  els.progressPath.textContent = path;
  els.progressModal.classList.remove("hidden");
}

function updateProgressModal(detail, progress, path = null) {
  els.progressDetail.textContent = detail;
  els.modalProgress.value = progress;
  if (path !== null) els.progressPath.textContent = path;
}

function hideProgressModal(delay = 900) {
  window.setTimeout(() => {
    els.progressModal.classList.add("hidden");
  }, delay);
}

function activeMedia() {
  return state.mediaEl;
}

function syncButtons() {
  const mediaReady = Boolean(state.duration);
  const exportReady = Boolean((state.uploadId || state.sourcePath) && state.duration);
  const hasTranscriptFormat = els.transcriptTxt.checked || els.transcriptSrt.checked;
  const hasOutput = els.videoOutput.checked || els.audioOutput.checked || (els.transcriptOutput.checked && hasTranscriptFormat);
  const hasSegments = state.segments.length > 0;
  els.addSegmentBtn.disabled = !mediaReady;
  els.setStartBtn.disabled = !mediaReady;
  els.setEndBtn.disabled = !mediaReady;
  els.audioFormat.disabled = !els.audioOutput.checked;
  els.transcriptLanguage.disabled = !els.transcriptOutput.checked;
  els.whisperModel.disabled = !els.transcriptOutput.checked;
  els.transcriptTxt.disabled = !els.transcriptOutput.checked;
  els.transcriptSrt.disabled = !els.transcriptOutput.checked;
  els.runSplitBtn.disabled = !(exportReady && hasSegments && hasOutput);
  els.exportTopBtn.disabled = !(exportReady && hasSegments && hasOutput);
}

function buildSplitRequest(segments = state.segments) {
  return {
    projectName: els.projectName.value || baseName(state.file.name),
    outputs: {
      video: els.videoOutput.checked,
      audioFormat: els.audioOutput.checked ? els.audioFormat.value : null,
      transcript: els.transcriptOutput.checked,
      transcriptFormats: [
        ...(els.transcriptTxt.checked ? ["txt"] : []),
        ...(els.transcriptSrt.checked ? ["srt"] : [])
      ],
      transcriptLanguage: els.transcriptLanguage.value,
      whisperModel: els.whisperModel.value
    },
    segments
  };
}

function syncRangeInputs() {
  els.startInput.value = formatTime(state.rangeStart);
  els.endInput.value = formatTime(state.rangeEnd);
  renderRangeSelection();
}

function renderRangeSelection() {
  if (!state.duration) {
    els.selectedRange.style.display = "none";
    els.startLine.style.display = "none";
    els.endLine.style.display = "none";
    return;
  }

  const start = Math.max(0, Math.min(state.rangeStart, state.duration));
  const end = Math.max(0, Math.min(state.rangeEnd, state.duration));
  const left = Math.min(start, end) / state.duration * 100;
  const right = Math.max(start, end) / state.duration * 100;
  const width = Math.max(0, right - left);

  els.selectedRange.style.display = width > 0 ? "block" : "none";
  els.selectedRange.style.left = `${left}%`;
  els.selectedRange.style.width = `${width}%`;
  els.startLine.style.display = "block";
  els.endLine.style.display = "block";
  els.startLine.style.left = `${(start / state.duration) * 100}%`;
  els.endLine.style.left = `${(end / state.duration) * 100}%`;
}

function readRangeInputs() {
  const start = parseTime(els.startInput.value);
  const end = parseTime(els.endInput.value);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    setStatus("Start/Endは 00:00.000 の形式で入力してください。");
    syncRangeInputs();
    return null;
  }
  const clampedStart = Math.max(0, Math.min(start, state.duration));
  const clampedEnd = Math.max(0, Math.min(end, state.duration));
  state.rangeStart = clampedStart;
  state.rangeEnd = clampedEnd;
  syncRangeInputs();
  return { start: clampedStart, end: clampedEnd };
}

function updatePlayhead() {
  const media = activeMedia();
  if (!media || !state.duration) return;
  const ratio = Math.min(1, media.currentTime / state.duration);
  els.playhead.style.left = `${ratio * 100}%`;
  els.timeBadge.textContent = formatTime(media.currentTime);
}

function renderSegmentMarks() {
  els.segmentMarks.innerHTML = "";
  if (!state.duration) return;
  for (const segment of state.segments) {
    const mark = document.createElement("div");
    mark.className = "segment-mark";
    mark.style.left = `${(segment.start / state.duration) * 100}%`;
    mark.style.width = `${((segment.end - segment.start) / state.duration) * 100}%`;
    els.segmentMarks.append(mark);
  }
}

function renderSegments() {
  els.segmentList.innerHTML = "";
  state.segments.forEach((segment, index) => {
    const row = document.createElement("li");
    row.className = "segment-row";

    const number = document.createElement("strong");
    number.textContent = String(index + 1).padStart(2, "0");

    const times = document.createElement("div");
    times.className = "times";

    const start = document.createElement("input");
    start.value = formatTime(segment.start);
    start.ariaLabel = "segment start";
    start.addEventListener("change", () => {
      const value = parseTime(start.value);
      if (Number.isFinite(value) && value >= 0 && value < segment.end) {
        segment.start = value;
      }
      renderSegments();
      renderSegmentMarks();
    });

    const end = document.createElement("input");
    end.value = formatTime(segment.end);
    end.ariaLabel = "segment end";
    end.addEventListener("change", () => {
      const value = parseTime(end.value);
      if (Number.isFinite(value) && value > segment.start && value <= state.duration) {
        segment.end = value;
      }
      renderSegments();
      renderSegmentMarks();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.title = "Remove segment";
    remove.addEventListener("click", () => {
      state.segments.splice(index, 1);
      renderSegments();
      renderSegmentMarks();
      renderRangeSelection();
      syncButtons();
    });

    times.append(start, end);
    row.append(number, times, remove);
    els.segmentList.append(row);
  });
  syncButtons();
}

function addSegment(start, end) {
  const cleanStart = Math.max(0, Math.min(start, state.duration));
  const cleanEnd = Math.max(0, Math.min(end, state.duration));
  if (cleanEnd - cleanStart < 0.05) {
    setStatus("区間が短すぎます。再生位置を進めてから追加してください。");
    return;
  }
  state.segments.push({ start: cleanStart, end: cleanEnd });
  state.segments.sort((a, b) => a.start - b.start);
  state.rangeStart = cleanEnd;
  state.rangeEnd = Math.min(state.duration, cleanEnd + 5);
  syncRangeInputs();
  renderSegments();
  renderSegmentMarks();
  setStatus(`${formatTime(cleanStart)} 〜 ${formatTime(cleanEnd)} を追加しました。`);
}

async function uploadFile(file) {
  if (isTauriApp()) {
    syncButtons();
    return;
  }
  els.uploadState.textContent = "Uploading";
  setStatus("ローカルサーバーへメディアを読み込んでいます...", 18);
  const response = await fetch(`/api/upload?filename=${encodeURIComponent(file.name)}`, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Upload failed");
  state.uploadId = payload.id;
  els.uploadState.textContent = "Ready";
  setStatus("アップロード完了。Start/End区間を分割できます。", 35);
  syncButtons();
}

function drawPlaceholderWaveform() {
  const canvas = els.waveform;
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(600, Math.floor(rect.width * devicePixelRatio));
  canvas.height = Math.floor(rect.height * devicePixelRatio);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#202626";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const mid = canvas.height / 2;
  ctx.strokeStyle = "rgba(0,245,160,.66)";
  ctx.lineWidth = Math.max(1, devicePixelRatio);
  for (let x = 0; x < canvas.width; x += 7 * devicePixelRatio) {
    const amp = (Math.sin(x * 0.018) * 0.5 + Math.sin(x * 0.045) * 0.3 + 0.8) * canvas.height * 0.18;
    ctx.beginPath();
    ctx.moveTo(x, mid - amp);
    ctx.lineTo(x, mid + amp);
    ctx.stroke();
  }
}

async function drawWaveform(file) {
  drawPlaceholderWaveform();
  if (file.size > 220 * 1024 * 1024) return;
  try {
    const arrayBuffer = await file.arrayBuffer();
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const data = audioBuffer.getChannelData(0);
    const canvas = els.waveform;
    const ctx = canvas.getContext("2d");
    const step = Math.ceil(data.length / canvas.width);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#181c1c";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(0,245,160,.82)";
    ctx.lineWidth = Math.max(1, devicePixelRatio);
    const mid = canvas.height / 2;
    for (let i = 0; i < canvas.width; i += 1) {
      let min = 1;
      let max = -1;
      for (let j = 0; j < step; j += 1) {
        const datum = data[i * step + j] || 0;
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      ctx.beginPath();
      ctx.moveTo(i, mid + min * mid * 0.82);
      ctx.lineTo(i, mid + max * mid * 0.82);
      ctx.stroke();
    }
    await audioContext.close();
  } catch {
    drawPlaceholderWaveform();
  }
}

async function loadFile(file) {
  if (!file) return;
  state.file = file;
  state.uploadId = null;
  state.sourcePath = null;
  state.duration = 0;
  state.rangeStart = 0;
  state.rangeEnd = 0;
  state.segments = [];
  syncRangeInputs();
  syncButtons();

  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = URL.createObjectURL(file);
  state.isVideo = file.type.startsWith("video/") || /\.(mp4|mov|mkv)$/i.test(file.name);
  state.mediaEl = state.isVideo ? els.video : els.audio;

  els.dropZone.classList.add("hidden");
  els.editor.classList.remove("hidden");
  els.video.classList.toggle("hidden", !state.isVideo);
  els.audioPoster.classList.toggle("hidden", state.isVideo);
  els.sessionName.textContent = baseName(file.name);
  els.projectName.value = baseName(file.name);
  els.metaFile.textContent = file.name;
  els.metaSize.textContent = formatBytes(file.size);
  els.metaDuration.textContent = "Loading";
  els.metaResolution.textContent = state.isVideo ? "Loading" : "Audio";
  renderSegments();
  drawPlaceholderWaveform();

  const media = activeMedia();
  els.video.removeAttribute("src");
  els.audio.removeAttribute("src");
  media.src = state.objectUrl;
  media.playbackRate = Number(els.speedSelect.value);
  media.load();

  await Promise.all([
    new Promise((resolveMetadata) => {
      media.onloadedmetadata = () => {
        state.duration = media.duration || 0;
        state.rangeStart = 0;
        state.rangeEnd = Math.min(state.duration, 5);
        syncRangeInputs();
        els.metaDuration.textContent = formatTime(state.duration);
        els.metaResolution.textContent = state.isVideo ? `${els.video.videoWidth} × ${els.video.videoHeight}` : "Audio only";
        syncButtons();
        updatePlayhead();
        renderRangeSelection();
        resolveMetadata();
      };
    }),
    uploadFile(file),
    drawWaveform(file)
  ]);
}

async function loadTauriMedia(mediaInfo) {
  const core = tauriApi();
  if (!core || !mediaInfo) return;

  state.file = { name: mediaInfo.name, size: mediaInfo.size, type: mediaInfo.mime || "" };
  state.uploadId = null;
  state.sourcePath = mediaInfo.path;
  state.duration = 0;
  state.rangeStart = 0;
  state.rangeEnd = 0;
  state.segments = [];

  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = mediaInfo.previewUrl || core.convertFileSrc(mediaInfo.path);
  state.isVideo = mediaInfo.kind === "video" || /\.(mp4|mov|mkv)$/i.test(mediaInfo.name);
  state.mediaEl = state.isVideo ? els.video : els.audio;

  els.dropZone.classList.add("hidden");
  els.editor.classList.remove("hidden");
  els.video.classList.toggle("hidden", !state.isVideo);
  els.audioPoster.classList.toggle("hidden", state.isVideo);
  els.sessionName.textContent = baseName(mediaInfo.name);
  els.projectName.value = baseName(mediaInfo.name);
  els.metaFile.textContent = mediaInfo.name;
  els.metaSize.textContent = formatBytes(mediaInfo.size);
  els.metaDuration.textContent = "Loading";
  els.metaResolution.textContent = state.isVideo ? "Loading" : "Audio";
  els.uploadState.textContent = "Ready";
  renderSegments();
  syncRangeInputs();
  syncButtons();
  drawPlaceholderWaveform();

  const media = activeMedia();
  els.video.removeAttribute("src");
  els.audio.removeAttribute("src");
  media.removeAttribute("src");
  media.src = state.objectUrl;
  media.crossOrigin = "anonymous";
  media.playbackRate = Number(els.speedSelect.value);
  media.load();
  media.onloadedmetadata = () => {
    state.duration = media.duration || 0;
    state.rangeStart = 0;
    state.rangeEnd = Math.min(state.duration, 5);
    syncRangeInputs();
    els.metaDuration.textContent = formatTime(state.duration);
    els.metaResolution.textContent = state.isVideo ? `${els.video.videoWidth} × ${els.video.videoHeight}` : "Audio only";
    syncButtons();
    updatePlayhead();
    renderRangeSelection();
    setStatus("Tauri: メディアを読み込みました。Start/Endで分段を設定できます。", 35);
  };
}

async function openTauriMedia() {
  const core = tauriApi();
  if (!core) return false;
  try {
    const mediaInfo = await core.invoke("select_media_file");
    if (mediaInfo) await loadTauriMedia(mediaInfo);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "ファイル選択に失敗しました。", 0);
  }
  return true;
}

function togglePlay() {
  const media = activeMedia();
  if (!media) return;
  if (media.paused) media.play();
  else media.pause();
}

async function runSplit() {
  if ((!state.uploadId && !state.sourcePath) || state.segments.length === 0) return;
  els.runSplitBtn.disabled = true;
  els.exportTopBtn.disabled = true;
  setStatus("FFmpegで一括分割しています...", 62);
  showProgressModal("変換中", "分割を開始しています...", 4);
  try {
    let payload;
    const core = tauriApi();
    if (core && state.sourcePath) {
      const outputs = [];
      let outputDir = null;
      const hasMediaOutput = els.videoOutput.checked || els.audioOutput.checked;
      const hasTranscriptOutput = els.transcriptOutput.checked && (els.transcriptTxt.checked || els.transcriptSrt.checked);
      const total = state.segments.length * (Number(hasMediaOutput) + Number(hasTranscriptOutput));
      let completed = 0;
      for (let index = 0; index < state.segments.length; index += 1) {
        if (hasMediaOutput) {
          updateProgressModal(`分段 ${index + 1} の動画/音声を書き出しています...`, Math.round((completed / total) * 92) + 4, outputDir || "");
          const segmentPayload = await core.invoke("split_media_segment", {
            sourcePath: state.sourcePath,
            request: buildSplitRequest([state.segments[index]]),
            segmentIndex: index,
            outputDir
          });
          outputDir = segmentPayload.outputDir;
          outputs.push(...segmentPayload.outputs);
          completed += 1;
          updateProgressModal(`分段 ${index + 1} の動画/音声が完了しました。`, Math.round((completed / total) * 92) + 4, outputDir);
        }

        if (hasTranscriptOutput) {
          updateProgressModal(`分段 ${index + 1} をWhisperで文字起こししています...`, Math.round((completed / total) * 92) + 4, outputDir || "");
          const transcriptPayload = await core.invoke("transcribe_media_segment", {
            sourcePath: state.sourcePath,
            request: buildSplitRequest([state.segments[index]]),
            segmentIndex: index,
            outputDir
          });
          outputDir = transcriptPayload.outputDir;
          outputs.push(...transcriptPayload.outputs);
          completed += 1;
          updateProgressModal(`分段 ${index + 1} の文字起こしが完了しました。`, Math.round((completed / total) * 92) + 4, outputDir);
        }
      }
      payload = { outputDir, outputs };
      if (payload.outputDir) {
        await core.invoke("open_folder", { path: payload.outputDir });
      }
    } else {
      const response = await fetch("/api/split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadId: state.uploadId,
          ...buildSplitRequest()
        })
      });
      payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Split failed");
    }
    updateProgressModal(`完了: ${payload.outputs.length}ファイルを書き出しました。`, 100, payload.outputDir);
    setStatus(`完了: ${payload.outputs.length}ファイルを書き出しました。${payload.outputDir}`, 100);
    hideProgressModal();
  } catch (error) {
    const message = error instanceof Error ? error.message : "分割に失敗しました。";
    setStatus(message, 0);
    updateProgressModal(message, 0);
    hideProgressModal(1800);
  } finally {
    syncButtons();
  }
}

els.fileInput.addEventListener("click", (event) => {
  if (!isTauriApp()) return;
  event.preventDefault();
  openTauriMedia();
});
els.fileInput.addEventListener("change", (event) => loadFile(event.target.files?.[0]));

["dragenter", "dragover"].forEach((name) => {
  els.dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    els.dropZone.classList.add("dragover");
  });
});

["dragleave", "drop"].forEach((name) => {
  els.dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    els.dropZone.classList.remove("dragover");
  });
});

els.dropZone.addEventListener("drop", (event) => {
  loadFile(event.dataTransfer?.files?.[0]);
});

els.playBtn.addEventListener("click", togglePlay);
els.backBtn.addEventListener("click", () => {
  const media = activeMedia();
  if (media) media.currentTime = Math.max(0, media.currentTime - 5);
});
els.setStartBtn.addEventListener("click", () => {
  const media = activeMedia();
  if (!media) return;
  state.rangeStart = Math.min(media.currentTime, state.duration);
  if (state.rangeEnd <= state.rangeStart) {
    state.rangeEnd = Math.min(state.duration, state.rangeStart + 5);
  }
  syncRangeInputs();
  setStatus(`Start: ${formatTime(state.rangeStart)}`);
});
els.setEndBtn.addEventListener("click", () => {
  const media = activeMedia();
  if (!media) return;
  state.rangeEnd = Math.min(media.currentTime, state.duration);
  syncRangeInputs();
  setStatus(`End: ${formatTime(state.rangeEnd)}`);
});
els.startInput.addEventListener("change", readRangeInputs);
els.endInput.addEventListener("change", readRangeInputs);
els.videoOutput.addEventListener("change", syncButtons);
els.audioOutput.addEventListener("change", syncButtons);
els.audioFormat.addEventListener("change", syncButtons);
els.transcriptOutput.addEventListener("change", syncButtons);
els.transcriptLanguage.addEventListener("change", syncButtons);
els.whisperModel.addEventListener("change", syncButtons);
els.transcriptTxt.addEventListener("change", syncButtons);
els.transcriptSrt.addEventListener("change", syncButtons);
els.addSegmentBtn.addEventListener("click", () => {
  const range = readRangeInputs();
  if (!range) return;
  addSegment(range.start, range.end);
});
els.runSplitBtn.addEventListener("click", runSplit);
els.exportTopBtn.addEventListener("click", runSplit);
els.speedSelect.addEventListener("change", () => {
  const media = activeMedia();
  if (media) media.playbackRate = Number(els.speedSelect.value);
});

els.timeline.addEventListener("click", (event) => {
  const media = activeMedia();
  if (!media || !state.duration) return;
  const rect = els.timeline.getBoundingClientRect();
  media.currentTime = ((event.clientX - rect.left) / rect.width) * state.duration;
});

for (const media of [els.video, els.audio]) {
  media.addEventListener("timeupdate", updatePlayhead);
  media.addEventListener("play", () => {
    els.playBtn.textContent = "Ⅱ";
  });
  media.addEventListener("pause", () => {
    els.playBtn.textContent = "▶";
  });
}

window.addEventListener("resize", () => {
  if (state.file) drawWaveform(state.file);
  renderSegmentMarks();
  renderRangeSelection();
});

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.code === "Space") {
    event.preventDefault();
    togglePlay();
  }
  if (event.key.toLowerCase() === "n") {
    const range = readRangeInputs();
    if (range) addSegment(range.start, range.end);
  }
});

syncButtons();
syncRangeInputs();
drawPlaceholderWaveform();
