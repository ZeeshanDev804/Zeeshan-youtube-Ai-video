import fs from 'fs';
import path from 'path';
import axios from 'axios';

import { config } from '../config/index.mjs';

const PEXELS_API_URL =
  'https://api.pexels.com/videos/search';

const MIN_FILE_SIZE =
  50 * 1024;

const MAX_QUERY_LENGTH =
  180;

const MAX_RESULTS_PER_QUERY =
  15;

const MAX_CANDIDATES =
  45;

const MIN_VISUAL_CONFIDENCE =
  20;

// ============================================================
// TEXT HELPERS
// ============================================================

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

function normalizeForMatching(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getWords(value) {
  return normalizeForMatching(value)
    .split(/\s+/)
    .filter(word =>
      word.length >= 3
    );
}

function uniqueWords(values = []) {
  return [
    ...new Set(
      values
        .flatMap(value =>
          getWords(value)
        )
    )
  ];
}

// ============================================================
// STOP WORDS
// ============================================================

const STOP_WORDS = new Set([
  'the',
  'and',
  'with',
  'from',
  'into',
  'that',
  'this',
  'then',
  'they',
  'their',
  'there',
  'where',
  'when',
  'while',
  'about',
  'after',
  'before',
  'over',
  'under',
  'very',
  'just',
  'more',
  'some',
  'than',
  'have',
  'has',
  'had',
  'will',
  'would',
  'could',
  'should',
  'being',
  'onto',
  'same',
  'story',
  'scene',
  'cinematic',
  'realistic',
  'person',
  'people',
  'young',
  'adult',
  'main',
  'character',
  'exact',
  'visual',
  'video',
  'footage',
  'shot',
  'vertical'
]);

function removeStopWords(words) {
  return words.filter(
    word =>
      !STOP_WORDS.has(word)
  );
}

// ============================================================
// STORY VISUAL PROMPT
// ============================================================

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

  const importantObject =
    cleanText(
      scene?.importantObject ||
      scene?.important_object ||
      scene?.object
    );

  const narration =
    cleanText(
      scene?.narration
    );

  const originalPrompt =
    cleanText(
      scene?.visualPrompt
    );

  return [
    'Professional vertical cinematic story scene.',
    `Scene ${index + 1}.`,
    `Narration event: ${narration}.`,
    `Main character: ${character}.`,
    `Environment: ${environment}.`,
    `Exact physical action: ${action}.`,
    `Emotion: ${emotion}.`,
    `Important object: ${importantObject}.`,
    `Original visual direction: ${originalPrompt}.`,
    'The visual must directly represent the narrated event.',
    'The exact physical action should be visible whenever possible.',
    'Do not substitute unrelated footage.',
    'Maintain character appearance continuity.',
    'Maintain hairstyle, clothing, accessories and approximate age.',
    'Maintain important objects across connected scenes.',
    'Maintain environment continuity unless the story explicitly changes location.',
    'Professional short-film composition.',
    'Natural lighting.',
    'Realistic visual style.',
    'Vertical 9:16 framing.',
    'No text overlays.',
    'No logos.',
    'No watermark.'
  ].join(' ');
}

// ============================================================
// SEARCH QUERY HELPERS
// ============================================================

function sanitizeQuery(query) {
  return cleanText(query)
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(
      0,
      MAX_QUERY_LENGTH
    );
}

function buildSearchQuery(
  scene
) {
  const narration =
    cleanText(
      scene?.narration
    );

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

  const importantObject =
    cleanText(
      scene?.importantObject ||
      scene?.important_object ||
      scene?.object
    );

  const rawWords =
    uniqueWords([
      action,
      importantObject,
      environment,
      narration,
      emotion
    ]);

  const usefulWords =
    removeStopWords(
      rawWords
    );

  const selectedWords =
    usefulWords.slice(
      0,
      14
    );

  return sanitizeQuery(
    [
      ...selectedWords,
      'realistic',
      'vertical'
    ]
      .filter(Boolean)
      .join(' ')
  );
}

