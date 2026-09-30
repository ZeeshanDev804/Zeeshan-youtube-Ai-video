import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

import { config } from './config/index.mjs';
import {
  generateScript,
  validateGeneratedScript
} from './modules/scriptEngine.mjs';

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

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------
// DIRECTORIES
// ---------------------------------------------------------

const OUTPUT_DIR =
  config.outputDir ||
  path.resolve('output');

const VISUALS_DIR =
  config.visualsDir ||
  path.join(OUTPUT_DIR, 'visuals');

const AUDIO_DIR =
  config.audioDir ||
  path.join(OUTPUT_DIR, 'audio');

const FINAL_DIR =
  config.finalDir ||
  path.join(OUTPUT_DIR, 'final');

// ---------------------------------------------------------
// DIRECTORY SETUP
// ---------------------------------------------------------

function ensureDirectories() {
  for (const directory of [
    OUTPUT_DIR,
    VISUALS_DIR,
    AUDIO_DIR,
    FINAL_DIR
  ]) {
    fs.mkdirSync(directory, {
      recursive: true
    });
  }
}

// ---------------------------------------------------------
// CLI ARGUMENTS
// ---------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);

  let topic = 'Never Give Up';
  let count = 1;

  if (
    args.length > 0 &&
    !args[0].startsWith('--')
  ) {
    topic = args[0];
  }

  for (const arg of args) {
    if (arg.startsWith('--count=')) {
      const value = Number(
        arg.split('=')[1]
      );

      if (
        Number.isInteger(value) &&
        value > 0
      ) {
        count = Math.min(value, 20);
      }
    }
  }

  return {
    topic,
    count
  };
}

// ---------------------------------------------------------
// STORY CATEGORY
// ---------------------------------------------------------

function getCategory() {
  return (
    process.env.STORY_CATEGORY ||
    process.env.CATEGORY ||
    'Life Lesson'
  );
}

// ---------------------------------------------------------
// SAFE FILE NAME
// ---------------------------------------------------------

function cleanFileName(value) {
  return String(value || 'video')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// ---------------------------------------------------------
// FILE VALIDATION
// ---------------------------------------------------------

function assertFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `${label} missing: ${filePath}`
    );
  }

  const stats = fs.statSync(filePath);

  if (
    !stats.isFile() ||
    stats.size === 0
  ) {
    throw new Error(
      `${label} is empty or invalid: ${filePath}`
    );
  }

  return stats.size;
}

// ---------------------------------------------------------
// REAL MEDIA DURATION
// ---------------------------------------------------------

async function getFileDuration(filePath) {
  assertFile(
    filePath,
    'Media file'
  );

  const {
    stdout
  } = await execFileAsync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath
    ]
  );

  const duration =
    Number.parseFloat(
      String(stdout).trim()
    );

  if (
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    throw new Error(
      `Unable to read media duration: ${filePath}`
    );
  }

  return duration;
}

// ---------------------------------------------------------
// PREPARE SCENE VISUALS
// ---------------------------------------------------------

async function prepareSceneVisuals(
  story,
  projectId
) {
  /*
   * IMPORTANT:
   * Pass the complete story to the visual engine.
   * This gives the visual engine access to
   * character/environment/story continuity context.
   */
  const sceneVisuals =
    await buildSceneVisuals(
      story.scenes,
      story
    );

  if (!Array.isArray(sceneVisuals)) {
    throw new Error(
      'Visual engine did not return a scene array.'
    );
  }

  if (
    sceneVisuals.length !==
    story.scenes.length
  ) {
    throw new Error(
      `Visual coverage mismatch. Expected ${story.scenes.length}, received ${sceneVisuals.length}.`
    );
  }

  const projectVisualDir =
    path.join(
      VISUALS_DIR,
      projectId
    );

  fs.mkdirSync(
    projectVisualDir,
    {
      recursive: true
    }
  );

  const visualPaths = [];

  for (
    let index = 0;
    index < sceneVisuals.length;
    index += 1
  ) {
    const visual =
      sceneVisuals[index];

    if (!visual?.url) {
      throw new Error(
        `Scene ${index + 1} has no visual URL.`
      );
    }

    const outputPath =
      path.join(
        projectVisualDir,
        `scene-${String(index + 1).padStart(2, '0')}.mp4`
      );

    await downloadVisual(
      visual.url,
      outputPath
    );

    assertFile(
      outputPath,
      `Scene ${index + 1} visual`
    );

    visualPaths.push(
      outputPath
    );
  }

  return {
    sceneVisuals,
    visualPaths
  };
}

// ---------------------------------------------------------
// PREPARE SCENE AUDIO
// ---------------------------------------------------------

