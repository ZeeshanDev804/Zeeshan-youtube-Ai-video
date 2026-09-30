import fs from 'fs';
import path from 'path';
import axios from 'axios';

import { config } from '../config/index.mjs';

const PEXELS_API_URL =
  'https://api.pexels.com/videos/search';

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function ensureDirectory(directory) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, {
      recursive: true
    });
  }
}

function buildContinuityPrompt(
  scene,
  story = {},
  index = 0
) {
  const character =
    cleanText(
      scene?.character ||
      story?.character
    );

  const environment =
    cleanText(
      scene?.environment
    );

  const action =
    cleanText(
      scene?.action
    );

  const emotion =
    cleanText(
      scene?.emotion
    );

  const originalPrompt =
    cleanText(
      scene?.visualPrompt
    );

  return [
    'Vertical cinematic story scene.',
    `Scene ${index + 1}.`,
    `Main character: ${character}.`,
    `Environment: ${environment}.`,
    `Action: ${action}.`,
    `Emotion: ${emotion}.`,
    `Story visual direction: ${originalPrompt}.`,
    'Keep the main character visually consistent with previous scenes.',
    'Keep important clothing, hair, age and physical appearance consistent.',
    'Keep the environment consistent unless the story explicitly changes location.',
    'Show the exact action described by this scene.',
    'Realistic cinematic photography.',
    'Natural lighting.',
    'Professional short-film composition.',
    'Vertical 9:16 framing.',
    'No text overlays.',
    'No logos.',
    'No watermark.'
  ].join(' ');
}