function buildSearchQueries(
  scene
) {
  const narration =
    cleanText(
      scene?.narration
    );

  const action =
    cleanText(
      scene?.action
    );

  const environment =
    cleanText(
      scene?.environment
    );

  const importantObject =
    cleanText(
      scene?.importantObject ||
      scene?.important_object ||
      scene?.object
    );

  const emotion =
    cleanText(
      scene?.emotion
    );

  const queries = [
    [
      action,
      importantObject,
      environment
    ],

    [
      action,
      environment
    ],

    [
      importantObject,
      action,
      environment
    ],

    [
      narration,
      action
    ],

    [
      action,
      emotion,
      environment
    ]
  ]
    .map(parts =>
      sanitizeQuery(
        parts
          .filter(Boolean)
          .join(' ')
      )
    )
    .filter(Boolean);

  return [
    ...new Set(
      queries
    )
  ];
}

// ============================================================
// VIDEO FILE QUALITY SCORE
// ============================================================

function scoreVideoFile(
  file
) {
  const width =
    Number(
      file?.width || 0
    );

  const height =
    Number(
      file?.height || 0
    );

  const isVertical =
    height > width;

  const isSquare =
    height === width &&
    height > 0;

  const resolution =
    width * height;

  let score = 0;

  if (isVertical) {
    score += 100;
  }

  if (isSquare) {
    score += 10;
  }

  if (width >= 720) {
    score += 20;
  }

  if (width >= 1080) {
    score += 50;
  }

  if (height >= 1280) {
    score += 25;
  }

  if (height >= 1920) {
    score += 50;
  }

  if (
    String(
      file?.file_type || ''
    )
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

// ============================================================
// PEXELS SEARCH
// ============================================================

async function searchPexelsVideos(
  query
) {
  if (
    !cleanText(
      config?.pexelsApiKey
    )
  ) {
    throw new Error(
      '[VisualEngine] PEXELS_API_KEY is missing.'
    );
  }

  const safeQuery =
    sanitizeQuery(
      query
    );

  if (!safeQuery) {
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
            query:
              safeQuery,

            orientation:
              'portrait',

            size:
              'large',

            per_page:
              MAX_RESULTS_PER_QUERY
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
        status
          ? ` (${status})`
          : ''
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

      if (
        !bestFile?.link
      ) {
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
            video?.user?.name ||
            ''
          ),

        searchQuery:
          safeQuery,

        fileScore:
          scoreVideoFile(
            bestFile
          )
      };
    })
    .filter(Boolean);
}

// ============================================================
// QUERY MATCH SCORING
// ============================================================

function scoreQueryMatch(
  candidate,
  scene
) {
  const queryWords =
    new Set(
      removeStopWords(
        getWords(
          candidate?.searchQuery
        )
      )
    );

  const actionWords =
    removeStopWords(
      getWords(
        scene?.action
      )
    );

  const environmentWords =
    removeStopWords(
      getWords(
        scene?.environment
      )
    );

  const objectWords =
    removeStopWords(
      getWords(
        scene?.importantObject ||
        scene?.important_object ||
        scene?.object
      )
    );

  const emotionWords =
    removeStopWords(
      getWords(
        scene?.emotion
      )
    );

  const weightedGroups = [
    {
      words:
        actionWords,
      weight:
        5
    },

    {
      words:
        objectWords,
      weight:
        3
    },

    {
      words:
        environmentWords,
      weight:
        2
    },

    {
      words:
        emotionWords,
      weight:
        1
    }
  ];

  let possibleWeight =
    0;

  let matchedWeight =
    0;

  for (
    const group of
      weightedGroups
  ) {
    if (
      group.words.length ===
      0
    ) {
      continue;
    }

    possibleWeight +=
      group.words.length *
      group.weight;

    for (
      const word of
        group.words
    ) {
      if (
        queryWords.has(word)
      ) {
        matchedWeight +=
          group.weight;
      }
    }
  }

  if (
    possibleWeight === 0
  ) {
    return 0;
  }

  return Math.round(
    (
      matchedWeight /
      possibleWeight
    ) *
    100
  );
}

