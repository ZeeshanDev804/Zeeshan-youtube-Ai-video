
import fs from 'fs';
import path from 'path';

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

const RISK_PATTERNS = [
  {
    type: 'sensitive_content',
    pattern:
      /\b(gore|graphic violence|self harm|suicide|sexual assault|child abuse)\b/i
  },
  {
    type: 'misleading_ai',
    pattern:
      /\b(real footage|actual footage|breaking footage|real person saying)\b/i
  },
  {
    type: 'copyright_risk',
    pattern:
      /\b(reupload|movie clip|tv clip|copyrighted clip|exact recreation)\b/i
  }
];

function text(value) {
  return String(value ?? '').trim();
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

  for (const field of REQUIRED_STORY_FIELDS) {
    if (!text(story[field])) {
      addIssue(
        report,
        'story_structure',
        `Missing story element: ${field}`,
        'high'
      );
    }
  }

  if (!Array.isArray(story.scenes)) {
    addIssue(
      report,
      'scene_structure',
      'Story scenes array is missing.',
      'high'
    );

    return;
  }

  if (story.scenes.length < 6) {
    addIssue(
      report,
      'scene_structure',
      'Story has fewer than 6 scenes.',
      'high'
    );
  }

  for (
    let index = 0;
    index < story.scenes.length;
    index += 1
  ) {
    const scene = story.scenes[index];

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

    if (!text(scene.narration)) {
      addIssue(
        report,
        'narration',
        `Scene ${index + 1} has no narration.`,
        'high'
      );
    }

    if (!text(scene.visualPrompt)) {
      addIssue(
        report,
        'visual_prompt',
        `Scene ${index + 1} has no visual prompt.`,
        'high'
      );
    }

    if (!text(scene.character)) {
      addIssue(
        report,
        'character_continuity',
        `Scene ${index + 1} has no character description.`,
        'medium'
      );
    }

    if (!text(scene.environment)) {
      addIssue(
        report,
        'environment_continuity',
        `Scene ${index + 1} has no environment description.`,
        'medium'
      );
    }

    if (!text(scene.action)) {
      addIssue(
        report,
        'action_match',
        `Scene ${index + 1} has no action description.`,
        'medium'
      );
    }
  }
}

function checkNarrationCoverage(
  story,
  report
) {
  if (!Array.isArray(story?.scenes)) {
    return;
  }

  const emptyScenes = story.scenes.filter(
    scene => !text(scene?.narration)
  );

  if (emptyScenes.length > 0) {
    addIssue(
      report,
      'narration_coverage',
      `${emptyScenes.length} scene(s) have missing narration.`,
      'high'
    );
  }

  const totalWords = story.scenes.reduce(
    (total, scene) => {
      const narration = text(scene?.narration);

      return (
        total +
        narration.split(/\s+/).filter(Boolean).length
      );
    },
    0
  );

  if (totalWords < 45) {
    addIssue(
      report,
      'narration_too_short',
      `Total scene narration is only ${totalWords} words.`,
      'medium'
    );
  }

  report.metrics.narrationWords = totalWords;
}

function checkVisualContinuity(
  story,
  report
) {
  if (!Array.isArray(story?.scenes)) {
    return;
  }

  const characters = story.scenes
    .map(scene => text(scene?.character))
    .filter(Boolean);

  const environments = story.scenes
    .map(scene => text(scene?.environment))
    .filter(Boolean);

  report.metrics.characterDescriptions =
    characters.length;

  report.metrics.environmentDescriptions =
    environments.length;

  if (characters.length !== story.scenes.length) {
    addIssue(
      report,
      'character_continuity',
      'Character continuity information is incomplete.',
      'medium'
    );
  }

  if (environments.length !== story.scenes.length) {
    addIssue(
      report,
      'environment_continuity',
      'Environment continuity information is incomplete.',
      'medium'
    );
  }
}

function checkRiskPatterns(
  story,
  report
) {
  const scenes = Array.isArray(story?.scenes)
    ? story.scenes
    : [];

  const combinedText = [
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
    ...scenes.flatMap(scene => [
      scene?.narration,
      scene?.visualPrompt,
      scene?.action,
      scene?.emotion
    ])
  ]
    .map(text)
    .filter(Boolean)
    .join(' ');

  for (const risk of RISK_PATTERNS) {
    if (risk.pattern.test(combinedText)) {
      addIssue(
        report,
        risk.type,
        `Potential ${risk.type.replaceAll('_', ' ')} detected. Manual review required.`,
        'high'
      );
    }
  }
}

function checkRepetition(
  story,
  report
) {
  if (!Array.isArray(story?.scenes)) {
    return;
  }

  const prompts = story.scenes
    .map(scene =>
      text(scene?.visualPrompt).toLowerCase()
    )
    .filter(Boolean);

  const uniquePrompts = new Set(prompts);

  report.metrics.uniqueVisualPrompts =
    uniquePrompts.size;

  if (
    prompts.length >= 6 &&
    uniquePrompts.size / prompts.length < 0.6
  ) {
    addIssue(
      report,
      'repetitive_visuals',
      'Visual prompts are highly repetitive. Review for mass-produced/repetitive content risk.',
      'medium'
    );
  }

  const narrations = story.scenes
    .map(scene =>
      text(scene?.narration).toLowerCase()
    )
    .filter(Boolean);

  const uniqueNarrations = new Set(narrations);

  report.metrics.uniqueNarrations =
    uniqueNarrations.size;

  if (
    narrations.length >= 6 &&
    uniqueNarrations.size / narrations.length < 0.7
  ) {
    addIssue(
      report,
      'repetitive_narration',
      'Narration contains repeated scene text.',
      'medium'
    );
  }
}

