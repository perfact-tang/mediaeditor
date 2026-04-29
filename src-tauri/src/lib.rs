use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Seek, SeekFrom, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaInfo {
    path: String,
    name: String,
    size: u64,
    kind: String,
    mime: String,
    preview_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Segment {
    start: f64,
    end: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OutputSettings {
    #[serde(default)]
    video: bool,
    #[serde(default)]
    audio_format: Option<String>,
    #[serde(default)]
    transcript: bool,
    #[serde(default)]
    transcript_formats: Vec<String>,
    #[serde(default = "default_transcript_language")]
    transcript_language: String,
    #[serde(default = "default_whisper_model")]
    whisper_model: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SplitRequest {
    project_name: String,
    outputs: OutputSettings,
    segments: Vec<Segment>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SplitOutput {
    output_type: String,
    format: Option<String>,
    name: String,
    path: String,
    start: f64,
    end: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SplitResponse {
    output_dir: String,
    outputs: Vec<SplitOutput>,
}

struct TranscriptSegment {
    start_cs: i64,
    end_cs: i64,
    text: String,
}

#[derive(Clone)]
struct PreviewServer {
    port: u16,
    files: Arc<Mutex<HashMap<String, PathBuf>>>,
    counter: Arc<AtomicU64>,
}

impl PreviewServer {
    fn start() -> Result<Self, String> {
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
        let port = listener
            .local_addr()
            .map_err(|error| error.to_string())?
            .port();
        let files = Arc::new(Mutex::new(HashMap::new()));
        let thread_files = Arc::clone(&files);

        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let files = Arc::clone(&thread_files);
                thread::spawn(move || {
                    let _ = handle_preview_request(stream, files);
                });
            }
        });

        Ok(Self {
            port,
            files,
            counter: Arc::new(AtomicU64::new(1)),
        })
    }

    fn register(&self, path: PathBuf) -> Result<String, String> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_millis();
        let count = self.counter.fetch_add(1, Ordering::Relaxed);
        let token = format!("{now}-{count}");
        self.files
            .lock()
            .map_err(|_| "Preview server lock was poisoned.".to_string())?
            .insert(token.clone(), path);
        Ok(format!("http://127.0.0.1:{}/media/{}", self.port, token))
    }
}

fn handle_preview_request(
    mut stream: TcpStream,
    files: Arc<Mutex<HashMap<String, PathBuf>>>,
) -> Result<(), String> {
    let mut buffer = [0_u8; 8192];
    let read = stream
        .read(&mut buffer)
        .map_err(|error| error.to_string())?;
    let request = String::from_utf8_lossy(&buffer[..read]);
    let mut lines = request.lines();
    let Some(request_line) = lines.next() else {
        return Ok(());
    };
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let path = parts.next().unwrap_or_default();
    let token = path
        .trim_start_matches("/media/")
        .split('/')
        .next()
        .unwrap_or_default();
    let range_header = request
        .lines()
        .find_map(|line| line.strip_prefix("Range: bytes="));

    if method != "GET" && method != "HEAD" {
        write_response(
            &mut stream,
            "405 Method Not Allowed",
            &[("Content-Length", "0")],
            &[],
        )?;
        return Ok(());
    }

    let media_path = files
        .lock()
        .map_err(|_| "Preview server lock was poisoned.".to_string())?
        .get(token)
        .cloned();
    let Some(media_path) = media_path else {
        write_response(
            &mut stream,
            "404 Not Found",
            &[("Content-Length", "0")],
            &[],
        )?;
        return Ok(());
    };

    let mut file = fs::File::open(&media_path).map_err(|error| error.to_string())?;
    let size = file.metadata().map_err(|error| error.to_string())?.len();
    let mime = media_mime(&media_path);
    let (start, end, status) = parse_range(range_header, size);
    let content_len = end.saturating_sub(start).saturating_add(1);
    file.seek(SeekFrom::Start(start))
        .map_err(|error| error.to_string())?;

    let content_length = content_len.to_string();
    let content_range = format!("bytes {start}-{end}/{size}");
    let mut headers = vec![
        ("Content-Type", mime.as_str()),
        ("Accept-Ranges", "bytes"),
        ("Content-Length", content_length.as_str()),
        ("Access-Control-Allow-Origin", "*"),
    ];
    if status == "206 Partial Content" {
        headers.push(("Content-Range", content_range.as_str()));
    }

    write_headers(&mut stream, status, &headers)?;
    if method == "HEAD" {
        return Ok(());
    }

    let mut remaining = content_len;
    let mut chunk = [0_u8; 64 * 1024];
    while remaining > 0 {
        let limit = remaining.min(chunk.len() as u64) as usize;
        let read = file
            .read(&mut chunk[..limit])
            .map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        stream
            .write_all(&chunk[..read])
            .map_err(|error| error.to_string())?;
        remaining -= read as u64;
    }

    Ok(())
}

fn parse_range(range_header: Option<&str>, size: u64) -> (u64, u64, &'static str) {
    let default_end = size.saturating_sub(1);
    let Some(range) = range_header else {
        return (0, default_end, "200 OK");
    };
    let mut parts = range.split('-');
    let start = parts
        .next()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0)
        .min(default_end);
    let end = parts
        .next()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(default_end)
        .min(default_end);
    (start, end.max(start), "206 Partial Content")
}

