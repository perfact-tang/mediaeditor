import fs from "node:fs";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

if (!ffmpegPath) {
  throw new Error("ffmpeg-static did not provide a binary for this platform.");
}

const repoRoot = path.resolve(import.meta.dirname, "..");
const targetDir = path.join(repoRoot, "src-tauri", "resources", "bin");
const targetName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
const targetPath = path.join(targetDir, targetName);

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(ffmpegPath, targetPath);

if (process.platform !== "win32") {
  fs.chmodSync(targetPath, 0o755);
}

console.log(`Prepared FFmpeg: ${targetPath}`);
