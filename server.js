import { createServer } from "node:http";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const root = process.cwd();
const publicDir = join(root, "public");
const uploadDir = join(root, "uploads");
const exportDir = join(root, "exports");
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "127.0.0.1";

const uploads = new Map();

await mkdir(publicDir, { recursive: true });
await mkdir(uploadDir, { recursive: true });
await mkdir(exportDir, { recursive: true });

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sanitizeName(value, fallback = "media") {
  const safe = String(value || fallback)
    .replace(/\.[^/.]+$/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return safe || fallback;
}

function sanitizeExt(filename) {
  const ext = extname(filename || "").toLowerCase();
  return [".mp4", ".mov", ".mkv", ".mp3", ".wav", ".m4a"].includes(ext) ? ext : ".mp4";
}

function resolvePublicPath(urlPath) {
  const requested = urlPath === "/" ? "/index.html" : urlPath;
  const decoded = decodeURIComponent(requested.split("?")[0]);
  const filePath = normalize(join(publicDir, decoded));
  if (!filePath.startsWith(publicDir)) return null;
  return filePath;
}

function collectBody(req) {
  return new Promise((resolveBody, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolveBody(body));
    req.on("error", reject);
  });
}

function runFfmpeg(args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(stderr.trim() || `ffmpeg exited with ${code}`));
    });
  });
}

function normalizeOutputs(value) {
  const requested = value && typeof value === "object" ? value : {};
  const audioFormat = requested.audioFormat === "wav" || requested.audioFormat === "mp3" ? requested.audioFormat : null;
  return {
    video: requested.video !== false,
    audioFormat
  };
}

function buildVideoArgs(upload, segment, outputPath) {
  return [
    "-hide_banner",
    "-y",
    "-i",
    upload.filePath,
    "-ss",
    segment.start.toFixed(3),
    "-t",
    (segment.end - segment.start).toFixed(3),
    "-map",
    "0",
    "-c",
    "copy",
    "-avoid_negative_ts",
    "make_zero",
    outputPath
  ];
}

function buildAudioArgs(upload, segment, format, outputPath) {
  const codecArgs = format === "wav" ? ["-c:a", "pcm_s16le"] : ["-c:a", "libmp3lame", "-b:a", "192k"];
  return [
    "-hide_banner",
    "-y",
    "-i",
    upload.filePath,
    "-ss",
    segment.start.toFixed(3),
    "-t",
    (segment.end - segment.start).toFixed(3),
    "-vn",
    "-map",
    "0:a:0",
    ...codecArgs,
    outputPath
  ];
}

async function handleUpload(req, res, url) {
  const filename = url.searchParams.get("filename") || "media.mp4";
  const id = randomUUID();
  const ext = sanitizeExt(filename);
  const originalName = sanitizeName(filename, "media");
  const storedName = `${id}${ext}`;
  const filePath = join(uploadDir, storedName);

  await pipeline(req, createWriteStream(filePath));
  const info = await stat(filePath);
  uploads.set(id, { id, filePath, originalName, ext, filename, size: info.size });
  sendJson(res, 200, { id, originalName, ext, size: info.size });
}

async function handleSplit(req, res) {
  const payload = JSON.parse(await collectBody(req));
  const upload = uploads.get(payload.uploadId);
  if (!upload) {
    sendJson(res, 404, { error: "Uploaded file was not found. Please import it again." });
    return;
  }

  const rawSegments = Array.isArray(payload.segments) ? payload.segments : [];
  const segments = rawSegments
    .map((segment, index) => ({
      index,
      start: Number(segment.start),
      end: Number(segment.end)
    }))
    .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start);

  if (segments.length === 0) {
    sendJson(res, 400, { error: "No valid segments were supplied." });
    return;
  }

  const requestedOutputs = normalizeOutputs(payload.outputs);
  if (!requestedOutputs.video && !requestedOutputs.audioFormat) {
    sendJson(res, 400, { error: "Select at least one output: video or audio." });
    return;
  }

  const projectName = sanitizeName(payload.projectName || upload.originalName, "project");
  const targetDir = join(exportDir, projectName);
  await mkdir(targetDir, { recursive: true });

  const outputs = [];
  for (const segment of segments) {
    const number = String(segment.index + 1).padStart(3, "0");
    if (requestedOutputs.video) {
      const outputName = `${projectName}_segment_${number}${upload.ext}`;
      const outputPath = join(targetDir, outputName);
      await runFfmpeg(buildVideoArgs(upload, segment, outputPath));
      outputs.push({ type: "video", name: outputName, path: outputPath, start: segment.start, end: segment.end });
    }

    if (requestedOutputs.audioFormat) {
      const outputName = `${projectName}_segment_${number}_audio.${requestedOutputs.audioFormat}`;
      const outputPath = join(targetDir, outputName);
      await runFfmpeg(buildAudioArgs(upload, segment, requestedOutputs.audioFormat, outputPath));
      outputs.push({ type: "audio", format: requestedOutputs.audioFormat, name: outputName, path: outputPath, start: segment.start, end: segment.end });
    }
  }

  sendJson(res, 200, { outputDir: targetDir, outputs });
}

async function handleListExports(_req, res) {
  const entries = await readdir(exportDir, { withFileTypes: true });
  sendJson(res, 200, {
    exports: entries.filter((entry) => entry.isDirectory()).map((entry) => join(exportDir, entry.name))
  });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/api/upload") {
      await handleUpload(req, res, url);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/split") {
      await handleSplit(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/exports") {
      await handleListExports(req, res);
      return;
    }

    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Method not allowed." });
      return;
    }

    const filePath = resolvePublicPath(url.pathname);
    if (!filePath) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    const fileInfo = await stat(filePath);
    if (!fileInfo.isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, { "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream" });
    createReadStream(filePath).pipe(res);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    sendJson(res, 500, { error: message });
  }
});

server.listen(port, host, () => {
  console.log(`MediaSplitter AI MVP running at http://${host}:${port}`);
  console.log(`Exports will be written to ${resolve(exportDir)}`);
});
