import fs from 'fs';
import path from 'path';

import { config } from '../config/index.mjs';

// ---------------------------------------------------------
// CONFIGURATION
// ---------------------------------------------------------

const VIDEO_CONFIG = config?.videoConfig || {};
const QUALITY_CONFIG = config?.qualityConfig || {};

const MIN_SCENES = Number(
  QUALITY_CONFIG.minScenes ??
    config?.scriptConfig?.minScenes ??
    6
);

const MAX_SCENES = Number(
  QUALITY_CONFIG.maxScenes ??
    config?.scriptConfig?.maxScenes ??
    10
);

const MIN_DURATION = Number(
  VIDEO_CONFIG.minDuration ??
    QUALITY_CONFIG.minDuration ??
    20
);

const MAX_DURATION = Number(
  VIDEO_CONFIG.maxDuration ??
    QUALITY_CONFIG.maxDuration ??
    59
);

const REQUIRED_WIDTH = Number(
  VIDEO_CONFIG.width ?? 1080
);

const REQUIRED_HEIGHT = Number(
  VIDEO_CONFIG.height ?? 1920
);

const MIN_NARRATION_WORDS = Number(
  QUALITY_CONFIG.minNarrationWords ?? 45
);

const MIN_UNIQUE_VISUAL_RATIO = Number(
  QUALITY_CONFIG.minUniqueVisualRatio ?? 0.60
);

const MIN_UNIQUE_NARRATION_RATIO = Number(
  QUALITY_CONFIG.minUniqueNarrationRatio ?? 0.70
);

// ---------------------------------------------------------
// REQUIRED STORY STRUCTURE
// ---------------------------------------------------------

const REQUIRED_STORY_FIELDS = [
  'hook',
  'character',
  'goal',
  'conflict',
  'setback',
  'turningPoint',
  'resolution',
  'ending'
];

const REQUIRED_SCENE_FIELDS = [
  'narration',
  'visualPrompt',
  'character',
  'environment',
  'action'
];

// ---------------------------------------------------------
// RISK PATTERNS
// ---------------------------------------------------------

const RISK_PATTERNS = [
  {
    type: 'sensitive_content',
    severity: 'high',
    pattern:
      /\b(gore|graphic violence|self[-\s]?harm|suicide|sexual assault|child abuse|extreme torture)\b/i
  },

  {
    type: 'misleading_ai',
    severity: 'high',
    pattern:
      /\b(real footage|actual footage|breaking footage|real person saying|real recording|authentic leaked footage)\b/i
  },

  {
    type: 'copyright_risk',
    severity: 'high',
    pattern:
      /\b(reupload|movie clip|tv clip|copyrighted clip|exact recreation|full movie|full episode)\b/i
  }
];

// ---------------------------------------------------------
// UTILITY
// ---------------------------------------------------------

function text(value) {
  return String(value ?? '').trim();
}

function normalizeText(value) {
  return text(value)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim();
}

