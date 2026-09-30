import { GoogleGenAI } from '@google/genai';

import { config } from '../config/index.mjs';

const MODEL =
  process.env.GEMINI_MODEL ||
  'gemini-3.8-flash';

// ---------------------------------------------------------
// TEXT HELPERS
// ---------------------------------------------------------

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
  const value = Number(
    getStoryConfig()?.targetWordsPerMinute
  );

  return Number.isFinite(value) && value > 0
    ? value
    : 150;
}

function estimateDuration(narration) {
  const words = cleanText(narration)
    .split(/\s+/)
    .filter(Boolean)
    .length;

  if (words === 0) {
    return Number(
      getVideoConfig().minDuration
    ) || 20;
  }

  const seconds = Math.ceil(
    (words / getTargetWordsPerMinute()) * 60
  );

  return clamp(
    seconds,
    Number(getVideoConfig().minDuration) || 20,
    Number(getVideoConfig().maxDuration) || 59
  );
}

function estimateSceneDuration(narration) {
  const text = cleanText(narration);

  if (!text) {
    return 3;
  }

  const words = text
    .split(/\s+/)
    .filter(Boolean)
    .length;

  const seconds = Math.ceil(
    (words / getTargetWordsPerMinute()) * 60
  );

  return clamp(seconds, 2, 10);
}

// ---------------------------------------------------------
// JSON EXTRACTION
// ---------------------------------------------------------

