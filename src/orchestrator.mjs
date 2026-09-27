import fs from 'fs';
import path from 'path';
import https from 'https';
import { execFileSync } from 'child_process';

import config from './config/index.mjs';

import {
  generateScript
} from './modules/scriptEngine.mjs';

import {
  buildSceneVisuals
} from './modules/visualEngine.mjs';

import {
  generateVoiceover
} from './modules/voiceEngine.mjs';

import {
  renderFinalVideo
} from './modules/renderEngine.mjs';

import {
  addProject,
  addScript,
  addRender,
  addHistory,
  updateProject
} from './store.mjs';


/* =========================================================
   DIRECTORIES
========================================================= */

const OUTPUT_DIR = path.resolve(
  config.outputDir || 'output_artifacts'
);

const VISUAL_DIR = path.join(
  OUTPUT_DIR,
  'visuals'
);

const AUDIO_DIR = path.join(
  OUTPUT_DIR,
  'audio'
);

const FINAL_DIR = path.join(
  OUTPUT_DIR,
  'final'
);


/* =========================================================
   DIRECTORY SETUP
========================================================= */

function ensureDirectories() {
  fs.mkdirSync(
    OUTPUT_DIR,
    {
      recursive: true
    }
  );

  fs.mkdirSync(
    VISUAL_DIR,
    {
      recursive: true
    }
  );

  fs.mkdirSync(
    AUDIO_DIR,
    {
      recursive: true
    }
  );

  fs.mkdirSync(
    FINAL_DIR,
    {
      recursive: true
    }
  );
}


/* =========================================================
   TEXT HELPERS
========================================================= */

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}


/* =========================================================
   COMMAND LINE
========================================================= */

function getTopicFromArguments() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    return '';
  }

  return cleanText(
    args
      .filter(
        arg => !arg.startsWith('--')
      )
      .join(' ')
  );
}


function getCountFromArguments() {
  const args = process.argv.slice(2);

  const countArgument = args.find(
    arg =>
      arg.startsWith('--count=')
  );

  if (!countArgument) {
    return 1;
  }

  const count = Number(
    countArgument.split('=')[1]
  );

  if (!Number.isFinite(count)) {
    return 1;
  }

  return Math.min(
    Math.max(
      Math.floor(count),
      1
    ),
    10
  );
}


/* =========================================================
   CUSTOM SCRIPT
========================================================= */

function getUserScriptFromEnvironment() {
  return cleanText(
    process.env.VIDEO_SCRIPT ||
    process.env.SCRIPT ||
    ''
  );
}


/* =========================================================
   DOWNLOAD FILE
========================================================= */

function downloadFile(
  url,
  destination
) {
  return new Promise(
    (resolve, reject) => {

      const file =
        fs.createWriteStream(
          destination
        );

      const request =
        https.get(
          url,
          {
            headers: {
              'User-Agent':
                'ZEESHAN-AI-LAB'
            }
          },
          response => {

            /*
             * REDIRECT
             */

            if (
              response.statusCode >= 300 &&
              response.statusCode < 400 &&
              response.headers.location
            ) {

              file.close();

              if (
                fs.existsSync(
                  destination
                )
              ) {
                fs.unlinkSync(
                  destination
                );
              }

              downloadFile(
                response.headers.location,
                destination
              )
                .then(resolve)
                .catch(reject);

              return;
            }


            /*
             * HTTP ERROR
             */

            if (
              response.statusCode !== 200
            ) {

              file.close();

              if (
                fs.existsSync(
                  destination
                )
              ) {
                fs.unlinkSync(
                  destination
                );
              }

              reject(
                new Error(
                  `Visual download failed: HTTP ${response.statusCode}`
                )
              );

              return;
            }


            /*
             * DOWNLOAD
             */

            response.pipe(file);


            file.on(
              'finish',
              () => {

                file.close(
                  () => {

                    if (
                      !fs.existsSync(
                        destination
                      )
                    ) {

                      reject(
                        new Error(
                          'Downloaded visual file does not exist.'
                        )
                      );

                      return;
                    }


                    const size =
                      fs.statSync(
                        destination
                      ).size;


                    if (
                      size < 50000
                    ) {

                      fs.unlinkSync(
                        destination
                      );

                      reject(
                        new Error(
                          'Downloaded visual file is too small.'
                        )
                      );

                      return;
                    }


                    resolve(
                      destination
                    );
                  }
                );
              }
            );
          }
        );


      request.on(
        'error',
        error => {

          file.close();

          if (
            fs.existsSync(
              destination
            )
          ) {
            fs.unlinkSync(
              destination
            );
          }

          reject(error);
        }
      );
    }
  );
}


