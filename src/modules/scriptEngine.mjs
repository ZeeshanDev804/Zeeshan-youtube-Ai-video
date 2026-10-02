import { GoogleGenAI } from "@google/genai";
import config from "../config/index.mjs";

const MODEL = config?.ai?.model || "gemini-3.8-flash";

const videoConfig = config?.videoConfig || {};
const scriptConfig = config?.scriptConfig || {};

const MIN_SCENES = Number(scriptConfig.minScenes || 6);
const MAX_SCENES = Number(scriptConfig.maxScenes || 10);

const MIN_DURATION = Number(videoConfig.minDuration || 20);
const MAX_DURATION = Number(videoConfig.maxDuration || 59);

const TARGET_WPM = Number(scriptConfig.wpm || 150);

const MIN_NARRATION_WORDS = Number(scriptConfig.minWords || 65);
const MAX_NARRATION_WORDS = Number(scriptConfig.maxWords || 155);

const MAX_SCENE_WORDS = 32;
const MIN_SCENE_WORDS = 4;

const BATCH_LANES = [
  {
    name: "Motivation",
    key: "motivation",
    instruction:
      "Create a grounded motivational life story with a clear struggle, specific action, setback, turning point and believable emotional payoff."
  },
  {
    name: "Interesting Facts",
    key: "facts",
    instruction:
      "Create an accurate educational story around a surprising fact. Explain the fact through a simple visual journey instead of presenting a dry list."
  },
  {
    name: "Mystery",
    key: "mystery",
    instruction:
      "Create a fictional or clearly framed unsolved mystery. Build clues progressively and end with a satisfying reveal without presenting fiction as verified real-world evidence."
  },
  {
    name: "Funny",
    key: "funny",
    instruction:
      "Create a clean relatable comedy story with escalating consequences, physical actions and a clear punchline or payoff."
  },
  {
    name: "Emotional",
    key: "emotional",
    instruction:
      "Create an emotionally engaging human story with a clear relationship, meaningful action, setback and sincere ending. Avoid manipulative tragedy."
  }
];

const FALLBACK_STORIES = {
  motivation: {
    title: "The Small Step That Changed Everything",
    type: "motivation",
    baseGoal: "finish one important task despite feeling stuck",
    conflict: "self-doubt keeps slowing the character down",
    turningPoint: "the character stops waiting for confidence and takes one small action",
    resolution:
      "the first small action creates momentum and makes the larger goal feel possible",
    ending:
      "Progress begins when you take the next small step."
  },

  facts: {
    title: "The Strange Reason Ice Floats",
    type: "facts",
    baseGoal: "understand why ice behaves differently from most solids",
    conflict:
      "the character expects frozen water to become denser like many other materials",
    turningPoint:
      "the water molecules spread into a more open structure as they freeze",
    resolution:
      "that structure makes solid ice less dense than liquid water",
    ending:
      "Sometimes the strange result is exactly what keeps life going."
  },

  mystery: {
    title: "The Light That Appeared at Midnight",
    type: "mystery",
    baseGoal: "find out why a light appears in an empty building every night",
    conflict:
      "every obvious explanation seems to fail",
    turningPoint:
      "a new clue reveals that the light follows a precise pattern",
    resolution:
      "the final clue points toward an ordinary explanation hidden in plain sight",
    ending:
      "The mystery was never about the light. It was about what nobody noticed."
  },

  funny: {
    title: "The Meeting That Went Completely Wrong",
    type: "funny",
    baseGoal: "get through an important online meeting without embarrassing himself",
    conflict:
      "small technical mistakes keep becoming bigger problems",
    turningPoint:
      "one accidental action exposes the real source of the chaos",
    resolution:
      "everyone realizes the situation is much simpler and funnier than expected",
    ending:
      "Sometimes the best plan is simply surviving the first five minutes."
  },

  emotional: {
    title: "The Note Hidden in the Drawer",
    type: "emotional",
    baseGoal: "understand why an old handwritten note was kept for years",
    conflict:
      "the character initially thinks the note is meaningless",
    turningPoint:
      "the handwriting connects the note to a forgotten moment between two people",
    resolution:
      "the character finally understands why the note was never thrown away",
    ending:
      "Some small words stay with us much longer than we expect."
  }
};

function cleanText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

