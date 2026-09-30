import { GoogleGenAI } from '@google/genai';
import config from '../config/index.mjs';

const MIN_DURATION = 20;
const MAX_DURATION = 59;
const TARGET_DURATION = 40;

const MIN_SCENES = 5;
const MAX_SCENES = 8;

const DEFAULT_CATEGORY = 'motivation';
const DEFAULT_AUDIENCE = 'USA, UK and Europe';

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

function estimateDuration(text) {
  const words = wordCount(text);

  // Natural English Shorts narration estimate.
  // Around 145 words/minute.
  const seconds = Math.round((words / 145) * 60);

  return Math.min(
    MAX_DURATION,
    Math.max(MIN_DURATION, seconds || TARGET_DURATION)
  );
}

function getCategory(options = {}) {
  const category = cleanText(
    options.category ||
    options.contentType ||
    DEFAULT_CATEGORY
  ).toLowerCase();

  const allowed = [
    'trending',
    'motivation',
    'funny',
    'comedy',
    'emotional',
    'mystery',
    'facts',
    'life lesson',
    'inspiration',
    'story'
  ];

  if (allowed.includes(category)) {
    return category;
  }

  if (category.includes('funny') || category.includes('comedy')) {
    return 'funny';
  }

  if (category.includes('trend')) {
    return 'trending';
  }

  if (category.includes('emotion')) {
    return 'emotional';
  }

  if (category.includes('mystery')) {
    return 'mystery';
  }

  if (category.includes('fact')) {
    return 'facts';
  }

  return DEFAULT_CATEGORY;
}

function getAudience(options = {}) {
  return cleanText(
    options.audience ||
    options.targetAudience ||
    DEFAULT_AUDIENCE
  );
}

function getRegion(options = {}) {
  return cleanText(
    options.region ||
    options.targetRegion ||
    'US,GB,EU'
  );
}

function categoryInstructions(category) {
  const instructions = {
    trending: `
- Use the supplied topic/trend as the subject.
- Do NOT copy a news article or another creator's wording.
- Turn the trend into an original short story, explanation, reaction, or scenario.
- Never invent facts, statistics, quotes, events, or breaking-news details.
- If the topic is uncertain or factual claims cannot be supported, keep the script general rather than inventing information.
`,

    motivation: `
- Build a real-feeling mini-story around a difficult decision or challenge.
- Show a setback before the turning point.
- The lesson must come naturally from the story.
`,

    funny: `
- Build a clear comedic situation.
- Give the character a simple goal.
- Create an unexpected problem or misunderstanding.
- Use a clean punchline or funny ending.
- Keep the humor understandable to USA, UK and European audiences.
`,

    comedy: `
- Build a clear comedic situation.
- Give the character a simple goal.
- Create an unexpected problem or misunderstanding.
- Use a clean punchline or funny ending.
- Keep the humor understandable to USA, UK and European audiences.
`,

    emotional: `
- Create an emotionally meaningful but fictional or clearly presented story.
- Give the character a genuine human problem.
- Build toward a meaningful turning point.
- Avoid manipulative fake claims presented as real events.
`,

    mystery: `
- Open with a strong unanswered question.
- Reveal information progressively.
- Include a clear turning point.
- Give the viewer a satisfying ending rather than stopping randomly.
`,

    facts: `
- Focus on factual information only when it is supplied or reliably established.
- Never invent statistics, scientific claims, quotes, dates, or historical details.
- If the topic is not suitable for verified facts, turn it into a clearly fictional scenario instead.
`,

    'life lesson': `
- Build a simple story around a decision, mistake, consequence and lesson.
- Make the ending practical and memorable.
`,

    inspiration: `
- Build an original human-centered story.
- Include difficulty, action, setback and progress.
- Avoid generic motivational filler.
`,

    story: `
- Create a complete original short story.
- Give the main character a goal, obstacle, turning point and ending.
`
  };

  return instructions[category] || instructions.motivation;
}

function cleanScene(scene, index) {
  if (!scene || typeof scene !== 'object') {
    return null;
  }

  const narration = cleanText(scene.narration);
  const visualPrompt = cleanText(
    scene.visualPrompt ||
    scene.visual ||
    scene.visualDescription
  );

  if (!narration || !visualPrompt) {
    return null;
  }

  return {
    sceneNumber: index + 1,
    narration,
    visualPrompt,
    duration: 5
  };
}