/* =========================================================
   DOWNLOAD ALL SCENE VISUALS
========================================================= */

async function downloadSceneVisuals(
  sceneVisuals,
  projectId
) {

  if (
    !Array.isArray(
      sceneVisuals
    ) ||
    sceneVisuals.length === 0
  ) {

    throw new Error(
      'NO_SCENE_VISUALS'
    );
  }


  const projectVisualDir =
    path.join(
      VISUAL_DIR,
      projectId
    );


  fs.mkdirSync(
    projectVisualDir,
    {
      recursive: true
    }
  );


  const downloaded = [];


  for (
    let index = 0;
    index < sceneVisuals.length;
    index++
  ) {

    const scene =
      sceneVisuals[index];


    const url =
      scene?.visual?.url;


    if (!url) {

      console.warn(
        `[Orchestrator] Scene ${index + 1} has no visual URL.`
      );

      continue;
    }


    const destination =
      path.join(
        projectVisualDir,
        `scene_${index + 1}.mp4`
      );


    console.log(
      `[Orchestrator] Downloading scene ${index + 1}/${sceneVisuals.length}`
    );


    try {

      await downloadFile(
        url,
        destination
      );


      downloaded.push(
        {
          ...scene,
          localPath:
            destination
        }
      );


      console.log(
        `[Orchestrator] Scene ${index + 1} downloaded successfully.`
      );

    } catch (error) {

      console.warn(
        `[Orchestrator] Scene ${index + 1} failed: ${error.message}`
      );
    }
  }


  if (
    downloaded.length === 0
  ) {

    throw new Error(
      'NO_SCENE_VISUALS_DOWNLOADED'
    );
  }


  return downloaded;
}


/* =========================================================
   MEDIA DURATION
========================================================= */

function getMediaDuration(
  filePath
) {

  try {

    const output =
      execFileSync(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'default=noprint_wrappers=1:nokey=1',
          filePath
        ],
        {
          encoding: 'utf8'
        }
      );


    const duration =
      Number.parseFloat(
        output.trim()
      );


    return Number.isFinite(
      duration
    )
      ? duration
      : 0;

  } catch (error) {

    console.warn(
      `[Orchestrator] Could not read media duration: ${error.message}`
    );

    return 0;
  }
}


/* =========================================================
   VIDEO DIMENSIONS
========================================================= */

function getVideoDimensions(
  filePath
) {

  try {

    const output =
      execFileSync(
        'ffprobe',
        [
          '-v',
          'error',
          '-select_streams',
          'v:0',
          '-show_entries',
          'stream=width,height',
          '-of',
          'csv=s=x:p=0',
          filePath
        ],
        {
          encoding: 'utf8'
        }
      );


    return output.trim();

  } catch {

    return '';
  }
}


/* =========================================================
   FINAL VIDEO VALIDATION
========================================================= */

function validateFinalVideo(
  filePath
) {

  if (
    !fs.existsSync(
      filePath
    )
  ) {

    throw new Error(
      'FINAL_VIDEO_MISSING'
    );
  }


  const size =
    fs.statSync(
      filePath
    ).size;


  if (
    size < 100000
  ) {

    throw new Error(
      'FINAL_VIDEO_TOO_SMALL'
    );
  }


  const duration =
    getMediaDuration(
      filePath
    );


  const videoConfig =
    config.videoConfig || {
      width: 1080,
      height: 1920,
      minDuration: 20,
      maxDuration: 59,
      fps: 30
    };


  if (
    duration < videoConfig.minDuration ||
    duration > videoConfig.maxDuration
  ) {

    throw new Error(
      `FINAL_VIDEO_DURATION_INVALID: ${duration.toFixed(2)}s`
    );
  }


  const dimensions =
    getVideoDimensions(
      filePath
    );


  const expectedDimensions =
    `${videoConfig.width}x${videoConfig.height}`;


  if (
    dimensions !==
    expectedDimensions
  ) {

    throw new Error(
      `FINAL_VIDEO_RESOLUTION_INVALID: ${dimensions}`
    );
  }


  console.log(
    `[Orchestrator] Final video validated: ${duration.toFixed(2)}s / ${dimensions}`
  );


  return {
    duration,
    dimensions,
    size
  };
}