fn write_response(
    stream: &mut TcpStream,
    status: &str,
    headers: &[(&str, &str)],
    body: &[u8],
) -> Result<(), String> {
    write_headers(stream, status, headers)?;
    stream.write_all(body).map_err(|error| error.to_string())
}

fn write_headers(
    stream: &mut TcpStream,
    status: &str,
    headers: &[(&str, &str)],
) -> Result<(), String> {
    write!(stream, "HTTP/1.1 {status}\r\n").map_err(|error| error.to_string())?;
    for (key, value) in headers {
        write!(stream, "{key}: {value}\r\n").map_err(|error| error.to_string())?;
    }
    write!(stream, "\r\n").map_err(|error| error.to_string())
}

fn sanitize_name(value: &str, fallback: &str) -> String {
    let stem = Path::new(value)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(value);
    let safe: String = stem
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .chars()
        .take(80)
        .collect();

    if safe.is_empty() {
        fallback.to_string()
    } else {
        safe
    }
}

fn default_transcript_language() -> String {
    "auto".to_string()
}

fn default_whisper_model() -> String {
    "base".to_string()
}

fn media_kind(path: &Path) -> String {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "mp3" | "wav" | "m4a" => "audio".to_string(),
        _ => "video".to_string(),
    }
}

fn media_mime(path: &Path) -> String {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        _ => "video/mp4",
    }
    .to_string()
}

fn bundled_ffmpeg_path(app: &AppHandle) -> Option<PathBuf> {
    let binary_name = if cfg!(target_os = "windows") {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };

    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("bin")
        .join(binary_name);
    if dev_path.is_file() {
        return Some(dev_path);
    }

    app.path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join("resources").join("bin").join(binary_name))
        .filter(|path| path.is_file())
}

fn run_ffmpeg(app: &AppHandle, args: &[String]) -> Result<(), String> {
    let command = bundled_ffmpeg_path(app).unwrap_or_else(|| PathBuf::from("ffmpeg"));
    let output = Command::new(&command)
        .args(args)
        .output()
        .map_err(|error| format!("failed to start ffmpeg at {}: {error}", command.display()))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(stderr.trim().to_string())
    }
}

fn video_args(source_path: &str, segment: &Segment, output_path: &Path) -> Vec<String> {
    vec![
        "-hide_banner".into(),
        "-y".into(),
        "-i".into(),
        source_path.into(),
        "-ss".into(),
        format!("{:.3}", segment.start),
        "-t".into(),
        format!("{:.3}", segment.end - segment.start),
        "-map".into(),
        "0".into(),
        "-c".into(),
        "copy".into(),
        "-avoid_negative_ts".into(),
        "make_zero".into(),
        output_path.to_string_lossy().to_string(),
    ]
}

fn audio_args(
    source_path: &str,
    segment: &Segment,
    format: &str,
    output_path: &Path,
) -> Vec<String> {
    let mut args = vec![
        "-hide_banner".into(),
        "-y".into(),
        "-i".into(),
        source_path.into(),
        "-ss".into(),
        format!("{:.3}", segment.start),
        "-t".into(),
        format!("{:.3}", segment.end - segment.start),
        "-vn".into(),
        "-map".into(),
        "0:a:0".into(),
    ];

    if format == "wav" {
        args.extend(["-c:a".into(), "pcm_s16le".into()]);
    } else {
        args.extend([
            "-c:a".into(),
            "libmp3lame".into(),
            "-b:a".into(),
            "192k".into(),
        ]);
    }

    args.push(output_path.to_string_lossy().to_string());
    args
}

