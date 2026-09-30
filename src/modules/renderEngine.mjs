import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

import { config } from '../config/index.mjs';

const execFileAsync =
  promisify(execFile);

function ensureDirectory(
  directory
) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, {
      recursive: true
    });
  }
}

function escapeConcatPath(
  filePath
) {
  return String(filePath)
    .replace(/\\/g, '/')
    .replace(/'/g, "'\\''");
}

async function runFFmpeg(
  args
) {
  console.log(
    `[RenderEngine] ffmpeg ${args.join(' ')}`
  );

  try {
    const result =
      await execFileAsync(
        'ffmpeg',
        args,
        {
          maxBuffer:
            10 * 1024 * 1024
        }
      );

    return result;
  } catch (error) {
    throw new Error(
      `[RenderEngine] FFmpeg failed: ${
        error?.stderr ||
        error?.message ||
        error
      }`
    );
  }
}

async function runFFprobe(
  args
) {
  try {
    const result =
      await execFileAsync(
        'ffprobe',
        args,
        {
          maxBuffer:
            10 * 1024 * 1024
        }
      );

    return result;
  } catch (error) {
    throw new Error(
      `[RenderEngine] FFprobe failed: ${
        error?.stderr ||
        error?.message ||
        error
      }`
    );
  }
}

async function getMediaInfo(
  filePath
) {
  if (
    !fs.existsSync(
      filePath
    )
  ) {
    throw new Error(
      `[RenderEngine] Media file not found: ${filePath}`
    );
  }

  const { stdout } =
    await runFFprobe([
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-show_entries',
      'stream=index,codec_type,width,height,codec_name,sample_rate,channels',
      '-of',
      'json',
      filePath
    ]);

  const data =
    JSON.parse(
      stdout
    );

  const streams =
    Array.isArray(
      data.streams
    )
      ? data.streams
      : [];

  const video =
    streams.find(
      stream =>
        stream.codec_type ===
        'video'
    );

  const audio =
    streams.find(
      stream =>
        stream.codec_type ===
        'audio'
    );

  return {
    duration:
      Number(
        data?.format?.duration ||
        0
      ),

    hasVideo:
      Boolean(video),

    hasAudio:
      Boolean(audio),

    width:
      Number(
        video?.width || 0
      ),

    height:
      Number(
        video?.height || 0
      ),

    videoCodec:
      video?.codec_name ||
      '',

    audioCodec:
      audio?.codec_name ||
      '',

    sampleRate:
      Number(
        audio?.sample_rate || 0
      ),

    channels:
      Number(
        audio?.channels || 0
      )
  };
}

async function normalizeVideo(
  inputPath,
  outputPath,
  duration
) {
  ensureDirectory(
    path.dirname(
      path.resolve(
        outputPath
      )
    )
  );

  const safeDuration =
    Math.max(
      Number(duration || 1),
      0.1
    );

  await runFFmpeg([
    '-y',

    '-i',
    inputPath,

    '-t',
    String(
      safeDuration
    ),

    '-vf',
    [
      `scale=${config.videoConfig.width}:${config.videoConfig.height}:force_original_aspect_ratio=increase`,
      `crop=${config.videoConfig.width}:${config.videoConfig.height}`,
      'setsar=1'
    ].join(','),

    '-r',
    String(
      config.videoConfig.fps
    ),

    '-an',

    '-c:v',
    config.videoConfig.videoCodec,

    '-pix_fmt',
    config.videoConfig.pixelFormat,

    '-preset',
    'medium',

    '-crf',
    String(
      config.videoConfig.crf
    ),

    '-movflags',
    '+faststart',

    outputPath
  ]);

  return outputPath;
}

async function createConcatFile(
  files,
  concatPath
) {
  ensureDirectory(
    path.dirname(
      path.resolve(
        concatPath
      )
    )
  );

  const content =
    files
      .map(
        file =>
          `file '${escapeConcatPath(
            path.resolve(file)
          )}'`
      )
      .join('\n') +
    '\n';

  fs.writeFileSync(
    concatPath,
    content,
    'utf8'
  );

  return concatPath;
}

async function combineVideos(
  videoPaths,
  durations,
  workingDirectory
) {
  if (
    !Array.isArray(
      videoPaths
    ) ||
    videoPaths.length === 0
  ) {
    throw new Error(
      '[RenderEngine] No scene videos supplied.'
    );
  }

  if (
    videoPaths.length !==
    durations.length
  ) {
    throw new Error(
      `[RenderEngine] Scene video count (${videoPaths.length}) does not match duration count (${durations.length}).`
    );
  }

  const normalizedDirectory =
    path.join(
      workingDirectory,
      'normalized-scenes'
    );

  ensureDirectory(
    normalizedDirectory
  );

  const normalizedPaths =
    [];

  for (
    let index = 0;
    index < videoPaths.length;
    index += 1
  ) {
    const inputPath =
      videoPaths[index];

    const duration =
      Number(
        durations[index]
      );

    if (
      !fs.existsSync(
        inputPath
      )
    ) {
      throw new Error(
        `[RenderEngine] Scene video ${index + 1} does not exist: ${inputPath}`
      );
    }

    if (
      !Number.isFinite(
        duration
      ) ||
      duration <= 0
    ) {
      throw new Error(
        `[RenderEngine] Invalid duration for scene ${index + 1}.`
      );
    }

    const outputPath =
      path.join(
        normalizedDirectory,
        `scene-${String(
          index + 1
        ).padStart(2, '0')}.mp4`
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

  const concatPath =
    path.join(
      workingDirectory,
      'scenes.txt'
    );

  await createConcatFile(
    normalizedPaths,
    concatPath
  );

  const combinedPath =
    path.join(
      workingDirectory,
      'combined-video.mp4'
    );

  await runFFmpeg([
    '-y',

    '-f',
    'concat',

    '-safe',
    '0',

    '-i',
    concatPath,

    '-c',
    'copy',

    combinedPath
  ]);

  return combinedPath;
}

async function createTimedAudio(
  sceneAudioPaths,
  sceneDurations,
  workingDirectory
) {
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

  const normalizedAudioPaths =
    [];

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

    if (
      !fs.existsSync(
        audioPath
      )
    ) {
      throw new Error(
        `[RenderEngine] Scene audio ${index + 1} not found: ${audioPath}`
      );
    }

    const outputPath =
      path.join(
        audioDirectory,
        `audio-${String(
          index + 1
        ).padStart(2, '0')}.m4a`
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

      '-c:a',
      'aac',

      '-b:a',
      config.videoConfig
        .audioBitrate,

      outputPath
    ]);

    normalizedAudioPaths.push(
      outputPath
    );
  }

  const concatPath =
    path.join(
      workingDirectory,
      'audio.txt'
    );

  await createConcatFile(
    normalizedAudioPaths,
    concatPath
  );

  const finalAudioPath =
    path.join(
      workingDirectory,
      'complete-narration.m4a'
    );

  await runFFmpeg([
    '-y',

    '-f',
    'concat',

    '-safe',
    '0',

    '-i',
    concatPath,

    '-c',
    'copy',

    finalAudioPath
  ]);

  return finalAudioPath;
}

async function addVoiceover(
  videoPath,
  audioPath,
  outputPath
) {
  if (
    !fs.existsSync(
      videoPath
    )
  ) {
    throw new Error(
      '[RenderEngine] Video file does not exist.'
    );
  }

  if (
    !fs.existsSync(
      audioPath
    )
  ) {
    throw new Error(
      '[RenderEngine] Audio file does not exist.'
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
    config.videoConfig
      .videoCodec,

    '-c:a',
    config.videoConfig
      .audioCodec,

    '-b:a',
    config.videoConfig
      .audioBitrate,

    '-pix_fmt',
    config.videoConfig
      .pixelFormat,

    '-r',
    String(
      config.videoConfig.fps
    ),

    '-shortest',

    '-movflags',
    '+faststart',

    outputPath
  ]);

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

  if (
    !info.hasVideo
  ) {
    throw new Error(
      '[RenderEngine] Final video has no video stream.'
    );
  }

  if (
    !info.hasAudio
  ) {
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
    Number(
      expectedDuration
    );

  if (
    Number.isFinite(
      expected
    ) &&
    expected > 0
  ) {
    const difference =
      Math.abs(
        info.duration -
          expected
      );

    if (
      difference > 1.0
    ) {
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
 * Existing compatible signature:
 *
 * renderFinalVideo(
 *   videoPaths,
 *   audioPath,
 *   outputPath
 * )
 *
 * New scene-aware signature:
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
    !Array.isArray(
      videoPaths
    ) ||
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
      path.resolve(
        outputPath
      )
    )
  );

  const workingDirectory =
    path.join(
      path.dirname(
        path.resolve(
          outputPath
        )
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

    /*
     * If scene durations are supplied,
     * enforce exact scene count.
     */
    if (
      sceneDurations &&
      sceneDurations.length !==
        videoPaths.length
    ) {
      throw new Error(
        '[RenderEngine] sceneDurations must match videoPaths exactly.'
      );
    }

    /*
     * If scene durations are not supplied,
     * use actual video durations.
     *
     * This keeps backward compatibility with
     * the existing orchestrator.
     */
    if (
      !sceneDurations
    ) {
      sceneDurations =
        [];

      for (
        const videoPath of videoPaths
      ) {
        const info =
          await getMediaInfo(
            videoPath
          );

        if (
          !info.hasVideo
        ) {
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

    /*
     * When scene audio files are provided,
     * create a synchronized complete narration.
     */
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

    /*
     * Final validation of the copied file.
     */
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
      `[RenderEngine] Audio: ${finalInfo.hasAudio ? 'OK' : 'MISSING'}`
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