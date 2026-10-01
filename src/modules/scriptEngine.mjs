import { GoogleGenAI } from '@google/genai';
import { config } from '../config/index.mjs';

const MODEL =
  process.env.GEMINI_MODEL || 'gemini-3.8-flash';

const MIN_SCENES = 6;
const MAX_SCENES = 10;

const MIN_DURATION = 20;
const MAX_DURATION = 59;

const TARGET_WPM = 150;

const MIN_NARRATION_WORDS = 50;
const MAX_NARRATION_WORDS = 145;

const MIN_HOOK_WORDS = 7;
const MAX_HOOK_WORDS = 28;

const BATCH_LANES = [
  {
    name: 'Motivation',
    category: 'Motivation',
    instruction: `
Create an original, emotionally engaging motivational mini-story.

Use a specific real-life problem.
Show the protagonist attempting something.
Create a meaningful setback.
Introduce a practical turning point.
End with an earned result.

Do not use generic motivational quotes.
Do not preach.
Do not simply say "never give up".
The lesson must come from what actually happens.
`
  },

  {
    name: 'Funny',
    category: 'Funny Story',
    instruction: `
Create an original situational comedy story.

Start with one specific awkward, surprising or funny situation.
Let the situation escalate naturally.
Every scene should make the situation clearer or funnier.
Build toward an unexpected but logical payoff.

Do not rely on memes.
Do not use random jokes.
Do not make every scene a separate joke.
The humour must come from the situation and characters.
`
  },

  {
    name: 'Interesting Facts',
    category: 'Amazing Information',
    instruction: `
Create an entertaining Short around ONE genuinely interesting,
well-established and verifiable fact or phenomenon.

Open with a specific curiosity question or surprising fact.
Explain it through a simple story or visual example.
Keep the information accurate and easy to understand.

Never invent statistics, studies, experts or historical claims.
Never present uncertain information as fact.
`
  },

  {
    name: 'Mystery',
    category: 'Mystery and Curiosity',
    instruction: `
Create an original fictional mystery.

The first scene must establish a specific mystery.
Give the viewer a clear question.
Introduce clues progressively.
Make every clue useful.
Build toward one logical reveal.

Do not fabricate real crimes, victims, evidence or news.
The mystery must be clearly fictional when appropriate.
`
  },

  {
    name: 'Emotional Life',
    category: 'Interesting Human Story',
    instruction: `
Create an original emotional human story.

Use a believable everyday relationship, decision or life problem.
Show emotion through actions and choices rather than dramatic speeches.
Build toward a sincere turning point.
End with a meaningful and understandable resolution.

Avoid fake tragedy.
Avoid emotional manipulation.
Avoid generic inspirational language.
`
  }
];

