import dotenv from 'dotenv';

dotenv.config();

/**
 * ZEESHAN AI VIDEO
 * Central Production Configuration
 *
 * IMPORTANT:
 * - Secrets are loaded from environment variables.
 * - Never hard-code API keys or OAuth secrets here.
 * - YouTube upload/publish automation is intentionally disabled.
 * - System goal: generate 5 professional Shorts for manual download/upload.
 */

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return ['true', '1', 'yes', 'on'].includes(
    String(value).trim().toLowerCase()
  );
};

const toList = (value, fallback = []) => {
  if (!value) return fallback;

  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

export const config = {
  /**
   * ============================================================
   * API KEYS
   * ============================================================
   */

  pexelsApiKey: process.env.PEXELS_API_KEY || '',

  geminiApiKey:
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    '',

  /**
   * ============================================================
   * APPLICATION
   * ============================================================
   */

  app: {
    name:
      process.env.APP_NAME ||
      'ZEESHAN AI VIDEO',

    environment:
      process.env.NODE_ENV ||
      'development',

    logLevel:
      process.env.LOG_LEVEL ||
      'info'
  },

  /**
   * ============================================================
   * PRODUCTION MODE
   * ============================================================
   *
   * The system creates videos only.
   * YouTube upload/publish is NOT part of production.
   */

  productionMode: {
    videosPerRun: toNumber(
      process.env.VIDEOS_PER_RUN,
      5
    ),

    maxVideosPerRun: 5,

    manualYouTubeUpload: true,

    automaticYouTubeUpload: false,

    automaticYouTubePublish: false
  },

  /**
   * ============================================================
   * CONTENT LANES
   * ============================================================
   *
   * Every video in a 5-video batch uses a different lane.
   */

  contentLanes: [
    'motivation',
    'facts',
    'mystery',
    'funny',
    'emotional'
  ],

  /**
   * ============================================================
   * TARGET AUDIENCE
   * ============================================================
   */

  audience: {
    primary:
      process.env.TARGET_AUDIENCE ||
      'US,UK,Europe',

    languages: toList(
      process.env.TARGET_LANGUAGES,
      [
        'en-US',
        'en-GB',
        'en'
      ]
    ),

    regions: toList(
      process.env.TARGET_REGIONS,
      [
        'US',
        'UK',
        'Europe'
      ]
    ),

    englishFirst: true,

    naturalEnglish: true,

    avoidHindi: true,

    avoidArtificialTranslationStyle: true
  },

  /**
   * ============================================================
   * VIDEO PRODUCTION
   * ============================================================
   */

  videoConfig: {
    width: 1080,

    height: 1920,

    minDuration: toNumber(
      process.env.VIDEO_MIN_DURATION,
      20
    ),

    maxDuration: toNumber(
      process.env.VIDEO_MAX_DURATION,
      59
    ),

    fps: toNumber(
      process.env.VIDEO_FPS,
      30
    ),

    codec:
      process.env.VIDEO_CODEC ||
      'libx264',

    crf: toNumber(
      process.env.VIDEO_CRF,
      21
    ),

    preset:
      process.env.VIDEO_PRESET ||
      'medium',

    pixelFormat:
      process.env.VIDEO_PIXEL_FORMAT ||
      'yuv420p',

    audioCodec:
      process.env.AUDIO_CODEC ||
      'aac',

    audioBitrate:
      process.env.AUDIO_BITRATE ||
      '192k'
  },

  /**
   * ============================================================
   * STORY / SCRIPT
   * ============================================================
   */

  scriptConfig: {
    minScenes: toNumber(
      process.env.MIN_SCENES,
      6
    ),

    maxScenes: toNumber(
      process.env.MAX_SCENES,
      10
    ),

    minWords: toNumber(
      process.env.MIN_SCRIPT_WORDS,
      65
    ),

    maxWords: toNumber(
      process.env.MAX_SCRIPT_WORDS,
      155
    ),

    wordsPerMinute: toNumber(
      process.env.WORDS_PER_MINUTE,
      150
    ),

    requireOriginalStory:
      toBoolean(
        process.env.REQUIRE_ORIGINAL_STORY,
        true
      ),

    requireStrongHook: true,

    requireCompleteEnding: true,

    requirePayoff: true,

    avoidFiller: true,

    avoidRepeatedConcepts: true,

    requireSceneNarration: true
  },

  /**
   * ============================================================
   * SCENE DIRECTOR
   * ============================================================
   *
   * Controls the relationship between:
   * Story -> Narration -> Action -> Visual
   */

  sceneConfig: {
    requireAction: true,

    requireCharacter: true,

    requireEnvironment: true,

    requireImportantObject: true,

    requireEmotion: true,

    requireVisualPurpose: true,

    requireNarrationVisualMatch: true,

    requireSceneProgression: true,

    avoidIdenticalScenePrompts: true,

    avoidRepeatedVisualAssets: true,

    maxSameAssetUsagePerStory: 1
  },

  /**
   * ============================================================
   * VISUAL ENGINE
   * ============================================================
   */

  visualConfig: {
    provider:
      process.env.VISUAL_PROVIDER ||
      'pexels',

    minConfidence: toNumber(
      process.env.VISUAL_MIN_CONFIDENCE,
      0.65
    ),

    portraitPreferred:
      toBoolean(
        process.env.PORTRAIT_VISUALS_PREFERRED,
        true
      ),

    avoidDuplicateVisuals:
      toBoolean(
        process.env.AVOID_DUPLICATE_VISUALS,
        true
      ),

    rejectWeakMatches: true,

    requireActionMatch: true,

    requireObjectMatch: true,

    requireEnvironmentMatch: true,

    requireSceneDiversity: true,

    maxVisualReuseRatio: 0,

    candidateLimitPerScene: 45,

    searchQueriesPerScene: 3
  },

  /**
   * ============================================================
   * VOICE ENGINE
   * ============================================================
   *
   * ElevenLabs remains primary.
   * Google Cloud and Amazon Polly remain backups.
   */

  voiceConfig: {
    primaryProvider:
      process.env.PRIMARY_TTS_PROVIDER ||
      'elevenlabs',

    fallbackProviders: toList(
      process.env.FALLBACK_TTS_PROVIDERS,
      [
        'google',
        'polly',
        'gtts'
      ]
    ),

    elevenLabs: {
      apiKey:
        process.env.ELEVENLABS_API_KEY ||
        '',

      voiceId:
        process.env.ELEVENLABS_VOICE_ID ||
        '',

      model:
        process.env.ELEVENLABS_MODEL ||
        'eleven_multilingual_v2',

      stability: toNumber(
        process.env.ELEVENLABS_STABILITY,
        0.42
      ),

      similarityBoost: toNumber(
        process.env.ELEVENLABS_SIMILARITY,
        0.82
      ),

      style: toNumber(
        process.env.ELEVENLABS_STYLE,
        0.30
      ),

      speakerBoost:
        toBoolean(
          process.env.ELEVENLABS_SPEAKER_BOOST,
          true
        )
    },

    google: {
      apiKey:
        process.env.GOOGLE_TTS_API_KEY ||
        process.env.GOOGLE_API_KEY ||
        '',

      languageCode:
        process.env.GOOGLE_TTS_LANGUAGE ||
        'en-US',

      voiceName:
        process.env.GOOGLE_TTS_VOICE ||
        'en-US-Neural2-J',

      speakingRate: toNumber(
        process.env.GOOGLE_TTS_RATE,
        1.0
      ),

      pitch: toNumber(
        process.env.GOOGLE_TTS_PITCH,
        0
      )
    },

    polly: {
      region:
        process.env.AWS_REGION ||
        'us-east-1',

      accessKeyId:
        process.env.AWS_ACCESS_KEY_ID ||
        '',

      secretAccessKey:
        process.env.AWS_SECRET_ACCESS_KEY ||
        '',

      sessionToken:
        process.env.AWS_SESSION_TOKEN ||
        '',

      voiceId:
        process.env.POLLY_VOICE_ID ||
        'Matthew',

      engine:
        process.env.POLLY_ENGINE ||
        'neural',

      languageCode:
        process.env.POLLY_LANGUAGE_CODE ||
        'en-US'
    },

    gtts: {
      language:
        process.env.GTTS_LANGUAGE ||
        'en',

      enabled:
        toBoolean(
          process.env.GTTS_ENABLED,
          true
        )
    }
  },

  /**
   * ============================================================
   * BACKGROUND MUSIC
   * ============================================================
   */

  musicConfig: {
    enabled:
      toBoolean(
        process.env.BACKGROUND_MUSIC_ENABLED,
        true
      ),

    path:
      process.env.BACKGROUND_MUSIC_PATH ||
      'output/music/background.mp3',

    volume: toNumber(
      process.env.BACKGROUND_MUSIC_VOLUME,
      0.14
    ),

    voiceDuckVolume: toNumber(
      process.env.MUSIC_VOICE_DUCK_VOLUME,
      0.06
    ),

    fadeInSeconds: toNumber(
      process.env.MUSIC_FADE_IN_SECONDS,
      0.8
    ),

    fadeOutSeconds: toNumber(
      process.env.MUSIC_FADE_OUT_SECONDS,
      1.2
    ),

    requireValidFile: true,

    failOnMissingMusic: true,

    enableDucking: true
  },

  /**
   * ============================================================
   * SUBTITLES / CAPTIONS
   * ============================================================
   */

  captionConfig: {
    enabled:
      toBoolean(
        process.env.CAPTIONS_ENABLED,
        true
      ),

    burnIntoVideo:
      toBoolean(
        process.env.BURN_CAPTIONS,
        true
      ),

    maxWordsPerLine: toNumber(
      process.env.CAPTION_MAX_WORDS_PER_LINE,
      5
    ),

    maxLines: 2,

    minimumDurationMs: toNumber(
      process.env.CAPTION_MIN_DURATION_MS,
      700
    ),

    safeArea: true,

    mobileOptimized: true
  },

  /**
   * ============================================================
   * QUALITY CONTROL
   * ============================================================
   */

  qualityConfig: {
    minDuration: toNumber(
      process.env.QUALITY_MIN_DURATION,
      20
    ),

    maxDuration: toNumber(
      process.env.QUALITY_MAX_DURATION,
      59
    ),

    minWidth: 1080,

    minHeight: 1920,

    requireAudio:
      toBoolean(
        process.env.QUALITY_REQUIRE_AUDIO,
        true
      ),

    requireVideo:
      toBoolean(
        process.env.QUALITY_REQUIRE_VIDEO,
        true
      ),

    requireMusic:
      toBoolean(
        process.env.QUALITY_REQUIRE_MUSIC,
        true
      ),

    requireCaptions:
      toBoolean(
        process.env.QUALITY_REQUIRE_CAPTIONS,
        true
      ),

    blockHighRisk:
      toBoolean(
        process.env.QUALITY_BLOCK_HIGH_RISK,
        true
      ),

    reviewMediumRisk:
      toBoolean(
        process.env.QUALITY_REVIEW_MEDIUM_RISK,
        true
      ),

    originalityRequired:
      toBoolean(
        process.env.QUALITY_ORIGINALITY_REQUIRED,
        true
      ),

    repetitionCheck:
      toBoolean(
        process.env.QUALITY_REPETITION_CHECK,
        true
      ),

    semanticVisualCheck: true,

    sceneDiversityCheck: true,

    audioMixCheck: true,

    timingSyncCheck: true,

    finalMediaCheck: true
  },

  /**
   * ============================================================
   * PRODUCTION / RENDER
   * ============================================================
   */

  productionConfig: {
    maxRetries: toNumber(
      process.env.PRODUCTION_MAX_RETRIES,
      2
    ),

    requestTimeoutMs: toNumber(
      process.env.PRODUCTION_REQUEST_TIMEOUT_MS,
      30000
    ),

    cleanupTemporaryFiles:
      toBoolean(
        process.env.CLEANUP_TEMP_FILES,
        true
      ),

    failClosedOnQualityError: true,

    failClosedOnMediaError: true,

    keepFailedArtifacts: true
  },

  /**
   * ============================================================
   * YOUTUBE SAFETY
   * ============================================================
   *
   * Upload/publish automation intentionally disabled.
   * These checks prepare videos for manual upload.
   */

  youtubeConfig: {
    uploadEnabled: false,

    publishEnabled: false,

    defaultPrivacy:
      process.env.YOUTUBE_DEFAULT_PRIVACY ||
      'private',

    requireApproval: true,

    originalityCheck:
      toBoolean(
        process.env.YOUTUBE_ORIGINALITY_CHECK,
        true
      ),

    reusedContentCheck:
      toBoolean(
        process.env.YOUTUBE_REUSED_CONTENT_CHECK,
        true
      ),

    repetitiveContentCheck:
      toBoolean(
        process.env.YOUTUBE_REPETITIVE_CONTENT_CHECK,
        true
      ),

    sensitiveContentCheck:
      toBoolean(
        process.env.YOUTUBE_SENSITIVE_CONTENT_CHECK,
        true
      ),

    misleadingContentCheck:
      toBoolean(
        process.env.YOUTUBE_MISLEADING_CONTENT_CHECK,
        true
      ),

    metadataCheck:
      toBoolean(
        process.env.YOUTUBE_METADATA_CHECK,
        true
      ),

    aiDisclosureCheck:
      toBoolean(
        process.env.YOUTUBE_AI_DISCLOSURE_CHECK,
        true
      )
  }
};

export default config;