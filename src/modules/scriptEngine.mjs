import { GoogleGenAI } from '@google/genai';

import { config } from '../config/index.mjs';

const MODEL =
  process.env.GEMINI_MODEL ||
  'gemini-3.8-flash';

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clamp(value, min, max) {
  return Math.min(
    Math.max(value, min),
    max
  );
}

function getStoryConfig() {
  return (
    config?.storyConfig || {
      targetWordsPerMinute: 150,
      minScenes: 6,
      maxScenes: 10
    }
  );
}

function getVideoConfig() {
  return (
    config?.videoConfig || {
      minDuration: 20,
      maxDuration: 59
    }
  );
}

function getTargetWordsPerMinute() {
  const storyConfig =
    getStoryConfig();

  const value =
    Number(
      storyConfig?.targetWordsPerMinute
    );

  return Number.isFinite(value) &&
    value > 0
    ? value
    : 150;
}

function estimateDuration(
  narration
) {
  const words = cleanText(
    narration
  )
    .split(/\s+/)
    .filter(Boolean)
    .length;

  if (words === 0) {
    return getVideoConfig()
      .minDuration || 20;
  }

  const minutes =
    words /
    getTargetWordsPerMinute();

  const seconds =
    Math.ceil(
      minutes * 60
    );

  const videoConfig =
    getVideoConfig();

  return clamp(
    seconds,
    Number(
      videoConfig.minDuration
    ) || 20,
    Number(
      videoConfig.maxDuration
    ) || 59
  );
}

function estimateSceneDuration(
  narration
) {
  const text =
    cleanText(
      narration
    );

  if (!text) {
    return 5;
  }

  const words =
    text
      .split(/\s+/)
      .filter(Boolean)
      .length;

  const duration =
    Math.ceil(
      (words /
        getTargetWordsPerMinute()) *
        60
    );

  return clamp(
    duration,
    2,
    12
  );
}

