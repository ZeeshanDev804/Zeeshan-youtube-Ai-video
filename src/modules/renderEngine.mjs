import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';

const WIDTH = 1080;
const HEIGHT = 1920;

function ensureDirectory(filePath) {
  const directory = path.dirname(
    path.resolve(filePath)
  );

  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, {
      recursive: true
    });
  }
}

function escapeConcatPath(filePath) {
  return path
    .resolve(filePath)
    .replace(/'/g, "'\\''");
}

function createConcatFile(videoPaths, concatPath) {
  const content = videoPaths
    .map(filePath => {
      return `file '${escapeConcatPath(filePath)}'`;
    })
    .join('\n');

  fs.writeFileSync(
    concatPath,
    `${content}\n`,
    'utf8'
  );
}

function runFFmpeg(command) {
  return new Promise((resolve, reject) => {
    command
      .on('start', commandLine => {
        console.log(
          `[RenderEngine] FFmpeg started:\n${commandLine}`
        );
      })
      .on('progress', progress => {
        if (
          typeof progress.percent === 'number'
        ) {
          console.log(
            `[RenderEngine] Progress: ${progress.percent.toFixed(1)}%`
          );
        }
      })
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

async function normalizeVideo(
  inputPath,
  outputPath
) {
  return runFFmpeg(
    ffmpeg(inputPath)
      .outputOptions([
        '-vf',
        `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},setsar=1`,
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-crf',
        '23',
        '-an',
        '-pix_fmt',
        'yuv420p'
      ])
      .output(outputPath)
  );
}

async function combineVideos(
  videoPaths,
  outputPath,
  workingDir
) {
  const normalizedPaths = [];

  for (let i = 0; i < videoPaths.length; i++) {
    const input = videoPaths[i];

    if (!fs.existsSync(input)) {
      console.warn(
        `[RenderEngine] Missing scene video: ${input}`
      );
      continue;
    }

    const normalized = path.join(
      workingDir,
      `scene_${i + 1}_normalized.mp4`
    );

    console.log(
      `[RenderEngine] Normalizing scene ${i + 1}/${videoPaths.length}`
    );

    await normalizeVideo(
      input,
      normalized
    );

    normalizedPaths.push(normalized);
  }

  if (normalizedPaths.length === 0) {
    throw new Error(
      '[RenderEngine] No valid scene videos found.'
    );
  }

  const concatFile = path.join(
    workingDir,
    'scenes.txt'
  );

  createConcatFile(
    normalizedPaths,
    concatFile
  );

  await runFFmpeg(
    ffmpeg()
      .input(concatFile)
      .inputOptions([
        '-f',
        'concat',
        '-safe',
        '0'
      ])
      .outputOptions([
        '-c',
        'copy'
      ])
      .output(outputPath)
  );

  return outputPath;
}

async function addVoiceover(
  videoPath,
  audioPath,
  outputPath
) {
  return runFFmpeg(
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .outputOptions([
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-crf',
        '23',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-pix_fmt',
        'yuv420p',
        '-shortest'
      ])
      .output(outputPath)
  );
}

export async function renderFinalVideo(
  audioPath,
  videoPaths,
  outputPath
) {
  if (!audioPath) {
    throw new Error(
      '[RenderEngine] audioPath is required.'
    );
  }

  if (
    !Array.isArray(videoPaths) ||
    videoPaths.length === 0
  ) {
    throw new Error(
      '[RenderEngine] At least one video path is required.'
    );
  }

  if (!fs.existsSync(audioPath)) {
    throw new Error(
      `[RenderEngine] Audio file not found: ${audioPath}`
    );
  }

  ensureDirectory(outputPath);

  const absoluteOutput = path.resolve(
    outputPath
  );

  const workingDir = path.join(
    path.dirname(absoluteOutput),
    `render_work_${Date.now()}`
  );

  fs.mkdirSync(workingDir, {
    recursive: true
  });

  const combinedVideo = path.join(
    workingDir,
    'combined_scenes.mp4'
  );

  const finalVideo = path.join(
    workingDir,
    'final_with_voice.mp4'
  );

  try {
    console.log(
      '[RenderEngine] Starting final video render...'
    );

    await combineVideos(
      videoPaths,
      combinedVideo,
      workingDir
    );

    console.log(
      '[RenderEngine] Adding voiceover...'
    );

    await addVoiceover(
      combinedVideo,
      audioPath,
      finalVideo
    );

    fs.copyFileSync(
      finalVideo,
      absoluteOutput
    );

    if (!fs.existsSync(absoluteOutput)) {
      throw new Error(
        '[RenderEngine] Final video was not created.'
      );
    }

    const stats = fs.statSync(
      absoluteOutput
    );

    if (stats.size === 0) {
      throw new Error(
        '[RenderEngine] Final video is empty.'
      );
    }

    console.log(
      `[RenderEngine] Final video created: ${absoluteOutput}`
    );

    return absoluteOutput;
  } catch (error) {
    console.error(
      '[RenderEngine] Render failed:',
      error.message
    );

    throw error;
  } finally {
    // Keep final output, remove temporary render files.
    try {
      fs.rmSync(workingDir, {
        recursive: true,
        force: true
      });
    } catch (cleanupError) {
      console.warn(
        '[RenderEngine] Temporary cleanup warning:',
        cleanupError.message
      );
    }
  }
}