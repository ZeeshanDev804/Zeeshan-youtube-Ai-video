import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

import { config } from '../config/index.mjs';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------
// STABLE VIDEO SETTINGS
// ---------------------------------------------------------

const VIDEO_CODEC = 'libx264';
const CRF = '23';
const PRESET = 'medium';
const PIX_FMT = 'yuv420p';

const VIDEO_WIDTH = 1080;
const VIDEO_HEIGHT = 1920;
const VIDEO_FPS = 30;

const MIN_DURATION = Number(
  config?.videoConfig?.minDuration ??
  20
);

const MAX_DURATION = Number(
  config?.videoConfig?.maxDuration ??
  59
);

// ---------------------------------------------------------
// BACKGROUND MUSIC
// ---------------------------------------------------------

const MUSIC_VOLUME = Number(
  process.env.BACKGROUND_MUSIC_VOLUME ??
  0.10
);

const DEFAULT_MUSIC_PATH = path.resolve(
  process.env.BACKGROUND_MUSIC_PATH ||
  'output/music/background.mp3'
);

// ---------------------------------------------------------
// FILE HELPERS
// ---------------------------------------------------------

function assertFile(
  filePath,
  label = 'File'
) {
  if (!filePath) {
    throw new Error(
      `[RenderEngine] ${label} path is empty.`
    );
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

// ---------------------------------------------------------
// FFMPEG
// ---------------------------------------------------------

async function runFFmpeg(args) {
  console.log(
    `[RenderEngine] FFmpeg command: ffmpeg ${args.join(' ')}`
  );

  try {
    const {
      stdout,
      stderr
    } = await execFileAsync(
      'ffmpeg',
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
    const stderr =
      error?.stderr ||
      '';

    const stdout =
      error?.stdout ||
      '';

    console.error(
      '[RenderEngine] FFmpeg failed.'
    );

    if (stdout) {
      console.error(stdout);
    }

    if (stderr) {
      console.error(stderr);
    }

    throw new Error(
      `[RenderEngine] FFmpeg failed:\n${
        stderr ||
        error.message
      }`
    );
  }
}

// ---------------------------------------------------------
// FFPROBE
// ---------------------------------------------------------

async function runFFprobe(args) {
  try {
    const {
      stdout,
      stderr
    } = await execFileAsync(
      'ffprobe',
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
    const stderr =
      error?.stderr ||
      '';

    throw new Error(
      `[RenderEngine] FFprobe failed:\n${
        stderr ||
        error.message
      }`
    );
  }
}

// ---------------------------------------------------------
// MEDIA INFO
// ---------------------------------------------------------

async function getMediaInfo(filePath) {
  assertFile(
    filePath,
    'Media file'
  );

  const {
    stdout
  } = await runFFprobe([
    '-v',
    'error',

    '-show_entries',
    'format=duration',

    '-show_entries',
    'stream=index,codec_type,codec_name,width,height,r_frame_rate',

    '-of',
    'json',

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

  const duration = Number(
    data?.format?.duration ||
    0
  );

  const streams =
    Array.isArray(data?.streams)
      ? data.streams
      : [];

  const videoStream =
    streams.find(
      stream =>
        stream.codec_type === 'video'
    ) || null;

  const audioStream =
    streams.find(
      stream =>
        stream.codec_type === 'audio'
    ) || null;

  return {
    path: filePath,

    duration,

    streams,

    hasVideo:
      Boolean(videoStream),

    hasAudio:
      Boolean(audioStream),

    video: videoStream
      ? {
          codec:
            videoStream.codec_name ||
            null,

          width:
            Number(
              videoStream.width ||
              0
            ),

          height:
            Number(
              videoStream.height ||
              0
            ),

          fps:
            videoStream.r_frame_rate ||
            null
        }
      : null,

    audio: audioStream
      ? {
          codec:
            audioStream.codec_name ||
            null
        }
      : null
  };
}

// ---------------------------------------------------------
// NORMALIZE VIDEO
// ---------------------------------------------------------

async function normalizeVideo(
  inputPath,
  outputPath,
  duration
) {
  assertFile(
    inputPath,
    'Scene video'
  );

  const requestedDuration =
    Number(duration);

  if (
    !Number.isFinite(
      requestedDuration
    ) ||
    requestedDuration <= 0
  ) {
    throw new Error(
      `[RenderEngine] Invalid scene duration: ${duration}`
    );
  }

  fs.mkdirSync(
    path.dirname(outputPath),
    {
      recursive: true
    }
  );

  await runFFmpeg([
    '-y',

    '-stream_loop',
    '-1',

    '-i',
    inputPath,

    '-t',
    requestedDuration.toFixed(3),

    '-vf',
    `scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=increase,crop=${VIDEO_WIDTH}:${VIDEO_HEIGHT},setsar=1,fps=${VIDEO_FPS},format=${PIX_FMT}`,

    '-an',

    '-c:v',
    VIDEO_CODEC,

    '-pix_fmt',
    PIX_FMT,

    '-preset',
    PRESET,

    '-crf',
    CRF,

    '-movflags',
    '+faststart',

    outputPath
  ]);

  assertFile(
    outputPath,
    'Normalized video'
  );

  const info =
    await getMediaInfo(
      outputPath
    );

  if (!info.hasVideo) {
    throw new Error(
      `[RenderEngine] Normalized video has no video stream: ${outputPath}`
    );
  }

  if (
    info.video.width !==
      VIDEO_WIDTH ||
    info.video.height !==
      VIDEO_HEIGHT
  ) {
    throw new Error(
      `[RenderEngine] Wrong video resolution: ${info.video.width}x${info.video.height}`
    );
  }

  if (
    info.duration <
    requestedDuration - 0.25
  ) {
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
  if (
    !Array.isArray(videoPaths) ||
    videoPaths.length === 0
  ) {
    throw new Error(
      '[RenderEngine] No scene videos were provided.'
    );
  }

  if (!Array.isArray(durations)) {
    throw new Error(
      '[RenderEngine] Scene durations must be an array.'
    );
  }

  if (
    videoPaths.length !==
    durations.length
  ) {
    throw new Error(
      `[RenderEngine] Video count (${videoPaths.length}) does not match duration count (${durations.length}).`
    );
  }

  fs.mkdirSync(
    workingDirectory,
    {
      recursive: true
    }
  );

  const normalizedPaths = [];

  for (
    let i = 0;
    i < videoPaths.length;
    i += 1
  ) {
    const normalizedPath =
      path.join(
        workingDirectory,
        `normalized-scene-${String(
          i + 1
        ).padStart(2, '0')}.mp4`
      );

    await normalizeVideo(
      videoPaths[i],
      normalizedPath,
      durations[i]
    );

    normalizedPaths.push(
      normalizedPath
    );
  }

  const args = [
    '-y'
  ];

  for (
    const videoPath of
      normalizedPaths
  ) {
    args.push(
      '-i',
      videoPath
    );
  }

  const labels = [];

  for (
    let i = 0;
    i < normalizedPaths.length;
    i += 1
  ) {
    labels.push(
      `[${i}:v]setpts=PTS-STARTPTS[v${i}]`
    );
  }

  const inputLabels =
    normalizedPaths
      .map(
        (_, i) =>
          `[v${i}]`
      )
      .join('');

  const filterComplex = [
    labels.join(';'),

    `${inputLabels}concat=n=${normalizedPaths.length}:v=1:a=0[outv]`
  ].join(';');

  const combinedPath =
    path.join(
      workingDirectory,
      'combined-video.mp4'
    );

  args.push(
    '-filter_complex',
    filterComplex,

    '-map',
    '[outv]',

    '-c:v',
    VIDEO_CODEC,

    '-pix_fmt',
    PIX_FMT,

    '-preset',
    PRESET,

    '-crf',
    CRF,

    '-r',
    String(VIDEO_FPS),

    '-movflags',
    '+faststart',

    combinedPath
  );

  await runFFmpeg(args);

  assertFile(
    combinedPath,
    'Combined video'
  );

  const info =
    await getMediaInfo(
      combinedPath
    );

  if (!info.hasVideo) {
    throw new Error(
      '[RenderEngine] Combined video contains no video stream.'
    );
  }

  return combinedPath;
}

// ---------------------------------------------------------
// CREATE TIMED NARRATION
// ---------------------------------------------------------

async function createTimedAudio(
  audioPaths,
  durations,
  workingDirectory
) {
  if (
    !Array.isArray(audioPaths) ||
    audioPaths.length === 0
  ) {
    throw new Error(
      '[RenderEngine] No scene audio files were provided.'
    );
  }

  if (!Array.isArray(durations)) {
    throw new Error(
      '[RenderEngine] Audio durations must be an array.'
    );
  }

  if (
    audioPaths.length !==
    durations.length
  ) {
    throw new Error(
      `[RenderEngine] Audio count (${audioPaths.length}) does not match duration count (${durations.length}).`
    );
  }

  fs.mkdirSync(
    workingDirectory,
    {
      recursive: true
    }
  );

  const normalizedAudioPaths = [];

  for (
    let i = 0;
    i < audioPaths.length;
    i += 1
  ) {
    const audioPath =
      audioPaths[i];

    assertFile(
      audioPath,
      `Scene audio ${i + 1}`
    );

    const duration =
      Number(durations[i]);

    if (
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      throw new Error(
        `[RenderEngine] Invalid audio duration for scene ${i + 1}: ${durations[i]}`
      );
    }

    const normalizedAudioPath =
      path.join(
        workingDirectory,
        `scene-audio-${String(
          i + 1
        ).padStart(2, '0')}.m4a`
      );

    await runFFmpeg([
      '-y',

      '-i',
      audioPath,

      '-af',
      `aresample=48000,apad=pad_dur=${duration.toFixed(3)},atrim=duration=${duration.toFixed(3)}`,

      '-ar',
      '48000',

      '-ac',
      '2',

      '-c:a',
      'aac',

      '-b:a',
      '192k',

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
    '-y'
  ];

  for (
    const audioPath of
      normalizedAudioPaths
  ) {
    args.push(
      '-i',
      audioPath
    );
  }

  const audioLabels =
    normalizedAudioPaths
      .map(
        (_, i) =>
          `[${i}:a]`
      )
      .join('');

  const filterComplex =
    `${audioLabels}concat=n=${normalizedAudioPaths.length}:v=0:a=1[outa]`;

  const outputPath =
    path.join(
      workingDirectory,
      'complete-narration.m4a'
    );

  args.push(
    '-filter_complex',
    filterComplex,

    '-map',
    '[outa]',

    '-ar',
    '48000',

    '-ac',
    '2',

    '-c:a',
    'aac',

    '-b:a',
    '192k',

    outputPath
  );

  await runFFmpeg(args);

  assertFile(
    outputPath,
    'Complete narration'
  );

  return outputPath;
}

// ---------------------------------------------------------
// MUSIC PATH
// ---------------------------------------------------------

function getBackgroundMusicPath(
  options = {}
) {
  const suppliedPath =
    options.backgroundMusicPath ||
    process.env.BACKGROUND_MUSIC_PATH ||
    DEFAULT_MUSIC_PATH;

  return path.resolve(
    suppliedPath
  );
}

function validateMusicVolume() {
  if (
    !Number.isFinite(
      MUSIC_VOLUME
    ) ||
    MUSIC_VOLUME < 0 ||
    MUSIC_VOLUME > 1
  ) {
    throw new Error(
      `[RenderEngine] Background music volume must be between 0 and 1. Received: ${MUSIC_VOLUME}`
    );
  }
}

// ---------------------------------------------------------
// BACKGROUND MUSIC
// ---------------------------------------------------------

async function prepareBackgroundMusic(
  musicPath,
  duration,
  workingDirectory
) {
  validateMusicVolume();

  const requestedDuration =
    Number(duration);

  if (
    !Number.isFinite(
      requestedDuration
    ) ||
    requestedDuration <= 0
  ) {
    throw new Error(
      `[RenderEngine] Invalid background music duration: ${duration}`
    );
  }

  const outputPath =
    path.join(
      workingDirectory,
      'background-music.m4a'
    );

  fs.mkdirSync(
    workingDirectory,
    {
      recursive: true
    }
  );

  let sourceIsReadable =
    false;

  try {
    assertFile(
      musicPath,
      'Background music'
    );

    const probe =
      await runFFprobe([
        '-v',
        'error',

        '-select_streams',
        'a:0',

        '-show_entries',
        'stream=codec_name,duration',

        '-of',
        'json',

        musicPath
      ]);

    const data =
      JSON.parse(
        probe.stdout
      );

    const streams =
      Array.isArray(
        data?.streams
      )
        ? data.streams
        : [];

    sourceIsReadable =
      Boolean(
        streams[0]?.codec_name
      );
  } catch (error) {
    console.warn(
      `[RenderEngine] Background music validation failed: ${error.message}`
    );
  }

  async function createSilentBackgroundMusic() {
    await runFFmpeg([
      '-y',

      '-f',
      'lavfi',

      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=48000',

      '-t',
      requestedDuration.toFixed(3),

      '-vn',

      '-c:a',
      'aac',

      '-b:a',
      '192k',

      '-ar',
      '48000',

      '-ac',
      '2',

      outputPath
    ]);

    assertFile(
      outputPath,
      'Silent background music'
    );

    return outputPath;
  }

  if (!sourceIsReadable) {
    console.warn(
      '[RenderEngine] Invalid/corrupt background music detected. Using silent fallback.'
    );

    return createSilentBackgroundMusic();
  }

  try {
    await runFFmpeg([
      '-y',

      '-stream_loop',
      '-1',

      '-i',
      musicPath,

      '-t',
      requestedDuration.toFixed(3),

      '-vn',

      '-af',
      [
        `volume=${MUSIC_VOLUME}`,
        'aresample=48000',
        `apad=pad_dur=${requestedDuration.toFixed(3)}`,
        `atrim=duration=${requestedDuration.toFixed(3)}`,
        'asetpts=N/SR/TB'
      ].join(','),

      '-ar',
      '48000',

      '-ac',
      '2',

      '-c:a',
      'aac',

      '-b:a',
      '192k',

      outputPath
    ]);

    assertFile(
      outputPath,
      'Prepared background music'
    );

    return outputPath;
  } catch (error) {
    console.warn(
      `[RenderEngine] Music processing failed: ${error.message}`
    );

    console.warn(
      '[RenderEngine] Falling back to silent background music.'
    );

    return createSilentBackgroundMusic();
  }
}

// ---------------------------------------------------------
// MIX NARRATION + MUSIC
// ---------------------------------------------------------

async function mixNarrationWithMusic(
  narrationPath,
  musicPath,
  duration,
  outputPath
) {
  assertFile(
    narrationPath,
    'Narration'
  );

  assertFile(
    musicPath,
    'Prepared background music'
  );

  const requestedDuration =
    Number(duration);

  if (
    !Number.isFinite(
      requestedDuration
    ) ||
    requestedDuration <= 0
  ) {
    throw new Error(
      `[RenderEngine] Invalid mix duration: ${duration}`
    );
  }

  fs.mkdirSync(
    path.dirname(outputPath),
    {
      recursive: true
    }
  );

  const filterComplex = [
    '[0:a]aresample=48000,asetpts=PTS-STARTPTS[narration]',

    '[1:a]aresample=48000,asetpts=PTS-STARTPTS[music]',

    '[narration][music]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[mixed]',

    `[mixed]atrim=duration=${requestedDuration.toFixed(3)},asetpts=N/SR/TB[outa]`
  ].join(';');

  await runFFmpeg([
    '-y',

    '-i',
    narrationPath,

    '-i',
    musicPath,

    '-filter_complex',
    filterComplex,

    '-map',
    '[outa]',

    '-ar',
    '48000',

    '-ac',
    '2',

    '-c:a',
    'aac',

    '-b:a',
    '192k',

    outputPath
  ]);

  assertFile(
    outputPath,
    'Mixed narration and music'
  );

  return outputPath;
}

// ---------------------------------------------------------
// ADD AUDIO TO VIDEO
// ---------------------------------------------------------

async function addVoiceover(
  videoPath,
  audioPath,
  outputPath
) {
  assertFile(
    videoPath,
    'Combined video'
  );

  assertFile(
    audioPath,
    'Final mixed audio'
  );

  fs.mkdirSync(
    path.dirname(outputPath),
    {
      recursive: true
    }
  );

  await runFFmpeg([
    '-y',

    '-i',
    videoPath,

    '-i',
    audioPath,

    '-map',
    '0:v:0',

    '-map',
    '1:a:0',

    '-c:v',
    VIDEO_CODEC,

    '-pix_fmt',
    PIX_FMT,

    '-preset',
    PRESET,

    '-crf',
    CRF,

    '-c:a',
    'aac',

    '-b:a',
    '192k',

    '-ar',
    '48000',

    '-ac',
    '2',

    '-movflags',
    '+faststart',

    '-shortest',

    outputPath
  ]);

  assertFile(
    outputPath,
    'Final rendered video'
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
    'Rendered video'
  );

  const info =
    await getMediaInfo(
      filePath
    );

  if (!info.hasVideo) {
    throw new Error(
      '[RenderEngine] Final video has no video stream.'
    );
  }

  if (!info.hasAudio) {
    throw new Error(
      '[RenderEngine] Final video has no audio stream.'
    );
  }

  if (
    info.video.width !==
      VIDEO_WIDTH ||
    info.video.height !==
      VIDEO_HEIGHT
  ) {
    throw new Error(
      `[RenderEngine] Final resolution ${info.video.width}x${info.video.height} is not ${VIDEO_WIDTH}x${VIDEO_HEIGHT}.`
    );
  }

  if (
    info.duration <
    MIN_DURATION
  ) {
    throw new Error(
      `[RenderEngine] Final video is shorter than minimum ${MIN_DURATION}s: ${info.duration.toFixed(3)}s`
    );
  }

  if (
    info.duration >
    MAX_DURATION + 0.25
  ) {
    throw new Error(
      `[RenderEngine] Final video exceeds maximum ${MAX_DURATION}s: ${info.duration.toFixed(3)}s`
    );
  }

  if (
    expectedDuration !== null &&
    Number.isFinite(
      Number(expectedDuration)
    )
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
  if (
    !Array.isArray(videoPaths) ||
    videoPaths.length === 0
  ) {
    throw new Error(
      '[RenderEngine] renderFinalVideo received no video paths.'
    );
  }

  const sceneDurations =
    Array.isArray(
      options.sceneDurations
    )
      ? options.sceneDurations
      : [];

  const sceneAudioPaths =
    Array.isArray(
      options.sceneAudioPaths
    )
      ? options.sceneAudioPaths
      : [];

  if (
    sceneDurations.length !==
    videoPaths.length
  ) {
    throw new Error(
      `[RenderEngine] Scene duration count ${sceneDurations.length} does not match video count ${videoPaths.length}.`
    );
  }

  if (
    sceneAudioPaths.length !==
    videoPaths.length
  ) {
    throw new Error(
      `[RenderEngine] Scene audio count ${sceneAudioPaths.length} does not match video count ${videoPaths.length}.`
    );
  }

  fs.mkdirSync(
    path.dirname(outputPath),
    {
      recursive: true
    }
  );

  const workingDirectory =
    path.join(
      path.dirname(outputPath),
      `.render-${Date.now()}`
    );

  fs.mkdirSync(
    workingDirectory,
    {
      recursive: true
    }
  );

  try {
    // -----------------------------------------------------
    // 1. SCENE VIDEOS
    // -----------------------------------------------------

    const combinedVideoPath =
      await combineVideos(
        videoPaths,
        sceneDurations,
        workingDirectory
      );

    // -----------------------------------------------------
    // 2. SCENE NARRATION
    // -----------------------------------------------------

    const completeNarrationPath =
      await createTimedAudio(
        sceneAudioPaths,
        sceneDurations,
        workingDirectory
      );

    // -----------------------------------------------------
    // 3. EXPECTED DURATION
    // -----------------------------------------------------

    const expectedDuration =
      sceneDurations.reduce(
        (
          total,
          duration
        ) =>
          total +
          Number(
            duration || 0
          ),
        0
      );

    if (
      !Number.isFinite(
        expectedDuration
      ) ||
      expectedDuration <= 0
    ) {
      throw new Error(
        '[RenderEngine] Could not calculate expected final duration.'
      );
    }

    // -----------------------------------------------------
    // 4. BACKGROUND MUSIC
    // -----------------------------------------------------

    const backgroundMusicPath =
      getBackgroundMusicPath(
        options
      );

    const preparedMusicPath =
      await prepareBackgroundMusic(
        backgroundMusicPath,
        expectedDuration,
        workingDirectory
      );

    // -----------------------------------------------------
    // 5. MIX AUDIO
    // -----------------------------------------------------

    const mixedAudioPath =
      path.join(
        workingDirectory,
        'final-mixed-audio.m4a'
      );

    await mixNarrationWithMusic(
      completeNarrationPath,
      preparedMusicPath,
      expectedDuration,
      mixedAudioPath
    );

    // -----------------------------------------------------
    // 6. FINAL MP4
    // -----------------------------------------------------

    const renderedPath =
      path.join(
        workingDirectory,
        'rendered-final.mp4'
      );

    await addVoiceover(
      combinedVideoPath,
      mixedAudioPath,
      renderedPath
    );

    // -----------------------------------------------------
    // 7. VALIDATE TEMP FINAL
    // -----------------------------------------------------

    await validateRenderedVideo(
      renderedPath,
      expectedDuration
    );

    // -----------------------------------------------------
    // 8. COPY TO FINAL OUTPUT
    // -----------------------------------------------------

    fs.copyFileSync(
      renderedPath,
      outputPath
    );

    // -----------------------------------------------------
    // 9. VALIDATE FINAL OUTPUT
    // -----------------------------------------------------

    const finalInfo =
      await validateRenderedVideo(
        outputPath,
        expectedDuration
      );

    console.log(
      '[RenderEngine] FINAL RENDER PASS'
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

    return {
      outputPath,

      duration:
        finalInfo.duration,

      width:
        finalInfo.video.width,

      height:
        finalInfo.video.height,

      hasVideo:
        finalInfo.hasVideo,

      hasAudio:
        finalInfo.hasAudio,

      backgroundMusic:
        true,

      backgroundMusicPath,

      backgroundMusicVolume:
        MUSIC_VOLUME
    };
  } finally {
    try {
      if (
        fs.existsSync(
          workingDirectory
        )
      ) {
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
  prepareBackgroundMusic,
  mixNarrationWithMusic,
  addVoiceover,
  validateRenderedVideo,
  renderFinalVideo
};