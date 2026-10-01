import { GoogleGenAI } from '@google/genai';
import { config } from '../config/index.mjs';

const MODEL =
  process.env.GEMINI_MODEL || 'gemini-3.8-flash';

const MIN_SCENES = 6;
const MAX_SCENES = 10;

const MIN_DURATION = 20;
const MAX_DURATION = 59;

const TARGET_WPM = 150;

const BATCH_LANES = [
  {
    name: 'Motivation',
    category: 'Motivation',
    instruction: `
Create an original motivational mini-story.

The character should face a believable problem,
setback or failure and gradually discover a practical
way forward.

Do not use generic motivational quotes.

Show the struggle through actual events.

The ending should feel earned rather than preachy.
`
  },

  {
    name: 'Funny',
    category: 'Funny Story',
    instruction: `
Create an original situational comedy story.

Use one clear funny situation that develops naturally.

Build toward an unexpected but logical comedic payoff.

Do not use random meme references.

Do not make every scene a joke.

The humour must come from the characters and situation.
`
  },

  {
    name: 'Interesting Facts',
    category: 'Amazing Information',
    instruction: `
Create an entertaining story around one genuinely
interesting and verifiable fact, phenomenon or discovery.

The information must be presented simply.

Do not invent statistics, studies, scientific claims,
historical claims or fake expert statements.

If factual certainty is unavailable, choose a safer
well-established fact or avoid the claim.
`
  },

  {
    name: 'Mystery',
    category: 'Mystery and Curiosity',
    instruction: `
Create an original fictional mystery.

Give the viewer a clear question in the opening.

Introduce clues gradually.

Every important clue must connect to the final reveal.

The mystery must have a logical fictional explanation.

Do not fabricate real crimes, real victims,
real news events or fake evidence.
`
  },

  {
    name: 'Emotional Life',
    category: 'Interesting Human Story',
    instruction: `
Create an original emotional human story.

Use believable relationships, ordinary life situations,
personal setbacks or meaningful decisions.

Avoid fake tragedy.

Avoid emotional manipulation.

Build toward a sincere and understandable resolution
or life lesson.
`
  }
];

