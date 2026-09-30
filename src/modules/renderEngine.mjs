import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import config from "../config/index.mjs";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------
// HARD-CODED STABLE VIDEO SETTINGS
// ---------------------------------------------------------

const VIDEO_CODEC = "libx264";
const CRF = "23";
const PRESET = "medium";
const PIX_FMT = "yuv420p";

const VIDEO_WIDTH = 1080;
const VIDEO_HEIGHT = 1920;
const VIDEO_FPS = 30;

const MIN_DURATION = Number(
  config?.qualityConfig?.minDuration ??
  config?.videoConfig?.minDuration ??
  20
);

const MAX_DURATION = Number(
  config?.qualityConfig?.maxDuration ??
  config?.videoConfig?.maxDuration ??
  59
);

// ---------------------------------------------------------
// HELPERS
// ---------------------------------------------------------

function assertFile(filePath, label = "File") {
  if (!filePath) {
    throw new Error(`[RenderEngine] ${label} path is empty.`);
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `[RenderEngine] ${label} does not exist: ${filePath}`
    );
  }

  const stat = fs.statSync(filePath);

  if (!stat.isFile()) {
    throw new Error(
      `[RenderEngine] ${label} is not a file: ${filePath}`
    );
  }

  if (stat.size === 0) {
    throw new Error(
      `[RenderEngine] ${label} is empty: ${filePath}`
    );
  }
}

async function runFFmpeg(args) {
  console.log(
    `[RenderEngine] FFmpeg command: ffmpeg ${args.join(" ")}`
  );

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
      console.log(stderr);
    }

    return {
      stdout,
      stderr
    };
  } catch (error) {
    const stderr = error?.stderr || "";
    const stdout = error?.stdout || "";

    console.error("[RenderEngine] FFmpeg failed.");
    if (stdout) console.error(stdout);
    if (stderr) console.error(stderr);

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

// ---------------------------------------------------------
// MEDIA INFO
// ---------------------------------------------------------

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
      `[RenderEngine] Could not parse FFprobe output for: ${filePath}`
    );
  }

  const duration = Number(data?.format?.duration || 0);

  const streams = Array.isArray(data?.streams)
    ? data.streams
    : [];

  const videoStream =
    streams.find((stream) => stream.codec_type === "video") || null;

  const audioStream =
    streams.find((stream) => stream.codec_type === "audio") || null;

  return {
    path: filePath,
    duration,
    streams,
    hasVideo: Boolean(videoStream),
    hasAudio: Boolean(audioStream),
    video: videoStream
      ? {
          codec: videoStream.codec_name || null,
          width: Number(videoStream.width || 0),
          height: Number(videoStream.height || 0),
          fps: videoStream.r_frame_rate || null
        }
      : null,
    audio: audioStream
      ? {
          codec: audioStream.codec_name || null
        }
      : null
  };
}

// ---------------------------------------------------------
// NORMALIZE ONE VIDEO
// ---------------------------------------------------------

async function normalizeVideo(
  inputPath,
  outputPath,
  duration
) {
  assertFile(inputPath, "Scene video");

  const requestedDuration = Number(duration);

  if (
    !Number.isFinite(requestedDuration) ||
    requestedDuration <= 0
  ) {
    throw new Error(
      `[RenderEngine] Invalid scene duration: ${duration}`
    );
  }

  const outputDir = path.dirname(outputPath);

  fs.mkdirSync(outputDir, {
    recursive: true
  });

  console.log(
    `[RenderEngine] Normalizing video: ${inputPath}`
  );

  console.log(
    `[RenderEngine] Target duration: ${requestedDuration.toFixed(3)}s`
  );

  await runFFmpeg([
    "-y",

    "-stream_loop",
    "-1",

    "-i",
    inputPath,

    "-t",
    requestedDuration.toFixed(3),

    "-vf",
    `scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=increase,crop=${VIDEO_WIDTH}:${VIDEO_HEIGHT},setsar=1,fps=${VIDEO_FPS},format=${PIX_FMT}`,

    "-an",

    "-c:v",
    VIDEO_CODEC,

    "-pix_fmt",
    PIX_FMT,

    "-preset",
    PRESET,

    "-crf",
    CRF,

    "-movflags",
    "+faststart",

    outputPath
  ]);

  assertFile(outputPath, "Normalized video");

  const info = await getMediaInfo(outputPath);

  if (!info.hasVideo) {
    throw new Error(
      `[RenderEngine] Normalized video has no video stream: ${outputPath}`
    );
  }

  if (
    info.video.width !== VIDEO_WIDTH ||
    info.video.height !== VIDEO_HEIGHT
  ) {
    throw new Error(
      `[RenderEngine] Wrong video resolution: ${info.video.width}x${info.video.height}`
    );
  }

  if (info.duration < requestedDuration - 0.25) {
    throw new Error(
      `[RenderEngine] Normalized video is too short. Expected ${requestedDuration}s, got ${info.duration}s`
    );
  }

  return info;
}