function wordCount(value) {
  return cleanText(value)
    .split(/\s+/)
    .filter(Boolean).length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getWords(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function uniqueWords(value) {
  return new Set(getWords(value));
}

function normalizeForComparison(value) {
  return getWords(value)
    .filter((word) => word.length > 3)
    .join(" ");
}

function estimateDuration(text) {
  const words = wordCount(text);
  return Number((words / TARGET_WPM) * 60);
}

function estimateSceneDuration(text) {
  const words = wordCount(text);
  return Number(clamp((words / TARGET_WPM) * 60, 1.2, 8).toFixed(2));
}

function similarityScore(a, b) {
  const A = uniqueWords(a);
  const B = uniqueWords(b);

  if (!A.size || !B.size) return 0;

  let intersection = 0;

  for (const word of A) {
    if (B.has(word)) intersection++;
  }

  const union = new Set([...A, ...B]).size;

  return union ? intersection / union : 0;
}

function hasMeaningfulOverlap(a, b, threshold = 0.72) {
  return similarityScore(a, b) >= threshold;
}

function extractJson(text) {
  const cleaned = cleanText(text);

  try {
    return JSON.parse(cleaned);
  } catch {
    // continue
  }

  const objectStart = cleaned.indexOf("{");
  const objectEnd = cleaned.lastIndexOf("}");

  if (objectStart !== -1 && objectEnd > objectStart) {
    const candidate = cleaned.slice(objectStart, objectEnd + 1);

    try {
      return JSON.parse(candidate);
    } catch {
      // continue
    }
  }

  throw new Error("AI response did not contain valid JSON.");
}

function getContentLane(laneName, variationIndex = 0) {
  const requested = String(laneName || "").trim().toLowerCase();

  const exact = BATCH_LANES.find(
    (lane) =>
      lane.name.toLowerCase() === requested ||
      lane.key.toLowerCase() === requested
  );

  if (exact) return exact;

  return BATCH_LANES[
    Math.abs(Number(variationIndex) || 0) % BATCH_LANES.length
  ];
}

function normalizeTopic(topic, lane) {
  const fallbackTopics = {
    motivation: "taking one small step when you feel stuck",
    facts: "why ice floats on water",
    mystery: "a strange light appearing at midnight",
    funny: "a simple online meeting going completely wrong",
    emotional: "an old handwritten note with unexpected meaning"
  };

  const value = cleanText(topic);

  if (value.length >= 8) {
    return value;
  }

  return fallbackTopics[lane.key] || fallbackTopics.motivation;
}

function validateTopicSpecificity(story, topic) {
  const normalizedTopic = normalizeForComparison(topic);

  if (!normalizedTopic) return true;

  const topicWords = normalizedTopic
    .split(/\s+/)
    .filter((word) => word.length > 3);

  if (!topicWords.length) return true;

  const searchable = normalizeForComparison(
    [
      story.title,
      story.hook,
      story.goal,
      story.conflict,
      story.setback,
      story.turningPoint,
      story.resolution,
      story.ending,
      ...(story.scenes || []).map(
        (scene) =>
          `${scene.narration} ${scene.action} ${scene.visualPrompt} ${scene.importantObject}`
      )
    ].join(" ")
  );

  const searchWords = new Set(searchable.split(/\s+/));

  const matches = topicWords.filter((word) => searchWords.has(word));

  return matches.length >= Math.max(1, Math.ceil(topicWords.length * 0.25));
}

function validateHook(hook) {
  const words = wordCount(hook);

  if (words < 7 || words > 28) {
    return false;
  }

  const weakPatterns = [
    "you won't believe",
    "this will change your life",
    "watch until the end",
    "number one secret",
    "craziest thing ever",
    "you need to know this"
  ];

  const lower = hook.toLowerCase();

  return !weakPatterns.some((pattern) => lower.includes(pattern));
}

function validatePayoff(story) {
  const ending = cleanText(story.ending);
  const turningPoint = cleanText(story.turningPoint);
  const resolution = cleanText(story.resolution);

  if (wordCount(ending) < 6) return false;

  if (similarityScore(ending, turningPoint) > 0.7) {
    return false;
  }

  if (similarityScore(ending, resolution) > 0.75) {
    return false;
  }

  return true;
}

function safetyCheck(text) {
  const value = cleanText(text).toLowerCase();

  const blockedPatterns = [
    "graphic gore",
    "graphic dismemberment",
    "sexual assault instructions",
    "child sexual abuse",
    "suicide instructions",
    "how to kill",
    "how to build a weapon",
    "weapon construction",
    "terrorist instructions",
    "extremist recruitment",
    "terrorist recruitment",
    "fake news presented as fact"
  ];

  const matched = blockedPatterns.find((pattern) =>
    value.includes(pattern)
  );

  if (matched) {
    return {
      safe: false,
      reason: `Blocked safety pattern: ${matched}`
    };
  }

  return {
    safe: true,
    reason: null
  };
}

function containsWeakVisualLanguage(value) {
  const text = cleanText(value).toLowerCase();

  const weakPatterns = [
    "random image",
    "generic image",
    "some picture",
    "stock image",
    "something interesting",
    "nice background",
    "beautiful background",
    "generic background",
    "person doing something",
    "a random person",
    "a random scene"
  ];

  return weakPatterns.some((pattern) => text.includes(pattern));
}

function sceneSemanticScore(scene) {
  const narration = getWords(scene.narration);
  const action = getWords(scene.action);
  const visual = getWords(scene.visualPrompt);

  const actionSet = new Set(action);
  const visualSet = new Set(visual);

  let narrationActionMatches = 0;
  let narrationVisualMatches = 0;

  for (const word of narration) {
    if (word.length < 4) continue;

    if (actionSet.has(word)) narrationActionMatches++;
    if (visualSet.has(word)) narrationVisualMatches++;
  }

  const narrationBase = Math.max(
    1,
    narration.filter((word) => word.length >= 4).length
  );

  return {
    narrationAction:
      narrationActionMatches / narrationBase,

    narrationVisual:
      narrationVisualMatches / narrationBase
  };
}

function validateSceneVisualRelationship(scene) {
  const required = [
    "narration",
    "visualPrompt",
    "action",
    "character",
    "environment",
    "importantObject",
    "emotion"
  ];

  for (const field of required) {
    if (!cleanText(scene[field])) {
      return {
        valid: false,
        reason: `Missing scene field: ${field}`
      };
    }
  }

  if (containsWeakVisualLanguage(scene.visualPrompt)) {
    return {
      valid: false,
      reason: "Weak/generic visual prompt."
    };
  }

  if (wordCount(scene.narration) < MIN_SCENE_WORDS) {
    return {
      valid: false,
      reason: "Scene narration is too short."
    };
  }

  if (wordCount(scene.narration) > MAX_SCENE_WORDS) {
    return {
      valid: false,
      reason: "Scene narration is too long."
    };
  }

  const semantic = sceneSemanticScore(scene);

  if (semantic.narrationAction < 0.05) {
    return {
      valid: false,
      reason: "Narration and physical action are weakly connected."
    };
  }

  if (semantic.narrationVisual < 0.05) {
    return {
      valid: false,
      reason: "Narration and visual prompt are weakly connected."
    };
  }

  return {
    valid: true,
    reason: null
  };
}

function normalizeScene(scene, index, topic) {
  const source = scene || {};

  const narration = cleanText(
    source.narration ||
      `The story moves forward as the character responds to ${topic}.`
  );

  const action = cleanText(
    source.action ||
      `The character takes a specific physical action connected to ${topic}.`
  );

  const character = cleanText(
    source.character || "the main character"
  );

  const environment = cleanText(
    source.environment || "the current story location"
  );

  const importantObject = cleanText(
    source.importantObject || "the object directly involved in the action"
  );

  const emotion = cleanText(
    source.emotion || "focused determination"
  );

  const visualPrompt = cleanText(
    source.visualPrompt ||
      `Vertical cinematic scene of ${character} ${action} in ${environment}, visibly interacting with ${importantObject}, showing ${emotion}, realistic lighting, natural human movement, documentary-style realism, no text, no logos.`
  );

  return {
    sceneNumber: index + 1,
    narration,
    action,
    character,
    environment,
    importantObject,
    emotion,
    visualPurpose: cleanText(
      source.visualPurpose ||
        `Show the physical event that moves the story forward in scene ${
          index + 1
        }.`
    ),
    visualPrompt,
    duration: Number(
      source.duration || estimateSceneDuration(narration)
    )
  };
}

function validateSceneProgression(scenes) {
  if (!Array.isArray(scenes) || scenes.length < MIN_SCENES) {
    return {
      valid: false,
      reason: "Not enough scenes."
    };
  }

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];

    if (Number(scene.sceneNumber) !== i + 1) {
      return {
        valid: false,
        reason: `Scene numbering is not sequential at scene ${i + 1}.`
      };
    }

    if (i === 0) continue;

    const previous = scenes[i - 1];

    const narrationSimilarity = similarityScore(
      previous.narration,
      scene.narration
    );

    const actionSimilarity = similarityScore(
      previous.action,
      scene.action
    );

    const visualSimilarity = similarityScore(
      previous.visualPrompt,
      scene.visualPrompt
    );

    if (
      narrationSimilarity > 0.82 &&
      actionSimilarity > 0.8
    ) {
      return {
        valid: false,
        reason: `Scene ${i} and scene ${i + 1} are too similar.`
      };
    }

    if (visualSimilarity > 0.88) {
      return {
        valid: false,
        reason: `Visual prompts for scene ${i} and scene ${
          i + 1
        } are too similar.`
      };
    }
  }

  const uniqueActions = new Set(
    scenes.map((scene) =>
      normalizeForComparison(scene.action)
    )
  );

  if (uniqueActions.size < Math.ceil(scenes.length * 0.75)) {
    return {
      valid: false,
      reason: "Too many scenes reuse the same action."
    };
  }

  const uniqueVisuals = new Set(
    scenes.map((scene) =>
      normalizeForComparison(scene.visualPrompt)
    )
  );

  if (uniqueVisuals.size < Math.ceil(scenes.length * 0.75)) {
    return {
      valid: false,
      reason: "Too many scenes reuse the same visual concept."
    };
  }

  return {
    valid: true,
    reason: null
  };
}

