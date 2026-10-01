import { GoogleGenAI } from '@google/genai';
import { config } from '../config/index.mjs';

/**
 * ZEESHAN AI VIDEO
 * Professional Script Engine
 *
 * Responsibilities:
 * - Original Shorts story generation
 * - Strong hook
 * - Topic relevance
 * - 6-10 connected scenes
 * - Natural English narration
 * - Character continuity
 * - Visual-event alignment
 * - Duration control
 * - Batch diversity
 * - Safety/originality checks
 * - Gemini generation with structured fallback
 */

const MODEL =
  process.env.GEMINI_MODEL ||
  'gemini-3.8-flash';

const videoConfig =
  config?.videoConfig || {};

const scriptConfig =
  config?.scriptConfig || {};

const MIN_SCENES =
  Number(scriptConfig.minScenes) || 6;

const MAX_SCENES =
  Number(scriptConfig.maxScenes) || 10;

const MIN_DURATION =
  Number(videoConfig.minDuration) || 20;

const MAX_DURATION =
  Number(videoConfig.maxDuration) || 59;

const TARGET_WPM =
  Number(scriptConfig.wordsPerMinute) || 150;

const MIN_NARRATION_WORDS =
  Number(scriptConfig.minWords) || 50;

const MAX_NARRATION_WORDS =
  Number(scriptConfig.maxWords) || 145;

const MIN_HOOK_WORDS = 7;
const MAX_HOOK_WORDS = 28;

const BATCH_LANES = [
  {
    name: 'Motivation',
    category: 'Motivation',
    instruction: `
Create an original motivational mini-story based on a
specific real-life problem.

Show:
- a clear goal
- an attempt
- a meaningful setback
- a practical turning point
- an earned result

Do not use generic motivational quotes.
Do not preach.
Do not rely on "never give up".
The lesson must come from what happens in the story.
`
  },

  {
    name: 'Funny',
    category: 'Funny Story',
    instruction: `
Create an original situational comedy.

Start with one specific awkward, surprising or funny situation.
Let the situation escalate naturally.
Keep the same characters and situation connected across scenes.
Build toward an unexpected but logical payoff.

Do not use memes.
Do not copy internet jokes.
Do not make every scene a separate joke.
`
  },

  {
    name: 'Interesting Facts',
    category: 'Amazing Information',
    instruction: `
Create an entertaining Short around ONE genuinely interesting,
well-established and verifiable fact or phenomenon.

Open with curiosity.
Explain the fact through a simple visual situation.
Keep the explanation accurate and easy to understand.

Never invent statistics, studies, experts or historical claims.
Do not present uncertain information as established fact.
`
  },

  {
    name: 'Mystery',
    category: 'Mystery and Curiosity',
    instruction: `
Create an original fictional mystery.

Establish one clear mystery immediately.
Give the viewer a question they want answered.
Reveal useful clues progressively.
Make every clue relevant.
End with one logical explanation.

Do not fabricate real crimes, victims, evidence or news.
`
  },

  {
    name: 'Emotional Life',
    category: 'Interesting Human Story',
    instruction: `
Create an original emotional human story.

Use a believable everyday relationship, decision or life problem.
Show emotion through actions and choices.
Avoid exaggerated speeches.
Build toward a sincere turning point.
End with a meaningful resolution.

Avoid fake tragedy and emotional manipulation.
`
  }
];