// ============================================================
// CANDIDATE SELECTION
// ============================================================

function selectBestVisual(
  candidates,
  scene,
  index
) {
  if (
    !Array.isArray(
      candidates
    ) ||
    candidates.length === 0
  ) {
    return null;
  }

  const scored =
    candidates.map(
      candidate => {
        const semanticScore =
          scoreQueryMatch(
            candidate,
            scene
          );

        const technicalScore =
          Math.min(
            Number(
              candidate.fileScore ||
              0
            ),
            275
          );

        const durationScore =
          Number(
            candidate.duration ||
            0
          ) > 0
            ? 10
            : 0;

        const verticalBonus =
          Number(
            candidate.height ||
            0
          ) >
          Number(
            candidate.width ||
            0
          )
            ? 25
            : 0;

        const finalScore =
          semanticScore * 4 +
          technicalScore +
          durationScore +
          verticalBonus;

        return {
          ...candidate,

          semanticScore,

          technicalScore,

          durationScore,

          verticalBonus,

          finalScore
        };
      }
    );

  scored.sort(
    (a, b) =>
      b.finalScore -
      a.finalScore
  );

  const selected =
    scored[0];

  console.log(
    `[VisualEngine] Scene ${
      index + 1
    } visual candidate scores:`
  );

  for (
    const candidate of
      scored.slice(
        0,
        5
      )
  ) {
    console.log(
      `[VisualEngine] Candidate ${
        candidate.id ||
        'unknown'
      } | semantic=${
        candidate.semanticScore
      } | technical=${
        candidate.technicalScore
      } | duration=${
        candidate.durationScore
      } | total=${
        candidate.finalScore
      }`
    );
  }

  return selected;
}

// ============================================================
// VISUAL MATCH VALIDATION
// ============================================================

function validateVisualMatchScore(
  visual,
  scene,
  index
) {
  const semanticScore =
    Number(
      visual?.semanticScore ||
      0
    );

  const action =
    cleanText(
      scene?.action
    );

  const environment =
    cleanText(
      scene?.environment
    );

  const importantObject =
    cleanText(
      scene?.importantObject ||
      scene?.important_object ||
      scene?.object
    );

  if (
    action.length <
    10
  ) {
    throw new Error(
      `[VisualEngine] Scene ${
        index + 1
      } action direction is too weak.`
    );
  }

  if (
    environment.length <
    5
  ) {
    throw new Error(
      `[VisualEngine] Scene ${
        index + 1
      } environment direction is too weak.`
    );
  }

  if (
    !importantObject
  ) {
    console.warn(
      `[VisualEngine] Scene ${
        index + 1
      } has no important object. Continuing because an object may not be required for every story event.`
    );
  }

  /*
   * IMPORTANT:
   *
   * Pexels search results do not provide true frame-level
   * semantic verification.
   *
   * Therefore this score is a SEARCH-CONFIDENCE signal.
   * It must never be described as proof that the actual
   * frames contain the exact narrated action.
   */

  if (
    semanticScore <
    MIN_VISUAL_CONFIDENCE
  ) {
    throw new Error(
      `[VisualEngine] Scene ${
        index + 1
      } visual search confidence is too low (${semanticScore}). Refusing weak/unrelated footage.`
    );
  }

  return true;
}

// ============================================================
// SCENE VALIDATION
// ============================================================