function normalizeStory(rawStory, topic, lane) {
  const source = rawStory || {};

  const rawScenes = Array.isArray(source.scenes)
    ? source.scenes
    : [];

  const scenes = rawScenes
    .slice(0, MAX_SCENES)
    .map((scene, index) =>
      normalizeScene(scene, index, topic)
    );

  const narration = cleanText(
    source.narration ||
      scenes.map((scene) => scene.narration).join(" ")
  );

  const story = {
    title: cleanText(
      source.title || `${lane.name}: ${topic}`
    ),

    lane: lane.name,
    laneKey: lane.key,

    topic: cleanText(topic),

    hook: cleanText(
      source.hook ||
        `What happens when one small decision changes the entire situation?`
    ),

    character: cleanText(
      source.character || "a determined main character"
    ),

    goal: cleanText(
      source.goal ||
        `The character wants to make progress with ${topic}.`
    ),

    conflict: cleanText(
      source.conflict ||
        `An unexpected problem makes progress harder.`
    ),

    setback: cleanText(
      source.setback ||
        `The first attempt fails and forces the character to change approach.`
    ),

    turningPoint: cleanText(
      source.turningPoint ||
        `The character notices one important detail and changes direction.`
    ),

    resolution: cleanText(
      source.resolution ||
        `The new approach solves the central problem.`
    ),

    ending: cleanText(
      source.ending ||
        `The final lesson becomes clear through what happened.`
    ),

    narration,

    scenes,

    duration: estimateDuration(narration),

    aiDisclosureRecommended:
      Boolean(source.aiDisclosureRecommended ?? true),

    safety: source.safety || {
      status: "pending"
    },

    qualityFlags: Array.isArray(source.qualityFlags)
      ? source.qualityFlags
      : []
  };

  story.duration = Number(
    clamp(
      story.duration,
      MIN_DURATION,
      MAX_DURATION
    ).toFixed(2)
  );

  return story;
}