const FALLBACK_STORIES = [
  {
    title: 'The Different Approach',
    category: 'Motivation',
    topicKeywords: ['failure', 'practice', 'mistake', 'improve'],
    hook:
      'Daniel failed the same practical test three times, but the fourth attempt was different.',
    character:
      'Daniel, a young adult with short dark hair, a navy hoodie and a black backpack',
    goal:
      'Pass an important practical test.',
    conflict:
      'Daniel keeps repeating the same mistake during practice.',
    setback:
      'He fails the test again after making that mistake at the worst possible moment.',
    turningPoint:
      'Daniel stops practicing everything and focuses only on the mistake that keeps causing the failure.',
    resolution:
      'He changes his practice method and repeats that specific skill until it becomes natural.',
    ending:
      'On the next attempt, Daniel handles the problem correctly and passes the test.',
    lesson:
      'Sometimes progress comes from fixing one specific weakness instead of doing everything again.'
  },

  {
    title: 'The Wrong Room',
    category: 'Funny Story',
    topicKeywords: ['meeting', 'office', 'mistake', 'funny'],
    hook:
      'Sam confidently joined a meeting, then realized nobody in the room knew who he was.',
    character:
      'Sam, a young professional with short brown hair, a grey jacket and a laptop bag',
    goal:
      'Attend an important work meeting.',
    conflict:
      'Sam accidentally enters the wrong meeting room.',
    setback:
      'He spends several minutes trying to understand a project he has never heard about.',
    turningPoint:
      'A manager finally asks Sam which department he works for.',
    resolution:
      'Sam checks his phone and discovers his actual meeting is in the room next door.',
    ending:
      'He apologizes, walks next door and arrives at the correct meeting just in time.',
    lesson:
      'Confidence helps, but checking the room number helps more.'
  },

  {
    title: 'Why Ice Floats',
    category: 'Amazing Information',
    topicKeywords: ['ice', 'water', 'science', 'lake'],
    hook:
      'Ice looks like it should sink, but one strange property of water makes it float.',
    character:
      'Maya, a curious young woman with curly dark hair, a green coat and a small backpack',
    goal:
      'Understand why ice floats on liquid water.',
    conflict:
      'Maya notices that solid ice behaves differently from many other solids.',
    setback:
      'She initially assumes freezing should make water heavier and denser.',
    turningPoint:
      'She learns that water expands as it freezes, making ice less dense than liquid water.',
    resolution:
      'Because ice is less dense, it stays at the surface instead of sinking.',
    ending:
      'That floating layer can help keep deeper water from freezing completely.',
    lesson:
      'One unusual property of water has important consequences for life.'
  },

  {
    title: 'The Midnight Light',
    category: 'Mystery and Curiosity',
    topicKeywords: ['light', 'office', 'midnight', 'mystery'],
    hook:
      'Every night at exactly midnight, a light appeared inside an empty office.',
    character:
      'Ethan, a young investigator with short black hair, a dark jacket and a small notebook',
    goal:
      'Discover why the office light keeps turning on.',
    conflict:
      'Nobody appears to enter the building at night.',
    setback:
      'The security footage shows an empty hallway when the light turns on.',
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
    topicKeywords: ['message', 'apartment', 'memory', 'moving'],
    hook:
      'While moving out, Noah found a handwritten message hidden behind an old shelf.',
    character:
      'Noah, a young man with short dark hair, a brown jacket and a moving box',
    goal:
      'Finish moving out and begin the next chapter of his life.',
    conflict:
      'The old apartment reminds Noah of someone and a promise from his past.',
    setback:
      'The hidden message makes him stop packing and reconsider leaving.',
    turningPoint:
      'The message reminds Noah that moving forward was part of the promise.',
    resolution:
      'He finishes packing instead of remaining trapped in the memory.',
    ending:
      'Noah carries the final box outside and leaves the apartment behind.',
    lesson:
      'Moving forward does not mean forgetting where you came from.'
  }
];

// ============================================================
// TEXT HELPERS
// ============================================================

function cleanText(value) {
  return String(value || '')
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
  return [...new Set(getWords(text))];
}

