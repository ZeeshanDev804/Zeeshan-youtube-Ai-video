import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

import { config } from '../config/index.mjs';

const execFileAsync = promisify(execFile);

function ensureDirectory(directory) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, {
      recursive: true
    });
  }
}

async function runFFmpeg(args) {
  console.log(
    `[RenderEngine] ffmpeg ${args.join(' ')}`
  );

  try {
    return await execFileAsync(
      'ffmpeg',
      args,
      {
        maxBuffer: 20 * 1024 * 1024
      }
    );
  } catch (error) {
    const stderr = String(
      error?.stderr ||
      error?.message ||
      error
    ).trim();

    throw new Error(
      `[RenderEngine] FFmpeg failed:\n${stderr}`
    );
  }
}

async function runFFprobe(args) {
  try {
    return await execFileAsync(
      'ffprobe',
      args,
      {
        maxBuffer: 20 * 1024 * 1024
      }
    );
  } catch (error) {
    const stderr = String(
      error?.stderr ||
      error?.message ||
      error
    ).trim();

    throw new Error(
      `[RenderEngine] FFprobe failed:\n${stderr}`
    );
  }
}

async function getMediaInfo(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `[RenderEngine] Media file not found: ${filePath}`
    );
  }

  const { stdout } = await runFFprobe([
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-show_entries',
    'stream=index,codec_type,width,height,codec_name,sample_rate,channels,r_frame_rate',
    '-of',
    'json',
    filePath
  ]);

  let data;

  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error(
      `[RenderEngine] Invalid FFprobe JSON for: ${filePath}`
    );
  }

  const streams = Array.isArray(data?.streams)
    ? data.streams
    : [];

  const video = streams.find(
    stream =>
      stream.codec_type === 'video'
  );

  const audio = streams.find(
    stream =>
      stream.codec_type === 'audio'
  );

  return {
    duration: Number(
      data?.format?.duration || 0
    ),

    hasVideo: Boolean(video),

    hasAudio: Boolean(audio),

    width: Number(
      video?.width || 0
    ),

    height: Number(
      video?.height || 0
    ),

    videoCodec:
      video?.codec_name || '',

    audioCodec:
      audio?.codec_name || '',

    sampleRate: Number(
      audio?.sample_rate || 0
    ),

    channels: Number(
      audio?.channels || 0
    ),

    frameRate:
      video?.r_frame_rate || ''
  };
}

