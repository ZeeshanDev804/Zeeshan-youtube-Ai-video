import { GoogleGenAI } from '@google/genai';
import config from '../config/index.mjs';

const MIN_DURATION = 20;
const MAX_DURATION = 59;
const TARGET_DURATION = 40;

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeScript(data, topic) {
  const title = cleanText(data?.title) || `The Story of ${topic}`;

  const hook = cleanText(data?.hook);
  const story = cleanText(data?.story);
  const lesson = cleanText(data?.lesson);
  const ending = cleanText(data?.ending);

  let narration = cleanText(
    data?.narration ||
    [hook, story, lesson, ending]
      .filter(Boolean)
      .join(' ')
  );

  if (!narration) {
    narration = fallbackNarration(topic);
  }

  const scenes = Array.isArray(data?.scenes)
    ? data.scenes
        .map((scene, index) => ({
          sceneNumber: index + 1,
          narration: cleanText(scene?.narration),
          visualPrompt: cleanText(scene?.visualPrompt),
          duration: Number(scene?.duration) || 5
        }))
        .filter(scene => scene.narration && scene.visualPrompt)
    : [];

  return {
    title,
    hook: hook || narration.split('.').slice(0, 1).join('.').trim(),
    story,
    lesson,
    ending,
    narration,
    durationEstimate: estimateDuration(narration),
    scenes: scenes.length > 0
      ? scenes
      : buildFallbackScenes(narration, topic)
  };
}

function estimateDuration(text) {
  const words = cleanText(text).split(/\s+/).filter(Boolean).length;

  // Approx. 145 words/minute for natural short-form narration.
  const seconds = Math.round((words / 145) * 60);

  return Math.min(
    MAX_DURATION,
    Math.max(MIN_DURATION, seconds || TARGET_DURATION)
  );
}

function fallbackNarration(topic) {
  return [
    `Most people overlook one important lesson about ${topic}.`,
    `The biggest change usually starts with one small decision.`,
    `You do not need perfect conditions to begin.`,
    `You need consistency, patience, and the courage to take the next step.`,
    `Start small, keep moving, and let your results grow over time.`
  ].join(' ');
}

function buildFallbackScenes(narration, topic) {
  const sentences = narration
    .split(/[.!?]+/)
    .map(cleanText)
    .filter(Boolean);

  const visualPrompts = [
    `cinematic close-up representing ${topic}, determined person, realistic, vertical 9:16`,
    `person facing a difficult challenge related to ${topic}, cinematic lighting, realistic, vertical 9:16`,
    `person taking action and making progress, inspiring atmosphere, realistic cinematic footage, vertical 9:16`,
    `symbolic visual of growth and persistence related to ${topic}, cinematic, realistic, vertical 9:16`,
    `hopeful successful ending, confident person looking toward the future, cinematic, realistic, vertical 9:16`
  ];

  const selected = sentences.slice(0, 5);

  return selected.map((sentence, index) => ({
    sceneNumber: index + 1,
    narration: sentence,
    visualPrompt: visualPrompts[index] || visualPrompts[4],
    duration: 5
  }));
}

function extractJson(text) {
  if (!text) return null;

  const cleaned = text
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
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function buildPrompt(topic, variation = 1) {
  return `
You are a professional YouTube Shorts motivational storyteller.

Create ONE original motivational short-form story about:

TOPIC:
${topic}

STORY VARIATION:
${variation}

IMPORTANT:
- Create an ORIGINAL story.
- Do not copy any existing article, TikTok, Reel, movie, speech, or YouTube video.
- Do not invent fake news or fake statistics.
- Do not use copyrighted characters.
- Do not make the story sound like generic AI filler.
- Make the story emotionally engaging and easy to understand.
- Target approximately ${TARGET_DURATION} seconds.
- Final narration must normally fit between ${MIN_DURATION} and ${MAX_DURATION} seconds.
- Use simple natural English.
- The first sentence must create curiosity.
- Build a clear mini-story.
- Give the viewer one useful lesson.
- Finish with a memorable but short ending.
- Every visual prompt must directly match its scene narration.
- Prefer realistic human/cinematic visuals that can reasonably be found through a stock-video provider.
- Avoid impossible or overly abstract visuals.

Return ONLY valid JSON.

Required JSON structure:

{
  "title": "short title",
  "hook": "strong opening sentence",
  "story": "main story section",
  "lesson": "clear lesson",
  "ending": "short memorable ending",
  "narration": "complete narration for the video",
  "scenes": [
    {
      "sceneNumber": 1,
      "narration": "sentence spoken during this scene",
      "visualPrompt": "specific realistic visual matching this sentence",
      "duration": 5
    }
  ]
}

Create 5 to 8 scenes.

The complete narration must be coherent from beginning to end.
`;
}

async function generateWithGemini(topic, variation = 1) {
  if (!config.geminiApiKey) {
    return null;
  }

  const ai = new GoogleGenAI({
    apiKey: config.geminiApiKey
  });

  const prompt = buildPrompt(topic, variation);

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

export async function generateScript(topic, options = {}) {
  const cleanTopic = cleanText(topic);

  if (!cleanTopic) {
    throw new Error('[ScriptEngine] Topic is required.');
  }

  const variation = Number(options.variation) || 1;

  console.log(
    `[ScriptEngine] Generating original motivational story: "${cleanTopic}"`
  );

  try {
    const aiResult = await generateWithGemini(
      cleanTopic,
      variation
    );

    if (aiResult) {
      const normalized = normalizeScript(aiResult, cleanTopic);

      console.log(
        `[ScriptEngine] AI script generated: ${normalized.durationEstimate}s`
      );

      return normalized;
    }

    console.warn(
      '[ScriptEngine] Gemini key not available or AI response failed. Using local fallback.'
    );
  } catch (error) {
    console.error(
      '[ScriptEngine] Gemini generation failed:',
      error.message
    );
  }

  const fallback = normalizeScript(
    {
      title: `The Lesson Behind ${cleanTopic}`,
      narration: fallbackNarration(cleanTopic),
      scenes: []
    },
    cleanTopic
  );

  return fallback;
}

export async function generateMultipleScripts(topic, count = 1) {
  const safeCount = Math.min(
    Math.max(Number(count) || 1, 1),
    10
  );

  const scripts = [];

  for (let i = 1; i <= safeCount; i++) {
    console.log(
      `[ScriptEngine] Creating video ${i}/${safeCount}...`
    );

    const script = await generateScript(topic, {
      variation: i
    });

    scripts.push({
      videoNumber: i,
      ...script
    });
  }

  return scripts;
}