function validateSceneVisual(
  scene,
  index
) {
  if (!scene) {
    throw new Error(
      `[VisualEngine] Scene ${
        index + 1
      } is missing.`
    );
  }

  if (
    !cleanText(
      scene.visualPrompt
    )
  ) {
    throw new Error(
      `[VisualEngine] Scene ${
        index + 1
      } has no visual prompt.`
    );
  }

  if (
    !cleanText(
      scene.narration
    )
  ) {
    throw new Error(
      `[VisualEngine] Scene ${
        index + 1
      } has no narration.`
    );
  }

  if (
    !cleanText(
      scene.action
    )
  ) {
    throw new Error(
      `[VisualEngine] Scene ${
        index + 1
      } has no action description.`
    );
  }

  if (
    !cleanText(
      scene.character
    )
  ) {
    throw new Error(
      `[VisualEngine] Scene ${
        index + 1
      } has no character continuity data.`
    );
  }

  if (
    !cleanText(
      scene.environment
    )
  ) {
    throw new Error(
      `[VisualEngine] Scene ${
        index + 1
      } has no environment continuity data.`
    );
  }
}

// ============================================================
// FIND VISUAL FOR ONE SCENE
// ============================================================

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

  const primaryQuery =
    buildSearchQuery(
      scene
    );

  const searchQueries =
    buildSearchQueries(
      scene
    );

  if (
    primaryQuery &&
    !searchQueries.includes(
      primaryQuery
    )
  ) {
    searchQueries.unshift(
      primaryQuery
    );
  }

  console.log(
    `[VisualEngine] ========================================`
  );

  console.log(
    `[VisualEngine] Scene ${
      index + 1
    } visual planning`
  );

  console.log(
    `[VisualEngine] Narration: ${
      scene.narration
    }`
  );

  console.log(
    `[VisualEngine] Character: ${
      scene.character
    }`
  );

  console.log(
    `[VisualEngine] Environment: ${
      scene.environment
    }`
  );

  console.log(
    `[VisualEngine] Action: ${
      scene.action
    }`
  );

  console.log(
    `[VisualEngine] Emotion: ${
      scene.emotion || ''
    }`
  );

  console.log(
    `[VisualEngine] Object: ${
      scene.importantObject ||
      ''
    }`
  );

  console.log(
    `[VisualEngine] Search queries: ${
      JSON.stringify(
        searchQueries
      )
    }`
  );

  console.log(
    `[VisualEngine] Continuity prompt prepared.`
  );

  console.log(
    `[VisualEngine] ========================================`
  );

  let allResults =
    [];

  for (
    const query of
      searchQueries
  ) {
    try {
      const results =
        await searchPexelsVideos(
          query
        );

      if (
        results.length > 0
      ) {
        allResults.push(
          ...results
        );
      }
    } catch (error) {
      console.warn(
        `[VisualEngine] Search query failed: ${query}`
      );

      console.warn(
        `[VisualEngine] Reason: ${
          error?.message ||
          error
        }`
      );
    }

    if (
      allResults.length >=
      MAX_CANDIDATES
    ) {
      break;
    }
  }

  /*
   * Remove duplicate Pexels videos.
   */

  const uniqueResults =
    [];

  const seenIds =
    new Set();

  for (
    const result of
      allResults
  ) {
    const id =
      result?.id ||
      result?.url;

    if (
      !id ||
      seenIds.has(id)
    ) {
      continue;
    }

    seenIds.add(id);

    uniqueResults.push(
      result
    );

    if (
      uniqueResults.length >=
      MAX_CANDIDATES
    ) {
      break;
    }
  }

  if (
    uniqueResults.length ===
    0
  ) {
    throw new Error(
      `[VisualEngine] No suitable Pexels visual found for scene ${
        index + 1
      }.`
    );
  }

  const selected =
    selectBestVisual(
      uniqueResults,
      scene,
      index
    );

  if (
    !selected
  ) {
    throw new Error(
      `[VisualEngine] Could not select a visual for scene ${
        index + 1
      }.`
    );
  }

  validateVisualMatchScore(
    selected,
    scene,
    index
  );

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

    importantObject:
      scene.importantObject ||
      '',

    narration:
      scene.narration || '',

    plannedDuration:
      Number(
        scene.duration ||
        5
      ),

    visualMatch: {
      method:
        'pexels-query-confidence',

      semanticScore:
        Number(
          selected.semanticScore ||
          0
        ),

      technicalScore:
        Number(
          selected.technicalScore ||
          0
        ),

      durationScore:
        Number(
          selected.durationScore ||
          0
        ),

      confidence:
        Number(
          selected.semanticScore ||
          0
        ) >= 50
          ? 'medium'
          : 'low',

      frameLevelVerified:
        false,

      note:
        'Pexels search confidence is not frame-level semantic verification.'
    }
  };
}

