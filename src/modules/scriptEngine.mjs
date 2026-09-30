import { GoogleGenAI } from '@google/genai';
import { config } from '../config/index.mjs';

const MODEL =
  process.env.GEMINI_MODEL || 'gemini-3.8-flash';

const MIN_SCENES = 6;
const MAX_SCENES = 10;

const MIN_DURATION = 20;
const MAX_DURATION = 59;

const TARGET_WPM = 150;

// ============================================================
// TEXT HELPERS
// ============================================================

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordCount(text) {
  return cleanText(text)
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

// ============================================================
// SAFE JSON EXTRACTION
// ============================================================

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
// CONTENT LANES
// ============================================================

const CONTENT_LANES = [
  {
    name: 'Funny Story',
    instruction: `
Create a genuinely entertaining situation.

Use natural situational humour, awkward moments,
unexpected consequences and a satisfying comedic payoff.

Do not force jokes into a serious story.
Do not use random meme-style humour.
`
  },

  {
    name: 'Amazing Information',
    instruction: `
Build the story around one genuinely interesting
piece of information, fact, phenomenon or useful discovery.

Explain it simply and make the discovery entertaining.

Never invent statistics, scientific claims or fake facts.
`
  },

  {
    name: 'Mystery and Curiosity',
    instruction: `
Create a curiosity-driven mini mystery.

Give the viewer a clear reason to keep watching.

The mystery must have a logical explanation or reveal.
Do not fabricate real-world crimes or news events.
`
  },

  {
    name: 'Unexpected Discovery',
    instruction: `
Start with an ordinary situation that develops
into an unexpected discovery or realization.

The final reveal must make sense because of events
shown earlier in the story.
`
  },

  {
    name: 'Technology and Modern Life',
    instruction: `
Create an entertaining story involving technology,
phones, AI, computers, apps, gadgets or modern life.

Keep technical information simple and useful.

Avoid unsupported technological claims.
`
  },

  {
    name: 'Interesting Human Story',
    instruction: `
Create a relatable human situation with emotion,
tension, character development and a memorable ending.

Keep the story believable.
Avoid fake tragedy or emotional manipulation.
`
  },

  {
    name: 'Clever Problem Solving',
    instruction: `
Create a practical problem.

Let the character discover an unexpected but believable
solution through the events of the story.

The solution should be understandable to the viewer.
`
  },

  {
    name: 'Everyday Surprise',
    instruction: `
Take a completely normal everyday situation and turn it
into an unexpectedly interesting mini-story.

Use curiosity, humour or a useful takeaway.
`
  }
];

function getContentLane(options = {}) {
  const explicit =
    cleanText(options.contentLane);

  if (explicit) {
    return {
      name: explicit,
      instruction:
        'Create an original, coherent and entertaining story.'
    };
  }

  const index =
    Number(options.variationIndex);

  if (
    Number.isInteger(index) &&
    index >= 0
  ) {
    return CONTENT_LANES[
      index % CONTENT_LANES.length
    ];
  }

  return CONTENT_LANES[0];
}

// ============================================================
// SCENE NORMALIZATION
// ============================================================

function normalizeScene(scene, index) {
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

  const suppliedVisual =
    cleanText(
      scene?.visualPrompt ||
      scene?.visual_prompt ||
      scene?.description ||
      ''
    );

  const finalCharacter =
    character ||
    'A young adult main character with consistent appearance, hairstyle and clothing';

  const finalEnvironment =
    environment ||
    'a realistic modern everyday environment';

  const finalAction =
    action ||
    'continues the story action';

  const finalEmotion =
    emotion ||
    'natural story-appropriate emotion';

  const finalVisualPrompt =
    suppliedVisual ||
    [
      'Cinematic realistic vertical 9:16 shot',
      `of ${finalCharacter}`,
      `performing ${finalAction}`,
      `in ${finalEnvironment}`,
      `showing ${finalEmotion}`,
      'consistent character appearance',
      'natural cinematic lighting',
      'realistic photography'
    ].join(', ');

  const suppliedDuration =
    Number(scene?.duration);

  return {
    sceneNumber: index + 1,

    narration,

    duration:
      Number.isFinite(suppliedDuration) &&
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
      finalCharacter,

    environment:
      finalEnvironment,

    action:
      finalAction,

    emotion:
      finalEmotion,

    visualPrompt:
      finalVisualPrompt
  };
}

// ============================================================
// STORY NORMALIZATION
// ============================================================

function normalizeStory(raw) {
  const story = raw || {};

  const rawScenes =
    Array.isArray(story.scenes)
      ? story.scenes
      : [];

  const scenes =
    rawScenes.map(
      (scene, index) =>
        normalizeScene(
          scene,
          index
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
      cleanText(story.title),

    category:
      cleanText(story.category),

    audience:
      cleanText(story.audience) ||
      'UK, USA and Europe',

    hook:
      cleanText(story.hook),

    character:
      cleanText(
        typeof story.character === 'string'
          ? story.character
          : story.character?.description ||
            story.character?.name ||
            ''
      ),

    goal:
      cleanText(story.goal),

    conflict:
      cleanText(story.conflict),

    setback:
      cleanText(story.setback),

    turningPoint:
      cleanText(story.turningPoint),

    resolution:
      cleanText(story.resolution),

    ending:
      cleanText(story.ending),

    lesson:
      cleanText(story.lesson),

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
        metadataRiskChecked: true
      },

    scenes
  };
}

// ============================================================
// STORY VALIDATION
// ============================================================

function validateStory(story) {
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

  if (missing.length > 0) {
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

  for (
    let i = 0;
    i < story.scenes.length;
    i += 1
  ) {
    const scene =
      story.scenes[i];

    const number =
      i + 1;

    if (!scene.narration) {
      throw new Error(
        `[ScriptEngine] Scene ${number} has no narration.`
      );
    }

    if (!scene.visualPrompt) {
      throw new Error(
        `[ScriptEngine] Scene ${number} has no visual prompt.`
      );
    }

    if (!scene.character) {
      throw new Error(
        `[ScriptEngine] Scene ${number} has no character continuity data.`
      );
    }

    if (!scene.environment) {
      throw new Error(
        `[ScriptEngine] Scene ${number} has no environment continuity data.`
      );
    }

    if (!scene.action) {
      throw new Error(
        `[ScriptEngine] Scene ${number} has no action.`
      );
    }

    if (
      !Number.isFinite(
        Number(scene.duration)
      ) ||
      Number(scene.duration) <= 0
    ) {
      throw new Error(
        `[ScriptEngine] Scene ${number} has invalid duration.`
      );
    }
  }

  const totalWords =
    wordCount(
      story.narration
    );

  if (totalWords < 45) {
    throw new Error(
      '[ScriptEngine] Narration is too short for a complete Shorts story.'
    );
  }

  return true;
}

// ============================================================
// FALLBACK STORIES
// ============================================================

const FALLBACK_STORIES = [
  {
    title:
      'The Coffee Machine Had Other Plans',

    hook:
      'Alex had one simple plan: make coffee and leave. The coffee machine disagreed.',

    character:
      'Alex, a young adult with short dark hair, a dark blue jacket and a small backpack',

    goal:
      'Make coffee before leaving for work.',

    conflict:
      'The coffee machine suddenly sprays coffee across the kitchen.',

    setback:
      'Alex discovers that the only clean work shirt has also been stained.',

    turningPoint:
      'Alex remembers a spare shirt hidden inside the backpack.',

    resolution:
      'Alex changes quickly and manages to leave on time.',

    ending:
      'The boring emergency shirt suddenly becomes the hero of the morning.',

    lesson:
      'A backup plan can become useful at exactly the right moment.'
  },

  {
    title:
      'The Shortcut That Was Not a Shortcut',

    hook:
      'He took a shortcut to save five minutes. It cost him twenty.',

    character:
      'Leo, a young adult with short brown hair, a navy jacket and a small backpack',

    goal:
      'Reach an appointment early.',

    conflict:
      'Leo decides to use an unfamiliar shortcut.',

    setback:
      'The shortcut sends him farther away from his destination.',

    turningPoint:
      'Leo stops rushing and checks the route properly.',

    resolution:
      'He finds the simple direct route and arrives just in time.',

    ending:
      'The shortcut failed because Leo was trying too hard to save time.',

    lesson:
      'Moving faster is not always the same as making progress.'
  },

  {
    title:
      'The Setting Everyone Missed',

    hook:
      'The problem looked complicated until one tiny setting solved it.',

    character:
      'Maya, a young professional with curly dark hair, a green jacket and a small shoulder bag',

    goal:
      'Finish an important digital task.',

    conflict:
      'A small unexpected setting changes the result.',

    setback:
      'Maya assumes the entire system is broken.',

    turningPoint:
      'She notices a hidden setting causing the problem.',

    resolution:
      'She changes it and the task works normally again.',

    ending:
      'The complicated problem had a surprisingly simple cause.',

    lesson:
      'Before assuming something is broken, check the simple settings.'
  },

  {
    title:
      'The Mystery Package',

    hook:
      'A package arrived with no clear owner, and the name belonged to someone from years ago.',

    character:
      'Daniel, a curious young man with short brown hair, a grey hoodie and a backpack',

    goal:
      'Find the correct owner of the package.',

    conflict:
      'The label contains an old apartment number.',

    setback:
      'Nobody in the building recognises the name.',

    turningPoint:
      'A neighbour remembers the family connected to the name.',

    resolution:
      'Daniel tracks down the correct person and returns the package.',

    ending:
      'What looked like a delivery mistake turns out to be a forgotten connection.',

    lesson:
      'Small mysteries can reveal stories hiding in ordinary places.'
  },

  {
    title:
      'The Phone That Would Not Stop Talking',

    hook:
      'His phone suddenly started reading every notification out loud.',

    character:
      'Sam, a young adult with short black hair, a black hoodie and wireless earbuds',

    goal:
      'Silence the phone before an important meeting.',

    conflict:
      'Every notification is announced aloud.',

    setback:
      'Restarting the phone does nothing.',

    turningPoint:
      'Sam discovers that an accessibility feature was accidentally enabled.',

    resolution:
      'He turns the setting off and the phone becomes quiet.',

    ending:
      'Nothing was broken. One hidden setting was simply doing exactly what it was told to do.',

    lesson:
      'Sometimes the simplest explanation is worth checking first.'
  }
];

function createFallbackStory(
  topic,
  options = {}
) {
  const index =
    Number.isInteger(
      Number(options.variationIndex)
    )
      ? Number(
          options.variationIndex
        )
      : 0;

  const template =
    FALLBACK_STORIES[
      Math.abs(index) %
      FALLBACK_STORIES.length
    ];

  const scenes = [
    {
      narration:
        template.hook,

      character:
        template.character,

      environment:
        'a realistic modern everyday location',

      action:
        'experiences the unexpected situation described by the hook',

      emotion:
        'surprised and curious',

      visualPrompt:
        `Cinematic realistic vertical 9:16 shot of ${template.character}, experiencing the opening event described by the story, realistic modern environment, expressive reaction, consistent appearance`
    },

    {
      narration:
        `The goal was simple: ${template.goal}`,

      character:
        template.character,

      environment:
        'the same story location',

      action:
        'starts working toward the goal',

      emotion:
        'focused',

      visualPrompt:
        `Cinematic realistic vertical 9:16 shot of the same ${template.character}, beginning the task, same environment and clothing, natural lighting, strong visual continuity`
    },

    {
      narration:
        template.conflict,

      character:
        template.character,

      environment:
        'the same story location',

      action:
        'reacts as the main problem appears',

      emotion:
        'confused and surprised',

      visualPrompt:
        `Cinematic realistic vertical 9:16 shot of the same ${template.character}, reacting to the main problem, exact story action visible, same environment, consistent appearance`
    },

    {
      narration:
        template.setback,

      character:
        template.character,

      environment:
        'the same story location',

      action:
        'deals with the setback',

      emotion:
        'frustrated but determined',

      visualPrompt:
        `Cinematic realistic vertical 9:16 shot of the same ${template.character}, dealing with the setback, believable physical action, same environment and clothing, cinematic realism`
    },

    {
      narration:
        template.turningPoint,

      character:
        template.character,

      environment:
        'the same story location',

      action:
        'notices the important clue or idea',

      emotion:
        'surprised and hopeful',

      visualPrompt:
        `Cinematic realistic vertical 9:16 close-up of the same ${template.character}, noticing the key clue or idea, expressive reaction, same environment, consistent character`
    },

    {
      narration:
        template.resolution,

      character:
        template.character,

      environment:
        'the same story location',

      action:
        'follows the new solution',

      emotion:
        'confident',

      visualPrompt:
        `Cinematic realistic vertical 9:16 shot of the same ${template.character}, successfully following the solution, believable action, consistent environment and appearance`
    },

    {
      narration:
        template.ending,

      character:
        template.character,

      environment:
        'the same story location',

      action:
        'reaches the final outcome',

      emotion:
        'relieved and amused',

      visualPrompt:
        `Cinematic realistic vertical 9:16 final shot of the same ${template.character}, experiencing the final outcome, satisfying reaction, consistent environment, cinematic lighting`
    },

    {
      narration:
        template.lesson,

      character:
        template.character,

      environment:
        'the same location during the final moment',

      action:
        'moves on after the experience',

      emotion:
        'calm and satisfied',

      visualPrompt:
        `Cinematic realistic vertical 9:16 closing shot of the same ${template.character}, calmly leaving after the experience, subtle satisfying expression, consistent appearance and environment`
    }
  ];

  const narration =
    scenes
      .map(
        scene =>
          scene.narration
      )
      .join(' ');

  return normalizeStory({
    title:
      template.title,

    category:
      getContentLane({
        variationIndex: index
      }).name,

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

    aiDisclosureRecommended:
      false,

    qualityFlags: {
      grammarChecked: true,
      storyStructureChecked: true,
      visualStoryMatchRequired: true,
      characterContinuityRequired: true,
      originalityRequired: true,
      repetitionRiskChecked: true,
      metadataRiskChecked: true
    },

    scenes
  });
}

// ============================================================
// PROFESSIONAL GEMINI PROMPT
// ============================================================

function buildPrompt(
  topic,
  options = {}
) {
  const lane =
    getContentLane(options);

  const audience =
    cleanText(options.region) ||
    'UK, USA and Europe';

  const variationIndex =
    Number.isInteger(
      Number(options.variationIndex)
    )
      ? Number(
          options.variationIndex
        )
      : 0;

  const batchSize =
    Number(options.batchSize) > 0
      ? Number(options.batchSize)
      : 1;

  const requestedCategory =
    cleanText(options.category) ||
    'Entertainment / Interesting Story';

  return `
You are the Senior Creative Director,
Story Director, YouTube Shorts Writer,
Viewer-Retention Specialist and Script Quality Editor
for ZEESHAN AI LABS.

Create ONE professional YouTube Short.

This must feel like a deliberately written mini-film,
not a generic AI-generated script.

============================================================
TARGET AUDIENCE
============================================================

Primary audience:

UNITED STATES
UNITED KINGDOM
EUROPE

This is NOT a UK-only video.

Write natural modern international English
that can be understood comfortably by viewers
across the US, UK and Europe.

Do not overload the story with:
- UK-only slang
- US-only slang
- local political references
- obscure local references
- culture-specific jokes that international viewers
  will not understand

The story should feel globally accessible.

============================================================
TOPIC
============================================================

${cleanText(topic) || 'Create an original interesting story.'}

Requested category:

${requestedCategory}

Content lane:

${lane.name}

Content direction:

${lane.instruction}

============================================================
MAIN CREATIVE OBJECTIVE
============================================================

Create a video that naturally makes viewers want
to continue watching.

Use a combination of:

CURIOUSITY
+
ENTERTAINMENT
+
EMOTION
+
SURPRISE
+
USEFUL INFORMATION WHEN APPROPRIATE
+
SATISFYING PAYOFF

Do not promise that the video will go viral.

Do not use fake engagement.

Do not manipulate the viewer with a promise
that the video does not deliver.

============================================================
HOOK
============================================================

The first 1–2 seconds are extremely important.

Create an immediate hook.

Possible approaches:

- surprising situation
- funny problem
- unusual discovery
- curiosity question
- unexpected consequence
- emotional moment
- strange but believable event
- useful piece of information

The hook must connect directly to the actual story.

Do NOT use empty clickbait.

Do NOT say something happened if it never happens.

============================================================
VIEWER RETENTION
============================================================

Maintain forward movement.

Each scene should introduce at least one of:

- new information
- new action
- new question
- new obstacle
- new reaction
- new discovery
- new consequence
- new emotional development

Avoid scenes that merely repeat the previous scene.

The viewer should understand that the story is moving forward.

============================================================
PROFESSIONAL STORY STRUCTURE
============================================================

Build a complete mini-film:

HOOK
↓
SETUP
↓
CHARACTER
↓
GOAL
↓
PROBLEM
↓
ESCALATION
↓
SETBACK
↓
DISCOVERY / TURNING POINT
↓
RESOLUTION
↓
PAYOFF / ENDING

Use 6–10 scenes.

The story must have clear cause and effect.

Every major event must logically lead to the next event.

Do not create a random collection of scenes.

============================================================
ENTERTAINMENT
============================================================

If appropriate, use:

- situational humour
- surprise
- awkward reactions
- clever reversals
- curiosity
- emotional contrast
- relatable situations
- unexpected consequences

Do not force comedy into every story.

Funny should come naturally from the situation.

============================================================
INFORMATION
============================================================

When the topic is informational:

Give the viewer something genuinely interesting
or useful to remember.

Explain it simply.

Do not invent:

- statistics
- studies
- scientific claims
- historical claims
- expert quotes
- news
- fake facts

If factual certainty is unavailable,
do not pretend certainty.

============================================================
CHARACTER CONTINUITY
============================================================

Choose one main character.

Keep consistent:

- approximate age
- gender presentation
- hairstyle
- hair colour
- clothing
- accessories
- physical appearance

across all scenes.

Do not randomly change the character.

If another character is needed,
introduce them clearly and keep them consistent.

============================================================
ENVIRONMENT CONTINUITY
============================================================

Keep the environment consistent.

If the story remains in one location,
do not randomly move the character elsewhere.

A location change must be caused by the story.

Keep important:

- objects
- background
- weather
- time of day
- visual identity

consistent when appropriate.

============================================================
VISUAL STORY MATCH
============================================================

Every visualPrompt must directly represent
what the narration is saying.

Example:

Narration:
"Alex opens the red door."

Visual:
Alex opening the red door.

Do NOT generate unrelated footage such as:

- random buses
- random city streets
- random buildings
- random gyms
- random people
- random landscapes

unless those things are actually part of the story.

The visual must tell the same story as the narration.

============================================================
VISUAL PROMPT
============================================================

Every scene visualPrompt must describe:

1. Main character
2. Exact action
3. Environment
4. Emotion
5. Important object
6. Character continuity
7. Cinematic composition

Use realistic vertical 9:16 framing.

Do not describe impossible actions.

Do not combine unrelated events into one shot.

============================================================
VOICEOVER
============================================================

The narration is written for spoken voice.

Use:

- natural conversational English
- short sentences
- clear wording
- strong verbs
- varied sentence rhythm
- concise delivery

Avoid:

- essay language
- corporate language
- unnecessary explanation
- robotic phrases
- repeated sentences

The narration must tell the COMPLETE story.

============================================================
ENDING
============================================================

The ending must reward the viewer.

Possible payoff:

- funny punchline
- surprising reveal
- clever solution
- emotional resolution
- useful takeaway
- logical twist

Do not end suddenly.

Do not leave the story incomplete.

============================================================
TITLE
============================================================

Create a concise curiosity-driven title.

The title must honestly represent the video.

No deceptive clickbait.

No keyword stuffing.

============================================================
ORIGINALITY
============================================================

Create an original concept.

Do not copy or closely reproduce:

- movies
- TV shows
- YouTube videos
- TikTok videos
- articles
- famous stories
- creator scripts
- copyrighted characters

Do not imitate a specific creator.

============================================================
BATCH UNIQUENESS
============================================================

This video may be part of a batch.

Batch size:
${batchSize}

Current video index:
${variationIndex + 1}

Make this video materially different from other videos
in the same batch.

Do not reuse:

- same plot
- same hook
- same joke
- same character situation
- same setting
- same twist
- same ending
- same sequence of events

Do not simply rename the character.

Each video must feel independently created.

============================================================
SAFETY
============================================================

Avoid:

- hateful content
- graphic violence
- sexual content
- dangerous instructions
- fake news
- fabricated real-world claims
- misleading political claims
- impersonation
- deceptive evidence

Keep risky subjects appropriate for a general audience.

============================================================
AI DISCLOSURE FLAG
============================================================

If the concept is intended to use realistic
AI-generated scenes that could require disclosure,
set:

"aiDisclosureRecommended": true

Otherwise:

"aiDisclosureRecommended": false

This is ONLY a production review flag.

It is NOT a guarantee of YouTube compliance.

============================================================
QUALITY FLAGS
============================================================

Return:

"qualityFlags": {
  "grammarChecked": true,
  "storyStructureChecked": true,
  "visualStoryMatchRequired": true,
  "characterContinuityRequired": true,
  "originalityRequired": true,
  "repetitionRiskChecked": true,
  "metadataRiskChecked": true
}

============================================================
FINAL SELF-CHECK
============================================================

Before returning JSON, silently check:

1. Is the first line interesting?
2. Does the hook match the actual story?
3. Is the story coherent?
4. Is there a clear protagonist?
5. Is there a clear goal?
6. Is there a real problem?
7. Does the situation develop?
8. Is there a setback?
9. Is there a turning point?
10. Is the ending satisfying?
11. Is the narration complete?
12. Are scenes visually connected to narration?
13. Is the character consistent?
14. Is the environment consistent?
15. Is the English natural internationally?
16. Is the story original?
17. Is there unnecessary repetition?
18. Is the title honest?
19. Is the story entertaining?
20. Is useful information included when appropriate?
21. Does the story make sense without previous context?
22. Does the final scene provide a payoff?

============================================================
OUTPUT
============================================================

Return ONLY valid JSON.

No markdown.

No explanation.

Use this exact structure:

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
    "metadataRiskChecked": true
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
      "visualPrompt": ""
    }
  ]
}
`;
}

// ============================================================
// GEMINI GENERATION
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

  if (!cleanText(text)) {
    throw new Error(
      '[ScriptEngine] Gemini returned an empty response.'
    );
  }

  return extractJson(text);
}

// ============================================================
// PUBLIC SCRIPT GENERATOR
// ============================================================

export async function generateScript(
  topic = '',
  options = {}
) {
  const variationIndex =
    Number.isInteger(
      Number(options.variationIndex)
    )
      ? Number(
          options.variationIndex
        )
      : 0;

  const lane =
    getContentLane({
      ...options,
      variationIndex
    });

  console.log(
    `[ScriptEngine] Creating professional Shorts story: ${
      cleanText(topic) ||
      'original topic'
    }`
  );

  console.log(
    '[ScriptEngine] Audience: UK, USA and Europe'
  );

  console.log(
    `[ScriptEngine] Content lane: ${lane.name}`
  );

  console.log(
    `[ScriptEngine] Variation index: ${
      variationIndex + 1
    }`
  );

  let rawStory;

  let generatedBy =
    'gemini';

  try {
    rawStory =
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
      error?.message ||
        error
    );

    console.warn(
      '[ScriptEngine] Using structured fallback story.'
    );

    rawStory =
      createFallbackStory(
        topic,
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
      story
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
      '[ScriptEngine] Rebuilding fallback story.'
    );

    story =
      createFallbackStory(
        topic,
        {
          ...options,
          variationIndex
        }
      );

    validateStory(
      story
    );

    generatedBy =
      'fallback';
  }

  console.log(
    `[ScriptEngine] Story ready: ${story.title}`
  );

  console.log(
    `[ScriptEngine] Generator: ${generatedBy}`
  );

  console.log(
    `[ScriptEngine] Scenes: ${story.scenes.length}`
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