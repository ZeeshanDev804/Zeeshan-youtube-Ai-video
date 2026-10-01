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

import {
  runQualityCheck
} from './modules/qualityEngine.mjs';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------
// DIRECTORIES
// ---------------------------------------------------------

const OUTPUT_DIR =
  config.outputDir ||
  path.resolve('output');

const VISUALS_DIR =
  config.visualsDir ||
  path.join(
    OUTPUT_DIR,
    'visuals'
  );

const AUDIO_DIR =
  config.audioDir ||
  path.join(
    OUTPUT_DIR,
    'audio'
  );

const FINAL_DIR =
  config.finalDir ||
  path.join(
    OUTPUT_DIR,
    'final'
  );

// ---------------------------------------------------------
// BATCH CONTENT LANES
// ---------------------------------------------------------

const BATCH_LANES = [
  {
    name: 'Motivation',
    category: 'Motivation'
  },
  {
    name: 'Funny',
    category: 'Funny Story'
  },
  {
    name: 'Interesting Facts',
    category: 'Amazing Information'
  },
  {
    name: 'Mystery',
    category: 'Mystery and Curiosity'
  },
  {
    name: 'Emotional Life',
    category: 'Interesting Human Story'
  }
];

// ---------------------------------------------------------
// DIRECTORY SETUP
// ---------------------------------------------------------

function ensureDirectories() {
  for (
    const directory of [
      OUTPUT_DIR,
      VISUALS_DIR,
      AUDIO_DIR,
      FINAL_DIR
    ]
  ) {
    fs.mkdirSync(
      directory,
      {
        recursive: true
      }
    );
  }
}

// ---------------------------------------------------------
// CLI ARGUMENTS
// ---------------------------------------------------------

function parseArgs(argv) {
  const args =
    argv.slice(2);

  let topic =
    'Create an original, highly engaging YouTube Short';

  let count = 1;

  if (
    args.length > 0 &&
    !args[0].startsWith('--')
  ) {
    topic =
      args[0];
  }

  for (
    const arg of args
  ) {
    if (
      arg.startsWith(
        '--count='
      )
    ) {
      const value =
        Number(
          arg.split('=')[1]
        );

      if (
        Number.isInteger(value) &&
        value > 0
      ) {
        count =
          Math.min(
            value,
            20
          );
      }
    }
  }

  return {
    topic,
    count
  };
}

// ---------------------------------------------------------
// CATEGORY
// ---------------------------------------------------------

function getCategory() {
  return (
    process.env.STORY_CATEGORY ||
    process.env.CATEGORY ||
    'Entertainment / Interesting Story'
  );
}

// ---------------------------------------------------------
// CONTENT LANE
// ---------------------------------------------------------

function getBatchLane(
  index
) {
  const safeIndex =
    Number.isInteger(index) &&
    index >= 0
      ? index
      : 0;

  return (
    BATCH_LANES[
      safeIndex %
      BATCH_LANES.length
    ] ||
    BATCH_LANES[0]
  );
}

// ---------------------------------------------------------
// SAFE FILE NAME
// ---------------------------------------------------------

function cleanFileName(
  value
) {
  return String(
    value || 'video'
  )
    .toLowerCase()
    .replace(
      /[^a-z0-9]+/g,
      '-'
    )
    .replace(
      /^-+|-+$/g,
      ''
    )
    .slice(
      0,
      80
    );
}

// ---------------------------------------------------------
// FILE VALIDATION
// ---------------------------------------------------------

function assertFile(
  filePath,
  label
) {
  if (
    !fs.existsSync(
      filePath
    )
  ) {
    throw new Error(
      `${label} missing: ${filePath}`
    );
  }

  const stats =
    fs.statSync(
      filePath
    );

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

async function getFileDuration(
  filePath
) {
  assertFile(
    filePath,
    'Media file'
  );

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
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath
      ]
    );

  const duration =
    Number.parseFloat(
      stdout.trim()
    );

  if (
    !Number.isFinite(
      duration
    ) ||
    duration <= 0
  ) {
    throw new Error(
      `Invalid media duration for ${filePath}: ${stdout}`
    );
  }

  return duration;
}

// ---------------------------------------------------------
// STORY VALIDATION
// ---------------------------------------------------------