async function prepareSceneAudio(
  story,
  projectId
) {
  const projectAudioDir =
    path.join(
      AUDIO_DIR,
      projectId
    );

  fs.mkdirSync(
    projectAudioDir,
    {
      recursive: true
    }
  );

  const sceneAudio =
    await generateSceneVoiceovers(
      story.scenes,
      projectAudioDir
    );

  if (!Array.isArray(sceneAudio)) {
    throw new Error(
      'Voice engine did not return scene audio files.'
    );
  }

  if (
    sceneAudio.length !==
    story.scenes.length
  ) {
    throw new Error(
      `Audio coverage mismatch. Expected ${story.scenes.length}, received ${sceneAudio.length}.`
    );
  }

  const sceneAudioPaths = [];
  const sceneDurations = [];

  for (
    let index = 0;
    index < sceneAudio.length;
    index += 1
  ) {
    const item =
      sceneAudio[index];

    const audioPath =
      typeof item === 'string'
        ? item
        : item?.path ||
          item?.outputPath ||
          item?.audioPath;

    if (!audioPath) {
      throw new Error(
        `Scene ${index + 1} has no audio path.`
      );
    }

    assertFile(
      audioPath,
      `Scene ${index + 1} audio`
    );

    /*
     * IMPORTANT:
     * Use the real generated voice duration.
     * Do not use an old planned duration.
     */
    const duration =
      await getFileDuration(
        audioPath
      );

    if (duration < 0.15) {
      throw new Error(
        `Scene ${index + 1} narration is too short: ${duration.toFixed(2)}s`
      );
    }

    sceneAudioPaths.push(
      audioPath
    );

    sceneDurations.push(
      duration
    );
  }

  return {
    sceneAudioPaths,
    sceneDurations
  };
}

// ---------------------------------------------------------
// TOTAL DURATION
// ---------------------------------------------------------

function getTotalDuration(
  durations
) {
  return durations.reduce(
    (
      total,
      duration
    ) =>
      total +
      Number(duration || 0),
    0
  );
}

// ---------------------------------------------------------
// DURATION RANGE VALIDATION
// ---------------------------------------------------------

function validateDurationRange(
  totalDuration
) {
  const minimum =
    Number(
      config?.videoConfig?.minDuration ??
      20
    );

  const maximum =
    Number(
      config?.videoConfig?.maxDuration ??
      59
    );

  if (
    totalDuration <
    minimum
  ) {
    throw new Error(
      `Final narration is too short: ${totalDuration.toFixed(2)}s. Minimum is ${minimum}s.`
    );
  }

  if (
    totalDuration >
    maximum
  ) {
    throw new Error(
      `Final narration is too long: ${totalDuration.toFixed(2)}s. Maximum is ${maximum}s.`
    );
  }
}

// ---------------------------------------------------------
// STORY VALIDATION
// ---------------------------------------------------------

function validateStoryCoverage(
  story
) {
  if (
    !validateGeneratedScript(
      story
    )
  ) {
    throw new Error(
      'Generated story failed structural validation.'
    );
  }

  if (
    !Array.isArray(
      story.scenes
    ) ||
    story.scenes.length < 6
  ) {
    throw new Error(
      'Story must contain at least 6 scenes.'
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
      !scene.narration?.trim()
    ) {
      throw new Error(
        `Scene ${index + 1} has no narration.`
      );
    }

    if (
      !scene.visualPrompt?.trim()
    ) {
      throw new Error(
        `Scene ${index + 1} has no visual prompt.`
      );
    }

    if (
      !scene.character?.trim()
    ) {
      throw new Error(
        `Scene ${index + 1} has no character description.`
      );
    }

    if (
      !scene.environment?.trim()
    ) {
      throw new Error(
        `Scene ${index + 1} has no environment description.`
      );
    }

    if (
      !scene.action?.trim()
    ) {
      throw new Error(
        `Scene ${index + 1} has no action description.`
      );
    }
  }
}

// ---------------------------------------------------------
// FINAL VIDEO VALIDATION
// ---------------------------------------------------------

