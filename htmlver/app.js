const state = {
  file: null,
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
  metaFile: $("metaFile"),
  metaDuration: $("metaDuration"),
  metaSize: $("metaSize"),
  metaResolution: $("metaResolution"),
  timeBadge: $("timeBadge")
};

function formatTime(value) {
  const totalMs = Math.max(0, Math.round(value * 1000));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  const head = hours > 0 ? `${String(hours).padStart(2, "0")}:` : "";
  return `${head}${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function parseTime(value) {
  const parts = String(value).trim().split(":");
  if (parts.length < 2 || parts.length > 3) return Number.NaN;
  const secondParts = parts.at(-1).split(".");
  const seconds = Number(secondParts[0]);
  const ms = Number((secondParts[1] || "0").padEnd(3, "0"));
  const minutes = Number(parts.at(-2));
  const hours = parts.length === 3 ? Number(parts[0]) : 0;
  if (![hours, minutes, seconds, ms].every(Number.isFinite) || minutes > 59 || seconds > 59) return Number.NaN;
  return hours * 3600 + minutes * 60 + seconds + ms / 1000;
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

function extension(fileName) {
  const match = fileName.match(/\.[^/.]+$/);
  return match ? match[0].toLowerCase() : ".mp4";
}

function setStatus(message, progress = null) {
  els.statusLine.textContent = message;
  if (progress !== null) els.progress.value = progress;
}

function activeMedia() {
  return state.mediaEl;
}

function syncButtons() {
  const mediaReady = Boolean(state.duration);
  const hasOutput = els.videoOutput.checked || els.audioOutput.checked;
  const hasSegments = state.segments.length > 0;
  els.addSegmentBtn.disabled = !mediaReady;
  els.setStartBtn.disabled = !mediaReady;
  els.setEndBtn.disabled = !mediaReady;
  els.audioFormat.disabled = !els.audioOutput.checked;
  els.runSplitBtn.disabled = !(mediaReady && hasSegments && hasOutput);
  els.exportTopBtn.disabled = !(mediaReady && hasSegments && hasOutput);
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
  els.selectedRange.style.display = right > left ? "block" : "none";
  els.selectedRange.style.left = `${left}%`;
  els.selectedRange.style.width = `${right - left}%`;
  els.startLine.style.display = "block";
  els.endLine.style.display = "block";
  els.startLine.style.left = `${(start / state.duration) * 100}%`;
  els.endLine.style.left = `${(end / state.duration) * 100}%`;
}

function syncRangeInputs() {
  els.startInput.value = formatTime(state.rangeStart);
  els.endInput.value = formatTime(state.rangeEnd);
  renderRangeSelection();
}

function readRangeInputs() {
  const start = parseTime(els.startInput.value);
  const end = parseTime(els.endInput.value);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    setStatus("Start/Endは 00:00.000 または 00:00:00.000 の形式で入力してください。");
    syncRangeInputs();
    return null;
  }
  state.rangeStart = Math.max(0, Math.min(start, state.duration));
  state.rangeEnd = Math.max(0, Math.min(end, state.duration));
  syncRangeInputs();
  return { start: state.rangeStart, end: state.rangeEnd };
}

function updatePlayhead() {
  const media = activeMedia();
  if (!media || !state.duration) return;
  els.playhead.style.left = `${Math.min(1, media.currentTime / state.duration) * 100}%`;
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
    const end = document.createElement("input");
    end.value = formatTime(segment.end);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "x";
    remove.title = "Remove segment";

    start.addEventListener("change", () => {
      const value = parseTime(start.value);
      if (Number.isFinite(value) && value >= 0 && value < segment.end) segment.start = value;
      renderSegments();
      renderSegmentMarks();
    });
    end.addEventListener("change", () => {
      const value = parseTime(end.value);
      if (Number.isFinite(value) && value > segment.start && value <= state.duration) segment.end = value;
      renderSegments();
      renderSegmentMarks();
    });
    remove.addEventListener("click", () => {
      state.segments.splice(index, 1);
      renderSegments();
      renderSegmentMarks();
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
    setStatus("区間が短すぎます。Start/Endを確認してください。");
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
    const mid = canvas.height / 2;
    ctx.fillStyle = "#181c1c";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(0,245,160,.82)";
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

function buildExportPlan() {
  const projectName = els.projectName.value || baseName(state.file.name);
  const ext = extension(state.file.name);
  const outputs = {
    video: els.videoOutput.checked,
    audioFormat: els.audioOutput.checked ? els.audioFormat.value : null
  };
  const segments = state.segments.map((segment, index) => {
    const number = String(index + 1).padStart(3, "0");
    const commands = [];
    if (outputs.video) {
      commands.push(`ffmpeg -i "${state.file.name}" -ss ${segment.start.toFixed(3)} -t ${(segment.end - segment.start).toFixed(3)} -map 0 -c copy -avoid_negative_ts make_zero "${projectName}_segment_${number}${ext}"`);
    }
    if (outputs.audioFormat) {
      const codec = outputs.audioFormat === "wav" ? "-c:a pcm_s16le" : "-c:a libmp3lame -b:a 192k";
      commands.push(`ffmpeg -i "${state.file.name}" -ss ${segment.start.toFixed(3)} -t ${(segment.end - segment.start).toFixed(3)} -vn -map 0:a:0 ${codec} "${projectName}_segment_${number}_audio.${outputs.audioFormat}"`);
    }
    return {
      index: index + 1,
      start: segment.start,
      end: segment.end,
      startText: formatTime(segment.start),
      endText: formatTime(segment.end),
      commands
    };
  });
  return {
    note: "Static HTML version cannot execute FFmpeg directly. Run these commands in the folder that contains the source media.",
    sourceFile: state.file.name,
    projectName,
    outputs,
    segments
  };
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function savePlan() {
  if (!state.file || state.segments.length === 0) return;
  const plan = buildExportPlan();
  downloadText(`${plan.projectName}_segments.json`, JSON.stringify(plan, null, 2));
  setStatus("静的版では実分割の代わりに、分段JSONとFFmpegコマンドを保存しました。", 100);
}

async function loadFile(file) {
  if (!file) return;
  state.file = file;
  state.duration = 0;
  state.rangeStart = 0;
  state.rangeEnd = 0;
  state.segments = [];
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
  els.metaResolution.textContent = state.isVideo ? "Loading" : "Audio only";
  els.uploadState.textContent = "Ready";
  renderSegments();
  syncRangeInputs();
  syncButtons();
  drawPlaceholderWaveform();

  const media = activeMedia();
  els.video.removeAttribute("src");
  els.audio.removeAttribute("src");
  media.src = state.objectUrl;
  media.playbackRate = Number(els.speedSelect.value);
  media.load();
  media.onloadedmetadata = () => {
    state.duration = media.duration || 0;
    state.rangeStart = 0;
    state.rangeEnd = Math.min(state.duration, 5);
    els.metaDuration.textContent = formatTime(state.duration);
    els.metaResolution.textContent = state.isVideo ? `${els.video.videoWidth} x ${els.video.videoHeight}` : "Audio only";
    syncRangeInputs();
    updatePlayhead();
    syncButtons();
    setStatus("静的版: 分段設定とFFmpegコマンド生成ができます。", 20);
  };
  await drawWaveform(file);
}

function togglePlay() {
  const media = activeMedia();
  if (!media) return;
  if (media.paused) media.play();
  else media.pause();
}

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
els.dropZone.addEventListener("drop", (event) => loadFile(event.dataTransfer?.files?.[0]));

els.playBtn.addEventListener("click", togglePlay);
els.backBtn.addEventListener("click", () => {
  const media = activeMedia();
  if (media) media.currentTime = Math.max(0, media.currentTime - 5);
});
els.setStartBtn.addEventListener("click", () => {
  const media = activeMedia();
  if (!media) return;
  state.rangeStart = Math.min(media.currentTime, state.duration);
  if (state.rangeEnd <= state.rangeStart) state.rangeEnd = Math.min(state.duration, state.rangeStart + 5);
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
els.addSegmentBtn.addEventListener("click", () => {
  const range = readRangeInputs();
  if (range) addSegment(range.start, range.end);
});
els.runSplitBtn.addEventListener("click", savePlan);
els.exportTopBtn.addEventListener("click", savePlan);
els.videoOutput.addEventListener("change", syncButtons);
els.audioOutput.addEventListener("change", syncButtons);
els.audioFormat.addEventListener("change", syncButtons);
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
    els.playBtn.textContent = "II";
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