function checkMedia(
  mediaInfo,
  report
) {
  if (!mediaInfo || typeof mediaInfo !== 'object') {
    addIssue(
      report,
      'media_missing',
      'Final media information is missing or invalid.',
      'high'
    );

    return;
  }

  const width = Number(
    mediaInfo.width ||
    mediaInfo.video?.width ||
    0
  );

  const height = Number(
    mediaInfo.height ||
    mediaInfo.video?.height ||
    0
  );

  const duration = Number(
    mediaInfo.duration ||
    mediaInfo.format?.duration ||
    0
  );

  const hasVideo =
    mediaInfo.hasVideo === true ||
    Boolean(mediaInfo.video) ||
    width > 0;

  const hasAudio =
    mediaInfo.hasAudio === true ||
    Boolean(mediaInfo.audio);

  report.metrics.width = width;
  report.metrics.height = height;
  report.metrics.duration = duration;

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

  if (width !== 1080 || height !== 1920) {
    addIssue(
      report,
      'resolution',
      `Expected 1080x1920 but received ${width}x${height}.`,
      'high'
    );
  }

  if (
    !Number.isFinite(duration) ||
    duration < 20 ||
    duration > 59
  ) {
    addIssue(
      report,
      'duration',
      `Final duration ${Number.isFinite(duration) ? duration.toFixed(2) : 'invalid'}s is outside the 20-59 second range.`,
      'high'
    );
  }
}

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

  const hasExternalSource = sourceFields.some(
    value => text(value)
  );

  if (hasExternalSource) {
    addIssue(
      report,
      'source_review',
      'External source information is present. Verify originality and transformation before publishing.',
      'medium'
    );
  }
}

export function runQualityCheck({
  story,
  mediaInfo = null
} = {}) {
  const report = {
    passed: true,
    reviewRequired: false,
    blocked: false,
    issues: [],
    metrics: {},
    checks: {
      storyStructure: false,
      narrationCoverage: false,
      visualContinuity: false,
      repetitionRisk: false,
      originalityRisk: false,
      mediaQuality: false,
      safetyRisk: false
    },
    generatedAt: new Date().toISOString()
  };

  checkStoryStructure(
    story,
    report
  );

  report.checks.storyStructure =
    !report.issues.some(
      issue =>
        issue.type === 'story_structure' ||
        issue.type === 'scene_structure' ||
        issue.type === 'story_missing'
    );

  checkNarrationCoverage(
    story,
    report
  );

  report.checks.narrationCoverage =
    !report.issues.some(
      issue =>
        issue.type === 'narration' ||
        issue.type === 'narration_coverage' ||
        issue.type === 'narration_too_short'
    );

  checkVisualContinuity(
    story,
    report
  );

  report.checks.visualContinuity =
    !report.issues.some(
      issue =>
        issue.type === 'character_continuity' ||
        issue.type === 'environment_continuity'
    );

  checkRepetition(
    story,
    report
  );

  report.checks.repetitionRisk =
    !report.issues.some(
      issue =>
        issue.type === 'repetitive_visuals' ||
        issue.type === 'repetitive_narration'
    );

  checkOriginalityMetadata(
    story,
    report
  );

  checkRiskPatterns(
    story,
    report
  );

  // Calculate originality after all relevant risks
  // have been collected.
  report.checks.originalityRisk =
    !report.issues.some(
      issue =>
        issue.type === 'copyright_risk' ||
        issue.type === 'source_review'
    );

  report.checks.safetyRisk =
    !report.issues.some(
      issue =>
        issue.type === 'sensitive_content' ||
        issue.type === 'misleading_ai'
    );

  checkMedia(
    mediaInfo,
    report
  );

  report.checks.mediaQuality =
    !report.issues.some(
      issue =>
        issue.type === 'media_missing' ||
        issue.type === 'video_stream' ||
        issue.type === 'audio_stream' ||
        issue.type === 'resolution' ||
        issue.type === 'duration'
    );

  const highRiskIssues = report.issues.filter(
    issue => issue.severity === 'high'
  );

  const mediumRiskIssues = report.issues.filter(
    issue => issue.severity === 'medium'
  );

  report.blocked =
    highRiskIssues.length > 0;

  report.reviewRequired =
    mediumRiskIssues.length > 0;

  report.passed =
    !report.blocked &&
    !report.reviewRequired;

  return report;
}

export function saveQualityReport(
  report,
  outputPath
) {
  if (!report || !outputPath) {
    throw new Error(
      'Quality report and output path are required.'
    );
  }

  fs.mkdirSync(
    path.dirname(outputPath),
    {
      recursive: true
    }
  );

  fs.writeFileSync(
    outputPath,
    JSON.stringify(report, null, 2),
    'utf8'
  );

  return outputPath;
}

export default {
  runQualityCheck,
  saveQualityReport
};
