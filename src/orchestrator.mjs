import fs from 'fs';
import path from 'path';
import https from 'https';
import { execFile } from 'child_process';
import { promisify } from 'util';

import { config } from './config/index.mjs';
import { generateScript } from './modules/scriptEngine.mjs';
import {
  buildSceneVisuals,
  downloadVisual
} from './modules/visualEngine.mjs';
import {
  generateSceneVoiceovers
} from './modules/voiceEngine.mjs';
import {
  renderFinalVideo,
  getMediaInfo
} from './modules/renderEngine.mjs';

const execFileAsync =
  promisify(execFile);

const OUTPUT_DIR =
  path.resolve(
    config.outputDir ||
      'output_artifacts'
  );

const VISUAL_DIR =
  path.resolve(
    config.visualsDir ||
      path.join(
        OUTPUT_DIR,
        'visuals'
      )
  );

const AUDIO_DIR =
  path.resolve(
    config.audioDir ||
      path.join(
        OUTPUT_DIR,
        'audio'
      )
  );

const FINAL_DIR =
  path.resolve(
    config.finalDir ||
      path.join(
        OUTPUT_DIR,
        'final'
      )
  );

function ensureDirectory(
  directory
) {
  fs.mkdirSync(
    directory,
    {
      recursive: true
    }
  );
}

function cleanName(
  value
) {
  return String(value || '')
    .toLowerCase()
    .replace(
      /[^a-z0-9]+/g,
      '-'
    )
    .replace(
      /^-+|-+$/g,
      ''
    )
    .slice(0, 80) ||
    'video';
}

function parseArguments() {
  const args =
    process.argv.slice(2);

  let topic =
    '';

  let count =
    1;

  for (
    let index = 0;
    index < args.length;
    index += 1
  ) {
    const arg =
      args[index];

    if (
      arg ===
      '--count'
    ) {
      count =
        Number(
          args[index + 1] || 1
        );

      index += 1;

      continue;
    }

    if (
      arg.startsWith(
        '--count='
      )
    ) {
      count =
        Number(
          arg.split('=')[1]
        );

      continue;
    }

    if (
      !arg.startsWith(
        '--'
      )
    ) {
      topic =
        topic
          ? `${topic} ${arg}`
          : arg;
    }
  }

  if (
    !Number.isFinite(
      count
    ) ||
    count < 1
  ) {
    count = 1;
  }

  return {
    topic:
      topic.trim(),

    count:
      Math.min(
        Math.floor(count),
        20
      )
  };
}

function downloadFile(
  url,
  outputPath
) {
  return new Promise(
    (resolve, reject) => {
      const request =
        https.get(
          url,
          response => {
            if (
              response.statusCode >=
                300 &&
              response.statusCode <
                400 &&
              response.headers.location
            ) {
              response.resume();

              return downloadFile(
                response.headers.location,
                outputPath
              )
                .then(resolve)
                .catch(reject);
            }

            if (
              response.statusCode !==
              200
            ) {
              response.resume();

              return reject(
                new Error(
                  `Visual download failed with HTTP ${response.statusCode}`
                )
              );
            }

            ensureDirectory(
              path.dirname(
                outputPath
              )
            );

            const file =
              fs.createWriteStream(
                outputPath
              );

            response.pipe(
              file
            );

            file.on(
              'finish',
              () => {
                file.close(
                  () => {
                    try {
                      const stats =
                        fs.statSync(
                          outputPath
                        );

                      if (
                        stats.size <
                        50 * 1024
                      ) {
                        return reject(
                          new Error(
                            `Downloaded visual is too small: ${outputPath}`
                          )
                        );
                      }

                      resolve(
                        outputPath
                      );
                    } catch (error) {
                      reject(
                        error
                      );
                    }
                  }
                );
              }
            );

            file.on(
              'error',
              error => {
                file.destroy();

                reject(
                  error
                );
              }
            );
          }
        );

      request.on(
        'error',
        reject
      );

      request.setTimeout(
        60000,
        () => {
          request.destroy(
            new Error(
              'Visual download timed out.'
            )
          );
        }
      );
    }
  );
}

async function getVideoInfo(
  filePath
) {
  const {
    stdout
  } =
    await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-show_entries',
        'stream=index,codec_type,width,height,codec_name',
        '-of',
        'json',
        filePath
      ]
    );

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

    width:
      Number(
        video?.width || 0
      ),

    height:
      Number(
        video?.height || 0
      ),

    hasVideo:
      Boolean(video),

    hasAudio:
      Boolean(audio),

    videoCodec:
      video?.codec_name || '',

    audioCodec:
      audio?.codec_name || ''
  };
}

