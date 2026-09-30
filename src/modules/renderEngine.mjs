import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import config from "../config/index.mjs";

const execFileAsync = promisify(execFile);

// ============================================================
// HARD-CODED VIDEO ENCODER SETTINGS
// ============================================================

const VIDEO_CODEC = "libx264";
const CRF = 23;
const PRESET = "medium";
const PIX_FMT = "yuv420p";

const VIDEO_WIDTH = 1080;
const VIDEO_HEIGHT = 1920;
const VIDEO_FPS = 30;

const AUDIO_SAMPLE_RATE = 48000;
const AUDIO_CHANNELS = 2;
const AUDIO_CODEC = "aac";
const AUDIO_BITRATE = "192k";

const MIN_DURATION = Number(config?.qualityConfig?.minDuration ?? 20);
const MAX_DURATION = Number(config?.qualityConfig?.maxDuration ?? 59);

// ============================================================
// HELPERS
// ============================================================

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function assertFile(filePath, label = "File") {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`[RenderEngine] ${label} not found: ${filePath}`);
  }

  const stat = fs.statSync(filePath);

  if (!stat.isFile() || stat.size <= 0) {
    throw new Error(`[RenderEngine] ${label} is empty or invalid: ${filePath}`);
  }
}

async function runFFmpeg(args) {
  console.log(`[RenderEngine] ffmpeg ${args.join(" ")}`);

  try {
    const { stdout, stderr } = await execFileAsync(
      "ffmpeg",
      args,
      {
        maxBuffer: 20 * 1024 * 1024
      }
    );

    if (stdout) {
      console.log(stdout);
    }

    if (stderr) {
      const lines = stderr
        .split("\n")
        .filter(Boolean)
        .slice(-12);

      for (const line of lines) {
        console.log(`[ffmpeg] ${line}`);
      }
    }

    return { stdout, stderr };
  } catch (error) {
    const stderr = error?.stderr || "";
    const stdout = error?.stdout || "";

    console.error("[RenderEngine] FFmpeg ERROR");

    if (stdout) {
      console.error(stdout);
    }

    if (stderr) {
      console.error(stderr);
    }

    throw new Error(
      `[RenderEngine] FFmpeg failed:\n${stderr || error.message}`
    );
  }
}

async function runFFprobe(args) {
  try {
    const { stdout, stderr } = await execFileAsync(
      "ffprobe",
      args,
      {
        maxBuffer: 10 * 1024 * 1024
      }
    );

    return {
      stdout,
      stderr
    };
  } catch (error) {
    const stderr = error?.stderr || "";

    throw new Error(
      `[RenderEngine] FFprobe failed:\n${stderr || error.message}`
    );
  }
}

async function getMediaInfo(filePath) {
  assertFile(filePath, "Media file");

  const { stdout } = await runFFprobe([
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-show_entries",
    "stream=index,codec_type,codec_name,width,height,r_frame_rate",
    "-of",
    "json",
    filePath
  ]);

  let data;

  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error(
      `[RenderEngine] Could not parse FFprobe output for ${filePath}`
    );
  }

  const duration = Number(data?.format?.duration || 0);
  const streams = Array.isArray(data?.streams)
    ? data.streams
    : [];

  const videoStream = streams.find(
    (stream) => stream.codec_type === "video"
  );

  const audioStream = streams.find(
    (stream) => stream.codec_type === "audio"
  );

  return {
    duration,
    streams,
    videoStream,
    audioStream
  };
}

// ============================================================
// NORMALIZE VIDEO
// ============================================================

async function normalizeVideo(
  inputPath,
  outputPath,
  requestedDuration
) {
  assertFile(inputPath, "Input scene video");

  ensureDir(path.dirname(outputPath));

  const duration = Math.max(
    0.15,
    Number(requestedDuration || 0)
  );

  if (!Number.isFinite(duration)) {
    throw new Error(
      `[RenderEngine] Invalid scene duration: ${requestedDuration}`
    );
  }

  console.log(
    `[RenderEngine] Normalizing scene for ${duration.toFixed(3)}s`
  );

  await runFFmpeg([
    "-y",

    "-stream_loop",
    "-1",

    "-i",
    inputPath,

    "-t",
    duration.toFixed(3),

    "-vf",
    `scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=increase,crop=${VIDEO_WIDTH}:${VIDEO_HEIGHT},setsar=1,format=${PIX_FMT}`,

    "-r",
    String(VIDEO_FPS),

    "-an",

    "-c:v",
    VIDEO_CODEC,

    "-pix_fmt",
    PIX_FMT,

    "-preset",
    PRESET,

    "-crf",
    String(CRF),

    "-movflags",
    "+faststart",

    outputPath
  ]);

  assertFile(outputPath, "Normalized scene");

  const info = await getMediaInfo(outputPath);

  if (!info.videoStream) {
    throw new Error(
      `[RenderEngine] Normalized scene has no video stream: ${outputPath}`
    );
  }

  if (
    Number(info.videoStream.width) !== VIDEO_WIDTH ||
    Number(info.videoStream.height) !== VIDEO_HEIGHT
  ) {
    throw new Error(
      `[RenderEngine] Invalid normalized resolution: ` +
      `${info.videoStream.width}x${info.videoStream.height}`
    );
  }

  if (info.duration < duration - 0.25) {
    throw new Error(
      `[RenderEngine] Normalized scene duration too short: ` +
      `${info.duration.toFixed(3)}s expected ${duration.toFixed(3)}s`
    );
  }

  return outputPath;
}