async function normalizeVideo(
  inputPath,
  outputPath,
  duration
) {
  ensureDirectory(
    path.dirname(
      path.resolve(outputPath)
    )
  );

  if (!fs.existsSync(inputPath)) {
    throw new Error(
      `[RenderEngine] Input video not found: ${inputPath}`
    );
  }

  const requestedDuration = Number(duration);

  if (
    !Number.isFinite(requestedDuration) ||
    requestedDuration <= 0
  ) {
    throw new Error(
      `[RenderEngine] Invalid scene duration: ${duration}`
    );
  }

  /*
   * We loop the source video so short stock clips
   * can safely cover the complete narration duration.
   *
   * The final output is always:
   * 1080x1920
   * configured FPS
   * H.264
   * no audio
   */
  await runFFmpeg([
    '-y',

    '-stream_loop',
    '-1',

    '-i',
    inputPath,

    '-t',
    String(requestedDuration),

    '-vf',
    [
      `scale=${config.videoConfig.width}:${config.videoConfig.height}:force_original_aspect_ratio=increase`,
      `crop=${config.videoConfig.width}:${config.videoConfig.height}`,
      'setsar=1',
      'format=yuv420p'
    ].join(','),

    '-r',
    String(config.videoConfig.fps),

    '-an',

    '-c:v',
    config.videoConfig.videoCodec,

    '-pix_fmt',
    config.videoConfig.pixelFormat,

    '-preset',
    'medium',

    '-crf',
    String(config.videoConfig.crf),

    '-movflags',
    '+faststart',

    outputPath
  ]);

  if (!fs.existsSync(outputPath)) {
    throw new Error(
      `[RenderEngine] Normalized video was not created: ${outputPath}`
    );
  }

  const info =
    await getMediaInfo(outputPath);

  if (!info.hasVideo) {
    throw new Error(
      `[RenderEngine] Normalized scene has no video stream: ${outputPath}`
    );
  }

  if (
    info.width !==
      config.videoConfig.width ||
    info.height !==
      config.videoConfig.height
  ) {
    throw new Error(
      `[RenderEngine] Normalized scene has wrong resolution: ${info.width}x${info.height}`
    );
  }

  if (
    Math.abs(
      info.duration -
      requestedDuration
    ) > 0.75
  ) {
    throw new Error(
      `[RenderEngine] Normalized scene duration mismatch. Expected ${requestedDuration.toFixed(
        2
      )}s, received ${info.duration.toFixed(
        2
      )}s.`
    );
  }

  return outputPath;
}

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
      '[RenderEngine] No scene videos supplied.'
    );
  }

  if (
    !Array.isArray(durations) ||
    durations.length !==
      videoPaths.length
  ) {
    throw new Error(
      `[RenderEngine] Scene video count (${videoPaths.length}) does not match duration count (${
        Array.isArray(durations)
          ? durations.length
          : 0
      }).`
    );
  }

  ensureDirectory(
    workingDirectory
  );

  const normalizedDirectory =
    path.join(
      workingDirectory,
      'normalized-scenes'
    );

  ensureDirectory(
    normalizedDirectory
  );

  const normalizedPaths = [];

  /*
   * Normalize every scene first.
   */
  for (
    let index = 0;
    index < videoPaths.length;
    index += 1
  ) {
    const inputPath =
      videoPaths[index];

    const duration =
      Number(durations[index]);

    if (!fs.existsSync(inputPath)) {
      throw new Error(
        `[RenderEngine] Scene video ${
          index + 1
        } does not exist: ${inputPath}`
      );
    }

    if (
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      throw new Error(
        `[RenderEngine] Invalid duration for scene ${
          index + 1
        }: ${durations[index]}`
      );
    }

    const outputPath =
      path.join(
        normalizedDirectory,
        `scene-${String(
          index + 1
        ).padStart(2, '0')}.mp4`
      );

    console.log(
      `[RenderEngine] Normalizing scene ${
        index + 1
      }/${videoPaths.length} for ${duration.toFixed(
        2
      )}s`
    );

    await normalizeVideo(
      inputPath,
      outputPath,
      duration
    );

    normalizedPaths.push(
      outputPath
    );
  }

  /*
   * IMPORTANT:
   *
   * Do NOT use:
   *   -f concat
   *   -c copy
   *
   * because independently generated MP4
   * containers can have timestamp/timebase
   * differences.
   *
   * Instead, use the FFmpeg concat FILTER
   * and re-encode one final video stream.
   */
  const concatInputs = [];

  for (
    let index = 0;
    index < normalizedPaths.length;
    index += 1
  ) {
    concatInputs.push(
      '-i',
      normalizedPaths[index]
    );
  }

  const filterParts = [];

  for (
    let index = 0;
    index < normalizedPaths.length;
    index += 1
  ) {
    filterParts.push(
      `[${index}:v:0]setpts=PTS-STARTPTS[v${index}]`
    );
  }

  const concatLabels =
    normalizedPaths
      .map(
        (_, index) =>
          `[v${index}]`
      )
      .join('');

  filterParts.push(
    `${concatLabels}concat=n=${normalizedPaths.length}:v=1:a=0[outv]`
  );

  const combinedPath =
    path.join(
      workingDirectory,
      'combined-video.mp4'
    );

  console.log(
    `[RenderEngine] Combining ${normalizedPaths.length} normalized scenes...`
  );

  await runFFmpeg([
    '-y',

    ...concatInputs,

    '-filter_complex',
    filterParts.join(';'),

    '-map',
    '[outv]',

    '-an',

    '-c:v',
    config.videoConfig.videoCodec,

    '-pix_fmt',
    config.videoConfig.pixelFormat,

    '-r',
    String(config.videoConfig.fps),

    '-preset',
    'medium',

    '-crf',
    String(config.videoConfig.crf),

    '-movflags',
    '+faststart',

    combinedPath
  ]);

  if (!fs.existsSync(combinedPath)) {
    throw new Error(
      `[RenderEngine] Combined video was not created: ${combinedPath}`
    );
  }

  const combinedInfo =
    await getMediaInfo(
      combinedPath
    );

  if (!combinedInfo.hasVideo) {
    throw new Error(
      '[RenderEngine] Combined video has no video stream.'
    );
  }

  const expectedDuration =
    durations.reduce(
      (total, value) =>
        total + Number(value || 0),
      0
    );

  if (
    Math.abs(
      combinedInfo.duration -
      expectedDuration
    ) > 1.0
  ) {
    throw new Error(
      `[RenderEngine] Combined video duration mismatch. Expected approximately ${expectedDuration.toFixed(
        2
      )}s, received ${combinedInfo.duration.toFixed(
        2
      )}s.`
    );
  }

  console.log(
    `[RenderEngine] Combined video ready: ${combinedInfo.duration.toFixed(
      2
    )}s`
  );

  return combinedPath;
}