fn transcript_audio_args(source_path: &str, segment: &Segment, output_path: &Path) -> Vec<String> {
    vec![
        "-hide_banner".into(),
        "-y".into(),
        "-i".into(),
        source_path.into(),
        "-ss".into(),
        format!("{:.3}", segment.start),
        "-t".into(),
        format!("{:.3}", segment.end - segment.start),
        "-vn".into(),
        "-map".into(),
        "0:a:0".into(),
        "-ac".into(),
        "1".into(),
        "-ar".into(),
        "16000".into(),
        "-c:a".into(),
        "pcm_s16le".into(),
        output_path.to_string_lossy().to_string(),
    ]
}

fn whisper_language_arg(value: &str) -> Option<&'static str> {
    match value {
        "ja" => Some("ja"),
        "en" => Some("en"),
        "zh" => Some("zh"),
        "ko" => Some("ko"),
        _ => None,
    }
}

fn transcript_formats(settings: &OutputSettings) -> Vec<String> {
    let mut formats: Vec<String> = settings
        .transcript_formats
        .iter()
        .filter(|format| format.as_str() == "txt" || format.as_str() == "srt")
        .cloned()
        .collect();
    formats.sort();
    formats.dedup();
    if formats.is_empty() {
        formats.push("txt".to_string());
    }
    formats
}

fn whisper_model_path(app: &AppHandle, settings: &OutputSettings) -> Result<PathBuf, String> {
    let model_name = match settings.whisper_model.as_str() {
        "tiny" => "ggml-tiny.bin",
        "small" => "ggml-small.bin",
        "medium" => "ggml-medium.bin",
        "large" => "ggml-large-v3.bin",
        _ => "ggml-base.bin",
    };

    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("models")
        .join(model_name);
    if dev_path.is_file() {
        return Ok(dev_path);
    }

    let resource_path = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("resources")
        .join("models")
        .join(model_name);
    if resource_path.is_file() {
        Ok(resource_path)
    } else {
        Err(format!(
            "Whisper model was not found: {}. The default bundled model is ggml-base.bin.",
            resource_path.display()
        ))
    }
}

fn read_mono_16k_wav(path: &Path) -> Result<Vec<f32>, String> {
    let mut reader = hound::WavReader::open(path).map_err(|error| error.to_string())?;
    let spec = reader.spec();
    if spec.channels != 1 || spec.sample_rate != 16_000 || spec.bits_per_sample != 16 {
        return Err("Expected a 16kHz mono 16-bit WAV for Whisper input.".to_string());
    }
    let samples: Vec<i16> = reader
        .samples::<i16>()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let mut audio = vec![0.0_f32; samples.len()];
    whisper_rs::convert_integer_to_float_audio(&samples, &mut audio)
        .map_err(|error| error.to_string())?;
    Ok(audio)
}

fn run_whisper(
    app: &AppHandle,
    audio_path: &Path,
    settings: &OutputSettings,
) -> Result<Vec<TranscriptSegment>, String> {
    let model_path = whisper_model_path(app, settings)?;
    let audio = read_mono_16k_wav(audio_path)?;
    let model_path_str = model_path.to_string_lossy();
    let ctx = WhisperContext::new_with_params(
        model_path_str.as_ref(),
        WhisperContextParameters::default(),
    )
    .map_err(|error| format!("failed to load Whisper model: {error}"))?;
    let mut state = ctx
        .create_state()
        .map_err(|error| format!("failed to create Whisper state: {error}"))?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_no_context(true);
    if let Some(language) = whisper_language_arg(&settings.transcript_language) {
        params.set_language(Some(language));
    } else {
        params.set_language(None);
        params.set_detect_language(true);
    }
    let threads = std::thread::available_parallelism()
        .map(|count| count.get().min(8) as i32)
        .unwrap_or(4);
    params.set_n_threads(threads);

    state
        .full(params, &audio)
        .map_err(|error| format!("Whisper transcription failed: {error}"))?;

    Ok(state
        .as_iter()
        .map(|segment| TranscriptSegment {
            start_cs: segment.start_timestamp(),
            end_cs: segment.end_timestamp(),
            text: segment.to_string().trim().to_string(),
        })
        .collect())
}

fn format_srt_timestamp(centiseconds: i64) -> String {
    let total_ms = centiseconds.max(0) * 10;
    let hours = total_ms / 3_600_000;
    let minutes = (total_ms % 3_600_000) / 60_000;
    let seconds = (total_ms % 60_000) / 1000;
    let millis = total_ms % 1000;
    format!("{hours:02}:{minutes:02}:{seconds:02},{millis:03}")
}