function extractJson(text) {
  const cleaned =
    String(text || '')
      .trim()
      .replace(
        /^```json/i,
        ''
      )
      .replace(
        /^```/i,
        ''
      )
      .replace(
        /```$/i,
        ''
      )
      .trim();

  try {
    return JSON.parse(
      cleaned
    );
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

function normalizeScene(
  scene,
  index
) {
  const narration =
    cleanText(
      scene?.narration ||
      scene?.voiceover ||
      scene?.voice ||
      ''
    );

  const visualPrompt =
    cleanText(
      scene?.visualPrompt ||
      scene?.visual_prompt ||
      scene?.description ||
      ''
    );

  const suppliedDuration =
    Number(
      scene?.duration
    );

  return {
    sceneNumber:
      index + 1,

    narration,

    visualPrompt,

    duration:
      Number.isFinite(
        suppliedDuration
      ) &&
      suppliedDuration > 0
        ? clamp(
            suppliedDuration,
            2,
            12
          )
        : estimateSceneDuration(
            narration
          ),

    character:
      cleanText(
        scene?.character
      ),

    environment:
      cleanText(
        scene?.environment
      ),

    action:
      cleanText(
        scene?.action
      ),

    emotion:
      cleanText(
        scene?.emotion
      )
  };
}

function normalizeStory(
  raw
) {
  const story =
    raw || {};

  const rawScenes =
    Array.isArray(
      story.scenes
    )
      ? story.scenes
      : [];

  const scenes =
    rawScenes.map(
      normalizeScene
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
      ),

    hook:
      cleanText(
        story.hook
      ),

    character:
      cleanText(
        story.character
      ),

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

    scenes
  };
}

function validateStory(
  story
) {
  const storyConfig =
    getStoryConfig();

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

  const missingFields =
    requiredFields.filter(
      field =>
        !cleanText(
          story[field]
        )
    );

  if (
    missingFields.length > 0
  ) {
    throw new Error(
      `[ScriptEngine] Missing story fields: ${missingFields.join(
        ', '
      )}`
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

  const minScenes =
    Number(
      storyConfig.minScenes
    ) || 6;

  const maxScenes =
    Number(
      storyConfig.maxScenes
    ) || 10;

  if (
    story.scenes.length <
    minScenes
  ) {
    throw new Error(
      `[ScriptEngine] Story needs at least ${minScenes} scenes.`
    );
  }

  if (
    story.scenes.length >
    maxScenes
  ) {
    throw new Error(
      `[ScriptEngine] Story has too many scenes. Maximum is ${maxScenes}.`
    );
  }

  const totalSceneNarration =
    story.scenes
      .map(
        scene =>
          scene.narration
      )
      .filter(Boolean)
      .join(' ');

  if (
    !cleanText(
      totalSceneNarration
    )
  ) {
    throw new Error(
      '[ScriptEngine] All scene narration is empty.'
    );
  }

  for (
    let index = 0;
    index < story.scenes.length;
    index += 1
  ) {
    const scene =
      story.scenes[index];

    const sceneNumber =
      index + 1;

    if (
      !scene.narration
    ) {
      throw new Error(
        `[ScriptEngine] Scene ${sceneNumber} has no narration.`
      );
    }

    if (
      !scene.visualPrompt
    ) {
      throw new Error(
        `[ScriptEngine] Scene ${sceneNumber} has no visual prompt.`
      );
    }

    if (
      !scene.character
    ) {
      throw new Error(
        `[ScriptEngine] Scene ${sceneNumber} has no character continuity data.`
      );
    }

    if (
      !scene.environment
    ) {
      throw new Error(
        `[ScriptEngine] Scene ${sceneNumber} has no environment continuity data.`
      );
    }

    if (
      !scene.action
    ) {
      throw new Error(
        `[ScriptEngine] Scene ${sceneNumber} has no action.`
      );
    }

    if (
      !Number.isFinite(
        Number(scene.duration)
      ) ||
      Number(scene.duration) <= 0
    ) {
      throw new Error(
        `[ScriptEngine] Scene ${sceneNumber} has invalid duration.`
      );
    }
  }

  return true;
}

function createFallbackStory(
  topic
) {
  const subject =
    cleanText(topic) ||
    'Never Give Up';

  const baseScenes = [
    {
      narration:
        'Everyone thought the story was already over.',
      action:
        'Alex stands alone and looks at the difficult challenge ahead.',
      emotion:
        'uncertain but determined',
      environment:
        'realistic modern city street at early morning',
      visualPrompt:
        'Cinematic vertical realistic shot of Alex, a young adult with short dark hair, dark blue jacket and backpack, standing alone on a modern city street at early morning, looking toward a difficult challenge, natural lighting, consistent character appearance, realistic photography'
    },

    {
      narration:
        'Alex had one simple goal: to finish the challenge before the day ended.',
      action:
        'Alex checks the plan and starts moving toward the goal.',
      emotion:
        'focused',
      environment:
        'same modern city street, early morning',
      visualPrompt:
        'Cinematic vertical realistic shot of the same Alex with short dark hair, dark blue jacket and backpack, checking a simple plan and walking toward the challenge, same city environment and morning lighting, consistent face and clothing, realistic photography'
    },

    {
      narration:
        'At first, everything seemed to go wrong.',
      action:
        'Alex discovers that the original plan has failed.',
      emotion:
        'frustrated',
      environment:
        'same city area near the challenge',
      visualPrompt:
        'Cinematic vertical realistic shot of the same Alex, same face, dark blue jacket and backpack, discovering that the plan has failed, frustrated expression, same city environment, realistic natural lighting, consistent character'
    },

    {
      narration:
        'Then a serious setback made giving up feel easier than continuing.',
      action:
        'Alex sits briefly, thinking about giving up.',
      emotion:
        'discouraged',
      environment:
        'same city area, quiet afternoon transition',
      visualPrompt:
        'Cinematic vertical realistic shot of the same Alex, same face and clothing, sitting alone near the challenge and thinking about giving up, discouraged expression, consistent environment, realistic cinematic photography'
    },

    {
      narration:
        'Alex stopped, looked at the problem again, and noticed one small detail everyone had missed.',
      action:
        'Alex notices a small but important detail and changes the plan.',
      emotion:
        'surprised and hopeful',
      environment:
        'same location near the challenge',
      visualPrompt:
        'Cinematic vertical realistic close shot of the same Alex, same face and dark blue jacket, suddenly noticing a small important detail, surprised hopeful expression, studying the problem carefully, same environment, realistic cinematic photography'
    },

    {
      narration:
        'That changed the entire plan.',
      action:
        'Alex confidently follows the new plan.',
      emotion:
        'determined',
      environment:
        'same challenge location',
      visualPrompt:
        'Cinematic vertical realistic shot of the same Alex, same face and clothing, confidently following a new plan at the challenge location, determined expression, consistent environment and lighting, realistic cinematic photography'
    },

    {
      narration:
        'Alex tried one more time, solved the problem step by step, and finally reached the goal.',
      action:
        'Alex completes the challenge and reaches the goal.',
      emotion:
        'relieved and proud',
      environment:
        'same location at golden hour',
      visualPrompt:
        'Cinematic vertical realistic shot of the same Alex, same face and dark blue jacket, successfully completing the challenge and reaching the goal, relieved proud expression, warm natural golden-hour lighting, same environment, realistic cinematic photography'
    },

    {
      narration:
        'The lesson was simple: a setback can change your plan without deciding your ending.',
      action:
        'Alex walks away calmly after completing the goal.',
      emotion:
        'peaceful and confident',
      environment:
        'same city street at sunset',
      visualPrompt:
        'Cinematic vertical realistic final shot of the same Alex, same face and clothing, calmly walking away after completing the goal, peaceful confident expression, same city street at sunset, natural cinematic lighting, realistic photography'
    }
  ];

  const narration =
    baseScenes
      .map(
        scene =>
          scene.narration
      )
      .join(' ');

  return normalizeStory({
    title:
      subject,

    category:
      'Life Lesson',

    audience:
      'US UK Europe',

    hook:
      'Everyone thought the story was already over.',

    character:
      'Alex, a young adult with short dark hair, dark blue jacket and backpack.',

    goal:
      'Finish a difficult challenge before the day ends.',

    conflict:
      'The original plan fails and the challenge becomes harder.',

    setback:
      'A serious failure makes Alex consider giving up.',

    turningPoint:
      'Alex notices a small detail that everyone else missed.',

    resolution:
      'Alex changes the plan and solves the problem step by step.',

    ending:
      'Alex reaches the goal and walks away with a clear lesson.',

    lesson:
      'A setback can change your plan without deciding your ending.',

    narration,

    scenes:
      baseScenes
  });
}

function buildPrompt(
  topic,
  options
) {
  const requestedCategory =
    cleanText(
      options.category
    ) ||
    'Life Lesson';

  const region =
    cleanText(
      options.region
    ) ||
    'US, UK and Europe';

  return `
You are the Story Director for a professional YouTube Shorts production system.

Create ONE completely original short-form story.

TOPIC:
${cleanText(topic) || 'Create an original story.'}

CATEGORY:
${requestedCategory}

TARGET AUDIENCE:
${region}

LANGUAGE:
Natural modern English suitable for viewers in the US, UK and Europe.

IMPORTANT:
- Do NOT copy an existing movie, video, article, story, celebrity story or creator.
- Do NOT imitate a known creator.
- Do NOT create generic disconnected motivational quotes.
- The video must feel like ONE complete mini-film.
- Events must logically cause the next events.
- The ending must resolve the central problem.
- Every scene must visually represent its narration.
- Keep the same main character across every scene.
- Keep important environment/location details consistent.
- Do not introduce unexplained characters or objects.
- Use realistic, filmable visual descriptions.
- Avoid impossible or contradictory actions.
- Avoid unnecessary dialogue.
- Narration must tell the COMPLETE story.

STORY STRUCTURE:
1. Hook
2. Character
3. Goal
4. Conflict
5. Setback
6. Turning Point
7. Resolution
8. Ending

LENGTH:
20–59 seconds total.

SCENES:
Create 6–10 scenes.

Each scene MUST contain:
- sceneNumber
- narration
- duration
- character
- environment
- action
- emotion
- visualPrompt

The narration of all scenes together must tell the COMPLETE story.

SCENE TIMING:
Duration should approximately match the narration length.
Do not give every scene the same arbitrary duration.

VISUAL CONTINUITY:
Repeat the important character identity in every scene:
age range, hair, clothing, physical appearance and persistent details.

Repeat important environment details when the location remains the same.

OUTPUT:
Return ONLY valid JSON.

Required JSON structure:

{
  "title": "",
  "category": "",
  "audience": "",
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
  "scenes": [
    {
      "sceneNumber": 1,
      "narration": "",
      "duration": 0,
      "character": "",
      "environment": "",
      "action": "",
      "emotion": "",
      "visualPrompt": ""
    }
  ]
}
`;
}

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
      '[ScriptEngine] Gemini returned empty story.'
    );
  }

  return extractJson(
    text
  );
}

export async function generateScript(
  topic = '',
  options = {}
) {
  console.log(
    `[ScriptEngine] Creating original story for: ${
      cleanText(topic) ||
      'unknown topic'
    }`
  );

  let story;
  let generatedBy =
    'gemini';

  try {
    story =
      await generateWithGemini(
        topic,
        options
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
      '[ScriptEngine] Building structured local fallback story.'
    );

    story =
      createFallbackStory(
        topic
      );
  }

  let normalized;

  try {
    normalized =
      normalizeStory(
        story
      );

    validateStory(
      normalized
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

    const fallback =
      createFallbackStory(
        topic
      );

    validateStory(
      fallback
    );

    normalized =
      fallback;

    generatedBy =
      'fallback';
  }

  console.log(
    `[ScriptEngine] Story ready: ${normalized.title}`
  );

  console.log(
    `[ScriptEngine] Generator: ${generatedBy}`
  );

  console.log(
    `[ScriptEngine] Model: ${
      generatedBy === 'gemini'
        ? MODEL
        : 'local-fallback'
    }`
  );

  console.log(
    `[ScriptEngine] Scenes: ${normalized.scenes.length}`
  );

  console.log(
    `[ScriptEngine] Estimated duration: ${normalized.duration}s`
  );

  return {
    ...normalized,

    generatedBy,

    model:
      generatedBy ===
      'gemini'
        ? MODEL
        : 'local-fallback',

    validated:
      true
  };
}

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

export default {
  generateScript,
  validateGeneratedScript
};