function extractJson(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```json/i, '')
    .replace(/^```/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');

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

// ---------------------------------------------------------
// SCENE NORMALIZATION
// ---------------------------------------------------------

function normalizeScene(scene, index) {
  const narration = cleanText(
    scene?.narration ||
    scene?.voiceover ||
    scene?.voice ||
    ''
  );

  const visualPrompt = cleanText(
    scene?.visualPrompt ||
    scene?.visual_prompt ||
    scene?.description ||
    ''
  );

  const suppliedDuration = Number(
    scene?.duration
  );

  const rawCharacter = scene?.character;

  const character =
    typeof rawCharacter === 'string'
      ? cleanText(rawCharacter)
      : cleanText(
          rawCharacter?.description ||
          rawCharacter?.name ||
          scene?.characterDescription ||
          ''
        );

  const environment = cleanText(
    scene?.environment ||
    scene?.location ||
    scene?.setting ||
    ''
  );

  const action = cleanText(
    scene?.action ||
    scene?.movement ||
    ''
  );

  const emotion = cleanText(
    scene?.emotion ||
    scene?.mood ||
    ''
  );

  const finalCharacter =
    character ||
    'A young adult main character with a consistent appearance, hairstyle and clothing';

  const finalEnvironment =
    environment ||
    'a realistic modern environment appropriate to the story';

  const finalAction =
    action ||
    'continues the story action described by the narration';

  const finalEmotion =
    emotion ||
    'natural and story-appropriate';

  const finalVisualPrompt =
    visualPrompt ||
    [
      'Cinematic vertical 9:16 realistic shot',
      `of ${finalCharacter}`,
      `${finalAction}`,
      `in ${finalEnvironment}`,
      `${finalEmotion} emotion`,
      'consistent character appearance',
      'natural cinematic lighting',
      'realistic photography'
    ].join(', ');

  return {
    sceneNumber: index + 1,

    narration,

    visualPrompt: finalVisualPrompt,

    duration:
      Number.isFinite(suppliedDuration) &&
      suppliedDuration > 0
        ? clamp(suppliedDuration, 2, 12)
        : estimateSceneDuration(narration),

    character: finalCharacter,

    environment: finalEnvironment,

    action: finalAction,

    emotion: finalEmotion
  };
}

// ---------------------------------------------------------
// STORY NORMALIZATION
// ---------------------------------------------------------

function normalizeStory(raw) {
  const story = raw || {};

  const rawScenes = Array.isArray(story.scenes)
    ? story.scenes
    : [];

  const scenes = rawScenes.map(
    (scene, index) =>
      normalizeScene(scene, index)
  );

  const sceneNarration = scenes
    .map(scene => scene.narration)
    .filter(Boolean)
    .join(' ');

  const narration = cleanText(
    story.narration ||
    sceneNarration
  );

  return {
    title: cleanText(story.title),

    category: cleanText(
      story.category
    ),

    audience: cleanText(
      story.audience
    ),

    hook: cleanText(
      story.hook
    ),

    character: cleanText(
      typeof story.character === 'string'
        ? story.character
        : story.character?.description ||
          story.character?.name ||
          ''
    ),

    goal: cleanText(
      story.goal
    ),

    conflict: cleanText(
      story.conflict
    ),

    setback: cleanText(
      story.setback
    ),

    turningPoint: cleanText(
      story.turningPoint
    ),

    resolution: cleanText(
      story.resolution
    ),

    ending: cleanText(
      story.ending
    ),

    lesson: cleanText(
      story.lesson
    ),

    narration,

    duration: estimateDuration(
      narration
    ),

    scenes
  };
}

// ---------------------------------------------------------
// STORY QUALITY VALIDATION
// ---------------------------------------------------------

function validateStory(story) {
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
        !cleanText(story[field])
    );

  if (missingFields.length > 0) {
    throw new Error(
      `[ScriptEngine] Missing story fields: ${missingFields.join(', ')}`
    );
  }

  if (!Array.isArray(story.scenes)) {
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

  if (story.scenes.length < minScenes) {
    throw new Error(
      `[ScriptEngine] Story needs at least ${minScenes} scenes.`
    );
  }

  if (story.scenes.length > maxScenes) {
    throw new Error(
      `[ScriptEngine] Story has too many scenes. Maximum is ${maxScenes}.`
    );
  }

  const totalSceneNarration =
    story.scenes
      .map(scene => scene.narration)
      .filter(Boolean)
      .join(' ');

  if (!cleanText(totalSceneNarration)) {
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

    if (!scene.narration) {
      throw new Error(
        `[ScriptEngine] Scene ${sceneNumber} has no narration.`
      );
    }

    if (!scene.visualPrompt) {
      throw new Error(
        `[ScriptEngine] Scene ${sceneNumber} has no visual prompt.`
      );
    }

    if (!scene.character) {
      throw new Error(
        `[ScriptEngine] Scene ${sceneNumber} has no character continuity data.`
      );
    }

    if (!scene.environment) {
      throw new Error(
        `[ScriptEngine] Scene ${sceneNumber} has no environment continuity data.`
      );
    }

    if (!scene.action) {
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

// ---------------------------------------------------------
// CONTENT LANES
// ---------------------------------------------------------

const CONTENT_LANES = [
  {
    name: 'Funny Story',
    instruction:
      'Build an entertaining funny situation with a believable problem, escalating awkwardness or surprise, and a satisfying comedic payoff. Humour must be understandable internationally.'
  },

  {
    name: 'Amazing Fact Story',
    instruction:
      'Build the story around one genuinely interesting fact or phenomenon. Do not invent statistics or present uncertain claims as facts. Make the discovery entertaining.'
  },

  {
    name: 'Mystery and Curiosity',
    instruction:
      'Create a curiosity-driven story where the viewer keeps asking what is happening and receives a clear reveal or explanation by the end.'
  },

  {
    name: 'Interesting Human Story',
    instruction:
      'Create a relatable human situation with emotion, tension and a memorable ending. Avoid generic motivational speeches.'
  },

  {
    name: 'Technology and Modern Life',
    instruction:
      'Create an entertaining story around technology, modern life or an everyday digital problem. Keep it understandable without specialist knowledge.'
  },

  {
    name: 'Unexpected Everyday Story',
    instruction:
      'Turn an ordinary situation into an unexpected mini-story with a strong hook, escalating events and a memorable payoff.'
  },

  {
    name: 'Emotional Surprise',
    instruction:
      'Create a short emotionally engaging story with a genuine turning point and satisfying ending. Avoid manipulation, fake tragedy and exaggerated claims.'
  },

  {
    name: 'Clever Problem Solving',
    instruction:
      'Create a story where the main character faces a practical problem and solves it through an unexpected but believable idea.'
  }
];

function getContentLane(options = {}) {
  const explicitLane =
    cleanText(
      options?.contentLane
    );

  if (explicitLane) {
    return explicitLane;
  }

  const variationIndex =
    Number(
      options?.variationIndex
    );

  if (
    Number.isInteger(
      variationIndex
    ) &&
    variationIndex >= 0
  ) {
    return CONTENT_LANES[
      variationIndex %
      CONTENT_LANES.length
    ];
  }

  return CONTENT_LANES[0];
}

// ---------------------------------------------------------
// FALLBACK STORY
// ---------------------------------------------------------

function createFallbackStory(
  topic,
  options = {}
) {
  const subject =
    cleanText(topic) ||
    'an unexpected everyday problem';

  const variationIndex =
    Number.isInteger(
      Number(options?.variationIndex)
    )
      ? Number(options.variationIndex)
      : 0;

  const lane =
    CONTENT_LANES[
      Math.abs(variationIndex) %
      CONTENT_LANES.length
    ];

  const stories = [
    {
      title:
        'The Coffee That Started a Very Bad Morning',

      hook:
        'He thought he was having a normal morning. Then the coffee machine exploded.',

      character:
        'Alex, a young adult with short dark hair, a dark blue jacket and a backpack',

      goal:
        'Get to work on time after making one quick coffee.',

      conflict:
        'The coffee machine suddenly sprays coffee across the kitchen.',

      setback:
        'Alex cleans the mess but then notices coffee has stained the only shirt ready for work.',

      turningPoint:
        'Instead of panicking, Alex uses a simple spare shirt hidden in the backpack.',

      resolution:
        'Alex changes quickly and still manages to leave on time.',

      ending:
        'The morning was a disaster, but the emergency backpack finally made sense.',

      lesson:
        'Sometimes the boring backup plan is the thing that saves the day.'
    },

    {
      title:
        'The Tiny Mistake That Changed Everything',

      hook:
        'One tiny mistake turned an ordinary task into a surprisingly useful discovery.',

      character:
        'Maya, a young professional with curly dark hair, a green jacket and a small shoulder bag',

      goal:
        'Finish an important task before leaving for the day.',

      conflict:
        'Maya accidentally changes one small setting and gets an unexpected result.',

      setback:
        'She assumes everything is broken and starts over from the beginning.',

      turningPoint:
        'She notices the unexpected result actually solves the problem she was trying to fix.',

      resolution:
        'Maya tests the discovery and confirms that it works.',

      ending:
        'The mistake was not the solution, but it showed her where to look.',

      lesson:
        'An unexpected result can sometimes reveal the better question.'
    },

    {
      title:
        'The Package Nobody Expected',

      hook:
        'A package arrived at the door, but nobody in the building had ordered it.',

      character:
        'Daniel, a curious young man with short brown hair, a grey hoodie and a backpack',

      goal:
        'Find out who the mysterious package belongs to.',

      conflict:
        'The label contains only a first name and an old apartment number.',

      setback:
        'Daniel searches the building but cannot find anyone matching the name.',

      turningPoint:
        'An elderly neighbour recognises the name from a story the building had almost forgotten.',

      resolution:
        'Daniel finds the correct family member and safely returns the package.',

      ending:
        'The mystery turns out to be much older than the package itself.',

      lesson:
        'Sometimes a small mystery is really a piece of someone else’s history.'
    },

    {
      title:
        'The Phone That Would Not Stop Talking',

      hook:
        'His phone started reading everything out loud at exactly the worst possible time.',

      character:
        'Sam, a young adult with short black hair, a black hoodie and wireless earbuds',

      goal:
        'Silence the phone before an important meeting begins.',

      conflict:
        'Every notification is suddenly spoken aloud.',

      setback:
        'Sam changes the volume, restarts the phone and removes the earbuds, but nothing works.',

      turningPoint:
        'He discovers an accessibility setting was accidentally activated.',

      resolution:
        'Sam switches the setting off and the phone becomes quiet again.',

      ending:
        'The problem was not a broken phone. It was one setting hiding in plain sight.',

      lesson:
        'Before replacing something, check the simple settings first.'
    },

    {
      title:
        'The Shortcut That Was Not a Shortcut',

      hook:
        'He took a shortcut to save five minutes and somehow made the trip twice as long.',

      character:
        'Leo, a young adult with short dark hair, a navy jacket and a small backpack',

      goal:
        'Reach an appointment five minutes early.',

      conflict:
        'Leo decides to use an unfamiliar shortcut.',

      setback:
        'The shortcut leads through a confusing series of streets and puts him farther away.',

      turningPoint:
        'He stops rushing and checks the route properly.',

      resolution:
        'Leo finds a simple direct route and arrives just in time.',

      ending:
        'The shortcut failed because he was trying too hard to save time.',

      lesson:
        'Going faster is not always the same as making progress.'
    }
  ];

  const template =
    stories[
      Math.abs(variationIndex) %
      stories.length
    ];

  const scenes = [
    {
      narration:
        template.hook,
      character:
        template.character,
      action:
        'The main character faces the unexpected situation described by the hook.',
      emotion:
        'surprised and curious',
      environment:
        'a realistic modern everyday location',
      visualPrompt:
        `Cinematic vertical 9:16 realistic shot of ${template.character}, experiencing the opening event described by the story, realistic modern environment, natural lighting, expressive reaction, consistent character appearance`
    },

    {
      narration:
        `The goal was simple: ${template.goal}`,
      character:
        template.character,
      action:
        'The character starts working toward the goal.',
      emotion:
        'focused',
      environment:
        'the same realistic location',
      visualPrompt:
        `Cinematic vertical 9:16 realistic shot of the same ${template.character}, beginning the task, same environment and clothing, natural cinematic lighting, consistent character`
    },

    {
      narration:
        template.conflict,
      character:
        template.character,
      action:
        'The unexpected problem appears.',
      emotion:
        'confused and surprised',
      environment:
        'the same location',
      visualPrompt:
        `Cinematic vertical 9:16 realistic shot of the same ${template.character}, reacting to the unexpected problem, same environment, realistic action, consistent appearance`
    },

    {
      narration:
        template.setback,
      character:
        template.character,
      action:
        'The character attempts to deal with the setback.',
      emotion:
        'frustrated but determined',
      environment:
        'the same story location',
      visualPrompt:
        `Cinematic vertical 9:16 realistic shot of the same ${template.character}, dealing with the setback, believable physical action, same environment and clothing, natural lighting`
    },

    {
      narration:
        template.turningPoint,
      character:
        template.character,
      action:
        'The character notices the important clue or idea.',
      emotion:
        'surprised and hopeful',
      environment:
        'the same location',
      visualPrompt:
        `Cinematic vertical close-up of the same ${template.character}, noticing the key clue or idea, expressive surprised reaction, same environment, realistic photography`
    },

    {
      narration:
        template.resolution,
      character:
        template.character,
      action:
        'The character follows the new solution.',
      emotion:
        'confident',
      environment:
        'the same location',
      visualPrompt:
        `Cinematic vertical 9:16 realistic shot of the same ${template.character}, successfully following the solution, believable action, consistent environment and appearance`
    },

    {
      narration:
        template.ending,
      character:
        template.character,
      action:
        'The character reaches the final outcome.',
      emotion:
        'relieved and amused',
      environment:
        'the same realistic location',
      visualPrompt:
        `Cinematic vertical 9:16 realistic final shot of the same ${template.character}, experiencing the final outcome, relieved expressive reaction, consistent environment, natural cinematic lighting`
    },

    {
      narration:
        template.lesson,
      character:
        template.character,
      action:
        'The character calmly moves on after the experience.',
      emotion:
        'calm and satisfied',
      environment:
        'the same location during the final moment',
      visualPrompt:
        `Cinematic vertical 9:16 realistic closing shot of the same ${template.character}, calmly leaving after the experience, subtle satisfying expression, consistent appearance and environment, cinematic realistic photography`
    }
  ];

  const narration =
    scenes
      .map(scene => scene.narration)
      .join(' ');

  return normalizeStory({
    title:
      template.title,

    category:
      lane.name,

    audience:
      'UK, USA and Europe',

    hook:
      template.hook,

    character:
      template.character,

    goal:
      template.goal,

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

    scenes
  });
}

// ---------------------------------------------------------
// PROMPT BUILDER
// ---------------------------------------------------------

function buildPrompt(
  topic,
  options = {}
) {
  const requestedCategory =
    cleanText(
      options?.category
    ) ||
    'Entertainment / Interesting Story';

  const region =
    cleanText(
      options?.region
    ) ||
    'UK, USA and Europe';

  const variationIndex =
    Number.isInteger(
      Number(options?.variationIndex)
    )
      ? Number(options.variationIndex)
      : 0;

  const lane =
    getContentLane({
      ...options,
      variationIndex
    });

  const batchSize =
    Number(options?.batchSize) > 0
      ? Number(options.batchSize)
      : 1;

  return `
You are the senior Story Director and YouTube Shorts writer for ZEESHAN AI LABS.

Your job is NOT to write a generic motivational script.

Your job is to create ONE highly engaging, original, coherent short-form mini-film that people naturally want to keep watching.

TOPIC:
${cleanText(topic) || 'Create an original entertaining story.'}

REQUESTED CATEGORY:
${requestedCategory}

CONTENT LANE:
${lane.name}

CONTENT LANE DIRECTION:
${lane.instruction}

TARGET AUDIENCE:
${region}

IMPORTANT AUDIENCE RULE:
The audience is INTERNATIONAL ENGLISH:
- United States
- United Kingdom
- Europe

Do NOT write this as a UK-only video.

Use natural modern English that is easy to understand across the US, UK and Europe.

Avoid:
- UK-only slang
- US-only slang
- highly regional jokes
- unexplained local references
- country-specific assumptions
- political messaging
- fake statistics
- fake quotes
- fake news
- deceptive claims

The story should feel natural to a broad English-speaking audience.

==================================================
CORE VIEWER-RETENTION GOAL
==================================================

The first seconds must create immediate curiosity.

The viewer should quickly wonder:

"What happens next?"

Use one or more of:
- an unexpected situation
- a funny problem
- a surprising discovery
- a mystery
- an emotional question
- a strange but believable event
- a relatable problem
- an unusual consequence

Do NOT use empty clickbait.

The hook must actually connect to the story.

==================================================
STORY STYLE
==================================================

Make the video feel like a tiny movie.

Required progression:

1. HOOK
2. CHARACTER / SITUATION
3. GOAL
4. PROBLEM
5. ESCALATION
6. SETBACK
7. DISCOVERY / TWIST
8. RESOLUTION
9. PAYOFF / ENDING

Not every story needs all nine as separate scenes, but the information must exist in the complete story.

The story must have cause-and-effect.

Every major event must logically lead to the next event.

Do NOT create random disconnected scenes.

==================================================
ENTERTAINMENT
==================================================

When appropriate, include:
- humour
- surprise
- awkwardness
- curiosity
- emotional contrast
- clever problem solving
- a satisfying reveal
- an unexpected ending

Funny does NOT mean adding random jokes.

The humour must come from the situation, character reaction or payoff.

If the topic is serious, use an appropriate engaging style instead of forcing comedy.

==================================================
NARRATION
==================================================

The narration must tell the COMPLETE story.

The viewer must understand:
- who the main character is
- what they want
- what goes wrong
- what changes
- how the problem develops
- what the turning point is
- how it ends

No incomplete narration.

No vague filler.

No generic motivational paragraph pretending to be a story.

Use short, natural spoken sentences.

Write for voice narration, not for an essay.

Avoid tongue-twisters and unnecessarily complex sentences.

==================================================
VISUAL STORY MATCH
==================================================

Every scene must visually represent its narration.

If narration says:
"Alex opens the door"

the visual must show:
Alex opening the door.

Do NOT show unrelated:
- random city streets
- random buses
- random buildings
- random gyms
- random people
- random landscapes

unless those things are actually part of the scene.

Each visual prompt must contain:
- main character
- exact action
- environment
- emotion
- important objects
- continuity details

==================================================
CHARACTER CONTINUITY
==================================================

Choose ONE main character.

Keep the same:
- approximate age
- hair
- clothing
- physical appearance
- important accessories

across the entire story.

Do not randomly change the character between scenes.

If another character is necessary, introduce them clearly.

==================================================
ENVIRONMENT CONTINUITY
==================================================

When the story remains in the same place, keep:
- location
- important objects
- time of day
- weather
- visual identity

consistent.

Only change location when the story requires it.

==================================================
VISUAL PROMPTS
==================================================

Use realistic, filmable descriptions.

Every prompt must be vertical 9:16 friendly.

Do not request impossible camera actions.

Do not create contradictory scenes.

Do not put multiple unrelated events into one scene.

==================================================
SHORTS LENGTH
==================================================

Total duration:
20–59 seconds.

Create 6–10 scenes.

Target a strong Shorts pace.

Avoid extremely short scenes that make the final video feel rushed.

Avoid unnecessary pauses.

==================================================
BATCH UNIQUENESS
==================================================

This video may be part of a batch.

BATCH SIZE:
${batchSize}

CURRENT VIDEO INDEX:
${variationIndex + 1}

The system must produce materially different videos in a batch.

If this is video 2, 3, 4 or 5:
DO NOT reuse the same:
- plot
- hook
- character situation
- setting
- joke
- twist
- ending
- sequence of events

Do not simply rewrite the same story with different names.

Each video must feel independently created.

==================================================
ORIGINALITY
==================================================

Create an original concept.

Do not copy:
- movies
- TV shows
- YouTube videos
- TikTok videos
- articles
- famous stories
- creators
- existing scripts

Do not imitate a specific creator.

Do not use recognizable copyrighted characters.

==================================================
FACT SAFETY
==================================================

If the story uses factual information:

- use only information you can state responsibly
- do not invent statistics
- do not invent scientific claims
- do not invent historical claims
- do not present uncertain information as certain

If a fact cannot be confidently stated, make the story fictional rather than inventing a fact.

==================================================
ENDING
==================================================

The ending must provide a payoff.

Possible endings:
- funny punchline
- surprising reveal
- emotional resolution
- clever solution
- satisfying lesson
- unexpected but logical twist

Do NOT suddenly stop.

Do NOT repeat the hook as the ending.

==================================================
TITLE
==================================================

Create a short, curiosity-driven title.

It must honestly represent the video.

Do not use deceptive clickbait.

==================================================
SCENE REQUIREMENTS
==================================================

Create 6–10 scenes.

Every scene MUST contain:

sceneNumber
narration
duration
character
environment
action
emotion
visualPrompt

The combined scene narration must tell the complete story.

==================================================
OUTPUT
==================================================

Return ONLY valid JSON.

No markdown.

No explanation.

Required structure:

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

// ---------------------------------------------------------
// GEMINI GENERATION
// ---------------------------------------------------------

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
      ?.map(part => part.text || '')
      .join('') ||
    '';

  if (!cleanText(text)) {
    throw new Error(
      '[ScriptEngine] Gemini returned empty story.'
    );
  }

  return extractJson(text);
}

// ---------------------------------------------------------
// PUBLIC SCRIPT GENERATOR
// ---------------------------------------------------------

export async function generateScript(
  topic = '',
  options = {}
) {
  console.log(
    `[ScriptEngine] Creating engaging original story for: ${
      cleanText(topic) ||
      'unknown topic'
    }`
  );

  const variationIndex =
    Number.isInteger(
      Number(options?.variationIndex)
    )
      ? Number(options.variationIndex)
      : 0;

  const lane =
    getContentLane({
      ...options,
      variationIndex
    });

  console.log(
    `[ScriptEngine] Audience: ${
      cleanText(
        options?.region
      ) ||
      'UK, USA and Europe'
    }`
  );

  console.log(
    `[ScriptEngine] Content lane: ${lane.name}`
  );

  console.log(
    `[ScriptEngine] Batch variation: ${
      variationIndex + 1
    }`
  );

  let story;

  let generatedBy =
    'gemini';

  try {
    story =
      await generateWithGemini(
        topic,
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
      error?.message || error
    );

    console.warn(
      '[ScriptEngine] Building structured local fallback story.'
    );

    story =
      createFallbackStory(
        topic,
        {
          ...options,
          variationIndex
        }
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
        topic,
        {
          ...options,
          variationIndex
        }
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
      generatedBy === 'gemini'
        ? MODEL
        : 'local-fallback',

    validated: true
  };
}

// ---------------------------------------------------------
// PUBLIC VALIDATOR
// ---------------------------------------------------------

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

// ---------------------------------------------------------
// DEFAULT EXPORT
// ---------------------------------------------------------

export default {
  generateScript,
  validateGeneratedScript
};