function buildSearchQuery(
  scene
) {
  const action =
    cleanText(
      scene?.action
    );

  const environment =
    cleanText(
      scene?.environment
    );

  const emotion =
    cleanText(
      scene?.emotion
    );

  const query = [
    action,
    environment,
    emotion,
    'cinematic',
    'realistic'
  ]
    .filter(Boolean)
    .join(' ');

  return query
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function scoreVideoFile(
  file
) {
  const width =
    Number(file?.width || 0);

  const height =
    Number(file?.height || 0);

  const isVertical =
    height >= width;

  const resolution =
    width * height;

  let score = 0;

  if (isVertical) {
    score += 100;
  }

  if (width >= 1080) {
    score += 50;
  }

  if (height >= 1920) {
    score += 50;
  }

  if (
    String(file?.file_type || '')
      .toLowerCase()
      .includes('mp4')
  ) {
    score += 25;
  }

  score += Math.min(
    resolution / 100000,
    50
  );

  return score;
}

async function searchPexelsVideos(
  query
) {
  if (!config.pexelsApiKey) {
    throw new Error(
      '[VisualEngine] PEXELS_API_KEY is missing.'
    );
  }

  if (!cleanText(query)) {
    throw new Error(
      '[VisualEngine] Pexels search query is empty.'
    );
  }

  let response;

  try {
    response =
      await axios.get(
        PEXELS_API_URL,
        {
          headers: {
            Authorization:
              config.pexelsApiKey
          },

          params: {
            query,
            orientation:
              'portrait',
            size:
              'large',
            per_page:
              15
          },

          timeout:
            30000
        }
      );
  } catch (error) {
    const status =
      error?.response?.status;

    const message =
      error?.response?.data?.error ||
      error?.message ||
      'Unknown Pexels error';

    throw new Error(
      `[VisualEngine] Pexels API request failed${
        status ? ` (${status})` : ''
      }: ${message}`
    );
  }

  const videos =
    Array.isArray(
      response?.data?.videos
    )
      ? response.data.videos
      : [];

  if (
    videos.length === 0
  ) {
    return [];
  }

  return videos
    .map(video => {
      const files =
        Array.isArray(
          video?.video_files
        )
          ? video.video_files
          : [];

      const sortedFiles =
        files
          .filter(file =>
            String(
              file?.file_type || ''
            )
              .toLowerCase()
              .includes('mp4')
          )
          .filter(file =>
            file?.link
          )
          .sort(
            (a, b) =>
              scoreVideoFile(b) -
              scoreVideoFile(a)
          );

      const bestFile =
        sortedFiles[0];

      if (!bestFile?.link) {
        return null;
      }

      return {
        id:
          video?.id || null,

        url:
          bestFile.link,

        width:
          Number(
            bestFile.width || 0
          ),

        height:
          Number(
            bestFile.height || 0
          ),

        duration:
          Number(
            video?.duration || 0
          ),

        provider:
          'pexels',

        source:
          'pexels',

        photographer:
          cleanText(
            video?.user?.name || ''
          ),

        searchQuery:
          query
      };
    })
    .filter(Boolean);
}

function validateSceneVisual(
  scene,
  index
) {
  if (!scene) {
    throw new Error(
      `[VisualEngine] Scene ${index + 1} is missing.`
    );
  }

  if (
    !cleanText(
      scene.visualPrompt
    )
  ) {
    throw new Error(
      `[VisualEngine] Scene ${index + 1} has no visual prompt.`
    );
  }

  if (
    !cleanText(
      scene.action
    )
  ) {
    throw new Error(
      `[VisualEngine] Scene ${index + 1} has no action description.`
    );
  }

  if (
    !cleanText(
      scene.character
    )
  ) {
    throw new Error(
      `[VisualEngine] Scene ${index + 1} has no character continuity data.`
    );
  }

  if (
    !cleanText(
      scene.environment
    )
  ) {
    throw new Error(
      `[VisualEngine] Scene ${index + 1} has no environment continuity data.`
    );
  }
}

export async function findVisualForScene(
  scene,
  story = {},
  index = 0
) {
  validateSceneVisual(
    scene,
    index
  );

  const continuityPrompt =
    buildContinuityPrompt(
      scene,
      story,
      index
    );

  const searchQuery =
    buildSearchQuery(
      scene
    );

  console.log(
    `[VisualEngine] Scene ${
      index + 1
    } visual direction: ${continuityPrompt}`
  );

  console.log(
    `[VisualEngine] Searching visual for scene ${
      index + 1
    }: ${searchQuery}`
  );

  const results =
    await searchPexelsVideos(
      searchQuery
    );

  if (
    results.length === 0
  ) {
    throw new Error(
      `[VisualEngine] No suitable Pexels visual found for scene ${
        index + 1
      }. Query: ${searchQuery}`
    );
  }

  const selected =
    results[0];

  return {
    ...selected,

    sceneNumber:
      index + 1,

    visualPrompt:
      scene.visualPrompt,

    continuityPrompt,

    character:
      scene.character,

    environment:
      scene.environment,

    action:
      scene.action,

    emotion:
      scene.emotion || '',

    narration:
      scene.narration || '',

    plannedDuration:
      Number(
        scene.duration || 5
      )
  };
}

export async function buildSceneVisuals(
  scenes,
  story = {}
) {
  if (
    !Array.isArray(scenes) ||
    scenes.length === 0
  ) {
    throw new Error(
      '[VisualEngine] No scenes provided.'
    );
  }

  const visuals = [];

  for (
    let index = 0;
    index < scenes.length;
    index += 1
  ) {
    const scene =
      scenes[index];

    validateSceneVisual(
      scene,
      index
    );

    const visual =
      await findVisualForScene(
        scene,
        story,
        index
      );

    if (!visual?.url) {
      throw new Error(
        `[VisualEngine] Scene ${
          index + 1
        } visual URL is missing.`
      );
    }

    visuals.push(
      visual
    );
  }

  if (
    visuals.length !==
    scenes.length
  ) {
    throw new Error(
      `[VisualEngine] Visual coverage failed. Scenes: ${scenes.length}, visuals: ${visuals.length}.`
    );
  }

  return visuals;
}

export async function downloadVisual(
  visualOrUrl,
  outputPath
) {
  const visualUrl =
    typeof visualOrUrl === 'string'
      ? visualOrUrl
      : visualOrUrl?.url;

  if (!cleanText(visualUrl)) {
    throw new Error(
      '[VisualEngine] Visual URL is missing.'
    );
  }

  if (!outputPath) {
    throw new Error(
      '[VisualEngine] outputPath is required.'
    );
  }

  const absoluteOutputPath =
    path.resolve(
      outputPath
    );

  const directory =
    path.dirname(
      absoluteOutputPath
    );

  ensureDirectory(
    directory
  );

  console.log(
    `[VisualEngine] Downloading visual: ${absoluteOutputPath}`
  );

  let response;

  try {
    response =
      await axios.get(
        visualUrl,
        {
          responseType:
            'stream',

          timeout:
            60000,

          maxRedirects:
            5,

          validateStatus:
            status =>
              status >= 200 &&
              status < 300
        }
      );
  } catch (error) {
    const status =
      error?.response?.status;

    const message =
      error?.message ||
      'Unknown download error';

    throw new Error(
      `[VisualEngine] Visual download failed${
        status ? ` (${status})` : ''
      }: ${message}`
    );
  }

  await new Promise(
    (resolve, reject) => {
      const writer =
        fs.createWriteStream(
          absoluteOutputPath
        );

      let settled =
        false;

      const fail =
        error => {
          if (settled) {
            return;
          }

          settled = true;

          writer.destroy();

          reject(error);
        };

      response.data.on(
        'error',
        fail
      );

      writer.on(
        'error',
        fail
      );

      writer.on(
        'finish',
        () => {
          if (settled) {
            return;
          }

          settled = true;
          resolve();
        }
      );

      response.data.pipe(
        writer
      );
    }
  );

  if (
    !fs.existsSync(
      absoluteOutputPath
    )
  ) {
    throw new Error(
      `[VisualEngine] Visual file was not created: ${absoluteOutputPath}`
    );
  }

  const stats =
    fs.statSync(
      absoluteOutputPath
    );

  if (
    !stats.isFile()
  ) {
    throw new Error(
      `[VisualEngine] Downloaded visual is not a file: ${absoluteOutputPath}`
    );
  }

  if (
    stats.size < 50 * 1024
  ) {
    throw new Error(
      `[VisualEngine] Downloaded visual is too small: ${absoluteOutputPath} (${stats.size} bytes)`
    );
  }

  console.log(
    `[VisualEngine] Visual downloaded successfully: ${stats.size} bytes`
  );

  return absoluteOutputPath;
}

export default {
  findVisualForScene,
  buildSceneVisuals,
  downloadVisual
};