// ---------------------------------------------------------
// COMBINE VIDEOS
// ---------------------------------------------------------

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
      "[RenderEngine] Scene durations must be an array."
    );
  }

  if (videoPaths.length !== durations.length) {
    throw new Error(
      `[RenderEngine] Video count (${videoPaths.length}) does not match duration count (${durations.length}).`
    );
  }

  fs.mkdirSync(workingDirectory, {
    recursive: true
  });

  console.log(
    `[RenderEngine] Combining ${videoPaths.length} scene videos...`
  );

  const normalizedPaths = [];

  for (let i = 0; i < videoPaths.length; i += 1) {
    const inputPath = videoPaths[i];

    const normalizedPath = path.join(
      workingDirectory,
      `normalized-scene-${String(i + 1).padStart(2, "0")}.mp4`
    );

    await normalizeVideo(
      inputPath,
      normalizedPath,
      durations[i]
    );

    normalizedPaths.push(normalizedPath);
  }

  const args = [
    "-y"
  ];

  for (const videoPath of normalizedPaths) {
    args.push(
      "-i",
      videoPath
    );
  }

  const labels = [];

  for (let i = 0; i < normalizedPaths.length; i += 1) {
    labels.push(
      `[${i}:v]setpts=PTS-STARTPTS[v${i}]`
    );
  }

  const inputLabels = normalizedPaths
    .map((_, i) => `[v${i}]`)
    .join("");

  const filterComplex = [
    labels.join(";"),
    `${inputLabels}concat=n=${normalizedPaths.length}:v=1:a=0[outv]`
  ].join(";");

  const combinedPath = path.join(
    workingDirectory,
    "combined-video.mp4"
  );

  args.push(
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
    CRF,

    "-r",
    String(VIDEO_FPS),

    "-movflags",
    "+faststart",

    combinedPath
  );

  await runFFmpeg(args);

  assertFile(
    combinedPath,
    "Combined video"
  );

  const info = await getMediaInfo(
    combinedPath
  );

  if (!info.hasVideo) {
    throw new Error(
      "[RenderEngine] Combined video contains no video stream."
    );
  }

  if (
    info.video.width !== VIDEO_WIDTH ||
    info.video.height !== VIDEO_HEIGHT
  ) {
    throw new Error(
      `[RenderEngine] Combined video resolution is ${info.video.width}x${info.video.height}, expected ${VIDEO_WIDTH}x${VIDEO_HEIGHT}.`
    );
  }

  console.log(
    `[RenderEngine] Combined video duration: ${info.duration.toFixed(3)}s`
  );

  return combinedPath;
}

// ---------------------------------------------------------
// CREATE TIMED AUDIO
// ---------------------------------------------------------

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
      "[RenderEngine] Audio durations must be an array."
    );
  }

  if (audioPaths.length !== durations.length) {
    throw new Error(
      `[RenderEngine] Audio count (${audioPaths.length}) does not match duration count (${durations.length}).`
    );
  }

  fs.mkdirSync(workingDirectory, {
    recursive: true
  });

  console.log(
    `[RenderEngine] Preparing ${audioPaths.length} timed audio tracks...`
  );

  const normalizedAudioPaths = [];

  for (let i = 0; i < audioPaths.length; i += 1) {
    const audioPath = audioPaths[i];

    assertFile(
      audioPath,
      `Scene audio ${i + 1}`
    );

    const duration = Number(
      durations[i]
    );

    if (
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      throw new Error(
        `[RenderEngine] Invalid audio duration for scene ${i + 1}: ${durations[i]}`
      );
    }

    const normalizedAudioPath = path.join(
      workingDirectory,
      `scene-audio-${String(i + 1).padStart(2, "0")}.m4a`
    );

    await runFFmpeg([
      "-y",

      "-i",
      audioPath,

      "-af",
      `aresample=48000,apad=pad_dur=${duration.toFixed(3)},atrim=duration=${duration.toFixed(3)}`,

      "-ar",
      "48000",

      "-ac",
      "2",

      "-c:a",
      "aac",

      "-b:a",
      "192k",

      normalizedAudioPath
    ]);

    assertFile(
      normalizedAudioPath,
      `Normalized scene audio ${i + 1}`
    );

    normalizedAudioPaths.push(
      normalizedAudioPath
    );
  }

  const args = [
    "-y"
  ];

  for (const audioPath of normalizedAudioPaths) {
    args.push(
      "-i",
      audioPath
    );
  }

  const audioLabels = normalizedAudioPaths
    .map((_, i) => `[${i}:a]`)
    .join("");

  const filterComplex =
    `${audioLabels}concat=n=${normalizedAudioPaths.length}:v=0:a=1[outa]`;

  const outputPath = path.join(
    workingDirectory,
    "complete-narration.m4a"
  );

  args.push(
    "-filter_complex",
    filterComplex,

    "-map",
    "[outa]",

    "-ar",
    "48000",

    "-ac",
    "2",

    "-c:a",
    "aac",

    "-b:a",
    "192k",

    outputPath
  );

  await runFFmpeg(args);

  assertFile(
    outputPath,
    "Complete narration"
  );

  return outputPath;
}