// ============================================================
// COMBINE VIDEOS
// ============================================================

async function combineVideos(
  videoPaths,
  durations,
  workingDirectory
) {
  if (!Array.isArray(videoPaths) || videoPaths.length === 0) {
    throw new Error(
      "[RenderEngine] No scene videos were provided."
    );
  }

  if (!Array.isArray(durations)) {
    throw new Error(
      "[RenderEngine] Scene durations are required."
    );
  }

  ensureDir(workingDirectory);

  const normalizedDirectory = path.join(
    workingDirectory,
    "normalized-scenes"
  );

  ensureDir(normalizedDirectory);

  const normalizedPaths = [];

  for (let index = 0; index < videoPaths.length; index += 1) {
    const inputPath = videoPaths[index];

    assertFile(
      inputPath,
      `Scene video ${index + 1}`
    );

    const duration = Number(
      durations[index] || 0
    );

    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(
        `[RenderEngine] Invalid duration for scene ${index + 1}: ${duration}`
      );
    }

    const normalizedPath = path.join(
      normalizedDirectory,
      `scene-${String(index + 1).padStart(2, "0")}.mp4`
    );

    await normalizeVideo(
      inputPath,
      normalizedPath,
      duration
    );

    normalizedPaths.push(normalizedPath);
  }

  console.log(
    `[RenderEngine] Combining ${normalizedPaths.length} normalized scenes...`
  );

  const ffmpegArgs = ["-y"];

  for (const videoPath of normalizedPaths) {
    ffmpegArgs.push(
      "-i",
      videoPath
    );
  }

  const labels = normalizedPaths
    .map(
      (_, index) =>
        `[${index}:v:0]setpts=PTS-STARTPTS[v${index}]`
    )
    .join(";");

  const concatInputs = normalizedPaths
    .map(
      (_, index) =>
        `[v${index}]`
    )
    .join("");

  const filterComplex =
    `${labels};${concatInputs}concat=n=${normalizedPaths.length}:v=1:a=0[outv]`;

  const combinedPath = path.join(
    workingDirectory,
    "combined-video.mp4"
  );

  ffmpegArgs.push(
    "-filter_complex",
    filterComplex,

    "-map",
    "[outv]",

    "-c:v",
    VIDEO_CODEC,

    "-pix_fmt",
    PIX_FMT,

    "-preset",
    PRESET,

    "-crf",
    String(CRF),

    "-r",
    String(VIDEO_FPS),

    "-movflags",
    "+faststart",

    combinedPath
  );

  await runFFmpeg(ffmpegArgs);

  assertFile(
    combinedPath,
    "Combined video"
  );

  const info = await getMediaInfo(
    combinedPath
  );

  if (!info.videoStream) {
    throw new Error(
      "[RenderEngine] Combined video has no video stream."
    );
  }

  if (
    Number(info.videoStream.width) !== VIDEO_WIDTH ||
    Number(info.videoStream.height) !== VIDEO_HEIGHT
  ) {
    throw new Error(
      `[RenderEngine] Combined video has invalid resolution: ` +
      `${info.videoStream.width}x${info.videoStream.height}`
    );
  }

  console.log(
    `[RenderEngine] Combined video duration: ${info.duration.toFixed(3)}s`
  );

  return combinedPath;
}

// ============================================================
// CREATE TIMED AUDIO
// ============================================================