/* =========================================================
   PROJECT STATUS
========================================================= */

function updateProjectStatus(
  projectId,
  status
) {

  try {

    updateProject(
      projectId,
      {
        status
      }
    );

  } catch (error) {

    console.warn(
      `[Orchestrator] Could not update project status: ${error.message}`
    );
  }

  console.log(
    `[Orchestrator] Project ${projectId}: ${status}`
  );
}


/* =========================================================
   GENERATE ONE VIDEO
========================================================= */

async function generateOneVideo({
  topic,
  videoNumber,
  userScript = ''
}) {

  const projectId =
    `project_${Date.now()}_${videoNumber}`;


  console.log(
    '\n========================================'
  );

  console.log(
    `ZEESHAN AI LABS - VIDEO ${videoNumber}`
  );

  console.log(
    '========================================'
  );


  const project =
    addProject(
      {
        id:
          projectId,

        topic,

        videoNumber,

        status:
          'started',

        mode:
          userScript
            ? 'script'
            : 'topic',

        createdAt:
          new Date().toISOString()
      }
    );


  try {

    /*
     * STEP 1
     * SCRIPT
     */

    console.log(
      '\n[1/6] Creating story/script...'
    );


    let script;


    if (
      userScript
    ) {

      /*
       * Current script engine supports
       * topic generation. The actual custom
       * script support will be added inside
       * scriptEngine without changing this
       * controller.
       */

      script =
        await generateScript(
          topic ||
            'Motivational Story',
          {
            userScript
          }
        );

    } else {

      script =
        await generateScript(
          topic,
          {
            variation:
              videoNumber
          }
        );
    }


    if (
      !script ||
      !script.narration
    ) {

      throw new Error(
        'SCRIPT_GENERATION_FAILED'
      );
    }


    addScript(
      {
        projectId,

        videoNumber,

        title:
          script.title,

        narration:
          script.narration,

        scenes:
          script.scenes,

        durationEstimate:
          script.durationEstimate
      }
    );


    console.log(
      `[Orchestrator] Story created: ${script.title}`
    );


    /*
     * STEP 2
     * VISUAL PLANNING
     */

    console.log(
      '\n[2/6] Finding matching visuals...'
    );


    const sceneVisuals =
      await buildSceneVisuals(
        script.scenes,
        topic
      );


    if (
      !sceneVisuals ||
      sceneVisuals.length === 0
    ) {

      throw new Error(
        'VISUAL_PLANNING_FAILED'
      );
    }


    console.log(
      `[Orchestrator] ${sceneVisuals.length} scene visuals selected.`
    );


    /*
     * STEP 3
     * DOWNLOAD VISUALS
     */

    console.log(
      '\n[3/6] Downloading scene visuals...'
    );


    const localScenes =
      await downloadSceneVisuals(
        sceneVisuals,
        projectId
      );


    if (
      localScenes.length === 0
    ) {

      throw new Error(
        'NO_LOCAL_SCENE_VISUALS'
      );
    }


    /*
     * STEP 4
     * VOICEOVER
     */

    console.log(
      '\n[4/6] Creating voiceover...'
    );


    const audioPath =
      path.join(
        AUDIO_DIR,
        `${projectId}.mp3`
      );


    await generateVoiceover(
      script.narration,
      audioPath,
      {
        language:
          'en'
      }
    );


    const audioDuration =
      getMediaDuration(
        audioPath
      );


    if (
      audioDuration <= 0
    ) {

      throw new Error(
        'VOICEOVER_DURATION_INVALID'
      );
    }


    console.log(
      `[Orchestrator] Voice duration: ${audioDuration.toFixed(2)}s`
    );


    /*
     * STEP 5
     * FINAL RENDER
     */

    console.log(
      '\n[5/6] Rendering final vertical video...'
    );


    const finalVideoPath =
      path.join(
        FINAL_DIR,
        `${projectId}.mp4`
      );


    const visualPaths =
      localScenes.map(
        scene =>
          scene.localPath
      );


    await renderFinalVideo(
      audioPath,
      visualPaths,
      finalVideoPath
    );


    /*
     * STEP 6
     * VALIDATION
     */

    console.log(
      '\n[6/6] Validating final video...'
    );


    const validation =
      validateFinalVideo(
        finalVideoPath
      );


    const renderRecord =
      addRender(
        {
          projectId,

          videoNumber,

          status:
            'completed',

          outputPath:
            finalVideoPath,

          duration:
            validation.duration,

          dimensions:
            validation.dimensions,

          fileSize:
            validation.size,

          title:
            script.title,

          createdAt:
            new Date().toISOString()
        }
      );


    addHistory(
      {
        projectId,

        action:
          'VIDEO_CREATED',

        status:
          'success',

        outputPath:
          finalVideoPath,

        duration:
          validation.duration
      }
    );


    updateProjectStatus(
      projectId,
      'completed'
    );


    console.log(
      '\n----------------------------------------'
    );

    console.log(
      'VIDEO CREATED SUCCESSFULLY'
    );

    console.log(
      `Title: ${script.title}`
    );

    console.log(
      `File: ${finalVideoPath}`
    );

    console.log(
      `Duration: ${validation.duration.toFixed(2)}s`
    );

    console.log(
      `Resolution: ${validation.dimensions}`
    );

    console.log(
      '----------------------------------------'
    );


    return {
      project,

      render:
        renderRecord,

      script,

      finalVideoPath,

      validation
    };

  } catch (error) {

    console.error(
      `\n[Orchestrator] Video ${videoNumber} FAILED:`,
      error.message
    );


    addHistory(
      {
        projectId,

        action:
          'VIDEO_FAILED',

        status:
          'failed',

        error:
          error.message
      }
    );


    updateProjectStatus(
      projectId,
      'failed'
    );


    throw error;
  }
}