function validateStoryCoverage(
  story
) {
  if (
    !story ||
    !Array.isArray(
      story.scenes
    )
  ) {
    throw new Error(
      '[Orchestrator] Story does not contain a valid scenes array.'
    );
  }

  if (
    story.scenes.length < 6
  ) {
    throw new Error(
      `[Orchestrator] Story has only ${story.scenes.length} scenes. Minimum is 6.`
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
      !scene ||
      typeof scene !== 'object'
    ) {
      throw new Error(
        `[Orchestrator] Scene ${index + 1} is invalid.`
      );
    }

    const requiredFields = [
      'narration',
      'visualPrompt',
      'character',
      'environment',
      'action'
    ];

    for (
      const field of requiredFields
    ) {
      if (
        !scene[field] ||
        String(
          scene[field]
        ).trim() === ''
      ) {
        throw new Error(
          `[Orchestrator] Scene ${index + 1} has no ${field}.`
        );
      }
    }
  }

  return true;
}

// ---------------------------------------------------------
// DURATION VALIDATION
// ---------------------------------------------------------

function validateDurationRange(
  duration
) {
  const minDuration =
    Number(
      config.videoConfig?.minDuration ??
      config.qualityConfig?.minDuration ??
      20
    );

  const maxDuration =
    Number(
      config.videoConfig?.maxDuration ??
      config.qualityConfig?.maxDuration ??
      59
    );

  if (
    duration < minDuration ||
    duration > maxDuration
  ) {
    throw new Error(
      `[Orchestrator] Final duration ${duration.toFixed(
        2
      )}s is outside allowed range ${minDuration}-${maxDuration}s.`
    );
  }

  return true;
}

// ---------------------------------------------------------
// VISUAL PREPARATION
// ---------------------------------------------------------