// ---------------------------------------------------------
// ADD VOICEOVER TO VIDEO
// ---------------------------------------------------------

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
    "Complete narration"
  );

  fs.mkdirSync(
    path.dirname(outputPath),
    {
      recursive: true
    }
  );

  console.log(
    "[RenderEngine] Adding complete narration to video..."
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
    CRF,

    "-c:a",
    "aac",

    "-b:a",
    "192k",

    "-ar",
    "48000",

    "-ac",
    "2",

    "-movflags",
    "+faststart",

    "-shortest",

    outputPath
  ]);

  assertFile(
    outputPath,
    "Final rendered video"
  );

  return outputPath;
}

// ---------------------------------------------------------
// FINAL VALIDATION
// ---------------------------------------------------------

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

  if (!info.hasVideo) {
    throw new Error(
      "[RenderEngine] Final video has no video stream."
    );
  }

  if (!info.hasAudio) {
    throw new Error(
      "[RenderEngine] Final video has no audio stream."
    );
  }

  if (
    info.video.width !== VIDEO_WIDTH ||
    info.video.height !== VIDEO_HEIGHT
  ) {
    throw new Error(
      `[RenderEngine] Final resolution ${info.video.width}x${info.video.height} is not ${VIDEO_WIDTH}x${VIDEO_HEIGHT}.`
    );
  }

  if (info.duration < MIN_DURATION) {
    throw new Error(
      `[RenderEngine] Final video is shorter than minimum ${MIN_DURATION}s: ${info.duration.toFixed(3)}s`
    );
  }

  if (info.duration > MAX_DURATION + 0.25) {
    throw new Error(
      `[RenderEngine] Final video exceeds maximum ${MAX_DURATION}s: ${info.duration.toFixed(3)}s`
    );
  }

  if (
    expectedDuration !== null &&
    Number.isFinite(Number(expectedDuration))
  ) {
    const difference =
      Math.abs(
        info.duration -
        Number(expectedDuration)
      );

    if (difference > 1.0) {
      throw new Error(
        `[RenderEngine] Final duration mismatch. Expected approximately ${expectedDuration}s, got ${info.duration.toFixed(3)}s.`
      );
    }
  }

  console.log(
    `[RenderEngine] FINAL QA PASS: ${info.duration.toFixed(3)}s | ${info.video.width}x${info.video.height} | video=${info.hasVideo} | audio=${info.hasAudio}`
  );

  return info;
}