function validateStory(
  story,
  topic,
  lane,
  previousConcepts = []
) {
  const errors = [];

  if (!story) {
    return {
      valid: false,
      errors: ["Story is empty."]
    };
  }

  const requiredFields = [
    "title",
    "hook",
    "character",
    "goal",
    "conflict",
    "setback",
    "turningPoint",
    "resolution",
    "ending",
    "narration"
  ];

  for (const field of requiredFields) {
    if (!cleanText(story[field])) {
      errors.push(`Missing field: ${field}`);
    }
  }

  if (
    !Array.isArray(story.scenes) ||
    story.scenes.length < MIN_SCENES ||
    story.scenes.length > MAX_SCENES
  ) {
    errors.push(
      `Scene count must be ${MIN_SCENES}-${MAX_SCENES}.`
    );
  }

  const narrationWords = wordCount(story.narration);

  if (
    narrationWords < MIN_NARRATION_WORDS ||
    narrationWords > MAX_NARRATION_WORDS
  ) {
    errors.push(
      `Narration word count ${narrationWords} is outside ${MIN_NARRATION_WORDS}-${MAX_NARRATION_WORDS}.`
    );
  }

  const duration = estimateDuration(story.narration);

  if (
    duration < MIN_DURATION ||
    duration > MAX_DURATION
  ) {
    errors.push(
      `Estimated duration ${duration.toFixed(
        1
      )}s is outside ${MIN_DURATION}-${MAX_DURATION}s.`
    );
  }

  if (!validateHook(story.hook)) {
    errors.push("Hook is weak or outside allowed length.");
  }

  if (!validatePayoff(story)) {
    errors.push("Ending/payoff is weak or repetitive.");
  }

  if (!validateTopicSpecificity(story, topic)) {
    errors.push(
      "Story does not sufficiently stay connected to the requested topic."
    );
  }

  const allStoryText = [
    story.title,
    story.hook,
    story.goal,
    story.conflict,
    story.setback,
    story.turningPoint,
    story.resolution,
    story.ending,
    story.narration
  ].join(" ");

  const safety = safetyCheck(allStoryText);

  if (!safety.safe) {
    errors.push(safety.reason);
  }

  for (const scene of story.scenes || []) {
    const sceneResult =
      validateSceneVisualRelationship(scene);

    if (!sceneResult.valid) {
      errors.push(
        `Scene ${scene.sceneNumber}: ${sceneResult.reason}`
      );
    }
  }

  const progression =
    validateSceneProgression(story.scenes);

  if (!progression.valid) {
    errors.push(progression.reason);
  }

  if (
    hasMeaningfulOverlap(
      story.hook,
      story.ending,
      0.82
    )
  ) {
    errors.push(
      "Hook and ending are too similar."
    );
  }

  for (const previous of previousConcepts) {
    const previousText =
      typeof previous === "string"
        ? previous
        : [
            previous.title,
            previous.hook,
            previous.goal,
            previous.conflict
          ].join(" ");

    const currentText = [
      story.title,
      story.hook,
      story.goal,
      story.conflict
    ].join(" ");

    if (similarityScore(currentText, previousText) > 0.72) {
      errors.push(
        "Story concept is too similar to a previous batch story."
      );
      break;
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function buildFallbackStory(topic, lane) {
  const base =
    FALLBACK_STORIES[lane.key] ||
    FALLBACK_STORIES.motivation;

  const topicText = cleanText(topic);

  const commonScenes = [
    {
      narration: `At first, the character faces a simple situation involving ${topicText}.`,
      action: `The character examines the situation and identifies the first important detail.`,
      environment: "a realistic everyday location",
      importantObject: "the object directly connected to the situation",
      emotion: "curiosity",
      visualPurpose: "Establish the character, location and central problem."
    },

    {
      narration: `Instead of ignoring the problem, the character decides to investigate what is actually happening.`,
      action: `The character moves closer and examines the important object from another angle.`,
      environment: "the same location from a closer viewpoint",
      importantObject: "the same important object",
      emotion: "focused attention",
      visualPurpose: "Move physically closer to the central problem."
    },

    {
      narration: `The first attempt does not work, creating a new obstacle that was not obvious at the beginning.`,
      action: `The character tries one practical solution, then stops when the result is different from expected.`,
      environment: "the problem area after the failed attempt",
      importantObject: "the object involved in the failed attempt",
      emotion: "frustration",
      visualPurpose: "Show the setback through a visible physical event."
    },

    {
      narration: `A small detail suddenly changes how the character understands the situation.`,
      action: `The character notices a previously overlooked detail and physically checks it.`,
      environment: "a closer section of the story location",
      importantObject: "the newly discovered detail",
      emotion: "surprise",
      visualPurpose: "Create the turning point with a visible discovery."
    },

    {
      narration: `With the new information, the character changes approach and finally makes meaningful progress.`,
      action: `The character uses the newly discovered information to take a different physical action.`,
      environment: "the main location after the discovery",
      importantObject: "the newly discovered object or clue",
      emotion: "determination",
      visualPurpose: "Show the new approach solving the central obstacle."
    },

    {
      narration: `The final result makes the original situation suddenly make sense.`,
      action: `The character steps back, sees the completed result and reacts to what it means.`,
      environment: "the completed story location",
      importantObject: "the object that explains the outcome",
      emotion: "relief",
      visualPurpose: "Deliver the resolution and emotional payoff."
    },

    {
      narration: `What looked like a small problem at the beginning turns into a useful lesson.`,
      action: `The character leaves the situation with a calm final reaction.`,
      environment: "the location after the problem is resolved",
      importantObject: "the meaningful object from the story",
      emotion: "quiet satisfaction",
      visualPurpose: "Show the consequence and transition toward the ending."
    },

    {
      narration: `The lesson is simple: the smallest detail can change the way we understand the whole story.`,
      action: `The character pauses and looks back at the resolved situation before leaving.`,
      environment: "a calm final view of the location",
      importantObject: "the final meaningful object",
      emotion: "reflection",
      visualPurpose: "Close the story with a distinct final visual."
    }
  ];

  const scenes = commonScenes.map((scene, index) => {
    const character = "the main character";

    return {
      sceneNumber: index + 1,
      narration: cleanText(scene.narration),
      action: cleanText(scene.action),
      character,
      environment: cleanText(scene.environment),
      importantObject: cleanText(scene.importantObject),
      emotion: cleanText(scene.emotion),
      visualPurpose: cleanText(scene.visualPurpose),
      visualPrompt: cleanText(
        `Vertical cinematic realistic scene showing ${character} ${scene.action.toLowerCase()} in ${scene.environment}, visibly interacting with ${scene.importantObject}, expression showing ${scene.emotion}, natural body movement, realistic lighting, detailed environment, documentary-style realism, no text, no logos.`
      ),
      duration: estimateSceneDuration(scene.narration)
    };
  });

  const narration = scenes
    .map((scene) => scene.narration)
    .join(" ");

  const story = {
    title:
      lane.key === "facts"
        ? `${base.title}: ${topicText}`
        : `${base.title}: ${topicText}`,

    lane: lane.name,
    laneKey: lane.key,
    topic: topicText,

    hook:
      lane.key === "facts"
        ? `Why does ${topicText} behave in such a surprising way?`
        : `What happens when ${topicText} creates a problem nobody expected?`,

    character: "a relatable main character",

    goal: `${base.baseGoal} while dealing with ${topicText}.`,

    conflict:
      `${base.conflict}, making the situation harder than it first appears.`,

    setback:
      `The first attempt fails, forcing the character to reconsider what is really happening.`,

    turningPoint:
      `${base.turningPoint}, revealing the detail that changes the direction of the story.`,

    resolution:
      `${base.resolution}, giving the character a clear answer to the original problem.`,

    ending: base.ending,

    narration,

    scenes,

    duration: estimateDuration(narration),

    aiDisclosureRecommended: true,

    safety: {
      status: "passed"
    },

    qualityFlags: [
      "fallback_story",
      "requires_visual_semantic_check"
    ]
  };

  return normalizeStory(story, topicText, lane);
}

function buildPrompt({
  topic,
  lane,
  variationIndex = 0,
  previousConcepts = []
}) {
  const previousText = previousConcepts.length
    ? previousConcepts
        .slice(-5)
        .map((item, index) => {
          const text =
            typeof item === "string"
              ? item
              : [
                  item.title,
                  item.hook,
                  item.goal
                ].join(" ");

          return `${index + 1}. ${cleanText(text)}`;
        })
        .join("\n")
    : "None.";

  return `
You are the professional story engine for an English-first YouTube Shorts production system.

Create ONE original short-form story.

CONTENT LANE:
${lane.name}

LANE REQUIREMENT:
${lane.instruction}

TOPIC:
${topic}

BATCH VARIATION INDEX:
${variationIndex}

TARGET AUDIENCE:
US / UK / Europe.

LANGUAGE:
Natural modern English.
Do NOT write Hindi.
Do NOT use unnatural translated-English phrasing.
Do NOT use fake viral language.

STRICT VIDEO LENGTH:
${MIN_DURATION}-${MAX_DURATION} seconds.

NARRATION:
${MIN_NARRATION_WORDS}-${MAX_NARRATION_WORDS} words.
Target approximately ${TARGET_WPM} words per minute.

STORY REQUIREMENTS:

1. The first line must create a real curiosity gap.
2. The story must have a clear beginning, middle and ending.
3. There must be one identifiable main character.
4. The character must have a clear goal.
5. There must be a concrete conflict.
6. There must be a real setback.
7. There must be a visible turning point.
8. There must be a resolution.
9. The ending must provide a payoff or meaningful final thought.
10. Do not end suddenly.
11. Do not pad the narration just to reach the word count.
12. Every scene must physically move the story forward.
13. Every scene must show a different physical event.
14. Do not reuse the same action across multiple scenes.
15. Do not reuse the same visual composition across multiple scenes.
16. Keep the same main character visually consistent.
17. Keep important objects logically consistent.
18. The visual prompt must show the actual action described by the narration.
19. Avoid abstract visuals when a physical visual can be shown.
20. Avoid generic stock-photo descriptions.
21. Avoid "person doing something" type prompts.
22. Each scene needs a clear environment.
23. Each scene needs an important object when relevant.
24. Each scene needs an emotion.
25. Each scene needs a visual purpose.
26. The final scene must feel like an ending, not another setup scene.

SCENE COUNT:
${MIN_SCENES}-${MAX_SCENES} scenes.

IMPORTANT:
The total narration duration must remain inside ${MIN_DURATION}-${MAX_DURATION} seconds.

For every scene:
- narration = exact spoken content for that scene
- action = exact physical event happening
- character = who performs the action
- environment = where it happens
- importantObject = key visible object
- emotion = visible emotional state
- visualPurpose = why this scene exists
- visualPrompt = detailed vertical-video visual instruction

SCENE DIVERSITY:
Scene 1 should establish.
Scene 2 should develop.
Scene 3 should create an obstacle.
Scene 4 should reveal new information.
Scene 5 should change the approach.
Scene 6 should resolve.
Additional scenes must add genuinely new information or action.

DO NOT create scenes like:
- "the person keeps walking"
- "the person looks around"
- "the person continues"
unless that action has a new story purpose.

FACTS:
If the lane is Interesting Facts, factual claims must be accurate and commonly verifiable.
Do not invent scientific facts.

MYSTERY:
If the lane is Mystery, fictional mysteries are allowed, but do not present fictional events as verified real-world crimes or evidence.

SAFETY:
No graphic violence.
No sexual abuse content.
No suicide instructions.
No weapon-building instructions.
No terrorist/extremist recruitment or instructions.
No deceptive fake-news presentation.

ORIGINALITY:
Do not imitate a known creator's script.
Do not copy a famous story.
Do not reuse the previous concepts below.

PREVIOUS CONCEPTS:
${previousText}

Return JSON only.

Required JSON structure:

{
  "title": "",
  "hook": "",
  "character": "",
  "goal": "",
  "conflict": "",
  "setback": "",
  "turningPoint": "",
  "resolution": "",
  "ending": "",
  "narration": "",
  "aiDisclosureRecommended": true,
  "scenes": [
    {
      "sceneNumber": 1,
      "narration": "",
      "action": "",
      "character": "",
      "environment": "",
      "importantObject": "",
      "emotion": "",
      "visualPurpose": "",
      "visualPrompt": "",
      "duration": 0
    }
  ]
}

FINAL CHECK BEFORE RETURNING JSON:
- Correct lane
- Topic clearly represented
- Natural English
- Strong hook
- Complete story
- 6-10 scenes
- Every scene different
- No repeated physical action
- No generic visual prompts
- Character continuity
- Object continuity
- Narration matches visuals
- 20-59 second total
- Safe
- Original
`;
}

async function generateWithGemini({
  topic,
  lane,
  variationIndex,
  previousConcepts
}) {
  if (!config?.geminiApiKey) {
    throw new Error("Gemini API key is missing.");
  }

  const ai = new GoogleGenAI({
    apiKey: config.geminiApiKey
  });

  const prompt = buildPrompt({
    topic,
    lane,
    variationIndex,
    previousConcepts
  });

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      temperature: 0.9,
      responseMimeType: "application/json"
    }
  });

  const text =
    response?.text ||
    response?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("") ||
    "";

  if (!text.trim()) {
    throw new Error("Gemini returned an empty response.");
  }

  return extractJson(text);
}