fn write_transcripts(
    target_dir: &Path,
    stem: &str,
    formats: &[String],
    segments: &[TranscriptSegment],
) -> Result<Vec<(String, PathBuf, String)>, String> {
    let mut outputs = Vec::new();
    if formats.iter().any(|format| format == "txt") {
        let output_name = format!("{stem}.txt");
        let output_path = target_dir.join(&output_name);
        let text = segments
            .iter()
            .map(|segment| segment.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(&output_path, text).map_err(|error| error.to_string())?;
        outputs.push(("txt".to_string(), output_path, output_name));
    }
    if formats.iter().any(|format| format == "srt") {
        let output_name = format!("{stem}.srt");
        let output_path = target_dir.join(&output_name);
        let mut srt = String::new();
        for (index, segment) in segments.iter().enumerate() {
            srt.push_str(&format!(
                "{}\n{} --> {}\n{}\n\n",
                index + 1,
                format_srt_timestamp(segment.start_cs),
                format_srt_timestamp(segment.end_cs),
                segment.text
            ));
        }
        fs::write(&output_path, srt).map_err(|error| error.to_string())?;
        outputs.push(("srt".to_string(), output_path, output_name));
    }
    Ok(outputs)
}

fn transcribe_to_dir(
    app: &AppHandle,
    source_path: &str,
    request: &SplitRequest,
    target_dir: &Path,
    segment_offset: usize,
) -> Result<Vec<SplitOutput>, String> {
    if !request.outputs.transcript {
        return Ok(Vec::new());
    }

    let formats = transcript_formats(&request.outputs);
    let project_name = sanitize_name(&request.project_name, "project");
    fs::create_dir_all(target_dir).map_err(|error| error.to_string())?;
    let valid_segments: Vec<&Segment> = request
        .segments
        .iter()
        .filter(|segment| {
            segment.start.is_finite() && segment.end.is_finite() && segment.end > segment.start
        })
        .collect();

    if valid_segments.is_empty() {
        return Err("No valid segments were supplied.".to_string());
    }

    let mut outputs = Vec::new();
    for (index, segment) in valid_segments.iter().enumerate() {
        let number = format!("{:03}", segment_offset + index + 1);
        let stem = format!("{project_name}_segment_{number}_transcript");
        let audio_path = target_dir.join(format!("{stem}.wav"));
        run_ffmpeg(
            app,
            &transcript_audio_args(source_path, segment, &audio_path),
        )?;
        let transcript_segments = run_whisper(app, &audio_path, &request.outputs)?;
        let _ = fs::remove_file(&audio_path);

        for (format, output_path, output_name) in
            write_transcripts(target_dir, &stem, &formats, &transcript_segments)?
        {
            outputs.push(SplitOutput {
                output_type: "transcript".to_string(),
                format: Some(format),
                name: output_name,
                path: output_path.to_string_lossy().to_string(),
                start: segment.start,
                end: segment.end,
            });
        }
    }
    Ok(outputs)
}

fn split_to_dir(
    app: &AppHandle,
    source_path: &str,
    source: &Path,
    request: &SplitRequest,
    target_dir: &Path,
    segment_offset: usize,
) -> Result<Vec<SplitOutput>, String> {
    let valid_segments: Vec<&Segment> = request
        .segments
        .iter()
        .filter(|segment| {
            segment.start.is_finite() && segment.end.is_finite() && segment.end > segment.start
        })
        .collect();

    if valid_segments.is_empty() {
        return Err("No valid segments were supplied.".to_string());
    }

    let audio_format = request.outputs.audio_format.as_deref().and_then(|format| {
        if format == "mp3" || format == "wav" {
            Some(format)
        } else {
            None
        }
    });

    if !request.outputs.video && audio_format.is_none() {
        return Err("Select at least one output: video or audio.".to_string());
    }

    let project_name = sanitize_name(&request.project_name, "project");
    fs::create_dir_all(target_dir).map_err(|error| error.to_string())?;

    let input_ext = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("mp4");
    let mut outputs = Vec::new();

    for (index, segment) in valid_segments.iter().enumerate() {
        let number = format!("{:03}", segment_offset + index + 1);

        if request.outputs.video {
            let output_name = format!("{project_name}_segment_{number}.{input_ext}");
            let output_path = target_dir.join(&output_name);
            run_ffmpeg(app, &video_args(source_path, segment, &output_path))?;
            outputs.push(SplitOutput {
                output_type: "video".to_string(),
                format: None,
                name: output_name,
                path: output_path.to_string_lossy().to_string(),
                start: segment.start,
                end: segment.end,
            });
        }

        if let Some(format) = audio_format {
            let output_name = format!("{project_name}_segment_{number}_audio.{format}");
            let output_path = target_dir.join(&output_name);
            run_ffmpeg(app, &audio_args(source_path, segment, format, &output_path))?;
            outputs.push(SplitOutput {
                output_type: "audio".to_string(),
                format: Some(format.to_string()),
                name: output_name,
                path: output_path.to_string_lossy().to_string(),
                start: segment.start,
                end: segment.end,
            });
        }
    }

    Ok(outputs)
}

fn default_output_dir(source: &Path, project_name: &str) -> PathBuf {
    let source_parent = source.parent().unwrap_or_else(|| Path::new("."));
    source_parent.join(format!(
        "{}_exports",
        sanitize_name(project_name, "project")
    ))
}

#[tauri::command]
fn select_media_file(server: State<'_, PreviewServer>) -> Result<Option<MediaInfo>, String> {
    let file = rfd::FileDialog::new()
        .add_filter("Media", &["mp4", "mov", "mkv", "mp3", "wav", "m4a"])
        .pick_file();

    let Some(path) = file else {
        return Ok(None);
    };

    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    let preview_url = server.register(path.clone())?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("media")
        .to_string();

    Ok(Some(MediaInfo {
        path: path.to_string_lossy().to_string(),
        name,
        size: metadata.len(),
        kind: media_kind(&path),
        mime: media_mime(&path),
        preview_url,
    }))
}

#[tauri::command]
fn split_media(
    app: AppHandle,
    source_path: String,
    request: SplitRequest,
) -> Result<SplitResponse, String> {
    let source = PathBuf::from(&source_path);
    if !source.is_file() {
        return Err("Source media file was not found.".to_string());
    }

    let target_dir = default_output_dir(&source, &request.project_name);
    let outputs = split_to_dir(&app, &source_path, &source, &request, &target_dir, 0)?;

    Ok(SplitResponse {
        output_dir: target_dir.to_string_lossy().to_string(),
        outputs,
    })
}

#[tauri::command]
fn split_media_segment(
    app: AppHandle,
    source_path: String,
    request: SplitRequest,
    segment_index: usize,
    output_dir: Option<String>,
) -> Result<SplitResponse, String> {
    let source = PathBuf::from(&source_path);
    if !source.is_file() {
        return Err("Source media file was not found.".to_string());
    }

    let target_dir = output_dir
        .map(PathBuf::from)
        .unwrap_or_else(|| default_output_dir(&source, &request.project_name));
    let outputs = split_to_dir(
        &app,
        &source_path,
        &source,
        &request,
        &target_dir,
        segment_index,
    )?;

    Ok(SplitResponse {
        output_dir: target_dir.to_string_lossy().to_string(),
        outputs,
    })
}

#[tauri::command]
fn transcribe_media_segment(
    app: AppHandle,
    source_path: String,
    request: SplitRequest,
    segment_index: usize,
    output_dir: Option<String>,
) -> Result<SplitResponse, String> {
    let source = PathBuf::from(&source_path);
    if !source.is_file() {
        return Err("Source media file was not found.".to_string());
    }

    let target_dir = output_dir
        .map(PathBuf::from)
        .unwrap_or_else(|| default_output_dir(&source, &request.project_name));
    let outputs = transcribe_to_dir(&app, &source_path, &request, &target_dir, segment_index)?;

    Ok(SplitResponse {
        output_dir: target_dir.to_string_lossy().to_string(),
        outputs,
    })
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    let opener = if cfg!(target_os = "macos") {
        ("open", vec![path])
    } else if cfg!(target_os = "windows") {
        ("explorer", vec![path])
    } else {
        ("xdg-open", vec![path])
    };

    Command::new(opener.0)
        .args(opener.1)
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn run() {
    let preview_server = PreviewServer::start().expect("failed to start preview server");
    tauri::Builder::default()
        .manage(preview_server)
        .invoke_handler(tauri::generate_handler![
            select_media_file,
            split_media,
            split_media_segment,
            transcribe_media_segment,
            open_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