/* =========================================================
   MAIN
========================================================= */

async function main() {

  ensureDirectories();


  const topic =
    getTopicFromArguments();


  const count =
    getCountFromArguments();


  const userScript =
    getUserScriptFromEnvironment();


  /*
   * NO INPUT
   */

  if (
    !topic &&
    !userScript
  ) {

    console.log(
      `
ZEESHAN AI LABS - AI VIDEO GENERATOR

Usage:

1) Topic:
node src/orchestrator.mjs "Never Give Up"

2) Multiple videos:
node src/orchestrator.mjs "Never Give Up" --count=5

3) Custom script:
VIDEO_SCRIPT="Your complete script here" node src/orchestrator.mjs "My Video"

Required environment:

PEXELS_API_KEY
GEMINI_API_KEY
`
    );

    return;
  }


  console.log(
    '\n========================================'
  );

  console.log(
    'ZEESHAN AI LABS'
  );

  console.log(
    'AI VIDEO GENERATOR'
  );

  console.log(
    '========================================'
  );


  console.log(
    `Mode: ${userScript ? 'SCRIPT' : 'TOPIC'}`
  );


  console.log(
    `Videos requested: ${count}`
  );


  if (
    topic
  ) {

    console.log(
      `Topic: ${topic}`
    );
  }


  if (
    userScript
  ) {

    console.log(
      'Custom script detected.'
    );
  }


  const results = [];


  for (
    let videoNumber = 1;
    videoNumber <= count;
    videoNumber++
  ) {

    try {

      const result =
        await generateOneVideo(
          {
            topic:
              topic ||
              'Motivational Story',

            videoNumber,

            userScript
          }
        );


      results.push(
        result
      );

    } catch (error) {

      console.error(
        `[Main] Video ${videoNumber} failed: ${error.message}`
      );
    }
  }


  /*
   * FINAL REPORT
   */

  console.log(
    '\n========================================'
  );

  console.log(
    'FINAL GENERATION REPORT'
  );

  console.log(
    '========================================'
  );


  console.log(
    `Requested: ${count}`
  );


  console.log(
    `Completed: ${results.length}`
  );


  console.log(
    `Failed: ${count - results.length}`
  );


  for (
    const result of results
  ) {

    console.log(
      `- ${result.finalVideoPath}`
    );
  }


  console.log(
    '========================================\n'
  );


  if (
    results.length === 0
  ) {

    process.exit(1);
  }
}


/* =========================================================
   START
========================================================= */

main().catch(
  error => {

    console.error(
      '\n[FATAL] Orchestrator failed:',
      error.message
    );

    process.exit(1);
  }
);