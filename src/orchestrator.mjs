import fs from 'fs';
import path from 'path';
import https from 'https';

import config from './config/index.mjs';
import { generateScript } from './modules/scriptEngine.mjs';
import { buildSceneVisuals } from './modules/visualEngine.mjs';
import { generateVoiceover } from './modules/voiceEngine.mjs';
import { renderFinalVideo } from './modules/renderEngine.mjs';

const OUTPUT_DIR = path.resolve(
  process.env.OUTPUT_DIR ||
  config.outputDir ||
  'output_artifacts'
);

const VISUAL_DIR = path.join(OUTPUT_DIR, 'visuals');
const AUDIO_DIR = path.join(OUTPUT_DIR, 'audio');
const FINAL_DIR = path.join(OUTPUT_DIR, 'final');

function ensureDirectories() {
  for (const directory of [
    OUTPUT_DIR,
    VISUAL_DIR,
    AUDIO_DIR,
    FINAL_DIR
  ]) {
    fs.mkdirSync(directory, {
      recursive: true
    });
  }
}

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseArguments() {
  const args = process.argv.slice(2);

  let topic = '';
  let count = 1;

  for (const arg of args) {
    if (arg.startsWith('--count=')) {
      const value = Number(
        arg.split('=').slice(1).join('=')
      );

      if (Number.isFinite(value) && value > 0) {
        count = Math.min(Math.floor(value), 10);
      }

      continue;
    }

    if (!arg.startsWith('--') && !topic) {
      topic = cleanText(arg);
    }
  }

  return {
    topic,
    count
  };
}

function downloadFile(url, destination, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (!url) {
      reject(
        new Error(
          '[Orchestrator] Visual URL is missing.'
        )
      );
      return;
    }

    if (redirects > 5) {
      reject(
        new Error(
          '[Orchestrator] Too many HTTP redirects.'
        )
      );
      return;
    }

    const outputDirectory = path.dirname(
      path.resolve(destination)
    );

    fs.mkdirSync(outputDirectory, {
      recursive: true
    });

    const request = https.get(
      url,
      {
        headers: {
          'User-Agent':
            'ZEESHAN-AI-LABS-Video-Generator/1.0'
        }
      },
      response => {
        const statusCode = response.statusCode || 0;

        if (
          statusCode >= 300 &&
          statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();

          downloadFile(
            response.headers.location,
            destination,
            redirects + 1
          )
            .then(resolve)
            .catch(reject);

          return;
        }

        if (statusCode !== 200) {
          response.resume();

          reject(
            new Error(
              `[Orchestrator] Download failed with HTTP ${statusCode}: ${url}`
            )
          );

          return;
        }

        const file = fs.createWriteStream(
          destination
        );

        let finished = false;

        const fail = error => {
          if (finished) return;

          finished = true;

          file.destroy();

          try {
            fs.unlinkSync(destination);
          } catch {
            // Ignore cleanup errors.
          }

          reject(error);
        };

        response.on('error', fail);
        file.on('error', fail);

        file.on('finish', () => {
          if (finished) return;

          finished = true;

          file.close(error => {
            if (error) {
              reject(error);
              return;
            }

            if (!fs.existsSync(destination)) {
              reject(
                new Error(
                  '[Orchestrator] Downloaded file was not created.'
                )
              );
              return;
            }

            const stats = fs.statSync(
              destination
            );

            if (stats.size < 50 * 1024) {
              try {
                fs.unlinkSync(destination);
              } catch {
                // Ignore cleanup errors.
              }

              reject(
                new Error(
                  `[Orchestrator] Downloaded file is too small: ${stats.size} bytes`
                )
              );

              return;
            }

            resolve(destination);
          });
        });

        response.pipe(file);
      }
    );

    request.setTimeout(30000, () => {
      request.destroy(
        new Error(
          '[Orchestrator] Download timeout.'
        )
      );
    });

    request.on('error', error => {
      reject(error);
    });
  });
}