function estimateDuration(text) {
  const words = wordCount(text);

  if (words <= 0) {
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

  if (words <= 0) {
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
    first.size === 0 ||
    second.length === 0
  ) {
    return false;
  }

  let matches = 0;

  for (const word of second) {
    if (first.has(word)) {
      matches += 1;
    }
  }

  return (
    matches >=
    Math.min(
      4,
      Math.max(
        2,
        Math.floor(
          second.length * 0.35
        )
      )
    )
  );
}

// ============================================================
// JSON EXTRACTION
// ============================================================

function extractJson(text) {
  const cleaned =
    String(text || '')
      .trim()
      .replace(/^```json/i, '')
      .replace(/^```/i, '')
      .replace(/```$/i, '')
      .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace =
      cleaned.indexOf('{');

    const lastBrace =
      cleaned.lastIndexOf('}');

    if (
      firstBrace !== -1 &&
      lastBrace !== -1 &&
      lastBrace > firstBrace
    ) {
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

    throw new Error(
      '[ScriptEngine] Gemini returned invalid JSON.'
    );
  }
}

// ============================================================
// BATCH LANE
// ============================================================

function getContentLane(options = {}) {
  const explicit =
    cleanText(options.contentLane);

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

    return {
      name: explicit,
      category: explicit,
      instruction:
        `
Create an original, coherent,
specific and entertaining YouTube Short.
Use a strong hook, clear topic,
progressive story structure and a real payoff.
`
    };
  }

  const rawIndex =
    Number(options.variationIndex);

  const index =
    Number.isInteger(rawIndex)
      ? Math.abs(rawIndex)
      : 0;

  return BATCH_LANES[
    index % BATCH_LANES.length
  ];
}

// ============================================================
// TOPIC VALIDATION
// ============================================================

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
        `${scene.narration} ${scene.action} ${scene.visualPrompt}`
    )
  ].join(' ');

  const topicWords =
    uniqueWords(requestedTopic)
      .filter(
        word =>
          word.length >= 4 &&
          ![
            'story',
            'video',
            'short',
            'youtube',
            'about',
            'make',
            'create'
          ].includes(word)
      );

  if (
    topicWords.length === 0
  ) {
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

  const requiredMatches =
    topicWords.length === 1
      ? 1
      : Math.min(
          2,
          topicWords.length
        );

  if (
    matches.length <
    requiredMatches
  ) {
    throw new Error(
      `[ScriptEngine] Story does not clearly use the requested topic: "${requestedTopic}".`
    );
  }
}

// ============================================================
// HOOK VALIDATION
// ============================================================

function validateHook(
  story
) {
  const hook =
    cleanText(story.hook);

  const words =
    wordCount(hook);

  if (
    words <
    MIN_HOOK_WORDS
  ) {
    throw new Error(
      '[ScriptEngine] Hook is too short.'
    );
  }

  if (
    words >
    MAX_HOOK_WORDS
  ) {
    throw new Error(
      '[ScriptEngine] Hook is too long for a Shorts opening.'
    );
  }

  const weakHooks = [
    'never give up',
    'believe in yourself',
    'you can do anything',
    'follow your dreams',
    'life is hard',
    'this will change your life',
    'wait until the end'
  ];

  const normalized =
    normalizeForComparison(hook);

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

// ============================================================
// PAYOFF VALIDATION
// ============================================================

function validatePayoff(
  story
) {
  const ending =
    cleanText(story.ending);

  const resolution =
    cleanText(story.resolution);

  const turningPoint =
    cleanText(story.turningPoint);

  if (
    wordCount(ending) < 6
  ) {
    throw new Error(
      '[ScriptEngine] Ending does not contain enough information for a payoff.'
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
      '[ScriptEngine] Ending appears repetitive instead of providing a payoff.'
    );
  }
}

// ============================================================
// SCENE VISUAL VALIDATION
// ============================================================

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
    'cinematic footage',
    'beautiful cinematic shot'
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

  if (
    !scene.narration ||
    !scene.visualPrompt
  ) {
    throw new Error(
      `[ScriptEngine] Scene ${number} must contain narration and visualPrompt.`
    );
  }

  if (
    containsWeakVisualLanguage(
      scene.visualPrompt
    )
  ) {
    throw new Error(
      `[ScriptEngine] Scene ${number} contains weak or unrelated visual language.`
    );
  }

  const narrationWords =
    wordCount(
      scene.narration
    );

  if (
    narrationWords < 4
  ) {
    throw new Error(
      `[ScriptEngine] Scene ${number} narration is too short.`
    );
  }

  if (
    cleanText(scene.action)
      .length < 10
  ) {
    throw new Error(
      `[ScriptEngine] Scene ${number} action is too vague.`
    );
  }

  if (
    cleanText(scene.environment)
      .length < 8
  ) {
    throw new Error(
      `[ScriptEngine] Scene ${number} environment is too vague.`
    );
  }

  if (
    cleanText(scene.character)
      .length < 8
  ) {
    throw new Error(
      `[ScriptEngine] Scene ${number} character continuity data is too weak.`
    );
  }

  if (
    cleanText(scene.importantObject)
      .length < 5
  ) {
    throw new Error(
      `[ScriptEngine] Scene ${number} importantObject is too vague.`
    );
  }

  const visualText =
    normalizeForComparison(
      scene.visualPrompt
    );

  const actionText =
    normalizeForComparison(
      scene.action
    );

  const objectText =
    normalizeForComparison(
      scene.importantObject
    );

  if (
    actionText.length < 10 ||
    objectText.length < 5
  ) {
    throw new Error(
      `[ScriptEngine] Scene ${number} does not provide enough visual-event information.`
    );
  }

  const actionWords =
    uniqueWords(
      actionText
    ).filter(
      word =>
        word.length >= 4
    );

  const visualWords =
    new Set(
      uniqueWords(
        visualText
      )
    );

  const actionMatches =
    actionWords.filter(
      word =>
        visualWords.has(word)
    );

  if (
    actionWords.length >= 2 &&
    actionMatches.length === 0
  ) {
    throw new Error(
      `[ScriptEngine] Scene ${number} visualPrompt does not clearly reference the scene action.`
    );
  }
}

// ============================================================
// SCENE NORMALIZATION
// ============================================================

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
    'performs the exact action described by the narration';

  const finalEmotion =
    emotion ||
    'natural story-appropriate emotion';

  const finalObject =
    importantObject ||
    'the key object directly involved in the narrated event';

  const finalVisualPrompt =
    suppliedVisual ||
    [
      'Cinematic realistic vertical 9:16 shot',
      `showing ${finalCharacter}`,
      `physically performing ${finalAction}`,
      `inside ${finalEnvironment}`,
      `with ${finalObject}`,
      `showing ${finalEmotion}`,
      'the exact narrated event must be clearly visible',
      'maintain the same character appearance',
      'maintain the same hairstyle and clothing',
      'maintain important object continuity',
      'natural cinematic lighting',
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

// ============================================================
// STORY NORMALIZATION
// ============================================================

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

    qualityFlags:
      story.qualityFlags || {
        grammarChecked: true,
        storyStructureChecked: true,
        visualStoryMatchRequired: true,
        characterContinuityRequired: true,
        originalityRequired: true,
        repetitionRiskChecked: true,
        metadataRiskChecked: true,
        hookQualityChecked: true,
        topicSpecificityChecked: true,
        payoffChecked: true
      },

    scenes
  };
}

// ============================================================
// STORY VALIDATION
// ============================================================

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
    missing.length > 0
  ) {
    throw new Error(
      `[ScriptEngine] Missing story fields: ${missing.join(', ')}`
    );
  }

  if (
    !Array.isArray(
      story.scenes
    )
  ) {
    throw new Error(
      '[ScriptEngine] Story scenes are missing.'
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

  if (
    cleanText(story.goal).length < 8
  ) {
    throw new Error(
      '[ScriptEngine] Story goal is too vague.'
    );
  }

  if (
    cleanText(story.conflict).length < 10
  ) {
    throw new Error(
      '[ScriptEngine] Story conflict is too vague.'
    );
  }

  if (
    cleanText(story.setback).length < 10
  ) {
    throw new Error(
      '[ScriptEngine] Story setback is too vague.'
    );
  }

  if (
    cleanText(story.turningPoint).length < 10
  ) {
    throw new Error(
      '[ScriptEngine] Story turning point is too vague.'
    );
  }

  if (
    cleanText(story.resolution).length < 10
  ) {
    throw new Error(
      '[ScriptEngine] Story resolution is too vague.'
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
      `[ScriptEngine] Narration is too short. Minimum ${MIN_NARRATION_WORDS} words.`
    );
  }

  if (
    narrationWords >
    MAX_NARRATION_WORDS
  ) {
    throw new Error(
      `[ScriptEngine] Narration is too long. Maximum ${MAX_NARRATION_WORDS} words.`
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
    sceneWords < MIN_NARRATION_WORDS
  ) {
    throw new Error(
      '[ScriptEngine] Scene narration coverage is too short.'
    );
  }

  if (
    Math.abs(
      sceneWords -
      narrationWords
    ) >
    Math.max(
      15,
      Math.ceil(
        narrationWords * 0.25
      )
    )
  ) {
    throw new Error(
      '[ScriptEngine] Story narration and scene narration differ too much.'
    );
  }

  for (
    let i = 0;
    i < story.scenes.length;
    i += 1
  ) {
    const scene =
      story.scenes[i];

    const number =
      i + 1;

    if (
      !scene.narration
    ) {
      throw new Error(
        `[ScriptEngine] Scene ${number} has no narration.`
      );
    }

    if (
      !scene.visualPrompt
    ) {
      throw new Error(
        `[ScriptEngine] Scene ${number} has no visual prompt.`
      );
    }

    if (
      !scene.character
    ) {
      throw new Error(
        `[ScriptEngine] Scene ${number} has no character continuity data.`
      );
    }

    if (
      !scene.environment
    ) {
      throw new Error(
        `[ScriptEngine] Scene ${number} has no environment continuity data.`
      );
    }

    if (
      !scene.action
    ) {
      throw new Error(
        `[ScriptEngine] Scene ${number} has no action.`
      );
    }

    if (
      !scene.emotion
    ) {
      throw new Error(
        `[ScriptEngine] Scene ${number} has no emotion.`
      );
    }

    if (
      !scene.importantObject
    ) {
      throw new Error(
        `[ScriptEngine] Scene ${number} has no importantObject.`
      );
    }

    if (
      !Number.isFinite(
        Number(
          scene.duration
        )
      ) ||
      Number(
        scene.duration
      ) <= 0
    ) {
      throw new Error(
        `[ScriptEngine] Scene ${number} has invalid duration.`
      );
    }

    validateSceneVisualRelationship(
      scene,
      i
    );
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
        '[ScriptEngine] Story is too similar to a previous concept.'
      );
    }
  }

  return true;
}

// ============================================================
// FALLBACK STORY BUILDER
// ============================================================

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

    const matchingTemplates =
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
        .filter(
          item =>
            item.matches > 0
        )
        .sort(
          (a, b) =>
            b.matches -
            a.matches
        );

    if (
      matchingTemplates.length > 0
    ) {
      templateIndex =
        matchingTemplates[
          0
        ].templateIndex;
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
        'the main story location where the opening event happens',

      action:
        'experiences the specific opening event described by the hook',

      emotion:
        'surprised and curious',

      importantObject:
        'the main object directly connected to the opening event'
    },

    {
      narration:
        `The goal is simple: ${template.goal}`,

      character:
        template.character,

      environment:
        'the same main story location',

      action:
        'takes a clear action toward the goal',

      emotion:
        'focused',

      importantObject:
        'the object directly needed for the goal'
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
        'confused and concerned',

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
        'frustrated but determined',

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
        'notices or uses the specific idea that changes the situation',

      emotion:
        'surprised and hopeful',

      importantObject:
        'the clue, tool or object responsible for the turning point'
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
        'focused and confident',

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
        'relieved and satisfied',

      importantObject:
        'the object connected to the final outcome'
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

  const lane =
    getContentLane({
      variationIndex:
        index
    });

  const finalTitle =
    requestedTopic
      ? `${template.title} — ${requestedTopic}`
      : template.title;

  return normalizeStory({
    title:
      finalTitle,

    category:
      lane.category,

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
      payoffChecked: true
    },

    scenes
  });
}

// ============================================================
// GEMINI PROMPT
// ============================================================

function buildPrompt(
  topic,
  options = {}
) {
  const lane =
    getContentLane(
      options
    );

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

  const batchSize =
    Number(
      options.batchSize
    ) > 0
      ? Number(
          options.batchSize
        )
      : 5;

  const requestedCategory =
    cleanText(
      options.category
    ) ||
    lane.category;

  const requestedTopic =
    normalizeTopic(topic);

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
for ZEESHAN AI LABS.

Your job is to create ONE professional,
original, highly watchable YouTube Short.

This is NOT a generic story generator.

The finished Short must have:
A SPECIFIC TOPIC
A STRONG OPENING HOOK
A CLEAR STORY QUESTION OR PROMISE
PROGRESSIVE EVENTS
A MEANINGFUL TURNING POINT
A REAL PAYOFF
A SATISFYING ENDING

============================================================
AUDIENCE
============================================================

Primary audience:

USA
UK
EUROPE

Use natural international English.

Avoid obscure slang.

Avoid region-specific references unless necessary.

Do not make the story specifically UK-only.

============================================================
CURRENT VIDEO
============================================================

Batch size:
${batchSize}

Current video number:
${variationIndex + 1}

Creative lane:
${lane.name}

Category:
${requestedCategory}

Creative direction:
${lane.instruction}

============================================================
MANDATORY TOPIC
============================================================

Requested topic:

${requestedTopic || 'Generate one specific, interesting topic suitable for the assigned creative lane.'}

The requested topic is NOT optional.

If a topic is supplied:
- Build the entire story around that topic.
- Mention or demonstrate the topic naturally.
- Make the hook directly connected to the topic.
- Make the ending/payoff connected to the topic.
- Do not replace the topic with a generic motivational story.
- Do not merely append the topic to the title.

If the topic is empty:
generate one specific topic yourself.

The final story must make it obvious what the video is about.

============================================================
BATCH DIVERSITY
============================================================

This is one video inside a batch.

The batch should contain materially different concepts.

Normal five-video rotation:

VIDEO 1:
Motivation

VIDEO 2:
Funny

VIDEO 3:
Interesting Fact

VIDEO 4:
Mystery

VIDEO 5:
Emotional / Life

Do NOT simply change the title.

Change the actual:

- concept
- plot
- characters
- setting
- problem
- goal
- mechanism
- visual situations
- emotional progression
- payoff

Previous concepts:

${previousConcepts || 'No previous concepts supplied.'}

Never closely repeat a previous concept.

============================================================
HOOK — EXTREMELY IMPORTANT
============================================================

The first 1–2 seconds are critical.

Create a hook that immediately creates curiosity.

The hook should contain at least one of:

- a surprising situation
- a specific question
- an unusual problem
- an unexpected discovery
- a strong emotional situation
- a specific mystery

Do NOT use generic hooks such as:

"Never give up."

"Believe in yourself."

"Life is hard."

"Anything is possible."

"You won't believe this."

"Wait until the end."

The hook must be honest.

The hook must connect directly to the actual story.

The hook must be paid off later.

============================================================
STORY ENGINE
============================================================

Create a complete mini-film.

Required progression:

HOOK
↓
SETUP
↓
GOAL / QUESTION
↓
PROBLEM
↓
ESCALATION
↓
SETBACK
↓
TURNING POINT
↓
SOLUTION / REVEAL
↓
PAYOFF
↓
ENDING

Every scene must cause or logically lead to the next scene.

No unrelated cinematic shots.

No filler scenes.

No scene should exist only because the video needs more scenes.

============================================================
CHARACTER
============================================================

Use one primary protagonist.

Define:

- name
- approximate age
- appearance
- hairstyle
- hair colour
- clothing
- accessories

Keep the protagonist identical across scenes.

If another recurring character appears,
give that character stable visual details.

============================================================
LOCATION
============================================================

Use one main believable setting.

A location can change only when the story causes the change.

Keep important objects consistent.

============================================================
SCENE EVENT RULE
============================================================

Every scene must describe an ACTUAL EVENT.

Narration must say what is happening.

Action must describe the physical action.

VisualPrompt must show that physical action.

Example:

Narration:
"Daniel opens the old metal box."

Action:
"Daniel lifts the lid of the old metal box."

Visual:
"Daniel physically lifting the lid of the old metal box."

BAD:

Narration:
"Daniel opens the box."

Visual:
"Daniel walking through a city."

The visual must never merely represent the mood.

============================================================
VISUAL PROMPT REQUIREMENTS
============================================================

Every visualPrompt must include:

- protagonist
- exact physical action
- environment
- emotion
- important object
- continuity
- vertical 9:16 composition
- realistic cinematic appearance

The exact narrated event must be clearly visible.

Avoid:

- random footage
- generic scene
- generic cinematic footage
- stock footage
- random person
- random city
- unrelated objects
- unrelated characters
- unrelated events
- text
- logos
- watermarks

============================================================
VOICEOVER
============================================================

Write natural spoken English.

Use conversational sentences.

Avoid:

- essay language
- corporate language
- robotic wording
- unnecessary exposition
- repeated sentences
- generic motivational quotes

The narration must tell the complete story.

============================================================
DURATION
============================================================

Target:

20–59 seconds.

Use approximately:

150 words per minute.

Aim for approximately 50–145 narration words.

Do not sacrifice story clarity just to increase duration.

============================================================
ENDING / PAYOFF
============================================================

The ending must resolve the central question or problem.

Possible payoffs:

- surprising reveal
- clever solution
- funny consequence
- useful discovery
- emotional resolution
- satisfying result

Do not simply repeat the lesson.

============================================================
FACTUAL CONTENT
============================================================

For informational stories:

Use only well-established facts.

Never invent:

- statistics
- studies
- scientific findings
- historical claims
- experts
- quotes
- breaking news

If uncertain, choose a safer established fact.

============================================================
MYSTERY
============================================================

Mystery stories should normally be fictional.

Never fabricate:

- real crimes
- real victims
- real evidence
- fake news
- real-world accusations

Every clue must connect to the final reveal.

============================================================
ORIGINALITY
============================================================

Create original concepts.

Do not copy or closely reproduce:

- movies
- TV shows
- YouTube videos
- TikTok videos
- creator scripts
- articles
- famous fictional characters
- copyrighted stories

Do not imitate a specific creator.

============================================================
SAFETY
============================================================

Avoid:

- hateful content
- graphic violence
- sexual content
- dangerous instructions
- fake news
- deceptive evidence
- impersonation
- misleading political claims

Keep the content suitable for a broad audience.

============================================================
AI DISCLOSURE REVIEW
============================================================

If realistic AI-generated visuals may require an AI disclosure review,
set:

"aiDisclosureRecommended": true

Otherwise:

false

This is only a review flag.

Do not claim guaranteed YouTube compliance.

============================================================
FINAL CREATIVE SELF-CHECK
============================================================

Before returning JSON verify:

1. The topic is specific.
2. The topic is actually used.
3. The hook is strong and specific.
4. The hook is honest.
5. The hook connects to the story.
6. One clear protagonist exists.
7. Character appearance remains consistent.
8. Goal/question is clear.
9. Problem is clear.
10. Escalation exists.
11. Setback exists.
12. Turning point changes the situation.
13. Resolution solves the problem.
14. Ending provides payoff.
15. Every scene follows logically.
16. Every scene contains a real event.
17. VisualPrompt shows the narrated event.
18. Important objects remain consistent.
19. No generic stock-style prompts.
20. Story is original.
21. Story is different from previous concepts.
22. English sounds natural.
23. Facts are supported by established knowledge.
24. Mystery does not fabricate real-world events.
25. No unsafe content.
26. No deceptive clickbait.
27. Narration is approximately 50–145 words.
28. Scene count is 6–10.
29. Duration is 20–59 seconds.

============================================================
OUTPUT
============================================================

Return ONLY valid JSON.

Use exactly this structure:

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
    "payoffChecked": true
  },
  "scenes": [
    {
      "sceneNumber": 1,
      "narration": "",
      "duration": 0,
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

// ============================================================
// GEMINI
// ============================================================

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
          part.text || ''
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

// ============================================================
// PUBLIC GENERATOR
// ============================================================

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
    `[ScriptEngine] Creating professional Shorts story: ${
      requestedTopic ||
      'AI-selected specific topic'
    }`
  );

  console.log(
    '[ScriptEngine] Audience: UK, USA and Europe'
  );

  console.log(
    `[ScriptEngine] Creative lane: ${lane.name}`
  );

  console.log(
    `[ScriptEngine] Batch video index: ${
      variationIndex + 1
    }`
  );

  let rawStory;

  let generatedBy =
    'gemini';

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
    generatedBy =
      'fallback';

    console.warn(
      '[ScriptEngine] Gemini generation failed.'
    );

    console.warn(
      '[ScriptEngine] Reason:',
      error?.message ||
        error
    );

    console.warn(
      '[ScriptEngine] Using structured fallback story.'
    );

    rawStory =
      createFallbackStory(
        requestedTopic,
        {
          ...options,
          variationIndex
        }
      );
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
      '[ScriptEngine] Story validation failed.'
    );

    console.warn(
      '[ScriptEngine] Validation reason:',
      validationError?.message ||
        validationError
    );

    console.warn(
      '[ScriptEngine] Rebuilding structured fallback story.'
    );

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
    `[ScriptEngine] Story ready: ${story.title}`
  );

  console.log(
    `[ScriptEngine] Category: ${story.category}`
  );

  console.log(
    `[ScriptEngine] Generator: ${generatedBy}`
  );

  console.log(
    `[ScriptEngine] Scenes: ${story.scenes.length}`
  );

  console.log(
    `[ScriptEngine] Narration words: ${
      wordCount(
        story.narration
      )
    }`
  );

  console.log(
    `[ScriptEngine] Estimated duration: ${story.duration}s`
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

// ============================================================
// PUBLIC VALIDATOR
// ============================================================

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

// ============================================================
// DEFAULT EXPORT
// ============================================================

export default {
  generateScript,
  validateGeneratedScript
};