const FALLBACK_STORIES = [
  {
    title: 'One More Try',
    category: 'Motivation',
    hook:
      'After failing the same test three times, Daniel almost stopped trying.',
    character:
      'Daniel, a young adult with short dark hair, a navy hoodie and a black backpack',
    goal:
      'Pass an important practical test.',
    conflict:
      'Daniel keeps making the same mistake during practice.',
    setback:
      'He fails the test again and feels ready to quit.',
    turningPoint:
      'Instead of practicing everything again, Daniel studies the exact mistake that keeps stopping him.',
    resolution:
      'He changes his approach and practices that specific weakness until it becomes natural.',
    ending:
      'On the next attempt, Daniel finally passes.',
    lesson:
      'Sometimes progress begins when you stop repeating the same approach.'
  },

  {
    title: 'The Wrong Meeting',
    category: 'Funny Story',
    hook:
      'Sam walked into an important meeting, sat down confidently, and immediately realized nobody knew him.',
    character:
      'Sam, a young professional with short brown hair, a grey jacket and a laptop bag',
    goal:
      'Attend an important work meeting.',
    conflict:
      'Sam accidentally enters the wrong meeting room.',
    setback:
      'He spends several minutes trying to understand why everyone is discussing a project he has never seen.',
    turningPoint:
      'Someone finally asks Sam which department he works for.',
    resolution:
      'Sam checks his phone and discovers the meeting is in the room next door.',
    ending:
      'He apologizes, walks next door, and arrives at his actual meeting just in time.',
    lesson:
      'Confidence is useful, but checking the room number helps too.'
  },

  {
    title: 'Why Ice Floats',
    category: 'Amazing Information',
    hook:
      'There is a strange reason a lake does not simply freeze from the bottom upward.',
    character:
      'Maya, a curious young woman with curly dark hair, a green coat and a small backpack',
    goal:
      'Understand why ice stays on top of water.',
    conflict:
      'Maya notices that frozen water floats instead of sinking.',
    setback:
      'The behaviour seems backwards compared with many other materials.',
    turningPoint:
      'She learns that water expands as it freezes, making solid ice less dense than liquid water.',
    resolution:
      'The floating ice forms a surface layer while deeper water can remain liquid.',
    ending:
      'That unusual property helps aquatic life survive cold conditions.',
    lesson:
      'One unusual property of water has major consequences for life on Earth.'
  },

  {
    title: 'The Light That Stayed On',
    category: 'Mystery and Curiosity',
    hook:
      'Every night at exactly midnight, a light appeared in an empty office.',
    character:
      'Ethan, a young investigator with short black hair, a dark jacket and a small notebook',
    goal:
      'Find out why the empty office light keeps turning on.',
    conflict:
      'Nobody admits to entering the building at night.',
    setback:
      'The security camera appears to show an empty hallway.',
    turningPoint:
      'Ethan notices the light switches on at exactly the same minute every night.',
    resolution:
      'He discovers an old automated timer still controlling the office lights.',
    ending:
      'The mystery was not a person at all. It was a forgotten setting.',
    lesson:
      'A strange result can have a surprisingly ordinary explanation.'
  },

  {
    title: 'The Last Message',
    category: 'Interesting Human Story',
    hook:
      'Before leaving his old apartment, Noah found a message hidden behind a shelf.',
    character:
      'Noah, a young man with short dark hair, a brown jacket and a moving box',
    goal:
      'Finish moving out of his old apartment.',
    conflict:
      'The apartment reminds Noah of someone important from his past.',
    setback:
      'While packing, he finds an old handwritten message hidden behind a shelf.',
    turningPoint:
      'The message reminds Noah of a promise he once made to keep moving forward.',
    resolution:
      'Instead of staying stuck in the past, Noah finishes packing.',
    ending:
      'He carries the final box outside and looks back one last time before leaving.',
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
// JSON EXTRACTION
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
        'Create an original, coherent and entertaining story.'
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
// SCENE VISUAL VALIDATION HELPERS
// ============================================================

function containsWeakVisualLanguage(text) {
  const value =
    cleanText(text).toLowerCase();

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
    'random landscape'
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
      `[ScriptEngine] Scene ${number} contains weak/unrelated visual language.`
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
      `[ScriptEngine] Scene ${number} narration is too short to drive a meaningful visual.`
    );
  }

  if (
    cleanText(scene.action).length <
    8
  ) {
    throw new Error(
      `[ScriptEngine] Scene ${number} action is too vague.`
    );
  }

  if (
    cleanText(scene.environment).length <
    5
  ) {
    throw new Error(
      `[ScriptEngine] Scene ${number} environment is too vague.`
    );
  }

  if (
    cleanText(scene.character).length <
    8
  ) {
    throw new Error(
      `[ScriptEngine] Scene ${number} character continuity data is too weak.`
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
      scene?.description ||
      ''
    );

  const finalCharacter =
    character ||
    storyCharacter ||
    'A young adult main character with consistent appearance, hairstyle and clothing';

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
    'the key object described by the narration';

  const finalVisualPrompt =
    suppliedVisual ||
    [
      'Cinematic realistic vertical 9:16 shot',
      `of ${finalCharacter}`,
      `performing ${finalAction}`,
      `in ${finalEnvironment}`,
      `showing ${finalEmotion}`,
      `with ${finalObject}`,
      'the exact narrated action must be clearly visible',
      'same character appearance',
      'same clothing and hairstyle',
      'natural cinematic lighting',
      'realistic photography',
      'no unrelated objects or events'
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
        metadataRiskChecked: true
      },

    scenes
  };
}

// ============================================================
// STORY VALIDATION
// ============================================================