function normalizeSceneDurations(scenes, totalDuration) {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    return [];
  }

  const sceneCount = scenes.length;

  // Distribute the final duration across scenes.
  // Every scene remains long enough to show its action.
  const baseDuration = Math.floor(totalDuration / sceneCount);
  let remainder = totalDuration - (baseDuration * sceneCount);

  return scenes.map((scene, index) => {
    let duration = baseDuration;

    if (remainder > 0) {
      duration += 1;
      remainder -= 1;
    }

    duration = Math.max(3, duration);

    return {
      ...scene,
      sceneNumber: index + 1,
      duration
    };
  });
}

function scenesContainNarration(scenes, narration) {
  const sceneText = cleanText(
    scenes
      .map(scene => scene.narration)
      .join(' ')
  ).toLowerCase();

  const fullNarration = cleanText(narration).toLowerCase();

  if (!sceneText || !fullNarration) {
    return false;
  }

  /*
   * The AI is allowed to make small punctuation/spacing differences,
   * so we compare meaningful words instead of requiring exact strings.
   */
  const narrationWords = fullNarration
    .replace(/[^\p{L}\p{N}' ]/gu, ' ')
    .split(/\s+/)
    .filter(word => word.length >= 3);

  if (narrationWords.length === 0) {
    return false;
  }

  const sceneWords = new Set(
    sceneText
      .replace(/[^\p{L}\p{N}' ]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean)
  );

  let matched = 0;

  for (const word of narrationWords) {
    if (sceneWords.has(word)) {
      matched += 1;
    }
  }

  const coverage = matched / narrationWords.length;

  return coverage >= 0.70;
}

function validateStoryStructure(data) {
  const structure = data?.storyStructure;

  if (!structure || typeof structure !== 'object') {
    return false;
  }

  const required = [
    'hook',
    'character',
    'goal',
    'conflict',
    'setback',
    'turningPoint',
    'resolution',
    'ending'
  ];

  return required.every(
    key => cleanText(structure[key]).length > 0
  );
}

function normalizeScript(data, topic, options = {}) {
  const category = getCategory(options);
  const audience = getAudience(options);
  const region = getRegion(options);

  const title =
    cleanText(data?.title) ||
    `A Short Story About ${topic}`;

  const narration = cleanText(data?.narration);

  const structure = {
    hook: cleanText(
      data?.storyStructure?.hook ||
      data?.hook
    ),

    character: cleanText(
      data?.storyStructure?.character
    ),

    goal: cleanText(
      data?.storyStructure?.goal
    ),

    conflict: cleanText(
      data?.storyStructure?.conflict
    ),

    setback: cleanText(
      data?.storyStructure?.setback
    ),

    turningPoint: cleanText(
      data?.storyStructure?.turningPoint
    ),

    resolution: cleanText(
      data?.storyStructure?.resolution
    ),

    ending: cleanText(
      data?.storyStructure?.ending ||
      data?.ending
    )
  };

  let finalNarration = narration;

  if (!finalNarration) {
    finalNarration = [
      structure.hook,
      structure.character,
      structure.goal,
      structure.conflict,
      structure.setback,
      structure.turningPoint,
      structure.resolution,
      structure.ending
    ]
      .filter(Boolean)
      .join(' ');
  }

  if (!finalNarration) {
    finalNarration = fallbackNarration(topic, category);
  }

  const scenes = Array.isArray(data?.scenes)
    ? data.scenes
        .map(cleanScene)
        .filter(Boolean)
    : [];

  const durationEstimate = estimateDuration(finalNarration);

  let finalScenes = scenes;

  if (
    finalScenes.length < MIN_SCENES ||
    !scenesContainNarration(finalScenes, finalNarration)
  ) {
    finalScenes = buildFallbackScenes(
      finalNarration,
      topic,
      category,
      structure
    );
  }

  finalScenes = finalScenes.slice(0, MAX_SCENES);

  finalScenes = normalizeSceneDurations(
    finalScenes,
    durationEstimate
  );

  return {
    title,
    category,
    audience,
    region,

    hook:
      structure.hook ||
      cleanText(finalNarration.split(/[.!?]/)[0]),

    story: cleanText(data?.story),

    storyStructure: structure,

    lesson: cleanText(
      data?.lesson ||
      structure.resolution
    ),

    ending:
      structure.ending ||
      cleanText(data?.ending),

    narration: finalNarration,

    durationEstimate,

    sceneCount: finalScenes.length,

    scenes: finalScenes
  };
}

function fallbackNarration(topic, category) {
  if (category === 'funny' || category === 'comedy') {
    return [
      `He thought today would be completely normal.`,
      `Then one tiny mistake turned into a problem he never expected.`,
      `He tried to fix it, but somehow made everything even worse.`,
      `Finally, he stopped, looked at what had happened, and realized the funniest part.`,
      `Sometimes the best stories start with the smallest mistakes.`
    ].join(' ');
  }

  if (category === 'mystery') {
    return [
      `Nobody understood why the old door opened every night at exactly midnight.`,
      `One evening, a curious stranger decided to find out.`,
      `Inside, there was nothing unusual at first.`,
      `Then he noticed one small detail that changed everything.`,
      `The mystery was never about the door. It was about what he had been ignoring.`
    ].join(' ');
  }

  if (category === 'emotional') {
    return [
      `He almost gave up on the one thing he had worked for years to achieve.`,
      `That morning, everything seemed to go wrong.`,
      `Then someone reminded him why he started.`,
      `He took one more step instead of walking away.`,
      `Sometimes one more step is all it takes to change the ending.`
    ].join(' ');
  }

  return [
    `He was ready to quit when one small decision changed everything.`,
    `For months, he had been trying to reach a goal, but every attempt seemed to fail.`,
    `Then another setback appeared, and this time he almost walked away.`,
    `Instead, he changed one small part of his approach and tried again.`,
    `The result was not instant success, but he finally started moving forward.`,
    `The lesson was simple: you do not need to win today, you just need to keep moving.`
  ].join(' ');
}

function buildFallbackScenes(
  narration,
  topic,
  category,
  structure = {}
) {
  const sentences = narration
    .split(/(?<=[.!?])\s+/)
    .map(cleanText)
    .filter(Boolean);

  const actions = [
    structure.hook ||
      `A close-up of the main character facing an unexpected situation related to ${topic}.`,

    structure.character ||
      `The main character is shown in their everyday environment, focused on their goal.`,

    structure.conflict ||
      `The character encounters a clear obstacle connected to ${topic}.`,

    structure.setback ||
      `The situation becomes harder and the character briefly considers giving up.`,

    structure.turningPoint ||
      `The character notices a new possibility and decides to take action.`,

    structure.resolution ||
      `The character takes the next step and begins making progress.`,

    structure.ending ||
      `The character reaches a meaningful ending and looks toward the future.`
  ];

  const sceneCount = Math.max(
    MIN_SCENES,
    Math.min(MAX_SCENES, sentences.length)
  );

  const scenes = [];

  for (let i = 0; i < sceneCount; i++) {
    const sentence =
      sentences[i] ||
      sentences[sentences.length - 1] ||
      `A meaningful moment connected to ${topic}.`;

    const action =
      actions[i] ||
      `A cinematic continuation of the story about ${topic}.`;

    scenes.push({
      sceneNumber: i + 1,
      narration: sentence,
      visualPrompt: [
        action,
        `Category: ${category}.`,
        `Realistic cinematic storytelling.`,
        `Natural human expressions and physical action.`,
        `Vertical 9:16 composition.`,
        `No text, no logos, no watermarks.`
      ].join(' '),
      duration: 5
    });
  }

  return scenes;
}

function extractJson(text) {
  if (!text) {
    return null;
  }

  const cleaned = String(text)
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');

    if (start === -1 || end === -1 || end <= start) {
      return null;
    }

    try {
      return JSON.parse(
        cleaned.slice(start, end + 1)
      );
    } catch {
      return null;
    }
  }
}

function buildPrompt(
  topic,
  variation = 1,
  options = {}
) {
  const category = getCategory(options);
  const audience = getAudience(options);
  const region = getRegion(options);

  return `
You are the STORY DIRECTOR for a professional YouTube Shorts production system.

Your job is NOT to write generic AI motivational text.

Create ONE original, coherent, visually producible short-form story.

TOPIC:
${topic}

CONTENT CATEGORY:
${category}

TARGET AUDIENCE:
${audience}

TARGET REGIONS:
${region}

STORY VARIATION:
${variation}

TARGET LENGTH:
Approximately ${TARGET_DURATION} seconds.

ALLOWED FINAL LENGTH:
${MIN_DURATION} to ${MAX_DURATION} seconds.

${categoryInstructions(category)}

AUDIENCE STYLE:
- Use natural modern English.
- English should be understandable to viewers in the USA, UK and Europe.
- Avoid awkward literal translations.
- Avoid excessive slang.
- Avoid region-specific jokes unless they are easy to understand.
- Do not use fake statistics or unsupported claims.
- Do not present fictional events as real news.
- Do not copy another creator's wording.

STORY STRUCTURE IS REQUIRED:

1. HOOK
The first sentence must immediately create curiosity.

2. CHARACTER
Introduce a clear main character.

3. GOAL
The viewer must understand what the character wants.

4. CONFLICT
Something must make the goal difficult.

5. SETBACK
The character must face a meaningful failure, problem or complication.

6. TURNING POINT
Something changes the direction of the story.

7. RESOLUTION
The character takes action and the situation develops toward an ending.

8. ENDING
Finish the story clearly. Do not stop randomly.
The ending should feel intentional and memorable.

IMPORTANT STORY RULES:
- The story must have cause and effect.
- Each event must logically lead to the next event.
- Do not create unrelated scenes.
- Do not jump between unrelated locations without a story reason.
- Do not introduce unnecessary characters.
- Do not use copyrighted fictional characters.
- Do not imitate a specific living creator.
- Do not copy existing movies, TikToks, Reels, speeches or YouTube scripts.
- Keep the story easy to understand without prior context.
- Make the viewer want to continue watching after the first sentence.

VISUAL RULES:
Every scene must show the exact action or situation being narrated.

For every scene:
- Describe the main character consistently.
- Keep clothing, age, appearance and important physical characteristics consistent.
- Keep the environment consistent when the story remains in the same location.
- Describe actual visible actions, not abstract concepts.
- Avoid visual prompts that cannot reasonably be shown.
- Avoid generic phrases such as "success", "motivation" or "happiness" without describing visible action.
- Use realistic cinematic visual direction.
- Use vertical 9:16 composition.
- No text, logos or watermarks unless the story specifically requires them.

NARRATION RULES:
- "narration" must contain the COMPLETE spoken story.
- Every sentence in the complete narration must be represented by one or more scene narrations.
- Scene narrations must appear in the same order as the complete narration.
- Do not leave narration outside the scenes.
- Do not add scene narration that is unrelated to the complete narration.
- Do not make the voiceover longer than the intended video duration.

SCENE RULES:
- Create ${MIN_SCENES} to ${MAX_SCENES} scenes.
- Every scene must contain narration.
- Every scene must contain a detailed visualPrompt.
- Scene order must follow the story.
- The scene number must start at 1.
- Use approximate durations that allow the complete narration to be spoken naturally.

QUALITY RULE:
Before returning the answer, mentally check:
HOOK → CHARACTER → GOAL → CONFLICT → SETBACK → TURNING POINT → RESOLUTION → ENDING.

If one of these is missing, rewrite the story before returning JSON.

Return ONLY valid JSON.

Required JSON:

{
  "title": "short professional title",
  "category": "${category}",
  "hook": "exact opening sentence",
  "story": "brief description of the complete story",
  "lesson": "lesson or takeaway",
  "ending": "exact ending idea",
  "storyStructure": {
    "hook": "story hook",
    "character": "main character",
    "goal": "character goal",
    "conflict": "main conflict",
    "setback": "important setback",
    "turningPoint": "turning point",
    "resolution": "resolution",
    "ending": "ending"
  },
  "narration": "COMPLETE narration from first sentence to final sentence",
  "scenes": [
    {
      "sceneNumber": 1,
      "narration": "exact narration spoken in this scene",
      "visualPrompt": "specific visible action matching the narration",
      "duration": 5
    }
  ]
}
`;
}

async function generateWithGemini(
  topic,
  variation = 1,
  options = {}
) {
  if (!config.geminiApiKey) {
    return null;
  }

  const ai = new GoogleGenAI({
    apiKey: config.geminiApiKey
  });

  const prompt = buildPrompt(
    topic,
    variation,
    options
  );

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt
  });

  const text =
    response?.text ||
    response?.candidates?.[0]?.content?.parts
      ?.map(part => part.text || '')
      .join('');

  return extractJson(text);
}

function validateGeneratedResult(data) {
  if (!data || typeof data !== 'object') {
    return {
      valid: false,
      reason: 'AI returned no valid object.'
    };
  }

  const narration = cleanText(data.narration);

  if (!narration) {
    return {
      valid: false,
      reason: 'Complete narration is missing.'
    };
  }

  if (wordCount(narration) < 45) {
    return {
      valid: false,
      reason: 'Narration is too short for a proper Short.'
    };
  }

  const scenes = Array.isArray(data.scenes)
    ? data.scenes
    : [];

  if (
    scenes.length < MIN_SCENES ||
    scenes.length > MAX_SCENES
  ) {
    return {
      valid: false,
      reason: `Scene count must be ${MIN_SCENES}-${MAX_SCENES}.`
    };
  }

  const cleanedScenes = scenes
    .map(cleanScene)
    .filter(Boolean);

  if (cleanedScenes.length !== scenes.length) {
    return {
      valid: false,
      reason: 'One or more scenes are missing narration or visualPrompt.'
    };
  }

  if (!scenesContainNarration(cleanedScenes, narration)) {
    return {
      valid: false,
      reason: 'Scene narration does not sufficiently cover complete narration.'
    };
  }

  if (!validateStoryStructure(data)) {
    return {
      valid: false,
      reason: 'Required story structure is incomplete.'
    };
  }

  return {
    valid: true,
    reason: 'Story validation passed.'
  };
}

export async function generateScript(
  topic,
  options = {}
) {
  const cleanTopic = cleanText(topic);

  if (!cleanTopic) {
    throw new Error(
      '[ScriptEngine] Topic is required.'
    );
  }

  const variation =
    Number(options.variation) || 1;

  const category = getCategory(options);

  console.log(
    `[ScriptEngine] Generating ${category} story: "${cleanTopic}"`
  );

  try {
    const aiResult = await generateWithGemini(
      cleanTopic,
      variation,
      options
    );

    if (aiResult) {
      const validation =
        validateGeneratedResult(aiResult);

      if (!validation.valid) {
        console.warn(
          `[ScriptEngine] AI story rejected: ${validation.reason}`
        );
      } else {
        const normalized =
          normalizeScript(
            aiResult,
            cleanTopic,
            options
          );

        console.log(
          `[ScriptEngine] AI story accepted: ${normalized.durationEstimate}s, ${normalized.sceneCount} scenes`
        );

        return normalized;
      }
    } else {
      console.warn(
        '[ScriptEngine] Gemini response unavailable.'
      );
    }
  } catch (error) {
    console.error(
      '[ScriptEngine] Gemini generation failed:',
      error.message
    );
  }

  /*
   * Safe local fallback.
   *
   * This keeps the pipeline alive if Gemini is temporarily
   * unavailable, but the fallback is clearly marked as local
   * generation and is not treated as a successful AI story.
   */
  console.warn(
    '[ScriptEngine] Using local fallback story.'
  );

  const fallback = normalizeScript(
    {
      title: `A Story About ${cleanTopic}`,
      narration: fallbackNarration(
        cleanTopic,
        category
      ),
      storyStructure: {
        hook: 'He was ready to quit when one small decision changed everything.',
        character: 'A determined person facing a difficult goal.',
        goal: `The character wants to make progress with ${cleanTopic}.`,
        conflict: 'Unexpected problems keep getting in the way.',
        setback: 'Another failure makes the character consider giving up.',
        turningPoint: 'The character changes approach and tries one more time.',
        resolution: 'The new approach creates progress.',
        ending: 'The character learns that consistent action matters more than perfection.'
      },
      scenes: []
    },
    cleanTopic,
    options
  );

  return fallback;
}

export async function generateMultipleScripts(
  topic,
  count = 1,
  options = {}
) {
  const safeCount = Math.min(
    Math.max(Number(count) || 1, 1),
    10
  );

  const scripts = [];

  for (let i = 1; i <= safeCount; i++) {
    console.log(
      `[ScriptEngine] Creating video ${i}/${safeCount}...`
    );

    const script = await generateScript(
      topic,
      {
        ...options,
        variation: i
      }
    );

    scripts.push({
      videoNumber: i,
      ...script
    });
  }

  return scripts;
}