async function validateFinalVideo(
  filePath
) {
  if (
    !fs.existsSync(
      filePath
    )
  ) {
    throw new Error(
      `Final video does not exist: ${filePath}`
    );
  }

  const stats =
    fs.statSync(
      filePath
    );

  if (
    stats.size === 0
  ) {
    throw new Error(
      'Final video file is empty.'
    );
  }

  const info =
    await getVideoInfo(
      filePath
    );

  if (
    !info.hasVideo
  ) {
    throw new Error(
      'Final video has no video stream.'
    );
  }

  if (
    !info.hasAudio
  ) {
    throw new Error(
      'Final video has no audio stream.'
    );
  }

  if (
    info.width !==
      config.videoConfig.width ||
    info.height !==
      config.videoConfig.height
  ) {
    throw new Error(
      `Wrong resolution: ${info.width}x${info.height}. Expected ${config.videoConfig.width}x${config.videoConfig.height}.`
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
      `Wrong duration: ${info.duration.toFixed(
        2
      )}s. Expected ${config.videoConfig.minDuration}-${config.videoConfig.maxDuration}s.`
    );
  }

  return info;
}

async function prepareSceneVisuals(
  visuals,
  videoId
) {
  const videoVisualDir =
    path.join(
      VISUAL_DIR,
      videoId
    );

  ensureDirectory(
    videoVisualDir
  );

  const paths =
    [];

  for (
    let index = 0;
    index < visuals.length;
    index += 1
  ) {
    const visual =
      visuals[index];

    if (
      !visual?.url
    ) {
      throw new Error(
        `Scene ${
          index + 1
        } has no visual URL.`
      );
    }

    const extension =
      '.mp4';

    const outputPath =
      path.join(
        videoVisualDir,
        `scene-${String(
          index + 1
        ).padStart(
          2,
          '0'
        )}${extension}`
      );

    console.log(
      `[Orchestrator] Downloading scene ${
        index + 1
      } visual...`
    );

    await downloadVisual(
      visual,
      outputPath
    );

    paths.push(
      outputPath
    );
  }

  if (
    paths.length !==
    visuals.length
  ) {
    throw new Error(
      'Not all scene visuals were downloaded.'
    );
  }

  return paths;
}

async function prepareSceneAudio(
  scenes,
  videoId
) {
  const videoAudioDir =
    path.join(
      AUDIO_DIR,
      videoId
    );

  ensureDirectory(
    videoAudioDir
  );

  const sceneAudio =
    await generateSceneVoiceovers(
      scenes,
      videoAudioDir,
      {
        languageCode:
          'en'
      }
    );

  if (
    sceneAudio.length !==
    scenes.length
  ) {
    throw new Error(
      'Not all scene voiceovers were generated.'
    );
  }

  return sceneAudio;
}

function calculateSceneDurations(
  scenes
) {
  return scenes.map(
    scene => {
      const duration =
        Number(
          scene.duration
        );

      if (
        !Number.isFinite(
          duration
        ) ||
        duration <= 0
      ) {
        throw new Error(
          `Invalid duration for scene ${scene.sceneNumber}.`
        );
      }

      return duration;
    }
  );
}

function validateStoryCoverage(
  story
) {
  if (
    !Array.isArray(
      story.scenes
    )
  ) {
    throw new Error(
      'Story has no scenes.'
    );
  }

  if (
    story.scenes.length <
    config.storyConfig.minScenes
  ) {
    throw new Error(
      `Story contains only ${story.scenes.length} scenes. Minimum is ${config.storyConfig.minScenes}.`
    );
  }

  for (
    let index = 0;
    index < story.scenes.length;
    index += 1
  ) {
    const scene =
      story.scenes[index];

    if (
      !scene.narration
    ) {
      throw new Error(
        `Scene ${
          index + 1
        } has no narration.`
      );
    }

    if (
      !scene.visualPrompt
    ) {
      throw new Error(
        `Scene ${
          index + 1
        } has no visual prompt.`
      );
    }

    if (
      !scene.action
    ) {
      throw new Error(
        `Scene ${
          index + 1
        } has no action.`
      );
    }
  }
}