async function validateFinalVideo(
  finalPath,
  expectedDuration
) {
  assertFile(
    finalPath,
    'Final video'
  );

  const info =
    await getMediaInfo(
      finalPath
    );

  const width =
    Number(
      info?.width ||
      info?.video?.width ||
      0
    );

  const height =
    Number(
      info?.height ||
      info?.video?.height ||
      0
    );

  const duration =
    Number(
      info?.duration ||
      info?.format?.duration ||
      0
    );

  const hasVideo =
    Boolean(info?.hasVideo) ||
    Boolean(info?.video) ||
    width > 0;

  const hasAudio =
    Boolean(info?.hasAudio) ||
    Boolean(info?.audio);

  if (!hasVideo) {
    throw new Error(
      'Final video has no video stream.'
    );
  }

  if (!hasAudio) {
    throw new Error(
      'Final video has no audio stream. Narration is missing.'
    );
  }

  const expectedWidth =
    Number(
      config?.videoConfig?.width ??
      1080
    );

  const expectedHeight =
    Number(
      config?.videoConfig?.height ??
      1920
    );

  if (
    width !== expectedWidth
  ) {
    throw new Error(
      `Wrong final width: ${width}. Expected ${expectedWidth}.`
    );
  }

  if (
    height !== expectedHeight
  ) {
    throw new Error(
      `Wrong final height: ${height}. Expected ${expectedHeight}.`
    );
  }

  if (
    !Number.isFinite(
      duration
    ) ||
    duration <= 0
  ) {
    throw new Error(
      'Final video duration could not be verified.'
    );
  }

  const durationDifference =
    Math.abs(
      duration -
      expectedDuration
    );

  if (
    durationDifference >
    1.5
  ) {
    throw new Error(
      `Final duration mismatch. Expected about ${expectedDuration.toFixed(
        2
      )}s, received ${duration.toFixed(2)}s.`
    );
  }

  validateDurationRange(
    duration
  );

  return {
    width,
    height,
    duration,
    hasVideo: true,
    hasAudio: true
  };
}

// ---------------------------------------------------------
// GENERATE ONE VIDEO
// ---------------------------------------------------------