async function createTimedAudio(
  audioPaths,
  durations,
  workingDirectory
) {
  if (!Array.isArray(audioPaths) || audioPaths.length === 0) {
    throw new Error(
      "[RenderEngine] No scene audio files were provided."
    );
  }

  if (!Array.isArray(durations)) {
    throw new Error(
      "[RenderEngine] Scene durations are required for audio."
    );
  }

  ensureDir(workingDirectory);

  const normalizedAudioDirectory = path.join(
    workingDirectory,
    "normalized-audio"
  );

  ensureDir(normalizedAudioDirectory);

  const normalizedAudioPaths = [];

  for (let index = 0; index < audioPaths.length; index += 1) {
    const inputPath = audioPaths[index];

    assertFile(
      inputPath,
      `Scene audio ${index + 1}`
    );

    const duration = Number(
      durations[index] || 0
    );

    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(
        `[RenderEngine] Invalid audio duration for scene ${index + 1}: ${duration}`
      );
    }

    const outputPath = path.join(
      normalizedAudioDirectory,
      `audio-${String(index + 1).padStart(2, "0")}.m4a`
    );

    console.log(
      `[RenderEngine] Normalizing audio ${index + 1}/${audioPaths.length} for ${duration.toFixed(3)}s`
    );

    await runFFmpeg([
      "-y",

      "-i",
      inputPath,

      "-t",
      duration.toFixed(3),

      "-af",
      `aresample=${AUDIO_SAMPLE_RATE},apad=pad_dur=${duration.toFixed(3)},atrim=duration=${duration.toFixed(3)}`,

      "-ar",
      String(AUDIO_SAMPLE_RATE),

      "-ac",
      String(AUDIO_CHANNELS),

      "-c:a",
      AUDIO_CODEC,

      "-b:a",
      AUDIO_BITRATE,

      outputPath
    ]);

    assertFile(
      outputPath,
      `Normalized audio ${index + 1}`
    );

    normalizedAudioPaths.push(
      outputPath
    );
  }

  console.log(
    `[RenderEngine] Combining ${normalizedAudioPaths.length} audio tracks...`
  );

  const ffmpegArgs = ["-y"];

  for (const audioPath of normalizedAudioPaths) {
    ffmpegArgs.push(
      "-i",
      audioPath
    );
  }

  const labels = normalizedAudioPaths
    .map(
      (_, index) =>
        `[${index}:a:0]asetpts=PTS-STARTPTS[a${index}]`
    )
    .join(";");

  const concatInputs = normalizedAudioPaths
    .map(
      (_, index) =>
        `[a${index}]`
    )
    .join("");

  const filterComplex =
    `${labels};${concatInputs}concat=n=${normalizedAudioPaths.length}:v=0:a=1[outa]`;

  const combinedAudioPath = path.join(
    workingDirectory,
    "complete-narration.m4a"
  );

  ffmpegArgs.push(
    "-filter_complex",
    filterComplex,

    "-map",
    "[outa]",

    "-ar",
    String(AUDIO_SAMPLE_RATE),

    "-ac",
    String(AUDIO_CHANNELS),

    "-c:a",
    AUDIO_CODEC,

    "-b:a",
    AUDIO_BITRATE,

    combinedAudioPath
  );

  await runFFmpeg(ffmpegArgs);

  assertFile(
    combinedAudioPath,
    "Combined narration"
  );

  return combinedAudioPath;
}

// ============================================================
// ADD VOICEOVER
// ============================================================

async function addVoiceover(
  videoPath,
  audioPath,
  outputPath
) {
  assertFile(
    videoPath,
    "Combined video"
  );

  assertFile(
    audioPath,
    "Narration audio"
  );

  ensureDir(path.dirname(outputPath));

  console.log(
    "[RenderEngine] Adding narration to final video..."
  );

  await runFFmpeg([
    "-y",

    "-i",
    videoPath,

    "-i",
    audioPath,

    "-map",
    "0:v:0",

    "-map",
    "1:a:0",

    "-c:v",
    VIDEO_CODEC,

    "-pix_fmt",
    PIX_FMT,

    "-preset",
    PRESET,

    "-crf",
    String(CRF),

    "-c:a",
    AUDIO_CODEC,

    "-b:a",
    AUDIO_BITRATE,

    "-ar",
    String(AUDIO_SAMPLE_RATE),

    "-ac",
    String(AUDIO_CHANNELS),

    "-shortest",

    "-movflags",
    "+faststart",

    outputPath
  ]);

  assertFile(
    outputPath,
    "Final rendered video"
  );

  return outputPath;
}

// ============================================================
// FINAL MEDIA VALIDATION
// ============================================================