const FALLBACK_STORIES = [
  {
    title: 'The One Mistake',
    category: 'Motivation',
    topicKeywords: [
      'failure',
      'practice',
      'mistake',
      'improve'
    ],
    hook:
      'Daniel failed the same practical test three times, but the fourth attempt was different.',
    character:
      'Daniel, a young adult with short dark hair, a navy hoodie and a black backpack',
    goal:
      'Pass an important practical test.',
    conflict:
      'Daniel keeps repeating the same mistake during practice.',
    setback:
      'He fails again after making that mistake at the worst possible moment.',
    turningPoint:
      'Daniel stops repeating the entire test and focuses only on the mistake causing the failures.',
    resolution:
      'He changes his practice method and repeatedly trains that specific weakness.',
    ending:
      'On the next attempt, Daniel handles the problem correctly and passes the test.',
    lesson:
      'Progress can begin by fixing one specific weakness instead of repeating everything.'
  },

  {
    title: 'The Wrong Meeting',
    category: 'Funny Story',
    topicKeywords: [
      'meeting',
      'office',
      'mistake',
      'funny'
    ],
    hook:
      'Sam confidently joined a meeting, then realized nobody in the room knew who he was.',
    character:
      'Sam, a young professional with short brown hair, a grey jacket and a laptop bag',
    goal:
      'Attend an important work meeting.',
    conflict:
      'Sam accidentally enters the wrong meeting room.',
    setback:
      'He spends several minutes discussing a project he has never heard about.',
    turningPoint:
      'A manager finally asks Sam which department he works for.',
    resolution:
      'Sam checks his phone and discovers his actual meeting is next door.',
    ending:
      'He apologizes, walks next door and arrives at the correct meeting just in time.',
    lesson:
      'Confidence helps, but checking the room number helps more.'
  },

  {
    title: 'Why Ice Floats',
    category: 'Amazing Information',
    topicKeywords: [
      'ice',
      'water',
      'science',
      'lake'
    ],
    hook:
      'Ice looks like it should sink, but one unusual property of water makes it float.',
    character:
      'Maya, a curious young woman with curly dark hair, a green coat and a small backpack',
    goal:
      'Understand why ice floats on liquid water.',
    conflict:
      'Maya assumes freezing should make water denser.',
    setback:
      'She discovers that water behaves differently when it freezes.',
    turningPoint:
      'She learns that water expands as it freezes, making ice less dense.',
    resolution:
      'Because ice is less dense than liquid water, it remains at the surface.',
    ending:
      'That floating ice layer can also help protect deeper water from freezing completely.',
    lesson:
      'One unusual property of water has important consequences for life.'
  },

  {
    title: 'The Midnight Light',
    category: 'Mystery and Curiosity',
    topicKeywords: [
      'light',
      'office',
      'midnight',
      'mystery'
    ],
    hook:
      'Every night at exactly midnight, a light appeared inside an empty office.',
    character:
      'Ethan, a young investigator with short black hair, a dark jacket and a small notebook',
    goal:
      'Discover why the office light keeps turning on.',
    conflict:
      'Nobody appears to enter the building at night.',
    setback:
      'Security footage shows an empty hallway when the light turns on.',
    turningPoint:
      'Ethan notices the light activates at exactly the same time every night.',
    resolution:
      'He discovers an old automatic timer still controls the office lights.',
    ending:
      'The mystery was not a person at all. It was a forgotten setting.',
    lesson:
      'A strange result can have a surprisingly ordinary explanation.'
  },

  {
    title: 'The Hidden Note',
    category: 'Interesting Human Story',
    topicKeywords: [
      'message',
      'apartment',
      'memory',
      'moving'
    ],
    hook:
      'While moving out, Noah found a handwritten message hidden behind an old shelf.',
    character:
      'Noah, a young man with short dark hair, a brown jacket and a moving box',
    goal:
      'Finish moving out and begin the next chapter of his life.',
    conflict:
      'The apartment reminds Noah of an important promise from his past.',
    setback:
      'The hidden message makes him stop packing and reconsider leaving.',
    turningPoint:
      'The message reminds Noah that moving forward was part of the promise.',
    resolution:
      'He finishes packing instead of remaining trapped in the memory.',
    ending:
      'Noah carries the final box outside and finally leaves the apartment behind.',
    lesson:
      'Moving forward does not mean forgetting where you came from.'
  }
];

/* ============================================================
   TEXT HELPERS
   ============================================================ */