// ============================================================
// BUILD ALL SCENE VISUALS
// ============================================================

export async function buildSceneVisuals(
  scenes,
  story = {}
) {
  if (
    !Array.isArray(
      scenes
    ) ||
    scenes.length === 0
  ) {
    throw new Error(
      '[VisualEngine] No scenes provided.'
    );
  }

  const visuals =
    [];

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

    if (
      !visual?.url
    ) {
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
      `[VisualEngine] Visual coverage failed. Scenes: ${
        scenes.length
      }, visuals: ${
        visuals.length
      }.`
    );
  }

  /*
   * Reject a batch when more than half of the scenes
   * have low search-confidence.
   */

  const lowConfidenceCount =
    visuals.filter(
      visual =>
        visual?.visualMatch
          ?.confidence ===
        'low'
    ).length;

  if (
    lowConfidenceCount >
    Math.ceil(
      scenes.length * 0.5
    )
  ) {
    throw new Error(
      `[VisualEngine] Too many low-confidence visuals: ${
        lowConfidenceCount
      }/${scenes.length}. Refusing to render a potentially incoherent story.`
    );
  }

  console.log(
    `[VisualEngine] Visual planning complete: ${
      visuals.length
    }/${scenes.length} scenes covered.`
  );

  return visuals;
}

// ============================================================
// DOWNLOAD VISUAL
// ============================================================

export async function downloadVisual(
  visualOrUrl,
  outputPath
) {
  const visualUrl =
    typeof visualOrUrl === 'string'
      ? visualOrUrl
      : visualOrUrl?.url;

  if (
    !cleanText(
      visualUrl
    )
  ) {
    throw new Error(
      '[VisualEngine] Visual URL is missing.'
    );
  }

  if (
    !outputPath
  ) {
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
    `[VisualEngine] Downloading visual: ${
      absoluteOutputPath
    }`
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
        status
          ? ` (${status})`
          : ''
      }: ${message}`
    );
  }

  await new Promise(
    (
      resolve,
      reject
    ) => {
      const writer =
        fs.createWriteStream(
          absoluteOutputPath
        );

      let settled =
        false;

      const fail =
        error => {
          if (
            settled
          ) {
            return;
          }

          settled =
            true;

          writer.destroy();

          reject(
            error
          );
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
          if (
            settled
          ) {
            return;
          }

          settled =
            true;

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
      `[VisualEngine] Visual file was not created: ${
        absoluteOutputPath
      }`
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
      `[VisualEngine] Downloaded visual is not a file: ${
        absoluteOutputPath
      }`
    );
  }

  if (
    stats.size <
    MIN_FILE_SIZE
  ) {
    throw new Error(
      `[VisualEngine] Downloaded visual is too small: ${
        absoluteOutputPath
      } (${stats.size} bytes)`
    );
  }

  console.log(
    `[VisualEngine] Visual downloaded successfully: ${
      stats.size
    } bytes`
  );

  return absoluteOutputPath;
}

// ============================================================
// EXPORTS
// ============================================================

export default {
  findVisualForScene,
  buildSceneVisuals,
  downloadVisual
};