async function validateRenderedVideo(
  filePath,
  expectedDuration = null
) {
  assertFile(
    filePath,
    "Rendered video"
  );

  const info = await getMediaInfo(
    filePath
  );

  if (!info.videoStream) {
    throw new Error(
      "[RenderEngine] Final video is missing video stream."
    );
  }

  if (!info.audioStream) {
    throw new Error(
      "[RenderEngine] Final video is missing audio stream."
    );
  }

  const width = Number(
    info.videoStream.width
  );

  const height = Number(
    info.videoStream.height
  );

  if (
    width !== VIDEO_WIDTH ||
    height !== VIDEO_HEIGHT
  ) {
    throw new Error(
      `[RenderEngine] Final resolution must be ${VIDEO_WIDTH}x${VIDEO_HEIGHT}, got ${width}x${height}`
    );
  }

  if (
    info.duration < MIN_DURATION ||
    info.duration > MAX_DURATION
  ) {
    throw new Error(
      `[RenderEngine] Final duration ${info.duration.toFixed(3)}s is outside allowed range ${MIN_DURATION}-${MAX_DURATION}s`
    );
  }

  if (
    expectedDuration !== null &&
    Number.isFinite(Number(expectedDuration))
  ) {
    const difference = Math.abs(
      info.duration -
      Number(expectedDuration)
    );

    if (difference > 1.5) {
      throw new Error(
        `[RenderEngine] Final duration mismatch. ` +
        `Expected approximately ${Number(expectedDuration).toFixed(3)}s, ` +
        `got ${info.duration.toFixed(3)}s`
      );
    }
  }

  console.log(
    `[RenderEngine] Final media QA PASS: ` +
    `${width}x${height}, ` +
    `${info.duration.toFixed(3)}s, ` +
    `video=${info.videoStream.codec_name}, ` +
    `audio=${info.audioStream.codec_name}`
  );

  return {
    valid: true,
    duration: info.duration,
    width,
    height,
    videoCodec: info.videoStream.codec_name,
    audioCodec: info.audioStream.codec_name
  };
}

// ============================================================
// MAIN RENDER FUNCTION
// Compatible with current orchestrator.mjs
// ============================================================

async function renderFinalVideo(
  videoPaths,
  audioPath,
  outputPath,
  options = {}
) {
  if (!Array.isArray(videoPaths) || videoPaths.length === 0) {
    throw new Error(
      "[RenderEngine] renderFinalVideo received no video paths."
    );
  }

  if (!outputPath) {
    throw new Error(
      "[RenderEngine] renderFinalVideo received no output path."
    );
  }

  const sceneDurations = Array.isArray(
    options.sceneDurations
  )
    ? options.sceneDurations
    : [];

  const sceneAudioPaths = Array.isArray(
    options.sceneAudioPaths
  )
    ? options.sceneAudioPaths
    : [];

  if (
    sceneDurations.length !== videoPaths.length
  ) {
    throw new Error(
      `[RenderEngine] Scene duration count mismatch. ` +
      `Videos=${videoPaths.length}, durations=${sceneDurations.length}`
    );
  }

  if (
    sceneAudioPaths.length !== videoPaths.length
  ) {
    throw new Error(
      `[RenderEngine] Scene audio count mismatch. ` +
      `Videos=${videoPaths.length}, audio=${sceneAudioPaths.length}`
    );
  }

  assertFile(
    audioPath,
    "Voiceover audio"
  );

  ensureDir(
    path.dirname(outputPath)
  );

  const workingDirectory = path.join(
    path.dirname(outputPath),
    `.render-work-${Date.now()}`
  );

  ensureDir(
    workingDirectory
  );

  try {
    console.log(
      `[RenderEngine] Starting final render with ${videoPaths.length} scenes...`
    );

    console.log(
      `[RenderEngine] Video encoder: ${VIDEO_CODEC}`
    );

    console.log(
      `[RenderEngine] CRF: ${CRF}`
    );

    console.log(
      `[RenderEngine] Preset: ${PRESET}`
    );

    console.log(
      `[RenderEngine] Pixel format: ${PIX_FMT}`
    );

    const combinedVideoPath =
      await combineVideos(
        videoPaths,
        sceneDurations,
        workingDirectory
      );

    const completeNarrationPath =
      await createTimedAudio(
        sceneAudioPaths,
        sceneDurations,
        workingDirectory
      );

    const finalWorkingPath =
      path.join(
        workingDirectory,
        "final-render.mp4"
      );

    await addVoiceover(
      combinedVideoPath,
      completeNarrationPath,
      finalWorkingPath
    );

    const expectedDuration =
      sceneDurations.reduce(
        (total, value) =>
          total + Number(value || 0),
        0
      );

    await validateRenderedVideo(
      finalWorkingPath,
      expectedDuration
    );

    fs.copyFileSync(
      finalWorkingPath,
      outputPath
    );

    assertFile(
      outputPath,
      "Final output"
    );

    console.log(
      `[RenderEngine] FINAL VIDEO CREATED: ${outputPath}`
    );

    return outputPath;
  } finally {
    try {
      fs.rmSync(
        workingDirectory,
        {
          recursive: true,
          force: true
        }
      );
    } catch (cleanupError) {
      console.warn(
        `[RenderEngine] Cleanup warning: ${cleanupError.message}`
      );
    }
  }
}

// ============================================================
// EXPORTS
// ============================================================

export {
  normalizeVideo,
  combineVideos,
  createTimedAudio,
  addVoiceover,
  validateRenderedVideo,
  renderFinalVideo
};