async function createTimedAudio(
  sceneAudioPaths,
  sceneDurations,
  workingDirectory
) {
  if (
    !Array.isArray(sceneAudioPaths) ||
    !Array.isArray(sceneDurations)
  ) {
    throw new Error(
      '[RenderEngine] Scene audio and duration arrays are required.'
    );
  }

  if (
    sceneAudioPaths.length !==
    sceneDurations.length
  ) {
    throw new Error(
      '[RenderEngine] Audio and scene duration counts do not match.'
    );
  }

  const audioDirectory =
    path.join(
      workingDirectory,
      'audio'
    );

  ensureDirectory(
    audioDirectory
  );

  const normalizedAudioPaths = [];

  for (
    let index = 0;
    index <
    sceneAudioPaths.length;
    index += 1
  ) {
    const audioPath =
      sceneAudioPaths[index];

    const duration =
      Number(
        sceneDurations[index]
      );

    if (!fs.existsSync(audioPath)) {
      throw new Error(
        `[RenderEngine] Scene audio ${
          index + 1
        } not found: ${audioPath}`
      );
    }

    if (
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      throw new Error(
        `[RenderEngine] Invalid audio duration for scene ${
          index + 1
        }.`
      );
    }

    const outputPath =
      path.join(
        audioDirectory,
        `audio-${String(
          index + 1
        ).padStart(2, '0')}.m4a`
      );

    console.log(
      `[RenderEngine] Normalizing audio ${
        index + 1
      }/${sceneAudioPaths.length} for ${duration.toFixed(
        2
      )}s`
    );

    await runFFmpeg([
      '-y',

      '-i',
      audioPath,

      '-af',
      [
        'aresample=48000',
        `apad=pad_dur=${duration}`,
        `atrim=duration=${duration}`
      ].join(','),

      '-ar',
      '48000',

      '-ac',
      '2',

      '-c:a',
      'aac',

      '-b:a',
      config.videoConfig.audioBitrate,

      outputPath
    ]);

    if (!fs.existsSync(outputPath)) {
      throw new Error(
        `[RenderEngine] Normalized audio was not created: ${outputPath}`
      );
    }

    normalizedAudioPaths.push(
      outputPath
    );
  }

  /*
   * Use concat FILTER for audio as well.
   * This avoids MP4/M4A stream-copy timestamp
   * incompatibilities.
   */
  const audioInputs = [];

  for (
    const audioPath of normalizedAudioPaths
  ) {
    audioInputs.push(
      '-i',
      audioPath
    );
  }

  const audioFilterParts = [];

  for (
    let index = 0;
    index <
    normalizedAudioPaths.length;
    index += 1
  ) {
    audioFilterParts.push(
      `[${index}:a:0]asetpts=PTS-STARTPTS[a${index}]`
    );
  }

  const audioLabels =
    normalizedAudioPaths
      .map(
        (_, index) =>
          `[a${index}]`
      )
      .join('');

  audioFilterParts.push(
    `${audioLabels}concat=n=${normalizedAudioPaths.length}:v=0:a=1[outa]`
  );

  const finalAudioPath =
    path.join(
      workingDirectory,
      'complete-narration.m4a'
    );

  await runFFmpeg([
    '-y',

    ...audioInputs,

    '-filter_complex',
    audioFilterParts.join(';'),

    '-map',
    '[outa]',

    '-ar',
    '48000',

    '-ac',
    '2',

    '-c:a',
    'aac',

    '-b:a',
    config.videoConfig.audioBitrate,

    finalAudioPath
  ]);

  if (!fs.existsSync(finalAudioPath)) {
    throw new Error(
      `[RenderEngine] Complete narration was not created: ${finalAudioPath}`
    );
  }

  const info =
    await getMediaInfo(
      finalAudioPath
    );

  if (!info.hasAudio) {
    throw new Error(
      '[RenderEngine] Complete narration has no audio stream.'
    );
  }

  const expectedDuration =
    sceneDurations.reduce(
      (total, value) =>
        total + Number(value || 0),
      0
    );

  if (
    Math.abs(
      info.duration -
      expectedDuration
    ) > 1.0
  ) {
    throw new Error(
      `[RenderEngine] Complete narration duration mismatch. Expected approximately ${expectedDuration.toFixed(
        2
      )}s, received ${info.duration.toFixed(
        2
      )}s.`
    );
  }

  return finalAudioPath;
}