async function getMediaInfo(filePath) {
  const { execFile } = await import(
    'child_process'
  );

  return new Promise((resolve, reject) => {
    execFile(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-show_entries',
        'stream=width,height,codec_name',
        '-of',
        'json',
        filePath
      ],
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `[Orchestrator] ffprobe failed: ${
                stderr || error.message
              }`
            )
          );
          return;
        }

        try {
          const data = JSON.parse(stdout);

          const videoStream =
            data.streams?.find(
              stream =>
                stream.width &&
                stream.height
            );

          resolve({
            duration: Number(
              data.format?.duration || 0
            ),
            width: Number(
              videoStream?.width || 0
            ),
            height: Number(
              videoStream?.height || 0
            ),
            codec:
              videoStream?.codec_name || ''
          });
        } catch (parseError) {
          reject(parseError);
        }
      }
    );
  });
}

async function validateFinalVideo(
  filePath
) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `[Orchestrator] Final video does not exist: ${filePath}`
    );
  }

  const stats = fs.statSync(filePath);

  if (stats.size === 0) {
    throw new Error(
      '[Orchestrator] Final video is empty.'
    );
  }

  const media = await getMediaInfo(filePath);

  console.log(
    `[Orchestrator] Final video duration: ${media.duration.toFixed(2)}s`
  );

  console.log(
    `[Orchestrator] Final video resolution: ${media.width}x${media.height}`
  );

  if (media.duration < 20) {
    throw new Error(
      `[Orchestrator] Video is too short: ${media.duration.toFixed(2)}s`
    );
  }

  if (media.duration > 59) {
    throw new Error(
      `[Orchestrator] Video is too long: ${media.duration.toFixed(2)}s`
    );
  }

  if (
    media.width !== 1080 ||
    media.height !== 1920
  ) {
    throw new Error(
      `[Orchestrator] Invalid resolution: ${media.width}x${media.height}. Expected 1080x1920.`
    );
  }

  return media;
}

async function downloadSceneVisuals(
  visualScenes,
  videoNumber
) {
  const downloadedPaths = [];

  for (
    let index = 0;
    index < visualScenes.length;
    index++
  ) {
    const scene = visualScenes[index];

    const visualUrl =
      scene?.visual?.url;

    if (!visualUrl) {
      console.warn(
        `[Orchestrator] Scene ${
          scene?.sceneNumber || index + 1
        } has no visual URL.`
      );

      continue;
    }

    const outputPath = path.join(
      VISUAL_DIR,
      `video_${videoNumber}_scene_${
        index + 1
      }.mp4`
    );

    console.log(
      `[Orchestrator] Downloading scene ${
        index + 1
      }/${visualScenes.length}...`
    );

    await downloadFile(
      visualUrl,
      outputPath
    );

    downloadedPaths.push(outputPath);
  }

  if (downloadedPaths.length === 0) {
    throw new Error(
      '[Orchestrator] No scene videos were downloaded.'
    );
  }

  return downloadedPaths;
}

