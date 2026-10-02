import fs from 'fs';
import path from 'path';
import axios from 'axios';

import { config } from '../config/index.mjs';

const PEXELS_API_URL =
  'https://api.pexels.com/videos/search';

const MIN_FILE_SIZE = 50 * 1024;
const MAX_QUERY_LENGTH = 180;
const MAX_RESULTS_PER_QUERY = 15;
const MAX_CANDIDATES = 45;
const MIN_VISUAL_CONFIDENCE = 20;

// ============================================================
// BASIC HELPERS
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

function normalizeText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getWords(value) {
  const text = normalizeText(value);

  if (!text) {
    return [];
  }

  return text
    .split(/\s+/)
    .filter(word => word.length >= 3);
}

function uniqueWords(values = []) {
  return [
    ...new Set(
      values.flatMap(value => getWords(value))
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
    word => !STOP_WORDS.has(word)
  );
}

// ============================================================
// SCENE DATA
// ============================================================

function getSceneObject(scene) {
  return cleanText(
    scene?.importantObject ||
    scene?.important_object ||
    scene?.object
  );
}

function getSceneCharacter(scene, story = {}) {
  return cleanText(
    scene?.character ||
    story?.character
  );
}

function validateScene(scene, index) {
  if (!scene) {
    throw new Error(
      `[VisualEngine] Scene ${index + 1} is missing.`
    );
  }

  if (!cleanText(scene.narration)) {
    throw new Error(
      `[VisualEngine] Scene ${index + 1} has no narration.`
    );
  }

  if (!cleanText(scene.action)) {
    throw new Error(
      `[VisualEngine] Scene ${index + 1} has no action.`
    );
  }

  if (!cleanText(scene.environment)) {
    throw new Error(
      `[VisualEngine] Scene ${index + 1} has no environment.`
    );
  }

  if (!getSceneCharacter(scene)) {
    throw new Error(
      `[VisualEngine] Scene ${index + 1} has no character continuity data.`
    );
  }

  if (!cleanText(scene.visualPrompt)) {
    throw new Error(
      `[VisualEngine] Scene ${index + 1} has no visual prompt.`
    );
  }
}

// ============================================================
// CONTINUITY PROMPT
// ============================================================

function buildContinuityPrompt(
  scene,
  story = {},
  index = 0
) {
  const character =
    getSceneCharacter(scene, story);

  const environment =
    cleanText(scene.environment);

  const action =
    cleanText(scene.action);

  const emotion =
    cleanText(scene.emotion);

  const object =
    getSceneObject(scene);

  const narration =
    cleanText(scene.narration);

  const visualPrompt =
    cleanText(scene.visualPrompt);

  return [
    'Professional vertical cinematic story scene.',
    `Scene ${index + 1}.`,
    `Narration event: ${narration}.`,
    `Main character: ${character}.`,
    `Environment: ${environment}.`,
    `Exact physical action: ${action}.`,
    `Emotion: ${emotion}.`,
    `Important object: ${object}.`,
    `Visual direction: ${visualPrompt}.`,
    'The visual must directly support the narration.',
    'The physical action should be visible whenever possible.',
    'Do not use unrelated footage.',
    'Keep character appearance consistent.',
    'Keep clothing, hairstyle and important accessories consistent.',
    'Keep important objects consistent.',
    'Keep the environment consistent unless the story changes location.',
    'Professional short-film composition.',
    'Natural lighting.',
    'Realistic footage.',
    'Vertical 9:16 composition.',
    'No text overlays.',
    'No logos.',
    'No watermark.'
  ].join(' ');
}

// ============================================================
// QUERY HELPERS
// ============================================================

function sanitizeQuery(query) {
  return cleanText(query)
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
}

function buildSearchQueries(scene) {
  const narration =
    cleanText(scene.narration);

  const action =
    cleanText(scene.action);

  const environment =
    cleanText(scene.environment);

  const emotion =
    cleanText(scene.emotion);

  const object =
    getSceneObject(scene);

  const queries = [
    [
      action,
      object,
      environment
    ],

    [
      action,
      environment
    ],

    [
      object,
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
    ...new Set(queries)
  ];
}

// ============================================================
// VIDEO FILE SCORE
// ============================================================

function scoreVideoFile(file) {
  const width =
    Number(file?.width || 0);

  const height =
    Number(file?.height || 0);

  const resolution =
    width * height;

  let score = 0;

  if (height > width) {
    score += 100;
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

// ============================================================
// PEXELS SEARCH
// ============================================================

async function searchPexelsVideos(query) {
  if (!cleanText(config?.pexelsApiKey)) {
    throw new Error(
      '[VisualEngine] PEXELS_API_KEY is missing.'
    );
  }

  const safeQuery =
    sanitizeQuery(query);

  if (!safeQuery) {
    throw new Error(
      '[VisualEngine] Empty Pexels search query.'
    );
  }

  let response;

  try {
    response = await axios.get(
      PEXELS_API_URL,
      {
        headers: {
          Authorization:
            config.pexelsApiKey
        },

        params: {
          query: safeQuery,
          orientation: 'portrait',
          size: 'large',
          per_page: MAX_RESULTS_PER_QUERY
        },

        timeout: 30000
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
      `[VisualEngine] Pexels request failed${
        status ? ` (${status})` : ''
      }: ${message}`
    );
  }

  const videos =
    Array.isArray(response?.data?.videos)
      ? response.data.videos
      : [];

  return videos
    .map(video => {
      const files =
        Array.isArray(video?.video_files)
          ? video.video_files
          : [];

      const bestFile =
        files
          .filter(file =>
            String(file?.file_type || '')
              .toLowerCase()
              .includes('mp4')
          )
          .filter(file =>
            Boolean(file?.link)
          )
          .sort(
            (a, b) =>
              scoreVideoFile(b) -
              scoreVideoFile(a)
          )[0];

      if (!bestFile?.link) {
        return null;
      }

      return {
        id:
          video?.id || null,

        url:
          bestFile.link,

        width:
          Number(bestFile.width || 0),

        height:
          Number(bestFile.height || 0),

        duration:
          Number(video?.duration || 0),

        provider: 'pexels',

        source: 'pexels',

        photographer:
          cleanText(
            video?.user?.name || ''
          ),

        searchQuery:
          safeQuery,

        fileScore:
          scoreVideoFile(bestFile)
      };
    })
    .filter(Boolean);
}

// ============================================================
// SEMANTIC SEARCH CONFIDENCE
// ============================================================

function scoreQueryMatch(candidate, scene) {
  const queryWords =
    new Set(
      removeStopWords(
        getWords(
          candidate?.searchQuery
        )
      )
    );

  const groups = [
    {
      words:
        removeStopWords(
          getWords(scene?.action)
        ),
      weight: 5
    },

    {
      words:
        removeStopWords(
          getWords(getSceneObject(scene))
        ),
      weight: 3
    },

    {
      words:
        removeStopWords(
          getWords(scene?.environment)
        ),
      weight: 2
    },

    {
      words:
        removeStopWords(
          getWords(scene?.emotion)
        ),
      weight: 1
    }
  ];

  let possible = 0;
  let matched = 0;

  for (const group of groups) {
    if (group.words.length === 0) {
      continue;
    }

    possible +=
      group.words.length *
      group.weight;

    for (const word of group.words) {
      if (queryWords.has(word)) {
        matched += group.weight;
      }
    }
  }

  if (possible === 0) {
    return 0;
  }

  return Math.round(
    (matched / possible) * 100
  );
}

// ============================================================
// VISUAL SELECTION
// ============================================================

function selectBestVisual(
  candidates,
  scene,
  index,
  usedVisualIds = new Set()
) {
  if (
    !Array.isArray(candidates) ||
    candidates.length === 0
  ) {
    return null;
  }

  const available =
    candidates.filter(candidate => {
      const identity =
        candidate?.id ||
        candidate?.url;

      return (
        identity &&
        !usedVisualIds.has(identity)
      );
    });

  if (available.length === 0) {
    throw new Error(
      `[VisualEngine] All candidate visuals for scene ${
        index + 1
      } were already used.`
    );
  }

  const scored =
    available.map(candidate => {
      const semanticScore =
        scoreQueryMatch(
          candidate,
          scene
        );

      const technicalScore =
        Math.min(
          Number(
            candidate.fileScore || 0
          ),
          275
        );

      const durationScore =
        Number(
          candidate.duration || 0
        ) > 0
          ? 10
          : 0;

      const verticalBonus =
        Number(candidate.height || 0) >
        Number(candidate.width || 0)
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
    });

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
    } selected visual ${
      selected.id || 'unknown'
    } | semantic=${
      selected.semanticScore
    } | total=${
      selected.finalScore
    }`
  );

  return selected;
}

// ============================================================
// VISUAL MATCH VALIDATION
// ============================================================

function validateVisualMatch(
  visual,
  scene,
  index
) {
  const semanticScore =
    Number(
      visual?.semanticScore || 0
    );

  if (
    semanticScore <
    MIN_VISUAL_CONFIDENCE
  ) {
    throw new Error(
      `[VisualEngine] Scene ${
        index + 1
      } visual confidence is too low: ${
        semanticScore
      }.`
    );
  }

  /*
   * IMPORTANT:
   * Pexels search confidence is not frame-level
   * semantic verification.
   *
   * This system therefore never claims that search
   * matching proves the exact frame content.
   */

  return true;
}

// ============================================================
// FIND VISUAL FOR ONE SCENE
// ============================================================

export async function findVisualForScene(
  scene,
  story = {},
  index = 0,
  usedVisualIds = new Set()
) {
  validateScene(
    scene,
    index
  );

  const continuityPrompt =
    buildContinuityPrompt(
      scene,
      story,
      index
    );

  const queries =
    buildSearchQueries(
      scene
    );

  if (queries.length === 0) {
    throw new Error(
      `[VisualEngine] Scene ${
        index + 1
      } produced no usable visual search query.`
    );
  }

  console.log(
    `[VisualEngine] Scene ${
      index + 1
    }`
  );

  console.log(
    `[VisualEngine] Action: ${
      scene.action
    }`
  );

  console.log(
    `[VisualEngine] Environment: ${
      scene.environment
    }`
  );

  console.log(
    `[VisualEngine] Character: ${
      getSceneCharacter(scene, story)
    }`
  );

  console.log(
    `[VisualEngine] Search queries: ${
      JSON.stringify(queries)
    }`
  );

  let allResults = [];

  for (const query of queries) {
    try {
      const results =
        await searchPexelsVideos(
          query
        );

      allResults.push(
        ...results
      );
    } catch (error) {
      console.warn(
        `[VisualEngine] Search failed for "${query}": ${
          error?.message || error
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

  const uniqueResults = [];
  const seen = new Set();

  for (const result of allResults) {
    const identity =
      result?.id ||
      result?.url;

    if (
      !identity ||
      seen.has(identity)
    ) {
      continue;
    }

    seen.add(identity);
    uniqueResults.push(result);

    if (
      uniqueResults.length >=
      MAX_CANDIDATES
    ) {
      break;
    }
  }

  if (uniqueResults.length === 0) {
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
      index,
      usedVisualIds
    );

  if (!selected?.url) {
    throw new Error(
      `[VisualEngine] Selected visual has no URL for scene ${
        index + 1
      }.`
    );
  }

  validateVisualMatch(
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
      getSceneCharacter(
        scene,
        story
      ),

    environment:
      scene.environment,

    action:
      scene.action,

    emotion:
      scene.emotion || '',

    importantObject:
      getSceneObject(scene),

    narration:
      scene.narration,

    plannedDuration:
      Number(
        scene.duration || 5
      ),

    visualMatch: {
      method:
        'pexels-query-confidence',

      semanticScore:
        Number(
          selected.semanticScore || 0
        ),

      technicalScore:
        Number(
          selected.technicalScore || 0
        ),

      durationScore:
        Number(
          selected.durationScore || 0
        ),

      confidence:
        Number(
          selected.semanticScore || 0
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
// BUILD VISUALS FOR ALL SCENES
// ============================================================

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
  const usedVisualIds = new Set();

  for (
    let index = 0;
    index < scenes.length;
    index += 1
  ) {
    const scene =
      scenes[index];

    const visual =
      await findVisualForScene(
        scene,
        story,
        index,
        usedVisualIds
      );

    if (!visual?.url) {
      throw new Error(
        `[VisualEngine] Scene ${
          index + 1
        } has no visual URL.`
      );
    }

    const identity =
      visual.id ||
      visual.url;

    if (!identity) {
      throw new Error(
        `[VisualEngine] Scene ${
          index + 1
        } has no stable visual identity.`
      );
    }

    if (
      usedVisualIds.has(identity)
    ) {
      throw new Error(
        `[VisualEngine] Duplicate visual detected for scene ${
          index + 1
        }.`
      );
    }

    usedVisualIds.add(identity);
    visuals.push(visual);
  }

  if (
    visuals.length !==
    scenes.length
  ) {
    throw new Error(
      `[VisualEngine] Visual coverage failed: ${
        visuals.length
      }/${scenes.length}.`
    );
  }

  const lowConfidence =
    visuals.filter(
      visual =>
        visual?.visualMatch
          ?.confidence === 'low'
    ).length;

  if (
    lowConfidence >
    Math.ceil(
      scenes.length * 0.5
    )
  ) {
    throw new Error(
      `[VisualEngine] Too many low-confidence visuals: ${
        lowConfidence
      }/${scenes.length}.`
    );
  }

  console.log(
    `[VisualEngine] Visual planning complete: ${
      visuals.length
    }/${scenes.length}.`
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

  ensureDirectory(
    path.dirname(
      absoluteOutputPath
    )
  );

  console.log(
    `[VisualEngine] Downloading visual to ${
      absoluteOutputPath
    }`
  );

  let response;

  try {
    response =
      await axios.get(
        visualUrl,
        {
          responseType: 'stream',
          timeout: 60000,
          maxRedirects: 5,
          validateStatus:
            status =>
              status >= 200 &&
              status < 300
        }
      );
  } catch (error) {
    const status =
      error?.response?.status;

    throw new Error(
      `[VisualEngine] Visual download failed${
        status ? ` (${status})` : ''
      }: ${
        error?.message ||
        'Unknown download error'
      }`
    );
  }

  await new Promise(
    (resolve, reject) => {
      const writer =
        fs.createWriteStream(
          absoluteOutputPath
        );

      let finished = false;

      const fail = error => {
        if (finished) {
          return;
        }

        finished = true;

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
          if (finished) {
            return;
          }

          finished = true;
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

  if (!stats.isFile()) {
    throw new Error(
      `[VisualEngine] Downloaded visual is not a file.`
    );
  }

  if (
    stats.size <
    MIN_FILE_SIZE
  ) {
    throw new Error(
      `[VisualEngine] Downloaded visual is too small: ${
        stats.size
      } bytes.`
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
// DEFAULT EXPORT
// ============================================================

export default {
  findVisualForScene,
  buildSceneVisuals,
  downloadVisual
};