function wordCount(value) {
  const valueText = text(value);

  if (!valueText) {
    return 0;
  }

  return valueText
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function addIssue(
  report,
  type,
  message,
  severity = 'medium'
) {
  report.issues.push({
    type,
    severity,
    message
  });
}

function hasIssueType(
  report,
  types
) {
  const typeSet = new Set(types);

  return report.issues.some(
    issue => typeSet.has(issue.type)
  );
}

function safeNumber(
  value,
  fallback = 0
) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

// ---------------------------------------------------------
// STORY STRUCTURE
// ---------------------------------------------------------

function checkStoryStructure(
  story,
  report
) {
  if (
    !story ||
    typeof story !== 'object' ||
    Array.isArray(story)
  ) {
    addIssue(
      report,
      'story_missing',
      'Story object is missing or invalid.',
      'high'
    );

    return;
  }

  for (
    const field of REQUIRED_STORY_FIELDS
  ) {
    if (!text(story[field])) {
      addIssue(
        report,
        'story_structure',
        `Missing story element: ${field}.`,
        'high'
      );
    }
  }

  if (!Array.isArray(story.scenes)) {
    addIssue(
      report,
      'scene_structure',
      'Story scenes array is missing or invalid.',
      'high'
    );

    return;
  }

  report.metrics.sceneCount =
    story.scenes.length;

  if (
    story.scenes.length < MIN_SCENES
  ) {
    addIssue(
      report,
      'scene_structure',
      `Story has ${story.scenes.length} scenes. Minimum is ${MIN_SCENES}.`,
      'high'
    );
  }

  if (
    story.scenes.length > MAX_SCENES
  ) {
    addIssue(
      report,
      'scene_structure',
      `Story has ${story.scenes.length} scenes. Maximum is ${MAX_SCENES}.`,
      'high'
    );
  }

  for (
    let index = 0;
    index < story.scenes.length;
    index += 1
  ) {
    const scene =
      story.scenes[index];

    if (
      !scene ||
      typeof scene !== 'object' ||
      Array.isArray(scene)
    ) {
      addIssue(
        report,
        'scene_structure',
        `Scene ${index + 1} is invalid.`,
        'high'
      );

      continue;
    }

    for (
      const field of REQUIRED_SCENE_FIELDS
    ) {
      if (!text(scene[field])) {
        const severity =
          field === 'narration' ||
          field === 'visualPrompt'
            ? 'high'
            : 'medium';

        addIssue(
          report,
          field === 'visualPrompt'
            ? 'visual_prompt'
            : field === 'narration'
              ? 'narration'
              : field === 'character'
                ? 'character_continuity'
                : field === 'environment'
                  ? 'environment_continuity'
                  : 'action_match',
          `Scene ${index + 1} has no ${field}.`,
          severity
        );
      }
    }
  }
}

// ---------------------------------------------------------
// NARRATION QUALITY
// ---------------------------------------------------------

function checkNarrationCoverage(
  story,
  report
) {
  if (!Array.isArray(story?.scenes)) {
    return;
  }

  let totalWords = 0;
  let missingNarration = 0;

  for (
    let index = 0;
    index < story.scenes.length;
    index += 1
  ) {
    const narration =
      text(
        story.scenes[index]?.narration
      );

    const words =
      wordCount(narration);

    totalWords += words;

    if (!narration) {
      missingNarration += 1;

      continue;
    }

    if (words < 3) {
      addIssue(
        report,
        'weak_narration',
        `Scene ${index + 1} narration is unusually short.`,
        'medium'
      );
    }
  }

  report.metrics.narrationWords =
    totalWords;

  report.metrics.averageNarrationWords =
    story.scenes.length > 0
      ? Number(
          (
            totalWords /
            story.scenes.length
          ).toFixed(2)
        )
      : 0;

  if (missingNarration > 0) {
    addIssue(
      report,
      'narration_coverage',
      `${missingNarration} scene(s) have missing narration.`,
      'high'
    );
  }

  if (
    totalWords <
    MIN_NARRATION_WORDS
  ) {
    addIssue(
      report,
      'narration_too_short',
      `Total narration is only ${totalWords} words. Minimum quality target is ${MIN_NARRATION_WORDS} words.`,
      'medium'
    );
  }
}

// ---------------------------------------------------------
// CHARACTER / ENVIRONMENT CONTINUITY
// ---------------------------------------------------------

function checkVisualContinuity(
  story,
  report
) {
  if (!Array.isArray(story?.scenes)) {
    return;
  }

  const characters =
    story.scenes
      .map(scene =>
        text(scene?.character)
      )
      .filter(Boolean);

  const environments =
    story.scenes
      .map(scene =>
        text(scene?.environment)
      )
      .filter(Boolean);

  report.metrics.characterDescriptions =
    characters.length;

  report.metrics.environmentDescriptions =
    environments.length;

  if (
    characters.length !==
    story.scenes.length
  ) {
    addIssue(
      report,
      'character_continuity',
      'Character continuity information is incomplete across scenes.',
      'medium'
    );
  }

  if (
    environments.length !==
    story.scenes.length
  ) {
    addIssue(
      report,
      'environment_continuity',
      'Environment continuity information is incomplete across scenes.',
      'medium'
    );
  }

  const normalizedCharacters =
    characters.map(normalizeText);

  const normalizedEnvironments =
    environments.map(normalizeText);

  const uniqueCharacters =
    new Set(
      normalizedCharacters.filter(Boolean)
    );

  const uniqueEnvironments =
    new Set(
      normalizedEnvironments.filter(Boolean)
    );

  report.metrics.uniqueCharacterDescriptions =
    uniqueCharacters.size;

  report.metrics.uniqueEnvironmentDescriptions =
    uniqueEnvironments.size;
}

// ---------------------------------------------------------
// VISUAL / ACTION RELATIONSHIP
// ---------------------------------------------------------

function checkSceneVisualCoverage(
  story,
  report
) {
  if (!Array.isArray(story?.scenes)) {
    return;
  }

  let weakScenes = 0;

  for (
    let index = 0;
    index < story.scenes.length;
    index += 1
  ) {
    const scene =
      story.scenes[index];

    const narration =
      normalizeText(
        scene?.narration
      );

    const visualPrompt =
      normalizeText(
        scene?.visualPrompt
      );

    const action =
      normalizeText(
        scene?.action
      );

    const importantObject =
      normalizeText(
        scene?.importantObject
      );

    if (
      !narration ||
      !visualPrompt ||
      !action
    ) {
      continue;
    }

    const actionWords =
      new Set(
        action
          .split(/\s+/)
          .filter(word =>
            word.length >= 4
          )
      );

    const narrationWords =
      new Set(
        narration
          .split(/\s+/)
          .filter(word =>
            word.length >= 4
          )
      );

    let actionOverlap = 0;

    for (
      const word of actionWords
    ) {
      if (
        narrationWords.has(word)
      ) {
        actionOverlap += 1;
      }
    }

    const actionRatio =
      actionWords.size > 0
        ? actionOverlap /
          actionWords.size
        : 0;

    const promptWords =
      new Set(
        visualPrompt
          .split(/\s+/)
          .filter(word =>
            word.length >= 4
          )
      );

    let promptOverlap = 0;

    for (
      const word of actionWords
    ) {
      if (
        promptWords.has(word)
      ) {
        promptOverlap += 1;
      }
    }

    const promptActionRatio =
      actionWords.size > 0
        ? promptOverlap /
          actionWords.size
        : 0;

    if (
      actionRatio < 0.10 &&
      promptActionRatio < 0.10
    ) {
      weakScenes += 1;

      addIssue(
        report,
        'visual_action_alignment',
        `Scene ${index + 1} has weak narration/action/visual alignment.`,
        'medium'
      );
    }

    if (
      importantObject &&
      !visualPrompt.includes(
        importantObject
      )
    ) {
      addIssue(
        report,
        'important_object_alignment',
        `Scene ${index + 1} important object is not clearly represented in the visual prompt.`,
        'medium'
      );
    }
  }

  report.metrics.weakVisualScenes =
    weakScenes;
}

// ---------------------------------------------------------
// RISK PATTERNS
// ---------------------------------------------------------

function buildStoryText(
  story
) {
  const scenes =
    Array.isArray(story?.scenes)
      ? story.scenes
      : [];

  return [
    story?.title,
    story?.hook,
    story?.character,
    story?.goal,
    story?.conflict,
    story?.setback,
    story?.turningPoint,
    story?.resolution,
    story?.ending,
    story?.narration,
    story?.topic,
    story?.category,
    story?.contentLane,
    story?.source,
    story?.sourceUrl,
    story?.originalSource,
    story?.copiedFrom,
    ...scenes.flatMap(
      scene => [
        scene?.narration,
        scene?.visualPrompt,
        scene?.character,
        scene?.environment,
        scene?.action,
        scene?.emotion,
        scene?.importantObject
      ]
    )
  ]
    .map(text)
    .filter(Boolean)
    .join(' ');
}

function checkRiskPatterns(
  story,
  report
) {
  const combinedText =
    buildStoryText(story);

  for (
    const risk of RISK_PATTERNS
  ) {
    if (
      risk.pattern.test(
        combinedText
      )
    ) {
      addIssue(
        report,
        risk.type,
        `Potential ${risk.type.replaceAll('_', ' ')} detected. Manual review required.`,
        risk.severity
      );
    }
  }
}

// ---------------------------------------------------------
// REPETITION
// ---------------------------------------------------------

function calculateUniqueRatio(
  values
) {
  const normalized =
    values
      .map(normalizeText)
      .filter(Boolean);

  if (
    normalized.length === 0
  ) {
    return 1;
  }

  return (
    new Set(normalized).size /
    normalized.length
  );
}

function checkRepetition(
  story,
  report
) {
  if (!Array.isArray(story?.scenes)) {
    return;
  }

  const prompts =
    story.scenes
      .map(scene =>
        text(scene?.visualPrompt)
      )
      .filter(Boolean);

  const narrations =
    story.scenes
      .map(scene =>
        text(scene?.narration)
      )
      .filter(Boolean);

  const actions =
    story.scenes
      .map(scene =>
        text(scene?.action)
      )
      .filter(Boolean);

  const visualRatio =
    calculateUniqueRatio(
      prompts
    );

  const narrationRatio =
    calculateUniqueRatio(
      narrations
    );

  const actionRatio =
    calculateUniqueRatio(
      actions
    );

  report.metrics.uniqueVisualPrompts =
    new Set(
      prompts.map(normalizeText)
    ).size;

  report.metrics.uniqueNarrations =
    new Set(
      narrations.map(normalizeText)
    ).size;

  report.metrics.uniqueActions =
    new Set(
      actions.map(normalizeText)
    ).size;

  report.metrics.visualUniquenessRatio =
    Number(
      visualRatio.toFixed(2)
    );

  report.metrics.narrationUniquenessRatio =
    Number(
      narrationRatio.toFixed(2)
    );

  report.metrics.actionUniquenessRatio =
    Number(
      actionRatio.toFixed(2)
    );

  if (
    prompts.length >= 6 &&
    visualRatio <
      MIN_UNIQUE_VISUAL_RATIO
  ) {
    addIssue(
      report,
      'repetitive_visuals',
      `Visual prompt uniqueness is ${(
        visualRatio * 100
      ).toFixed(
        0
      )}%. Review for repetitive or mass-produced visual patterns.`,
      'medium'
    );
  }

  if (
    narrations.length >= 6 &&
    narrationRatio <
      MIN_UNIQUE_NARRATION_RATIO
  ) {
    addIssue(
      report,
      'repetitive_narration',
      `Narration uniqueness is ${(
        narrationRatio * 100
      ).toFixed(
        0
      )}%. Review repeated scene narration.`,
      'medium'
    );
  }

  if (
    actions.length >= 6 &&
    actionRatio < 0.60
  ) {
    addIssue(
      report,
      'repetitive_actions',
      'Scene actions are highly repetitive.',
      'medium'
    );
  }
}

// ---------------------------------------------------------
// ORIGINALITY
// ---------------------------------------------------------

function checkOriginalityMetadata(
  story,
  report
) {
  const sourceFields = [
    story?.source,
    story?.sourceUrl,
    story?.originalSource,
    story?.copiedFrom
  ];

  const externalSource =
    sourceFields.some(
      value => Boolean(text(value))
    );

  report.metrics.externalSourcePresent =
    externalSource;

  if (
    externalSource
  ) {
    addIssue(
      report,
      'source_review',
      'External source information is present. Verify originality, transformation and attribution before publishing.',
      'medium'
    );
  }

  const originalityFields = [
    story?.originality,
    story?.originalityStatus,
    story?.isOriginal,
    story?.generatedBy
  ];

  const hasOriginalityMetadata =
    originalityFields.some(
      value =>
        value !== undefined &&
        value !== null &&
        text(value) !== ''
    );

  report.metrics.originalityMetadataPresent =
    hasOriginalityMetadata;

  if (
    story?.isOriginal === false
  ) {
    addIssue(
      report,
      'originality_risk',
      'Story is explicitly marked as not original.',
      'high'
    );
  }
}

// ---------------------------------------------------------
// AI DISCLOSURE
// ---------------------------------------------------------

function checkAIDisclosure(
  story,
  report
) {
  const aiGenerated =
    story?.aiGenerated === true ||
    story?.isAIGenerated === true ||
    Boolean(
      text(story?.generatedBy)
    );

  report.metrics.aiGenerated =
    aiGenerated;

  const disclosure =
    story?.aiDisclosure ??
    story?.aiGeneratedDisclosure ??
    story?.disclosure;

  report.metrics.aiDisclosurePresent =
    disclosure !== undefined &&
    disclosure !== null &&
    text(disclosure) !== '';

  if (
    aiGenerated &&
    !report.metrics.aiDisclosurePresent
  ) {
    addIssue(
      report,
      'ai_disclosure_review',
      'AI-generated content metadata is present but no explicit disclosure metadata was found. Review platform disclosure requirements before publishing.',
      'medium'
    );
  }
}

// ---------------------------------------------------------
// MEDIA QUALITY
// ---------------------------------------------------------

function checkMedia(
  mediaInfo,
  report
) {
  if (
    !mediaInfo ||
    typeof mediaInfo !== 'object'
  ) {
    addIssue(
      report,
      'media_missing',
      'Final media information is missing or invalid.',
      'high'
    );

    return;
  }

  const width =
    safeNumber(
      mediaInfo.width ??
        mediaInfo.video?.width,
      0
    );

  const height =
    safeNumber(
      mediaInfo.height ??
        mediaInfo.video?.height,
      0
    );

  const duration =
    safeNumber(
      mediaInfo.duration ??
        mediaInfo.format?.duration,
      0
    );

  const hasVideo =
    mediaInfo.hasVideo === true ||
    Boolean(mediaInfo.video) ||
    width > 0;

  const hasAudio =
    mediaInfo.hasAudio === true ||
    Boolean(mediaInfo.audio);

  report.metrics.width =
    width;

  report.metrics.height =
    height;

  report.metrics.duration =
    Number(
      duration.toFixed(2)
    );

  report.metrics.hasVideo =
    hasVideo;

  report.metrics.hasAudio =
    hasAudio;

  if (!hasVideo) {
    addIssue(
      report,
      'video_stream',
      'Final file has no video stream.',
      'high'
    );
  }

  if (!hasAudio) {
    addIssue(
      report,
      'audio_stream',
      'Final file has no narration/audio stream.',
      'high'
    );
  }

  if (
    width !== REQUIRED_WIDTH ||
    height !== REQUIRED_HEIGHT
  ) {
    addIssue(
      report,
      'resolution',
      `Expected ${REQUIRED_WIDTH}x${REQUIRED_HEIGHT} but received ${width}x${height}.`,
      'high'
    );
  }

  if (
    !Number.isFinite(duration) ||
    duration < MIN_DURATION ||
    duration > MAX_DURATION
  ) {
    addIssue(
      report,
      'duration',
      `Final duration ${
        Number.isFinite(duration)
          ? duration.toFixed(2)
          : 'invalid'
      }s is outside the ${MIN_DURATION}-${MAX_DURATION} second range.`,
      'high'
    );
  }
}

// ---------------------------------------------------------
// FINAL FILE CHECK
// ---------------------------------------------------------

function checkFinalFile(
  finalPath,
  report
) {
  if (!finalPath) {
    addIssue(
      report,
      'final_file_missing',
      'Final video path was not provided.',
      'high'
    );

    return;
  }

  try {
    if (
      !fs.existsSync(finalPath)
    ) {
      addIssue(
        report,
        'final_file_missing',
        `Final video file does not exist: ${finalPath}`,
        'high'
      );

      return;
    }

    const stats =
      fs.statSync(
        finalPath
      );

    report.metrics.finalFileSize =
      stats.size;

    if (
      !stats.isFile() ||
      stats.size <= 0
    ) {
      addIssue(
        report,
        'final_file_invalid',
        'Final video file is empty or invalid.',
        'high'
      );
    }
  } catch (error) {
    addIssue(
      report,
      'final_file_error',
      `Unable to validate final video file: ${
        error?.message ||
        String(error)
      }`,
      'high'
    );
  }
}

// ---------------------------------------------------------
// QUALITY STATUS
// ---------------------------------------------------------

function calculateStatus(
  report
) {
  const highRiskIssues =
    report.issues.filter(
      issue =>
        issue.severity === 'high'
    );

  const mediumRiskIssues =
    report.issues.filter(
      issue =>
        issue.severity === 'medium'
    );

  report.blocked =
    highRiskIssues.length > 0;

  report.reviewRequired =
    !report.blocked &&
    mediumRiskIssues.length > 0;

  report.passed =
    !report.blocked &&
    !report.reviewRequired;

  report.status =
    report.blocked
      ? 'BLOCK'
      : report.reviewRequired
        ? 'REVIEW'
        : 'PASS';

  report.metrics.highRiskIssues =
    highRiskIssues.length;

  report.metrics.mediumRiskIssues =
    mediumRiskIssues.length;

  return report.status;
}

// ---------------------------------------------------------
// MAIN QUALITY CHECK
// ---------------------------------------------------------

export function runQualityCheck({
  story,
  mediaInfo = null,
  finalPath = null
} = {}) {
  const report = {
    passed: false,
    reviewRequired: false,
    blocked: false,

    status: 'BLOCK',

    issues: [],

    metrics: {},

    checks: {
      storyStructure: false,
      narrationCoverage: false,
      visualContinuity: false,
      visualActionAlignment: false,
      repetitionRisk: false,
      originalityRisk: false,
      aiDisclosure: false,
      mediaQuality: false,
      safetyRisk: false,
      finalFile: false
    },

    generatedAt:
      new Date().toISOString()
  };

  try {
    // -----------------------------------------------------
    // STORY
    // -----------------------------------------------------

    checkStoryStructure(
      story,
      report
    );

    report.checks.storyStructure =
      !hasIssueType(
        report,
        [
          'story_missing',
          'story_structure',
          'scene_structure',
          'narration',
          'visual_prompt'
        ]
      );

    // -----------------------------------------------------
    // NARRATION
    // -----------------------------------------------------

    checkNarrationCoverage(
      story,
      report
    );

    report.checks.narrationCoverage =
      !hasIssueType(
        report,
        [
          'narration',
          'narration_coverage'
        ]
      );

    // Short narration is a quality warning,
    // not automatically a hard block.
    if (
      !hasIssueType(
        report,
        [
          'narration',
          'narration_coverage'
        ]
      )
    ) {
      report.checks.narrationCoverage =
        true;
    }

    // -----------------------------------------------------
    // VISUAL CONTINUITY
    // -----------------------------------------------------

    checkVisualContinuity(
      story,
      report
    );

    report.checks.visualContinuity =
      !hasIssueType(
        report,
        [
          'character_continuity',
          'environment_continuity'
        ]
      );

    // -----------------------------------------------------
    // VISUAL / ACTION
    // -----------------------------------------------------

    checkSceneVisualCoverage(
      story,
      report
    );

    report.checks.visualActionAlignment =
      !hasIssueType(
        report,
        [
          'visual_action_alignment',
          'important_object_alignment'
        ]
      );

    // -----------------------------------------------------
    // REPETITION
    // -----------------------------------------------------

    checkRepetition(
      story,
      report
    );

    report.checks.repetitionRisk =
      !hasIssueType(
        report,
        [
          'repetitive_visuals',
          'repetitive_narration',
          'repetitive_actions'
        ]
      );

    // -----------------------------------------------------
    // ORIGINALITY
    // -----------------------------------------------------

    checkOriginalityMetadata(
      story,
      report
    );

    report.checks.originalityRisk =
      !hasIssueType(
        report,
        [
          'copyright_risk',
          'source_review',
          'originality_risk'
        ]
      );

    // -----------------------------------------------------
    // SAFETY
    // -----------------------------------------------------

    checkRiskPatterns(
      story,
      report
    );

    report.checks.safetyRisk =
      !hasIssueType(
        report,
        [
          'sensitive_content',
          'misleading_ai',
          'copyright_risk'
        ]
      );

    // -----------------------------------------------------
    // AI DISCLOSURE
    // -----------------------------------------------------

    checkAIDisclosure(
      story,
      report
    );

    report.checks.aiDisclosure =
      !hasIssueType(
        report,
        [
          'ai_disclosure_review'
        ]
      );

    // -----------------------------------------------------
    // MEDIA
    // -----------------------------------------------------

    checkMedia(
      mediaInfo,
      report
    );

    report.checks.mediaQuality =
      !hasIssueType(
        report,
        [
          'media_missing',
          'video_stream',
          'audio_stream',
          'resolution',
          'duration'
        ]
      );

    // -----------------------------------------------------
    // FINAL FILE
    // -----------------------------------------------------

    checkFinalFile(
      finalPath,
      report
    );

    report.checks.finalFile =
      !hasIssueType(
        report,
        [
          'final_file_missing',
          'final_file_invalid',
          'final_file_error'
        ]
      );

    // -----------------------------------------------------
    // FINAL STATUS
    // -----------------------------------------------------

    calculateStatus(
      report
    );

    return report;
  } catch (error) {
    // -----------------------------------------------------
    // FAIL CLOSED
    // -----------------------------------------------------

    report.passed = false;
    report.reviewRequired = false;
    report.blocked = true;
    report.status = 'BLOCK';

    report.issues.push({
      type: 'quality_engine_error',
      severity: 'high',
      message:
        error?.message ||
        String(error)
    });

    report.metrics.qualityEngineFailed =
      true;

    return report;
  }
}

// ---------------------------------------------------------
// SAVE QUALITY REPORT
// ---------------------------------------------------------

export function saveQualityReport(
  report,
  outputPath
) {
  if (
    !report ||
    typeof report !== 'object'
  ) {
    throw new Error(
      'Valid quality report is required.'
    );
  }

  if (!outputPath) {
    throw new Error(
      'Quality report output path is required.'
    );
  }

  const directory =
    path.dirname(
      outputPath
    );

  fs.mkdirSync(
    directory,
    {
      recursive: true
    }
  );

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      report,
      null,
      2
    ),
    'utf8'
  );

  return outputPath;
}

// ---------------------------------------------------------
// DEFAULT EXPORT
// ---------------------------------------------------------

export default {
  runQualityCheck,
  saveQualityReport
};