function cleanText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordCount(text) {
  const value = cleanText(text);

  if (!value) {
    return 0;
  }

  return value
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function clamp(value, min, max) {
  return Math.min(
    Math.max(value, min),
    max
  );
}

function normalizeForComparison(text) {
  return cleanText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getWords(text) {
  return normalizeForComparison(text)
    .split(/\s+/)
    .filter(Boolean);
}

function uniqueWords(text) {
  return [
    ...new Set(
      getWords(text)
    )
  ];
}

function estimateDuration(text) {
  const words = wordCount(text);

  if (!words) {
    return MIN_DURATION;
  }

  const seconds = Math.ceil(
    (words / TARGET_WPM) * 60
  );

  return clamp(
    seconds,
    MIN_DURATION,
    MAX_DURATION
  );
}

function estimateSceneDuration(text) {
  const words = wordCount(text);

  if (!words) {
    return 3;
  }

  const seconds = Math.ceil(
    (words / TARGET_WPM) * 60
  );

  return clamp(
    seconds,
    2,
    10
  );
}

function hasMeaningfulOverlap(a, b) {
  const first = new Set(
    uniqueWords(a).filter(
      word => word.length >= 4
    )
  );

  const second =
    uniqueWords(b).filter(
      word => word.length >= 4
    );

  if (
    !first.size ||
    !second.length
  ) {
    return false;
  }

  let matches = 0;

  for (const word of second) {
    if (first.has(word)) {
      matches += 1;
    }
  }

  const threshold =
    Math.min(
      4,
      Math.max(
        2,
        Math.floor(
          second.length * 0.35
        )
      )
    );

  return matches >= threshold;
}

/* ============================================================
   JSON EXTRACTION
   ============================================================ */

function extractJson(text) {
  const cleaned =
    String(text || '')
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace =
      cleaned.indexOf('{');

    const lastBrace =
      cleaned.lastIndexOf('}');

    if (
      firstBrace === -1 ||
      lastBrace === -1 ||
      lastBrace <= firstBrace
    ) {
      throw new Error(
        '[ScriptEngine] Gemini returned invalid JSON.'
      );
    }

    try {
      return JSON.parse(
        cleaned.slice(
          firstBrace,
          lastBrace + 1
        )
      );
    } catch {
      throw new Error(
        '[ScriptEngine] Gemini returned malformed JSON.'
      );
    }
  }
}

/* ============================================================
   CONTENT LANE
   ============================================================ */

function getContentLane(options = {}) {
  const explicit =
    cleanText(
      options.contentLane
    );

  if (explicit) {
    const found =
      BATCH_LANES.find(
        lane =>
          lane.name.toLowerCase() ===
          explicit.toLowerCase()
      );

    if (found) {
      return found;
    }
  }

  const rawIndex =
    Number(
      options.variationIndex
    );

  const index =
    Number.isInteger(rawIndex)
      ? Math.abs(rawIndex)
      : 0;

  return BATCH_LANES[
    index % BATCH_LANES.length
  ];
}

/* ============================================================
   TOPIC
   ============================================================ */

function normalizeTopic(topic) {
  return cleanText(topic)
    .replace(/^topic\s*:/i, '')
    .trim();
}

function validateTopicSpecificity(
  story,
  topic
) {
  const requestedTopic =
    normalizeTopic(topic);

  if (!requestedTopic) {
    return;
  }

  const storyText = [
    story.title,
    story.hook,
    story.goal,
    story.conflict,
    story.setback,
    story.turningPoint,
    story.resolution,
    story.ending,
    story.lesson,
    story.narration,
    ...story.scenes.map(
      scene =>
        [
          scene.narration,
          scene.action,
          scene.environment,
          scene.importantObject,
          scene.visualPrompt
        ].join(' ')
    )
  ].join(' ');

  const topicWords =
    uniqueWords(
      requestedTopic
    ).filter(
      word =>
        word.length >= 4 &&
        ![
          'story',
          'video',
          'short',
          'youtube',
          'make',
          'create',
          'about'
        ].includes(word)
    );

  if (!topicWords.length) {
    return;
  }

  const storyWords =
    new Set(
      uniqueWords(storyText)
    );

  const matches =
    topicWords.filter(
      word =>
        storyWords.has(word)
    );

  const required =
    topicWords.length === 1
      ? 1
      : Math.min(
          2,
          topicWords.length
        );

  if (
    matches.length < required
  ) {
    throw new Error(
      `[ScriptEngine] Requested topic is not clearly used: "${requestedTopic}".`
    );
  }
}

/* ============================================================
   HOOK
   ============================================================ */

function validateHook(story) {
  const hook =
    cleanText(
      story.hook
    );

  const words =
    wordCount(hook);

  if (
    words < MIN_HOOK_WORDS
  ) {
    throw new Error(
      '[ScriptEngine] Hook is too short.'
    );
  }

  if (
    words > MAX_HOOK_WORDS
  ) {
    throw new Error(
      '[ScriptEngine] Hook is too long.'
    );
  }

  const weakHooks = [
    'never give up',
    'believe in yourself',
    'you can do anything',
    'follow your dreams',
    'life is hard',
    'this will change your life',
    'wait until the end',
    'you will not believe'
  ];

  const normalized =
    normalizeForComparison(
      hook
    );

  if (
    weakHooks.some(
      phrase =>
        normalized.includes(
          phrase
        )
    )
  ) {
    throw new Error(
      '[ScriptEngine] Hook is generic or cliché.'
    );
  }

  if (
    !/[.!?]/.test(hook)
  ) {
    throw new Error(
      '[ScriptEngine] Hook must be a complete spoken sentence.'
    );
  }
}

/* ============================================================
   PAYOFF
   ============================================================ */

function validatePayoff(story) {
  const ending =
    cleanText(
      story.ending
    );

  const resolution =
    cleanText(
      story.resolution
    );

  const turningPoint =
    cleanText(
      story.turningPoint
    );

  if (
    wordCount(ending) < 6
  ) {
    throw new Error(
      '[ScriptEngine] Ending is too weak.'
    );
  }

  if (
    hasMeaningfulOverlap(
      ending,
      turningPoint
    ) &&
    hasMeaningfulOverlap(
      ending,
      resolution
    )
  ) {
    throw new Error(
      '[ScriptEngine] Ending is too repetitive.'
    );
  }
}

/* ============================================================
   SAFETY
   ============================================================ */

function validateSafety(story) {
  const text =
    normalizeForComparison(
      [
        story.title,
        story.hook,
        story.goal,
        story.conflict,
        story.setback,
        story.turningPoint,
        story.resolution,
        story.ending,
        story.lesson,
        story.narration,
        ...story.scenes.map(
          scene =>
            `${scene.narration} ${scene.visualPrompt}`
        )
      ].join(' ')
    );

  const blockedPatterns = [
    'graphic gore',
    'graphic violence',
    'sexual assault',
    'child sexual',
    'suicide instructions',
    'how to kill',
    'how to build a weapon',
    'terrorist instructions',
    'extremist recruitment',
    'fake news',
    'real victim',
    'real crime evidence'
  ];

  for (
    const pattern of blockedPatterns
  ) {
    if (
      text.includes(pattern)
    ) {
      throw new Error(
        `[ScriptEngine] Safety risk detected: ${pattern}.`
      );
    }
  }
}

/* ============================================================
   VISUAL RELATIONSHIP
   ============================================================ */

function containsWeakVisualLanguage(
  text
) {
  const value =
    cleanText(text)
      .toLowerCase();

  const weakTerms = [
    'random footage',
    'random scene',
    'generic footage',
    'generic scene',
    'unrelated footage',
    'stock footage',
    'random person',
    'random people',
    'random city',
    'random landscape',
    'cinematic footage'
  ];

  return weakTerms.some(
    term =>
      value.includes(term)
  );
}

function validateSceneVisualRelationship(
  scene,
  index
) {
  const number =
    index + 1;

  const narration =
    cleanText(
      scene.narration
    );

  const visual =
    cleanText(
      scene.visualPrompt
    );

  const action =
    cleanText(
      scene.action
    );

  if (!narration) {
    throw new Error(
      `[ScriptEngine] Scene ${number} has no narration.`
    );
  }

  if (!visual) {
    throw new Error(
      `[ScriptEngine] Scene ${number} has no visualPrompt.`
    );
  }

  if (
    containsWeakVisualLanguage(
      visual
    )
  ) {
    throw new Error(
      `[ScriptEngine] Scene ${number} contains weak visual language.`
    );
  }

  if (
    wordCount(narration) < 4
  ) {
    throw new Error(
      `[ScriptEngine] Scene ${number} narration is too short.`
    );
  }

  if (
    action.length < 10
  ) {
    throw new Error(
      `[ScriptEngine] Scene ${number} action is too vague.`
    );
  }

  if (
    cleanText(
      scene.character
    ).length < 8
  ) {
    throw new Error(
      `[ScriptEngine] Scene ${number} character continuity is too weak.`
    );
  }

  if (
    cleanText(
      scene.environment
    ).length < 8
  ) {
    throw new Error(
      `[ScriptEngine] Scene ${number} environment is too vague.`
    );
  }

  if (
    cleanText(
      scene.importantObject
    ).length < 5
  ) {
    throw new Error(
      `[ScriptEngine] Scene ${number} importantObject is too vague.`
    );
  }

  const actionWords =
    uniqueWords(action)
      .filter(
        word =>
          word.length >= 4
      );

  const visualWords =
    new Set(
      uniqueWords(visual)
    );

  if (
    actionWords.length >= 2
  ) {
    const matches =
      actionWords.filter(
        word =>
          visualWords.has(word)
      );

    if (
      matches.length === 0
    ) {
      throw new Error(
        `[ScriptEngine] Scene ${number} visualPrompt does not clearly represent its action.`
      );
    }
  }
}

/* ============================================================
   SCENE NORMALIZATION
   ============================================================ */

function normalizeScene(
  scene,
  index,
  storyCharacter = ''
) {
  const narration =
    cleanText(
      scene?.narration ||
      scene?.voiceover ||
      scene?.voice
    );

  const character =
    cleanText(
      typeof scene?.character === 'string'
        ? scene.character
        : scene?.character?.description ||
          scene?.character?.name ||
          ''
    );

  const environment =
    cleanText(
      scene?.environment ||
      scene?.location ||
      scene?.setting ||
      ''
    );

  const action =
    cleanText(
      scene?.action ||
      scene?.movement ||
      ''
    );

  const emotion =
    cleanText(
      scene?.emotion ||
      scene?.mood ||
      ''
    );

  const importantObject =
    cleanText(
      scene?.importantObject ||
      scene?.important_object ||
      scene?.object ||
      ''
    );

  const suppliedVisual =
    cleanText(
      scene?.visualPrompt ||
      scene?.visual_prompt ||
      ''
    );

  const finalCharacter =
    character ||
    storyCharacter ||
    'A young adult protagonist with consistent appearance, hairstyle and clothing';

  const finalEnvironment =
    environment ||
    'a realistic modern everyday environment';

  const finalAction =
    action ||
    'performs the exact physical action described by the narration';

  const finalEmotion =
    emotion ||
    'natural story-appropriate emotion';

  const finalObject =
    importantObject ||
    'the key object directly involved in the narrated event';

  const finalVisualPrompt =
    suppliedVisual ||
    [
      'Realistic cinematic vertical 9:16 shot',
      `showing ${finalCharacter}`,
      `physically performing ${finalAction}`,
      `inside ${finalEnvironment}`,
      `with ${finalObject}`,
      `showing ${finalEmotion}`,
      'the exact narrated event must be visible',
      'consistent character appearance',
      'consistent hairstyle and clothing',
      'consistent important object',
      'natural lighting',
      'realistic photography',
      'no unrelated people',
      'no unrelated objects',
      'no text overlays',
      'no logos',
      'no watermark'
    ].join(', ');

  const suppliedDuration =
    Number(
      scene?.duration
    );

  return {
    sceneNumber:
      index + 1,

    narration,

    duration:
      Number.isFinite(
        suppliedDuration
      ) &&
      suppliedDuration > 0
        ? clamp(
            suppliedDuration,
            2,
            10
          )
        : estimateSceneDuration(
            narration
          ),

    character:
      finalCharacter,

    environment:
      finalEnvironment,

    action:
      finalAction,

    emotion:
      finalEmotion,

    importantObject:
      finalObject,

    visualPrompt:
      finalVisualPrompt
  };
}

/* ============================================================
   STORY NORMALIZATION
   ============================================================ */

function normalizeStory(raw) {
  const story =
    raw || {};

  const storyCharacter =
    cleanText(
      typeof story.character === 'string'
        ? story.character
        : story.character?.description ||
          story.character?.name ||
          ''
    );

  const rawScenes =
    Array.isArray(
      story.scenes
    )
      ? story.scenes
      : [];

  const scenes =
    rawScenes.map(
      (scene, index) =>
        normalizeScene(
          scene,
          index,
          storyCharacter
        )
    );

  const sceneNarration =
    scenes
      .map(
        scene =>
          scene.narration
      )
      .filter(Boolean)
      .join(' ');

  const narration =
    cleanText(
      story.narration ||
      sceneNarration
    );

  return {
    title:
      cleanText(
        story.title
      ),

    category:
      cleanText(
        story.category
      ),

    audience:
      cleanText(
        story.audience
      ) ||
      'UK, USA and Europe',

    hook:
      cleanText(
        story.hook
      ),

    character:
      storyCharacter,

    goal:
      cleanText(
        story.goal
      ),

    conflict:
      cleanText(
        story.conflict
      ),

    setback:
      cleanText(
        story.setback
      ),

    turningPoint:
      cleanText(
        story.turningPoint
      ),

    resolution:
      cleanText(
        story.resolution
      ),

    ending:
      cleanText(
        story.ending
      ),

    lesson:
      cleanText(
        story.lesson
      ),

    narration,

    duration:
      estimateDuration(
        narration
      ),

    aiDisclosureRecommended:
      Boolean(
        story.aiDisclosureRecommended
      ),

    qualityFlags: {
      grammarChecked: true,
      storyStructureChecked: true,
      visualStoryMatchRequired: true,
      characterContinuityRequired: true,
      originalityRequired: true,
      repetitionRiskChecked: true,
      metadataRiskChecked: true,
      hookQualityChecked: true,
      topicSpecificityChecked: true,
      payoffChecked: true,
      safetyChecked: true
    },

    scenes
  };
}

/* ============================================================
   STORY VALIDATION
   ============================================================ */

function validateStory(
  story,
  topic = '',
  options = {}
) {
  const requiredFields = [
    'title',
    'hook',
    'character',
    'goal',
    'conflict',
    'setback',
    'turningPoint',
    'resolution',
    'ending',
    'narration'
  ];

  const missing =
    requiredFields.filter(
      field =>
        !cleanText(
          story[field]
        )
    );

  if (
    missing.length
  ) {
    throw new Error(
      `[ScriptEngine] Missing fields: ${missing.join(', ')}`
    );
  }

  if (
    !Array.isArray(
      story.scenes
    )
  ) {
    throw new Error(
      '[ScriptEngine] Scenes are missing.'
    );
  }

  if (
    story.scenes.length <
      MIN_SCENES ||
    story.scenes.length >
      MAX_SCENES
  ) {
    throw new Error(
      `[ScriptEngine] Scene count must be ${MIN_SCENES}-${MAX_SCENES}.`
    );
  }

  validateHook(story);
  validatePayoff(story);
  validateSafety(story);

  if (
    cleanText(story.goal).length < 8
  ) {
    throw new Error(
      '[ScriptEngine] Goal is too vague.'
    );
  }

  if (
    cleanText(story.conflict).length < 10
  ) {
    throw new Error(
      '[ScriptEngine] Conflict is too vague.'
    );
  }

  if (
    cleanText(story.setback).length < 10
  ) {
    throw new Error(
      '[ScriptEngine] Setback is too vague.'
    );
  }

  if (
    cleanText(story.turningPoint).length < 10
  ) {
    throw new Error(
      '[ScriptEngine] Turning point is too vague.'
    );
  }

  if (
    cleanText(story.resolution).length < 10
  ) {
    throw new Error(
      '[ScriptEngine] Resolution is too vague.'
    );
  }

  const narrationWords =
    wordCount(
      story.narration
    );

  if (
    narrationWords <
    MIN_NARRATION_WORDS
  ) {
    throw new Error(
      `[ScriptEngine] Narration is below ${MIN_NARRATION_WORDS} words.`
    );
  }

  if (
    narrationWords >
    MAX_NARRATION_WORDS
  ) {
    throw new Error(
      `[ScriptEngine] Narration exceeds ${MAX_NARRATION_WORDS} words.`
    );
  }

  const sceneNarration =
    story.scenes
      .map(
        scene =>
          scene.narration
      )
      .join(' ');

  const sceneWords =
    wordCount(
      sceneNarration
    );

  if (
    sceneWords <
    MIN_NARRATION_WORDS
  ) {
    throw new Error(
      '[ScriptEngine] Scene narration is too short.'
    );
  }

  const difference =
    Math.abs(
      sceneWords -
      narrationWords
    );

  const allowedDifference =
    Math.max(
      15,
      Math.ceil(
        narrationWords * 0.25
      )
    );

  if (
    difference >
    allowedDifference
  ) {
    throw new Error(
      '[ScriptEngine] Story narration and scene narration differ too much.'
    );
  }

  const totalSceneDuration =
    story.scenes.reduce(
      (total, scene) =>
        total +
        Number(scene.duration || 0),
      0
    );

  if (
    totalSceneDuration <
      MIN_DURATION ||
    totalSceneDuration >
      MAX_DURATION + 8
  ) {
    throw new Error(
      `[ScriptEngine] Estimated scene duration is outside the production range: ${totalSceneDuration}s.`
    );
  }

  for (
    let i = 0;
    i < story.scenes.length;
    i += 1
  ) {
    const scene =
      story.scenes[i];

    validateSceneVisualRelationship(
      scene,
      i
    );

    if (
      !Number.isFinite(
        Number(
          scene.duration
        )
      ) ||
      Number(scene.duration) <= 0
    ) {
      throw new Error(
        `[ScriptEngine] Scene ${i + 1} has invalid duration.`
      );
    }
  }

  validateTopicSpecificity(
    story,
    topic
  );

  const previousConcepts =
    Array.isArray(
      options.previousConcepts
    )
      ? options.previousConcepts
          .map(
            item =>
              cleanText(item)
          )
          .filter(Boolean)
      : [];

  const currentConcept =
    [
      story.title,
      story.hook,
      story.goal,
      story.conflict,
      story.ending
    ].join(' ');

  for (
    const previous of previousConcepts
  ) {
    if (
      hasMeaningfulOverlap(
        currentConcept,
        previous
      )
    ) {
      throw new Error(
        '[ScriptEngine] Story is too similar to a previous batch concept.'
      );
    }
  }

  return true;
}

/* ============================================================
   FALLBACK
   ============================================================ */

function createFallbackStory(
  topic,
  options = {}
) {
  const rawIndex =
    Number(
      options.variationIndex
    );

  const index =
    Number.isInteger(
      rawIndex
    )
      ? Math.abs(rawIndex)
      : 0;

  const requestedTopic =
    normalizeTopic(topic);

  let templateIndex =
    index %
    FALLBACK_STORIES.length;

  if (
    requestedTopic
  ) {
    const topicWords =
      uniqueWords(
        requestedTopic
      );

    const ranked =
      FALLBACK_STORIES
        .map(
          (template, templateIndex) => ({
            template,
            templateIndex,
            matches:
              topicWords.filter(
                word =>
                  template.topicKeywords.includes(
                    word
                  )
              ).length
          })
        )
        .sort(
          (a, b) =>
            b.matches -
            a.matches
        );

    if (
      ranked[0]?.matches > 0
    ) {
      templateIndex =
        ranked[0].templateIndex;
    }
  }

  const template =
    FALLBACK_STORIES[
      templateIndex
    ];

  const scenes = [
    {
      narration:
        template.hook,
      character:
        template.character,
      environment:
        'the main story location',
      action:
        'experiences the specific opening event described in the narration',
      emotion:
        'surprised and curious',
      importantObject:
        'the main object connected to the opening event'
    },

    {
      narration:
        `The goal is simple: ${template.goal}`,
      character:
        template.character,
      environment:
        'the same main story location',
      action:
        'takes a clear physical step toward the goal',
      emotion:
        'focused',
      importantObject:
        'the object directly involved in the goal'
    },

    {
      narration:
        template.conflict,
      character:
        template.character,
      environment:
        'the same story location',
      action:
        'encounters the specific problem described by the narration',
      emotion:
        'concerned',
      importantObject:
        'the object involved in the problem'
    },

    {
      narration:
        template.setback,
      character:
        template.character,
      environment:
        'the same story location',
      action:
        'deals directly with the setback',
      emotion:
        'frustrated',
      importantObject:
        'the object directly involved in the setback'
    },

    {
      narration:
        template.turningPoint,
      character:
        template.character,
      environment:
        'the same story location',
      action:
        'notices or uses the idea that changes the situation',
      emotion:
        'hopeful',
      importantObject:
        'the clue, tool or object causing the turning point'
    },

    {
      narration:
        template.resolution,
      character:
        template.character,
      environment:
        'the same story location',
      action:
        'applies the new solution to the original problem',
      emotion:
        'confident',
      importantObject:
        'the object used in the solution'
    },

    {
      narration:
        template.ending,
      character:
        template.character,
      environment:
        'the final location connected to the outcome',
      action:
        'experiences the final result of the story',
      emotion:
        'relieved',
      importantObject:
        'the object connected to the final result'
    },

    {
      narration:
        template.lesson,
      character:
        template.character,
      environment:
        'the same final location',
      action:
        'moves forward after the experience',
      emotion:
        'calm and reflective',
      importantObject:
        'a subtle visual reminder of the experience'
    }
  ];

  const narration =
    scenes
      .map(
        scene =>
          scene.narration
      )
      .join(' ');

  const finalTitle =
    requestedTopic
      ? `${template.title}: ${requestedTopic}`
      : template.title;

  return normalizeStory({
    title:
      finalTitle,

    category:
      template.category,

    audience:
      'UK, USA and Europe',

    hook:
      template.hook,

    character:
      template.character,

    goal:
      requestedTopic
        ? `${template.goal} The story specifically explores ${requestedTopic}.`
        : template.goal,

    conflict:
      template.conflict,

    setback:
      template.setback,

    turningPoint:
      template.turningPoint,

    resolution:
      template.resolution,

    ending:
      template.ending,

    lesson:
      template.lesson,

    narration,

    aiDisclosureRecommended:
      false,

    scenes
  });
}

/* ============================================================
   GEMINI PROMPT
   ============================================================ */

function buildPrompt(
  topic,
  options = {}
) {
  const lane =
    getContentLane(
      options
    );

  const requestedTopic =
    normalizeTopic(topic);

  const audience =
    cleanText(
      options.region
    ) ||
    'UK, USA and Europe';

  const rawIndex =
    Number(
      options.variationIndex
    );

  const variationIndex =
    Number.isInteger(
      rawIndex
    )
      ? Math.abs(rawIndex)
      : 0;

  const previousConcepts =
    Array.isArray(
      options.previousConcepts
    )
      ? options.previousConcepts
          .map(
            item =>
              cleanText(item)
          )
          .filter(Boolean)
          .join('\n- ')
      : '';

  return `
You are the Senior Creative Director,
YouTube Shorts Story Director,
Visual Story Director and Quality Editor
for ZEESHAN AI VIDEO.

Create ONE complete professional YouTube Short.

The scenes are parts of ONE video.
They are NOT separate videos.

==================================================
AUDIENCE
==================================================

Primary audience:
USA, UK and Europe.

Language:
Natural international English.

Avoid:
- awkward AI wording
- excessive slang
- corporate language
- essay-style narration
- copied creator styles
- unnecessary exposition

==================================================
CURRENT VIDEO
==================================================

Creative lane:
${lane.name}

Category:
${lane.category}

Audience:
${audience}

Video index:
${variationIndex + 1}

Creative direction:
${lane.instruction}

==================================================
TOPIC
==================================================

Requested topic:

${requestedTopic || 'Choose one specific topic suitable for the creative lane.'}

If a topic is supplied, it is MANDATORY.

The topic must influence:
- hook
- story
- scenes
- visuals
- conflict
- payoff
- ending

Do not merely put the topic in the title.

==================================================
BATCH DIVERSITY
==================================================

Previous concepts:

${previousConcepts || 'None supplied.'}

Do not repeat or closely imitate previous concepts.

Change the actual:
- premise
- character situation
- setting
- problem
- goal
- events
- visual situations
- payoff

Changing only names or titles is NOT enough.

==================================================
HOOK
==================================================

The first seconds must create immediate curiosity.

Use:
- a specific surprising event
- a specific question
- an unusual problem
- an unexpected discovery
- a clear emotional situation
- a specific mystery

The hook must be honest and connected to the actual story.

Do not use:
"Never give up."
"Believe in yourself."
"You can do anything."
"Wait until the end."
"You won't believe this."
"Life is hard."

The hook must receive a payoff later.

==================================================
STORY STRUCTURE
==================================================

Build ONE connected mini-film:

HOOK
SETUP
GOAL / QUESTION
PROBLEM
ESCALATION
SETBACK
TURNING POINT
SOLUTION / REVEAL
PAYOFF
ENDING

Every scene must logically cause or lead to the next.

No filler scenes.

==================================================
CHARACTER CONTINUITY
==================================================

Use one primary protagonist.

Define:
- name
- approximate age
- hair
- hairstyle
- clothing
- accessories

Keep these details stable in every scene.

If a recurring secondary character appears,
keep that character visually stable too.

==================================================
SCENE EVENT
==================================================

Every scene must contain a REAL PHYSICAL EVENT.

Narration says what happens.

Action describes the physical action.

VisualPrompt shows that exact action.

BAD:
Narration: "He opens the box."
Visual: "A beautiful city skyline."

GOOD:
Narration: "He opens the old metal box."
Action: "He lifts the lid of the old metal box."
Visual: "The protagonist physically lifts the lid of the old metal box."

==================================================
VISUAL PROMPTS
==================================================

Every visualPrompt must include:
- protagonist
- physical action
- environment
- emotion
- important object
- continuity
- vertical 9:16
- realistic cinematic appearance

Do not use:
- random footage
- generic footage
- stock footage
- unrelated people
- unrelated objects
- unrelated locations
- text overlays
- logos
- watermarks

==================================================
NARRATION
==================================================

Narration must sound natural when spoken aloud.

Target:
${MIN_NARRATION_WORDS}-${MAX_NARRATION_WORDS} words.

Target speaking rate:
approximately ${TARGET_WPM} WPM.

Keep sentences short enough for voiceover.

==================================================
DURATION
==================================================

Final Short target:
${MIN_DURATION}-${MAX_DURATION} seconds.

Use 6-${MAX_SCENES} connected scenes.

Scene duration should normally be 2-10 seconds.

==================================================
FACTS
==================================================

For factual content:
- use established facts
- never invent studies
- never invent experts
- never invent statistics
- never invent quotes
- never invent historical events

==================================================
MYSTERY
==================================================

Mysteries should normally be fictional.

Do not fabricate real:
- crimes
- victims
- evidence
- accusations
- news events

==================================================
ORIGINALITY
==================================================

Create an original concept.

Do not copy or closely reproduce:
- movies
- TV shows
- YouTube videos
- TikTok videos
- creator scripts
- famous fictional characters
- copyrighted stories

Do not imitate a specific creator.

==================================================
SAFETY
==================================================

Avoid:
- graphic violence
- sexual content
- hateful content
- dangerous instructions
- fake news
- deceptive evidence
- impersonation
- real-world accusations

==================================================
AI DISCLOSURE FLAG
==================================================

If realistic AI-generated content may warrant disclosure review,
set:

"aiDisclosureRecommended": true

Otherwise:

false

This is a review flag only.

Do not claim guaranteed YouTube compliance or monetization.

==================================================
FINAL CHECK
==================================================

Before returning JSON verify:

1. Specific topic.
2. Topic actually drives story.
3. Strong hook.
4. Honest hook.
5. Hook has payoff.
6. Clear protagonist.
7. Character continuity.
8. Clear goal/question.
9. Clear conflict.
10. Escalation.
11. Setback.
12. Turning point.
13. Resolution.
14. Payoff.
15. Connected ending.
16. 6-${MAX_SCENES} scenes.
17. Every scene has a real event.
18. Narration matches action.
19. Visual matches action.
20. Important objects are consistent.
21. Original concept.
22. Different from previous concepts.
23. Natural English.
24. Accurate facts where applicable.
25. Fictional mystery where appropriate.
26. No unsafe content.
27. No deceptive clickbait.
28. ${MIN_NARRATION_WORDS}-${MAX_NARRATION_WORDS} narration words.
29. ${MIN_DURATION}-${MAX_DURATION} second target.

==================================================
OUTPUT
==================================================

Return ONLY valid JSON.

Use exactly:

{
  "title": "",
  "category": "",
  "audience": "UK, USA and Europe",
  "hook": "",
  "character": "",
  "goal": "",
  "conflict": "",
  "setback": "",
  "turningPoint": "",
  "resolution": "",
  "ending": "",
  "lesson": "",
  "narration": "",
  "aiDisclosureRecommended": false,
  "qualityFlags": {
    "grammarChecked": true,
    "storyStructureChecked": true,
    "visualStoryMatchRequired": true,
    "characterContinuityRequired": true,
    "originalityRequired": true,
    "repetitionRiskChecked": true,
    "metadataRiskChecked": true,
    "hookQualityChecked": true,
    "topicSpecificityChecked": true,
    "payoffChecked": true,
    "safetyChecked": true
  },
  "scenes": [
    {
      "sceneNumber": 1,
      "narration": "",
      "duration": 3,
      "character": "",
      "environment": "",
      "action": "",
      "emotion": "",
      "importantObject": "",
      "visualPrompt": ""
    }
  ]
}
`;
}

/* ============================================================
   GEMINI GENERATION
   ============================================================ */

async function generateWithGemini(
  topic,
  options
) {
  if (
    !cleanText(
      config?.geminiApiKey
    )
  ) {
    throw new Error(
      '[ScriptEngine] GEMINI_API_KEY is missing.'
    );
  }

  const ai =
    new GoogleGenAI({
      apiKey:
        config.geminiApiKey
    });

  const prompt =
    buildPrompt(
      topic,
      options
    );

  const response =
    await ai.models.generateContent({
      model: MODEL,
      contents: prompt
    });

  const text =
    response?.text ||
    response?.candidates?.[0]?.content?.parts
      ?.map(
        part =>
          part?.text || ''
      )
      .join('') ||
    '';

  if (
    !cleanText(text)
  ) {
    throw new Error(
      '[ScriptEngine] Gemini returned an empty response.'
    );
  }

  return extractJson(
    text
  );
}

/* ============================================================
   PUBLIC GENERATOR
   ============================================================ */

export async function generateScript(
  topic = '',
  options = {}
) {
  const rawIndex =
    Number(
      options.variationIndex
    );

  const variationIndex =
    Number.isInteger(
      rawIndex
    )
      ? Math.abs(rawIndex)
      : 0;

  const lane =
    getContentLane({
      ...options,
      variationIndex
    });

  const requestedTopic =
    normalizeTopic(topic);

  console.log(
    `[ScriptEngine] Creating professional Short: ${
      requestedTopic ||
      'AI-selected topic'
    }`
  );

  console.log(
    `[ScriptEngine] Lane: ${lane.name}`
  );

  console.log(
    '[ScriptEngine] Audience: UK, USA and Europe'
  );

  console.log(
    `[ScriptEngine] Scenes: ${MIN_SCENES}-${MAX_SCENES}`
  );

  console.log(
    `[ScriptEngine] Duration: ${MIN_DURATION}-${MAX_DURATION}s`
  );

  let rawStory;
  let generatedBy = 'gemini';

  try {
    rawStory =
      await generateWithGemini(
        requestedTopic,
        {
          ...options,
          variationIndex
        }
      );
  } catch (error) {
    console.warn(
      '[ScriptEngine] Gemini generation failed.'
    );

    console.warn(
      '[ScriptEngine] Reason:',
      error?.message ||
        error
    );

    console.warn(
      '[ScriptEngine] Trying structured fallback.'
    );

    rawStory =
      createFallbackStory(
        requestedTopic,
        {
          ...options,
          variationIndex
        }
      );

    generatedBy =
      'fallback';
  }

  let story;

  try {
    story =
      normalizeStory(
        rawStory
      );

    validateStory(
      story,
      requestedTopic,
      options
    );
  } catch (validationError) {
    console.warn(
      '[ScriptEngine] Generated story failed validation.'
    );

    console.warn(
      '[ScriptEngine] Reason:',
      validationError?.message ||
        validationError
    );

    /*
     * Do not silently accept an invalid AI story.
     * Rebuild through the structured fallback and validate it again.
     */

    story =
      createFallbackStory(
        requestedTopic,
        {
          ...options,
          variationIndex
        }
      );

    try {
      validateStory(
        story,
        requestedTopic,
        options
      );
    } catch (fallbackError) {
      throw new Error(
        `[ScriptEngine] Fallback story also failed validation: ${
          fallbackError?.message ||
          fallbackError
        }`
      );
    }

    generatedBy =
      'fallback';
  }

  console.log(
    `[ScriptEngine] Story: ${story.title}`
  );

  console.log(
    `[ScriptEngine] Generator: ${generatedBy}`
  );

  console.log(
    `[ScriptEngine] Narration words: ${
      wordCount(
        story.narration
      )
    }`
  );

  console.log(
    `[ScriptEngine] Estimated duration: ${
      story.duration
    }s`
  );

  console.log(
    `[ScriptEngine] Validation: PASSED`
  );

  return {
    ...story,

    generatedBy,

    model:
      generatedBy === 'gemini'
        ? MODEL
        : 'local-fallback',

    validated:
      true
  };
}

/* ============================================================
   PUBLIC VALIDATOR
   ============================================================ */

export function validateGeneratedScript(
  script
) {
  const normalized =
    normalizeStory(
      script
    );

  validateStory(
    normalized
  );

  return normalized;
}

/* ============================================================
   DEFAULT EXPORT
   ============================================================ */

export default {
  generateScript,
  validateGeneratedScript
};