// ---------------------------------------------------------
// COMPLETE RENDER PIPELINE
// ---------------------------------------------------------

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

  const sceneDurations =
    Array.isArray(options.sceneDurations)
      ? options.sceneDurations
      : [];

  const sceneAudioPaths =
    Array.isArray(options.sceneAudioPaths)
      ? options.sceneAudioPaths
      : [];

  if (sceneDurations.length !== videoPaths.length) {
    throw new Error(
      `[RenderEngine] Scene duration count ${sceneDurations.length} does not match video count ${videoPaths.length}.`
    );
  }

  if (sceneAudioPaths.length !== videoPaths.length) {
    throw new Error(
      `[RenderEngine] Scene audio count ${sceneAudioPaths.length} does not match video count ${videoPaths.length}.`
    );
  }

  const outputDirectory =
    path.dirname(outputPath);

  fs.mkdirSync(
    outputDirectory,
    {
      recursive: true
    }
  );

  const workingDirectory =
    path.join(
      outputDirectory,
      `.render-${Date.now()}`
    );

  fs.mkdirSync(
    workingDirectory,
    {
      recursive: true
    }
  );

  console.log(
    "[RenderEngine] ========================================"
  );

  console.log(
    "[RenderEngine] STARTING FINAL VIDEO RENDER"
  );

  console.log(
    `[RenderEngine] Scenes: ${videoPaths.length}`
  );

  console.log(
    `[RenderEngine] Output: ${outputPath}`
  );

  console.log(
    `[RenderEngine] Codec: ${VIDEO_CODEC}`
  );

  console.log(
    `[RenderEngine] Pixel format: ${PIX_FMT}`
  );

  console.log(
    `[RenderEngine] Preset: ${PRESET}`
  );

  console.log(
    `[RenderEngine] CRF: ${CRF}`
  );

  console.log(
    "[RenderEngine] ========================================"
  );

  try {
    // -----------------------------------------------------
    // STEP 1: COMBINE SCENE VIDEOS
    // -----------------------------------------------------

    const combinedVideoPath =
      await combineVideos(
        videoPaths,
        sceneDurations,
        workingDirectory
      );

    // -----------------------------------------------------
    // STEP 2: COMPLETE NARRATION
    // -----------------------------------------------------

    const completeAudioPath =
      await createTimedAudio(
        sceneAudioPaths,
        sceneDurations,
        workingDirectory
      );

    // -----------------------------------------------------
    // STEP 3: FINAL VIDEO + AUDIO
    // -----------------------------------------------------

    const renderedPath =
      path.join(
        workingDirectory,
        "rendered-final.mp4"
      );

    await addVoiceover(
      combinedVideoPath,
      completeAudioPath,
      renderedPath
    );

    // -----------------------------------------------------
    // STEP 4: CALCULATE EXPECTED DURATION
    // -----------------------------------------------------

    const expectedDuration =
      sceneDurations.reduce(
        (total, duration) =>
          total + Number(duration || 0),
        0
      );

    // -----------------------------------------------------
    // STEP 5: FINAL MEDIA QA
    // -----------------------------------------------------

    await validateRenderedVideo(
      renderedPath,
      expectedDuration
    );

    // -----------------------------------------------------
    // STEP 6: COPY FINAL MP4
    // -----------------------------------------------------

    fs.copyFileSync(
      renderedPath,
      outputPath
    );

    assertFile(
      outputPath,
      "Final output MP4"
    );

    // -----------------------------------------------------
    // STEP 7: VERIFY COPIED MP4
    // -----------------------------------------------------

    const finalInfo =
      await getMediaInfo(
        outputPath
      );

    await validateRenderedVideo(
      outputPath,
      expectedDuration
    );

    console.log(
      "[RenderEngine] ========================================"
    );

    console.log(
      "[RenderEngine] FINAL RENDER PASS"
    );

    console.log(
      `[RenderEngine] File: ${outputPath}`
    );

    console.log(
      `[RenderEngine] Duration: ${finalInfo.duration.toFixed(3)}s`
    );

    console.log(
      `[RenderEngine] Resolution: ${finalInfo.video.width}x${finalInfo.video.height}`
    );

    console.log(
      `[RenderEngine] Video: ${finalInfo.hasVideo}`
    );

    console.log(
      `[RenderEngine] Audio: ${finalInfo.hasAudio}`
    );

    console.log(
      "[RenderEngine] ========================================"
    );

    return {
      outputPath,
      duration: finalInfo.duration,
      width: finalInfo.video.width,
      height: finalInfo.video.height,
      hasVideo: finalInfo.hasVideo,
      hasAudio: finalInfo.hasAudio
    };
  } finally {
    // -----------------------------------------------------
    // CLEAN TEMP RENDER DIRECTORY
    // -----------------------------------------------------

    try {
      if (fs.existsSync(workingDirectory)) {
        fs.rmSync(
          workingDirectory,
          {
            recursive: true,
            force: true
          }
        );
      }
    } catch (cleanupError) {
      console.warn(
        `[RenderEngine] Temporary directory cleanup warning: ${cleanupError.message}`
      );
    }
  }
}

// ---------------------------------------------------------
// EXPORTS
// ---------------------------------------------------------

export {
  getMediaInfo,
  normalizeVideo,
  combineVideos,
  createTimedAudio,
  addVoiceover,
  validateRenderedVideo,
  renderFinalVideo
};