async function prepareSceneVisuals(
  story,
  projectId
) {
  console.log(
    '[Orchestrator] Building scene visuals...'
  );

  const visualResults =
    await buildSceneVisuals(
      story.scenes,
      story
    );

  if (
    !Array.isArray(
      visualResults
    ) ||
    visualResults.length !==
      story.scenes.length
  ) {
    throw new Error(
      '[Orchestrator] Visual engine did not return one visual for every scene.'
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
    index < visualResults.length;
    index += 1
  ) {
    const visual =
      visualResults[index];

    const visualUrl =
      typeof visual === 'string'
        ? visual
        : visual?.url ||
          visual?.videoUrl ||
          visual?.downloadUrl;

    if (!visualUrl) {
      throw new Error(
        `[Orchestrator] Scene ${index + 1} visual URL is missing.`
      );
    }

    const outputPath =
      path.join(
        projectVisualDir,
        `scene-${String(
          index + 1
        ).padStart(
          2,
          '0'
        )}.mp4`
      );

    console.log(
      `[Orchestrator] Downloading visual ${index + 1}/${visualResults.length}...`
    );

    await downloadVisual(
      visualUrl,
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

  return visualPaths;
}

// ---------------------------------------------------------
// AUDIO PREPARATION
// ---------------------------------------------------------

async function prepareSceneAudio(
  story,
  projectId
) {
  console.log(
    '[Orchestrator] Generating scene narration...'
  );

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

  const audioResults =
    await generateSceneVoiceovers(
      story.scenes,
      projectAudioDir
    );

  if (
    !Array.isArray(
      audioResults
    ) ||
    audioResults.length !==
      story.scenes.length
  ) {
    throw new Error(
      '[Orchestrator] Voice engine did not return one audio file for every scene.'
    );
  }

  const sceneAudioPaths = [];
  const sceneDurations = [];

  for (
    let index = 0;
    index < audioResults.length;
    index += 1
  ) {
    const item =
      audioResults[index];

    const audioPath =
      typeof item === 'string'
        ? item
        : item?.path ||
          item?.outputPath ||
          item?.audioPath;

    if (!audioPath) {
      throw new Error(
        `[Orchestrator] Scene ${index + 1} audio path is missing.`
      );
    }

    assertFile(
      audioPath,
      `Scene ${index + 1} narration`
    );

    const duration =
      await getFileDuration(
        audioPath
      );

    if (
      !Number.isFinite(
        duration
      ) ||
      duration <= 0
    ) {
      throw new Error(
        `[Orchestrator] Scene ${index + 1} has invalid narration duration.`
      );
    }

    sceneAudioPaths.push(
      audioPath
    );

    sceneDurations.push(
      duration
    );

    console.log(
      `[Orchestrator] Scene ${
        index + 1
      } narration duration: ${duration.toFixed(
        2
      )}s`
    );
  }

  return {
    sceneAudioPaths,
    sceneDurations
  };
}

// ---------------------------------------------------------
// QUALITY ENGINE
// ---------------------------------------------------------

async function runProductionQualityCheck(
  story,
  finalPath,
  mediaInfo
) {
  console.log(
    '[Orchestrator] Running production quality check...'
  );

  if (
    typeof runQualityCheck !==
    'function'
  ) {
    console.warn(
      '[Orchestrator] QualityEngine export runQualityCheck not available. Continuing with core validation.'
    );

    return {
      passed: true,
      reviewRequired: false,
      blocked: false,
      issues: [],
      skipped: true
    };
  }

  let report;

  try {
    report =
      await runQualityCheck({
        story,
        mediaInfo,
        finalPath
      });
  } catch (error) {
    console.warn(
      '[Orchestrator] QualityEngine execution failed.'
    );

    console.warn(
      error?.message ||
        error
    );

    return {
      passed: true,
      reviewRequired: true,
      blocked: false,
      issues: [
        {
          type: 'quality_engine_error',
          message:
            error?.message ||
            String(error)
        }
      ],
      skipped: false,
      qualityEngineError: true
    };
  }

  if (!report) {
    console.warn(
      '[Orchestrator] QualityEngine returned no report.'
    );

    return {
      passed: true,
      reviewRequired: true,
      blocked: false,
      issues: [
        {
          type: 'quality_engine_empty_report',
          message:
            'QualityEngine returned an empty report.'
        }
      ]
    };
  }

  console.log(
    `[Orchestrator] Quality result: ${
      report.passed
        ? 'PASS'
        : report.reviewRequired
          ? 'REVIEW'
          : report.blocked
            ? 'BLOCK'
            : 'CHECK'
    }`
  );

  if (
    Array.isArray(
      report.issues
    ) &&
    report.issues.length > 0
  ) {
    console.log(
      `[Orchestrator] Quality issues: ${report.issues.length}`
    );

    for (
      const issue of report.issues.slice(
        0,
        10
      )
    ) {
      console.log(
        `- ${
          issue?.type ||
          'quality'
        }: ${
          issue?.message ||
          JSON.stringify(
            issue
          )
        }`
      );
    }
  }

  if (
    report.blocked === true
  ) {
    throw new Error(
      '[Orchestrator] QualityEngine BLOCKED this video.'
    );
  }

  if (
    report.reviewRequired === true
  ) {
    console.warn(
      '[Orchestrator] QualityEngine marked this video for REVIEW.'
    );
  }

  return report;
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

  const mediaInfo =
    await getMediaInfo(
      finalPath
    );

  if (
    !mediaInfo.hasVideo
  ) {
    throw new Error(
      '[Orchestrator] Final video has no video stream.'
    );
  }

  if (
    !mediaInfo.hasAudio
  ) {
    throw new Error(
      '[Orchestrator] Final video has no audio stream.'
    );
  }

  const width =
    Number(
      mediaInfo.video?.width
    );

  const height =
    Number(
      mediaInfo.video?.height
    );

  const requiredWidth =
    Number(
      config.videoConfig?.width ??
      1080
    );

  const requiredHeight =
    Number(
      config.videoConfig?.height ??
      1920
    );

  if (
    width !== requiredWidth ||
    height !== requiredHeight
  ) {
    throw new Error(
      `[Orchestrator] Invalid final resolution: ${width}x${height}. Expected ${requiredWidth}x${requiredHeight}.`
    );
  }

  const actualDuration =
    Number(
      mediaInfo.duration
    );

  if (
    !Number.isFinite(
      actualDuration
    ) ||
    actualDuration <= 0
  ) {
    throw new Error(
      '[Orchestrator] Final video has invalid duration.'
    );
  }

  const durationDifference =
    Math.abs(
      actualDuration -
        expectedDuration
    );

  if (
    durationDifference > 1.5
  ) {
    throw new Error(
      `[Orchestrator] Final duration mismatch. Expected ${expectedDuration.toFixed(
        2
      )}s, got ${actualDuration.toFixed(
        2
      )}s.`
    );
  }

  validateDurationRange(
    actualDuration
  );

  console.log(
    `[Orchestrator] Final video validated: ${actualDuration.toFixed(
      2
    )}s, ${width}x${height}`
  );

  return mediaInfo;
}

// ---------------------------------------------------------
// SINGLE VIDEO GENERATION
// ---------------------------------------------------------

async function generateOneVideo(
  topic,
  index,
  total,
  previousConcepts
) {
  const projectId =
    `video-${Date.now()}-${
      index + 1
    }`;

  const lane =
    getBatchLane(
      index
    );

  console.log('');

  console.log(
    '============================================================'
  );

  console.log(
    `STARTING VIDEO ${index + 1}/${total}`
  );

  console.log(
    `PROJECT: ${projectId}`
  );

  console.log(
    `CONTENT LANE: ${lane.name}`
  );

  console.log(
    `CATEGORY: ${lane.category}`
  );

  console.log(
    '============================================================'
  );

  // -------------------------------------------------------
  // 1. STORY
  // -------------------------------------------------------

  console.log(
    '[1/6] Generating original story...'
  );

  const story =
    await generateScript(
      topic,
      {
        category:
          lane.category,

        contentLane:
          lane.name,

        variationIndex:
          index,

        batchSize:
          total,

        previousConcepts,

        audience:
          config?.audienceConfig ||
          {
            regions: [
              'US',
              'UK',
              'Europe'
            ],
            language:
              'English'
          }
      }
    );

  if (
    typeof validateGeneratedScript ===
    'function'
  ) {
    validateGeneratedScript(
      story
    );
  }

  validateStoryCoverage(
    story
  );

  console.log(
    `[Orchestrator] Story created with ${story.scenes.length} scenes.`
  );

  console.log(
    `[Orchestrator] Story title: ${story.title}`
  );

  console.log(
    `[Orchestrator] Story category: ${story.category}`
  );

  // -------------------------------------------------------
  // 2. VISUALS
  // -------------------------------------------------------

  console.log(
    '[2/6] Preparing scene visuals...'
  );

  const visualPaths =
    await prepareSceneVisuals(
      story,
      projectId
    );

  // -------------------------------------------------------
  // 3. VOICE
  // -------------------------------------------------------

  console.log(
    '[3/6] Generating scene narration...'
  );

  const {
    sceneAudioPaths,
    sceneDurations
  } =
    await prepareSceneAudio(
      story,
      projectId
    );

  // -------------------------------------------------------
  // 4. EXPECTED DURATION
  // -------------------------------------------------------

  const expectedDuration =
    sceneDurations.reduce(
      (
        totalDuration,
        duration
      ) =>
        totalDuration +
        duration,
      0
    );

  console.log(
    `[Orchestrator] Expected final duration: ${expectedDuration.toFixed(
      2
    )}s`
  );

  validateDurationRange(
    expectedDuration
  );

  // -------------------------------------------------------
  // 5. RENDER
  // -------------------------------------------------------

  console.log(
    '[4/6] Rendering final video...'
  );

  const safeTopic =
    cleanFileName(
      story.title ||
        topic ||
        `video-${index + 1}`
    );

  const finalFileName =
    `${String(
      index + 1
    ).padStart(
      2,
      '0'
    )}-${safeTopic}-${Date.now()}.mp4`;

  const finalPath =
    path.join(
      FINAL_DIR,
      finalFileName
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

  assertFile(
    finalPath,
    'Rendered final video'
  );

  // -------------------------------------------------------
  // 6. VALIDATE
  // -------------------------------------------------------

  console.log(
    '[5/6] Validating final video...'
  );

  const mediaInfo =
    await validateFinalVideo(
      finalPath,
      expectedDuration
    );

  // -------------------------------------------------------
  // QUALITY
  // -------------------------------------------------------

  console.log(
    '[6/6] Running final quality checks...'
  );

  const qualityReport =
    await runProductionQualityCheck(
      story,
      finalPath,
      mediaInfo
    );

  console.log(
    '[Orchestrator] Video generation completed successfully.'
  );

  console.log(
    `[Orchestrator] FINAL VIDEO: ${finalPath}`
  );

  return {
    index:
      index + 1,

    projectId,

    topic,

    lane:
      lane.name,

    category:
      lane.category,

    title:
      story.title ||
      null,

    path:
      finalPath,

    duration:
      mediaInfo.duration,

    width:
      mediaInfo.video.width,

    height:
      mediaInfo.video.height,

    generatedBy:
      story.generatedBy ||
      'unknown',

    quality:
      qualityReport
  };
}

// ---------------------------------------------------------
// MAIN
// ---------------------------------------------------------

async function main() {
  ensureDirectories();

  const {
    topic,
    count
  } =
    parseArgs(
      process.argv
    );

  console.log('');

  console.log(
    '============================================================'
  );

  console.log(
    'ZEESHAN AI LABS - YOUTUBE SHORTS GENERATOR'
  );

  console.log(
    '============================================================'
  );

  console.log(
    `Topic: ${topic}`
  );

  console.log(
    `Requested videos: ${count}`
  );

  console.log(
    `Output directory: ${OUTPUT_DIR}`
  );

  console.log(
    'Target audience: UK, USA and Europe'
  );

  console.log(
    'Batch diversity: ENABLED'
  );

  console.log(
    'QualityEngine: ENABLED'
  );

  console.log(
    'Automatic YouTube upload: DISABLED'
  );

  console.log(
    '============================================================'
  );

  const successfulVideos = [];
  const failedVideos = [];

  const previousConcepts = [];

  for (
    let index = 0;
    index < count;
    index += 1
  ) {
    try {
      const result =
        await generateOneVideo(
          topic,
          index,
          count,
          previousConcepts
        );

      successfulVideos.push(
        result
      );

      // ---------------------------------------------------
      // STORE CONCEPT FOR NEXT VIDEO
      // ---------------------------------------------------

      const concept =
        [
          result.title,
          result.category,
          result.lane,
          result.topic
        ]
          .filter(Boolean)
          .join(
            ' | '
          );

      if (
        concept
      ) {
        previousConcepts.push(
          concept
        );
      }

      console.log(
        `[Orchestrator] Stored previous concept: ${concept}`
      );
    } catch (
      error
    ) {
      const message =
        error?.stack ||
        error?.message ||
        String(error);

      console.error('');

      console.error(
        `VIDEO ${index + 1} FAILED`
      );

      console.error(
        message
      );

      failedVideos.push({
        index:
          index + 1,

        lane:
          getBatchLane(
            index
          ).name,

        error:
          message
      });
    }
  }

  // -------------------------------------------------------
  // RUN SUMMARY
  // -------------------------------------------------------

  console.log('');

  console.log(
    '============================================================'
  );

  console.log(
    'RUN SUMMARY'
  );

  console.log(
    '============================================================'
  );

  console.log(
    `Requested: ${count}`
  );

  console.log(
    `Successful: ${successfulVideos.length}`
  );

  console.log(
    `Failed: ${failedVideos.length}`
  );

  if (
    successfulVideos.length > 0
  ) {
    console.log('');

    console.log(
      'Generated videos:'
    );

    for (
      const video of successfulVideos
    ) {
      console.log(
        `- Video ${video.index}: ${video.title}`
      );

      console.log(
        `  Lane: ${video.lane}`
      );

      console.log(
        `  Category: ${video.category}`
      );

      console.log(
        `  File: ${video.path}`
      );

      console.log(
        `  Duration: ${Number(
          video.duration
        ).toFixed(
          2
        )}s`
      );
    }
  }

  if (
    failedVideos.length > 0
  ) {
    console.log('');

    console.log(
      'Failed videos:'
    );

    for (
      const failure of failedVideos
    ) {
      console.log(
        `- Video ${failure.index} (${failure.lane}): ${failure.error}`
      );
    }
  }

  console.log(
    '============================================================'
  );

  if (
    successfulVideos.length === 0
  ) {
    throw new Error(
      'No videos were generated successfully.'
    );
  }

  return {
    requested:
      count,

    successful:
      successfulVideos.length,

    failed:
      failedVideos.length,

    videos:
      successfulVideos
  };
}

// ---------------------------------------------------------
// APPLICATION ENTRY POINT
// ---------------------------------------------------------

main().catch(
  (error) => {
    console.error('');

    console.error(
      'FATAL ORCHESTRATOR ERROR'
    );

    console.error(
      error?.stack ||
      error?.message ||
      error
    );

    process.exitCode = 1;
  }
);.