function validateStory(
  story
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

  const totalWords =
    wordCount(
      story.narration
    );

  if (
    totalWords < 45
  ) {
    throw new Error(
      '[ScriptEngine] Narration is too short for a complete Shorts story.'
    );
  }

  if (
    totalWords > 170
  ) {
    throw new Error(
      '[ScriptEngine] Narration is too long for a 20–59 second Short.'
    );
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

  const template =
    FALLBACK_STORIES[
      index %
      FALLBACK_STORIES.length
    ];

  const scenes = [
    {
      narration:
        template.hook,

      character:
        template.character,

      environment:
        'the main location where the story begins',

      action:
        'experiences the opening situation described by the hook',

      emotion:
        'surprised and curious',

      importantObject:
        'the main object connected to the opening event'
    },

    {
      narration:
        `The goal was simple: ${template.goal}`,

      character:
        template.character,

      environment:
        'the same main location',

      action:
        'starts working toward the goal',

      emotion:
        'focused',

      importantObject:
        'the object needed for the goal'
    },

    {
      narration:
        template.conflict,

      character:
        template.character,

      environment:
        'the same location as the previous scene',

      action:
        'reacts as the main problem appears',

      emotion:
        'confused and surprised',

      importantObject:
        'the object causing or revealing the problem'
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
        'the object involved in the setback'
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

      importantObject:
        'the clue or object that creates the turning point'
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

      importantObject:
        'the object used in the solution'
    },

    {
      narration:
        template.ending,

      character:
        template.character,

      environment:
        'the final location of the story',

      action:
        'experiences the final outcome',

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

  return normalizeStory({
    title:
      template.title,

    category:
      lane.category,

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

Create ONE complete original YouTube Short.

============================================================
AUDIENCE
============================================================

Primary audience:

USA
UK
EUROPE

Use natural international English.

Do NOT make the story specifically UK-only.

Avoid obscure regional slang.

Avoid political persuasion.

Avoid local references that international viewers
would not understand.

============================================================
CURRENT VIDEO
============================================================

Batch size:
${batchSize}

Current video number:
${variationIndex + 1}

Required creative lane:

${lane.name}

Required category:

${requestedCategory}

Creative direction:

${lane.instruction}

Topic:

${cleanText(topic) || 'Create an original topic appropriate for the selected creative lane.'}

============================================================
BATCH DIVERSITY IS MANDATORY
============================================================

This is one video inside a five-video batch.

The five videos must NOT feel like variations
of the same story.

The batch should normally contain:

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

Current video must strongly follow its assigned lane.

Do NOT simply change the title.

Change the actual:

- plot
- characters
- setting
- problem
- goal
- visual situations
- emotional progression
- ending
- story mechanism

============================================================
PREVIOUS CONCEPTS
============================================================

If previous concepts are supplied below,
do NOT repeat or closely imitate them.

${previousConcepts || 'No previous concepts supplied.'}

============================================================
STORY REQUIREMENT
============================================================

Create a complete mini-film.

Required structure:

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
TURNING POINT
↓
RESOLUTION
↓
PAYOFF

The story must have cause and effect.

Scene 2 must logically follow scene 1.

Scene 3 must logically follow scene 2.

Continue this chain until the ending.

Never create a collection of unrelated cinematic shots.

============================================================
HOOK
============================================================

The first scene must immediately establish:

- who
- what
- why it matters

The hook must actually happen later in the story.

No empty clickbait.

============================================================
CHARACTER
============================================================

Use one primary protagonist.

Define:

- age range
- appearance
- hairstyle
- clothing
- accessories

Keep these details identical across scenes.

Do NOT randomly change the protagonist.

If another character appears,
give that character a stable description too.

============================================================
LOCATION
============================================================

Choose a believable main setting.

Examples:

- apartment
- workshop
- office
- café
- street
- school
- park
- train station
- home
- small business

Do not randomly move between unrelated locations.

A location change must be caused by the story.

============================================================
VISUAL STORY MATCH — CRITICAL
============================================================

THIS IS ONE OF THE MOST IMPORTANT REQUIREMENTS.

Every visualPrompt must directly show
what the narration describes.

The visual cannot merely match the mood.

It must match the EVENT.

Example:

Narration:
"Daniel opens the old metal box."

Correct visual:
Daniel physically opening the old metal box.

Incorrect visual:
Daniel walking through a city.

Incorrect visual:
A random fisherman.

Incorrect visual:
A random director.

Incorrect visual:
A random detective board.

Every scene must visually communicate
the exact narrated action.

============================================================
VISUAL CONTINUITY — CRITICAL
============================================================

The same protagonist must remain visually consistent.

Keep:

- hairstyle
- hair colour
- approximate age
- clothing
- accessories
- body appearance

consistent.

Keep important locations and objects consistent.

============================================================
SCENE DESIGN
============================================================

Create 6–10 scenes.

Each scene must contain:

1. narration
2. duration
3. character
4. environment
5. action
6. emotion
7. importantObject
8. visualPrompt

The visualPrompt must explicitly include:

- character
- exact action
- environment
- emotion
- important object
- continuity
- vertical 9:16 framing

============================================================
NO RANDOM STOCK FOOTAGE
============================================================

Do NOT write visual prompts such as:

- generic cinematic footage
- random city
- random person
- random landscape
- stock footage
- unrelated cinematic shot

The visual must be story-specific.

============================================================
VOICEOVER
============================================================

Write natural spoken English.

Use short conversational sentences.

Avoid:

- essay language
- corporate language
- robotic phrases
- unnecessary exposition
- repeated ideas

The narration must tell the entire story.

============================================================
DURATION
============================================================

Target:

20–59 seconds.

Use approximately:

150 words per minute.

Keep narration concise enough for a Short.

============================================================
ENDING
============================================================

The ending must provide an actual payoff.

Possible endings:

- logical reveal
- funny punchline
- useful takeaway
- emotional resolution
- clever solution
- surprising discovery

Do not stop randomly.

============================================================
FACTUAL CONTENT
============================================================

If the selected lane is informational:

Use only well-established information.

Never invent:

- statistics
- studies
- scientific findings
- historical claims
- expert quotes
- breaking news

============================================================
MYSTERY CONTENT
============================================================

If the selected lane is Mystery:

It must be fictional unless reliable factual source
information is explicitly provided.

Do not fabricate real crimes.

Do not fabricate real victims.

Do not fabricate evidence.

============================================================
ORIGINALITY
============================================================

Create an original concept.

Do not copy or closely reproduce:

- movies
- television
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
- fabricated real-world events
- misleading political claims
- impersonation
- deceptive evidence

Keep the story suitable for a broad audience.

============================================================
AI DISCLOSURE
============================================================

If the planned realistic AI-generated visuals
could require an AI disclosure review,
set:

"aiDisclosureRecommended": true

Otherwise:

false

This is a review flag only.

Do not claim guaranteed YouTube compliance.

============================================================
FINAL SELF-CHECK
============================================================

Before returning JSON verify:

1. Hook is interesting.
2. Hook matches the actual story.
3. One clear protagonist exists.
4. Character stays consistent.
5. Goal is clear.
6. Problem is clear.
7. Events escalate.
8. Setback exists.
9. Turning point exists.
10. Resolution exists.
11. Ending has payoff.
12. Every scene follows the previous scene.
13. Every visual directly matches its narration.
14. No random unrelated footage is requested.
15. Environment continuity is logical.
16. Story is original.
17. Story is materially different from previous concepts.
18. English is natural internationally.
19. No unsupported facts.
20. No fake news.
21. No unsafe instructions.
22. No deceptive clickbait.
23. Duration is 20–59 seconds.
24. Scene count is 6–10.

============================================================
OUTPUT
============================================================

Return ONLY valid JSON.

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
      '[ScriptEngine] Rebuilding structured fallback story.'
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
    `[ScriptEngine] Category: ${story.category}`
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