async function generateOneVideo(
  topic,
  index
) {
  const videoNumber =
    String(index + 1).padStart(
      2,
      '0'
    );

  console.log(
    ''
  );

  console.log(
    '========================================'
  );

  console.log(
    `Creating video ${videoNumber}`
  );

  console.log(
    '========================================'
  );

  const story =
    await generateScript(
      topic,
      {
        category:
          process.env.VIDEO_CATEGORY ||
          'Life Lesson',

        region:
          process.env.TREND_REGION ||
          'US, UK, Europe'
      }
    );

  validateStoryCoverage(
    story
  );

  const videoId =
    `${videoNumber}-${cleanName(
      story.title
    )}`;

  console.log(
    `[Orchestrator] Story: ${story.title}`
  );

  console.log(
    `[Orchestrator] Scenes: ${story.scenes.length}`
  );

  console.log(
    `[Orchestrator] Estimated duration: ${story.duration}s`
  );

  const visuals =
    await buildSceneVisuals(
      story.scenes,
      story
    );

  if (
    visuals.length !==
    story.scenes.length
  ) {
    throw new Error(
      'Visual coverage is incomplete.'
    );
  }

  const visualPaths =
    await prepareSceneVisuals(
      visuals,
      videoId
    );

  const sceneAudio =
    await prepareSceneAudio(
      story.scenes,
      videoId
    );

  const sceneAudioPaths =
    sceneAudio.map(
      item =>
        item.audioPath
    );

  const sceneDurations =
    calculateSceneDurations(
      story.scenes
    );

  const totalSceneDuration =
    sceneDurations.reduce(
      (
        total,
        duration
      ) =>
        total +
        duration,
      0
    );

  if (
    totalSceneDuration <
      config.videoConfig.minDuration ||
    totalSceneDuration >
      config.videoConfig.maxDuration
  ) {
    throw new Error(
      `Scene durations total ${totalSceneDuration.toFixed(
        2
      )}s, outside allowed ${config.videoConfig.minDuration}-${config.videoConfig.maxDuration}s range.`
    );
  }

  const finalPath =
    path.join(
      FINAL_DIR,
      `${videoId}.mp4`
    );

  ensureDirectory(
    FINAL_DIR
  );

  console.log(
    '[Orchestrator] Rendering final video...'
  );

  await renderFinalVideo(
    visualPaths,
    sceneAudioPaths[0],
    finalPath,
    {
      sceneDurations,
      sceneAudioPaths
    }
  );

  const finalInfo =
    await validateFinalVideo(
      finalPath
    );

  const metadataPath =
    path.join(
      FINAL_DIR,
      `${videoId}.json`
    );

  fs.writeFileSync(
    metadataPath,
    JSON.stringify(
      {
        title:
          story.title,

        category:
          story.category,

        audience:
          story.audience,

        hook:
          story.hook,

        character:
          story.character,

        goal:
          story.goal,

        conflict:
          story.conflict,

        setback:
          story.setback,

        turningPoint:
          story.turningPoint,

        resolution:
          story.resolution,

        ending:
          story.ending,

        lesson:
          story.lesson,

        narration:
          story.narration,

        duration:
          finalInfo.duration,

        resolution:
          `${finalInfo.width}x${finalInfo.height}`,

        fps:
          config.videoConfig
            .fps,

        scenes:
          story.scenes,

        visuals,

        audio:
          sceneAudio,

        generatedBy:
          story.generatedBy,

        model:
          story.model,

        youtubeUpload:
          false,

        readyForManualUpload:
          true
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(
    ''
  );

  console.log(
    '✅ VIDEO READY'
  );

  console.log(
    `MP4: ${finalPath}`
  );

  console.log(
    `Metadata: ${metadataPath}`
  );

  console.log(
    `Duration: ${finalInfo.duration.toFixed(
      2
    )}s`
  );

  console.log(
    `Resolution: ${finalInfo.width}x${finalInfo.height}`
  );

  console.log(
    'YouTube upload: MANUAL'
  );

  return {
    finalPath,
    metadataPath,
    story,
    visuals,
    sceneAudio,
    finalInfo
  };
}

async function main() {
  const {
    topic,
    count
  } =
    parseArguments();

  ensureDirectory(
    OUTPUT_DIR
  );

  ensureDirectory(
    VISUAL_DIR
  );

  ensureDirectory(
    AUDIO_DIR
  );

  ensureDirectory(
    FINAL_DIR
  );

  console.log(
    '========================================'
  );

  console.log(
    'ZEESHAN AI LABS'
  );

  console.log(
    'Professional Shorts Generator'
  );

  console.log(
    '========================================'
  );

  console.log(
    `Videos requested: ${count}`
  );

  console.log(
    `Topic: ${
      topic || 'AI selected story'
    }`
  );

  console.log(
    'YouTube automatic upload: DISABLED'
  );

  const results =
    [];

  for (
    let index = 0;
    index < count;
    index += 1
  ) {
    try {
      const result =
        await generateOneVideo(
          topic,
          index
        );

      results.push(
        result
      );
    } catch (error) {
      console.error(
        ''
      );

      console.error(
        `❌ Video ${
          index + 1
        } failed:`,
        error?.message ||
          error
      );
    }
  }

  console.log(
    ''
  );

  console.log(
    '========================================'
  );

  console.log(
    `Completed: ${results.length}/${count}`
  );

  console.log(
    '========================================'
  );

  if (
    results.length ===
    0
  ) {
    throw new Error(
      'No videos were successfully generated.'
    );
  }

  console.log(
    'Ready-for-upload MP4 files are in:'
  );

  console.log(
    FINAL_DIR
  );
}

main().catch(
  error => {
    console.error(
      ''
    );

    console.error(
      '❌ ORCHESTRATOR FAILED'
    );

    console.error(
      error?.message ||
        error
    );

    process.exit(
      1
    );
  }
);