async function generateOneVideo(
  topic,
  videoNumber,
  options = {}
) {
  console.log('');
  console.log(
    '======================================'
  );
  console.log(
    `[Orchestrator] GENERATING VIDEO ${videoNumber}`
  );
  console.log(
    '======================================'
  );

  console.log(
    `[Orchestrator] Topic: ${topic}`
  );

  console.log(
    '[Orchestrator] Step 1/4 - Generating script...'
  );

  const script = await generateScript(
    topic,
    {
      variation: videoNumber,
      userScript: options.userScript || ''
    }
  );

  if (!script?.narration) {
    throw new Error(
      '[Orchestrator] Script engine returned no narration.'
    );
  }

  console.log(
    `[Orchestrator] Script ready: ${script.narration.length} characters`
  );

  console.log(
    '[Orchestrator] Step 2/4 - Finding visuals...'
  );

  const visualScenes =
    await buildSceneVisuals(
      script.scenes,
      topic
    );

  if (
    !Array.isArray(visualScenes) ||
    visualScenes.length === 0
  ) {
    throw new Error(
      '[Orchestrator] No usable visuals were found.'
    );
  }

  const sceneVideoPaths =
    await downloadSceneVisuals(
      visualScenes,
      videoNumber
    );

  console.log(
    `[Orchestrator] ${sceneVideoPaths.length} scene videos ready.`
  );

  console.log(
    '[Orchestrator] Step 3/4 - Generating voiceover...'
  );

  const audioPath = path.join(
    AUDIO_DIR,
    `video_${videoNumber}.mp3`
  );

  await generateVoiceover(
    script.narration,
    audioPath,
    {
      language: 'en'
    }
  );

  if (!fs.existsSync(audioPath)) {
    throw new Error(
      '[Orchestrator] Voiceover file was not created.'
    );
  }

  console.log(
    '[Orchestrator] Voiceover ready.'
  );

  console.log(
    '[Orchestrator] Step 4/4 - Rendering final MP4...'
  );

  const finalPath = path.join(
    FINAL_DIR,
    `short_${videoNumber}_${Date.now()}.mp4`
  );

  await renderFinalVideo(
    audioPath,
    sceneVideoPaths,
    finalPath
  );

  await validateFinalVideo(
    finalPath
  );

  console.log(
    `[Orchestrator] VIDEO ${videoNumber} COMPLETE: ${finalPath}`
  );

  return {
    videoNumber,
    topic,
    title: script.title,
    durationEstimate:
      script.durationEstimate,
    outputPath: finalPath,
    scenes:
      visualScenes.length
  };
}

async function main() {
  ensureDirectories();

  const {
    topic,
    count
  } = parseArguments();

  const userScript = cleanText(
    process.env.VIDEO_SCRIPT ||
    process.env.SCRIPT ||
    ''
  );

  if (!topic && !userScript) {
    console.error(
      '[Orchestrator] Topic or VIDEO_SCRIPT is required.'
    );

    process.exitCode = 1;

    return;
  }

  const generationTopic =
    topic || 'Motivational Story';

  console.log(
    '======================================'
  );

  console.log(
    'ZEESHAN AI LABS - AI VIDEO GENERATOR'
  );

  console.log(
    '======================================'
  );

  console.log(
    `[Orchestrator] Topic: ${generationTopic}`
  );

  console.log(
    `[Orchestrator] Videos requested: ${count}`
  );

  console.log(
    `[Orchestrator] Output directory: ${OUTPUT_DIR}`
  );

  const results = [];

  for (
    let videoNumber = 1;
    videoNumber <= count;
    videoNumber++
  ) {
    try {
      const result =
        await generateOneVideo(
          generationTopic,
          videoNumber,
          {
            userScript
          }
        );

      results.push(result);
    } catch (error) {
      console.error('');
      console.error(
        `[Orchestrator] VIDEO ${videoNumber} FAILED`
      );

      console.error(
        error?.stack ||
        error?.message ||
        error
      );
    }
  }

  console.log('');
  console.log(
    '======================================'
  );

  console.log(
    `[Orchestrator] Completed: ${results.length}/${count}`
  );

  console.log(
    '======================================'
  );

  for (const result of results) {
    console.log(
      `[Orchestrator] MP4: ${result.outputPath}`
    );
  }

  if (results.length === 0) {
    console.error(
      '[Orchestrator] No videos were generated.'
    );

    process.exitCode = 1;

    return;
  }

  console.log(
    '[Orchestrator] Generation finished successfully.'
  );
}

main().catch(error => {
  console.error(
    '[Orchestrator] Fatal error:',
    error?.stack ||
    error?.message ||
    error
  );

  process.exitCode = 1;
});