async function addVoiceover(
  videoPath,
  audioPath,
  outputPath
) {
  if (!fs.existsSync(videoPath)) {
    throw new Error(
      `[RenderEngine] Video file does not exist: ${videoPath}`
    );
  }

  if (!fs.existsSync(audioPath)) {
    throw new Error(
      `[RenderEngine] Audio file does not exist: ${audioPath}`
    );
  }

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
    config.videoConfig.videoCodec,

    '-c:a',
    config.videoConfig.audioCodec,

    '-b:a',
    config.videoConfig.audioBitrate,

    '-ar',
    '48000',

    '-ac',
    '2',

    '-pix_fmt',
    config.videoConfig.pixelFormat,

    '-r',
    String(
      config.videoConfig.fps
    ),

    '-shortest',

    '-movflags',
    '+faststart',

    outputPath
  ]);

  if (!fs.existsSync(outputPath)) {
    throw new Error(
      `[RenderEngine] Final temporary video was not created: ${outputPath}`
    );
  }

  return outputPath;
}

async function validateRenderedVideo(
  outputPath,
  expectedDuration
) {
  const info =
    await getMediaInfo(
      outputPath
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
    info.width !==
      config.videoConfig.width ||
    info.height !==
      config.videoConfig.height
  ) {
    throw new Error(
      `[RenderEngine] Final resolution is ${info.width}x${info.height}, expected ${config.videoConfig.width}x${config.videoConfig.height}.`
    );
  }

  if (
    info.duration <
      config.videoConfig.minDuration ||
    info.duration >
      config.videoConfig.maxDuration +
        0.5
  ) {
    throw new Error(
      `[RenderEngine] Final duration ${info.duration.toFixed(
        2
      )}s is outside the allowed range.`
    );
  }

  const expected =
    Number(expectedDuration);

  if (
    Number.isFinite(expected) &&
    expected > 0
  ) {
    const difference =
      Math.abs(
        info.duration -
        expected
      );

    if (difference > 1.0) {
      throw new Error(
        `[RenderEngine] Final duration mismatch. Expected approximately ${expected.toFixed(
          2
        )}s, got ${info.duration.toFixed(
          2
        )}s.`
      );
    }
  }

  return info;
}