export async function generateScript({
  topic,
  laneName,
  variationIndex = 0,
  previousConcepts = []
} = {}) {
  const lane = getContentLane(
    laneName,
    variationIndex
  );

  const normalizedTopic = normalizeTopic(
    topic,
    lane
  );

  console.log(
    `[ScriptEngine] Lane: ${lane.name}`
  );

  console.log(
    `[ScriptEngine] Topic: ${normalizedTopic}`
  );

  console.log(
    `[ScriptEngine] Target duration: ${MIN_DURATION}-${MAX_DURATION}s`
  );

  let story;
  let generatedBy = "fallback";

  try {
    const generated =
      await generateWithGemini({
        topic: normalizedTopic,
        lane,
        variationIndex,
        previousConcepts
      });

    story = normalizeStory(
      generated,
      normalizedTopic,
      lane
    );

    const validation = validateStory(
      story,
      normalizedTopic,
      lane,
      previousConcepts
    );

    if (!validation.valid) {
      console.warn(
        "[ScriptEngine] Gemini story rejected:"
      );

      console.warn(
        validation.errors.join(" | ")
      );

      story = buildFallbackStory(
        normalizedTopic,
        lane
      );

      generatedBy = "fallback_after_validation";
    } else {
      generatedBy = "gemini";
    }
  } catch (error) {
    console.warn(
      `[ScriptEngine] Gemini generation failed: ${error.message}`
    );

    story = buildFallbackStory(
      normalizedTopic,
      lane
    );

    generatedBy = "fallback_after_error";
  }

  story = normalizeStory(
    story,
    normalizedTopic,
    lane
  );

  const finalValidation = validateStory(
    story,
    normalizedTopic,
    lane,
    previousConcepts
  );

  if (!finalValidation.valid) {
    console.warn(
      "[ScriptEngine] Final validation failed:"
    );

    console.warn(
      finalValidation.errors.join(" | ")
    );

    throw new Error(
      `Script quality gate failed: ${finalValidation.errors.join(
        " | "
      )}`
    );
  }

  const finalDuration = estimateDuration(
    story.narration
  );

  if (
    finalDuration < MIN_DURATION ||
    finalDuration > MAX_DURATION
  ) {
    throw new Error(
      `Final story duration ${finalDuration.toFixed(
        1
      )}s is outside ${MIN_DURATION}-${MAX_DURATION}s.`
    );
  }

  story.duration = Number(
    finalDuration.toFixed(2)
  );

  story.generatedBy = generatedBy;
  story.model =
    generatedBy === "gemini"
      ? MODEL
      : "fallback";

  story.validated = true;

  story.validation = {
    status: "PASS",
    duration: story.duration,
    sceneCount: story.scenes.length,
    narrationWords: wordCount(
      story.narration
    ),
    generatedBy
  };

  return story;
}

export function validateGeneratedScript(
  story,
  topic,
  laneName = "Motivation",
  previousConcepts = []
) {
  const lane = getContentLane(
    laneName
  );

  const normalizedTopic = normalizeTopic(
    topic,
    lane
  );

  const normalized = normalizeStory(
    story,
    normalizedTopic,
    lane
  );

  const result = validateStory(
    normalized,
    normalizedTopic,
    lane,
    previousConcepts
  );

  return {
    ...result,
    story: normalized
  };
}

export {
  BATCH_LANES,
  FALLBACK_STORIES,
  estimateDuration,
  estimateSceneDuration,
  similarityScore,
  safetyCheck,
  validateHook,
  validatePayoff,
  validateSceneVisualRelationship,
  validateSceneProgression,
  validateStory,
  normalizeStory,
  normalizeScene,
  buildFallbackStory
};

export default {
  generateScript,
  validateGeneratedScript,
  validateStory,
  normalizeStory,
  normalizeScene,
  buildFallbackStory,
  validateSceneProgression
};