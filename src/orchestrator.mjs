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
// DIRECTORY SETUP
// ---------------------------------------------------------

function ensureDirectories() {
  for (const directory of [
    OUTPUT_DIR,
    VISUALS_DIR,
    AUDIO_DIR,
    FINAL_DIR
  ]) {
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
    topic = args[0];
  }

  for (const arg of args) {
    if (
      arg.startsWith('--count=')
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
// STORY CATEGORY
// ---------------------------------------------------------

function getCategory() {
  return (
    process.env.STORY_CATEGORY ||
    process.env.CATEGORY ||
    'Entertainment / Interesting Story'
  );
}

// ---------------------------------------------------------
// SAFE FILE NAME
// ---------------------------------------------------------

function cleanFileName(value) {
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
    Number.parse