/**
 * Main production renderer.
 *
 * Compatible signature:
 *
 * renderFinalVideo(
 *   videoPaths,
 *   audioPath,
 *   outputPath
 * )
 *
 * Scene-aware signature:
 *
 * renderFinalVideo(
 *   videoPaths,
 *   audioPath,
 *   outputPath,
 *   options
 * )
 */
export async function renderFinalVideo(
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
      '[RenderEngine] videoPaths is required.'
    );
  }

  if (!audioPath) {
    throw new Error(
      '[RenderEngine] audioPath is required.'
    );
  }

  if (!outputPath) {
    throw new Error(
      '[RenderEngine] outputPath is required.'
    );
  }

  ensureDirectory(
    path.dirname(
      path.resolve(outputPath)
    )
  );

  const workingDirectory =
    path.join(
      path.dirname(
        path.resolve(outputPath)
      ),
      `.render-${Date.now()}`
    );

  ensureDirectory(
    workingDirectory
  );

  try {
    let sceneDurations =
      Array.isArray(
        options.sceneDurations
      )
        ? options.sceneDurations.map(
            Number
          )
        : null;

    if (
      sceneDurations &&
      sceneDurations.length !==
        videoPaths.length
    ) {
      throw new Error(
        '[RenderEngine] sceneDurations must match videoPaths exactly.'
      );
    }

    if (!sceneDurations) {
      sceneDurations = [];

      for (
        const videoPath of videoPaths
      ) {
        const info =
          await getMediaInfo(
            videoPath
          );

        if (!info.hasVideo) {
          throw new Error(
            `[RenderEngine] Scene has no video stream: ${videoPath}`
          );
        }

        sceneDurations.push(
          info.duration
        );
      }
    }

    const combinedVideo =
      await combineVideos(
        videoPaths,
        sceneDurations,
        workingDirectory
      );

    let finalAudio =
      audioPath;

    if (
      Array.isArray(
        options.sceneAudioPaths
      ) &&
      options.sceneAudioPaths.length > 0
    ) {
      finalAudio =
        await createTimedAudio(
          options.sceneAudioPaths,
          sceneDurations,
          workingDirectory
        );
    }

    const outputTemp =
      path.join(
        workingDirectory,
        'final.mp4'
      );

    const expectedDuration =
      sceneDurations.reduce(
        (total, value) =>
          total +
          Number(value || 0),
        0
      );

    await addVoiceover(
      combinedVideo,
      finalAudio,
      outputTemp
    );

    await validateRenderedVideo(
      outputTemp,
      expectedDuration
    );

    fs.copyFileSync(
      outputTemp,
      outputPath
    );

    const finalInfo =
      await validateRenderedVideo(
        outputPath,
        expectedDuration
      );

    console.log(
      `[RenderEngine] Final video created: ${outputPath}`
    );

    console.log(
      `[RenderEngine] Duration: ${finalInfo.duration.toFixed(
        2
      )}s`
    );

    console.log(
      `[RenderEngine] Resolution: ${finalInfo.width}x${finalInfo.height}`
    );

    console.log(
      `[RenderEngine] Audio: ${
        finalInfo.hasAudio
          ? 'OK'
          : 'MISSING'
      }`
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
        '[RenderEngine] Working directory cleanup warning:',
        cleanupError?.message ||
          cleanupError
      );
    }
  }
}

export {
  getMediaInfo,
  normalizeVideo,
  combineVideos,
  addVoiceover,
  validateRenderedVideo
};

export default {
  renderFinalVideo,
  getMediaInfo,
  normalizeVideo,
  combineVideos,
  addVoiceover,
  validateRenderedVideo
};