async function generateOneVideo(
  topic,
  index
) {
  ensureDirectories();

  const projectId =
    `${Date.now()}-${index + 1}`;

  console.log('');
  console.log(
    '=============================================='
  );
  console.log(
    `ZEESHAN AI LABS VIDEO ${index + 1}`
  );
  console.log(
    '=============================================='
  );
  console.log(
    `Topic: ${topic}`
  );
  console.log(
    `Category: ${getCategory()}`
  );
  console.log('');

  // -------------------------------------------------------
  // STEP 1
  // -------------------------------------------------------

  console.log(
    '[1/8] Generating structured story...'
  );

  /*
   * FIX:
   * ScriptEngine expects:
   * generateScript(topic, options)
   *
   * not:
   * generateScript({ topic, ... })
   */
  const story =
    await generateScript(
      topic,
      {
        category: getCategory(),

        audience:
          config?.audienceConfig || {
            regions: [
              'US',
              'UK',
              'Europe'
            ],
            language: 'English'
          }
      }
    );

  validateStoryCoverage(
    story
  );

  console.log(
    `Story created: ${story.scenes.length} scenes`
  );

  // -------------------------------------------------------
  // STEP 2
  // -------------------------------------------------------

  console.log('');
  console.log(
    '[2/8] Preparing scene visuals...'
  );

  const {
    sceneVisuals,
    visualPaths
  } =
    await prepareSceneVisuals(
      story,
      projectId
    );

  console.log(
    `Visual coverage: ${visualPaths.length}/${story.scenes.length}`
  );

  // -------------------------------------------------------
  // STEP 3
  // -------------------------------------------------------

  console.log('');
  console.log(
    '[3/8] Generating scene narration...'
  );

  const {
    sceneAudioPaths,
    sceneDurations
  } =
    await prepareSceneAudio(
      story,
      projectId
    );

  console.log(
    `Audio coverage: ${sceneAudioPaths.length}/${story.scenes.length}`
  );

  // -------------------------------------------------------
  // STEP 4
  // -------------------------------------------------------

  console.log('');
  console.log(
    '[4/8] Measuring real narration timing...'
  );

  const totalNarrationDuration =
    getTotalDuration(
      sceneDurations
    );

  console.log(
    `Real narration duration: ${totalNarrationDuration.toFixed(2)}s`
  );

  validateDurationRange(
    totalNarrationDuration
  );

  // -------------------------------------------------------
  // STEP 5
  // -------------------------------------------------------

  console.log('');
  console.log(
    '[5/8] Checking scene sync...'
  );

  for (
    let index = 0;
    index < sceneDurations.length;
    index += 1
  ) {
    console.log(
      `Scene ${index + 1}: ${sceneDurations[index].toFixed(2)}s`
    );
  }

  // -------------------------------------------------------
  // STEP 6
  // -------------------------------------------------------

  console.log('');
  console.log(
    '[6/8] Rendering final 1080x1920 video...'
  );

  const safeTitle =
    cleanFileName(
      story.title ||
      topic ||
      `video-${index + 1}`
    );

  const finalPath =
    path.join(
      FINAL_DIR,
      `${safeTitle}-${projectId}.mp4`
    );

  /*
   * IMPORTANT:
   * Keep this interface exactly compatible
   * with the current RenderEngine.
   *
   * The first audio argument is retained for
   * compatibility, while the complete scene
   * audio array is passed through options.
   */
  await renderFinalVideo(
    visualPaths,
    sceneAudioPaths[0],
    finalPath,
    {
      sceneDurations,
      sceneAudioPaths
    }
  );

  // -------------------------------------------------------
  // STEP 7
  // -------------------------------------------------------

  console.log('');
  console.log(
    '[7/8] Running final media QA...'
  );

  const mediaInfo =
    await validateFinalVideo(
      finalPath,
      totalNarrationDuration
    );

  console.log(
    `Final video: ${mediaInfo.width}x${mediaInfo.height}`
  );

  console.log(
    `Final duration: ${mediaInfo.duration.toFixed(2)}s`
  );

  console.log(
    `Audio stream: ${
      mediaInfo.hasAudio
        ? 'OK'
        : 'MISSING'
    }`
  );

  // -------------------------------------------------------
  // STEP 8
  // -------------------------------------------------------

  console.log('');
  console.log(
    '[8/8] Writing production metadata...'
  );

  const metadataPath =
    path.join(
      FINAL_DIR,
      `${safeTitle}-${projectId}.json`
    );

  const metadata = {
    projectId,

    topic,

    category:
      getCategory(),

    title:
      story.title,

    generatedAt:
      new Date().toISOString(),

    story: {
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

      narration:
        story.narration
    },

    scenes:
      story.scenes.map(
        (
          scene,
          sceneIndex
        ) => ({
          sceneNumber:
            sceneIndex + 1,

          narration:
            scene.narration,

          visualPrompt:
            scene.visualPrompt,

          character:
            scene.character,

          environment:
            scene.environment,

          action:
            scene.action,

          emotion:
            scene.emotion || '',

          actualAudioDuration:
            sceneDurations[
              sceneIndex
            ]
        })
      ),

    visuals:
      sceneVisuals.map(
        (
          visual,
          visualIndex
        ) => ({
          sceneNumber:
            visualIndex + 1,

          url:
            visual.url || null,

          provider:
            visual.provider ||
            'unknown'
        })
      ),

    audio: {
      providerArchitecture:
        'ElevenLabs -> Google Cloud TTS -> Amazon Polly -> gTTS emergency fallback',

      sceneCount:
        sceneAudioPaths.length,

      totalNarrationDuration
    },

    output: {
      file:
        finalPath,

      width:
        mediaInfo.width,

      height:
        mediaInfo.height,

      fps:
        Number(
          config?.videoConfig?.fps ??
          30
        ),

      duration:
        mediaInfo.duration,

      hasAudio:
        mediaInfo.hasAudio,

      readyForManualUpload:
        true,

      youtubeUpload:
        false
    },

    safety: {
      automatedUpload:
        false,

      manualReviewRecommended:
        true,

      monetizationGuaranteed:
        false,

      policyApprovalGuaranteed:
        false
    }
  };

  fs.writeFileSync(
    metadataPath,
    JSON.stringify(
      metadata,
      null,
      2
    ),
    'utf8'
  );

  console.log('');
  console.log(
    '=============================================='
  );
  console.log(
    'VIDEO READY'
  );
  console.log(
    '=============================================='
  );
  console.log(
    `MP4: ${finalPath}`
  );
  console.log(
    `Metadata: ${metadataPath}`
  );
  console.log(
    'YouTube upload: MANUAL'
  );
  console.log(
    '=============================================='
  );

  return {
    projectId,
    finalPath,
    metadataPath,
    duration:
      mediaInfo.duration
  };
}

// ---------------------------------------------------------
// MAIN
// ---------------------------------------------------------

async function main() {
  try {
    const {
      topic,
      count
    } =
      parseArgs(
        process.argv
      );

    ensureDirectories();

    console.log(
      'ZEESHAN AI LABS'
    );

    console.log(
      'Professional YouTube Shorts Generator'
    );

    console.log('');

    const results = [];

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
        console.error('');
        console.error(
          `VIDEO ${index + 1} FAILED`
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
      '=============================================='
    );
    console.log(
      'RUN SUMMARY'
    );
    console.log(
      '=============================================='
    );

    console.log(
      `Requested: ${count}`
    );

    console.log(
      `Successful: ${results.length}`
    );

    console.log(
      `Failed: ${count - results.length}`
    );

    console.log(
      '=============================================='
    );

    if (
      results.length === 0
    ) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      error?.stack ||
      error?.message ||
      error
    );

    process.exitCode = 1;
  }
}

main();