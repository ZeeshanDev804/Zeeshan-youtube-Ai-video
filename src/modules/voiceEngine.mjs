import fs from 'fs';
import path from 'path';
import https from 'https';
import crypto from 'crypto';
import gTTS from 'gtts';

import { config } from '../config/index.mjs';

// ============================================================
// ZEESHAN AI LABS — PROFESSIONAL VOICE ENGINE
// ============================================================

const MIN_AUDIO_BYTES = 1024;
const REQUEST_TIMEOUT_MS = 60000;
const MAX_TEXT_LENGTH = 5000;
const MAX_PROVIDER_RETRIES = 2;

// Professional narration defaults
const DEFAULT_LANGUAGE = 'en-US';
const DEFAULT_ELEVEN_MODEL = 'eleven_multilingual_v2';

const DEFAULT_VOICE_PROFILE = {
  stability: 0.42,
  similarityBoost: 0.82,
  style: 0.30,
  useSpeakerBoost: true
};

// ============================================================
// TEXT NORMALIZATION
// ============================================================

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function validateText(value) {
  const text = cleanText(value);

  if (!text) {
    throw new Error(
      '[VoiceEngine] Narration text is empty.'
    );
  }

  if (text.length > MAX_TEXT_LENGTH) {
    throw new Error(
      `[VoiceEngine] Narration exceeds maximum length: ${text.length} characters.`
    );
  }

  return text;
}

// ============================================================
// FILE MANAGEMENT
// ============================================================

function ensureOutputDirectory(outputPath) {
  const directory = path.dirname(
    path.resolve(outputPath)
  );

  fs.mkdirSync(directory, {
    recursive: true
  });
}

function removeExistingFile(outputPath) {
  try {
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
  } catch (error) {
    throw new Error(
      `[VoiceEngine] Could not remove existing audio: ${
        error?.message || String(error)
      }`
    );
  }
}

function validateAudioFile(outputPath) {
  if (!fs.existsSync(outputPath)) {
    throw new Error(
      `[VoiceEngine] Audio file does not exist: ${outputPath}`
    );
  }

  const stats = fs.statSync(outputPath);

  if (!stats.isFile()) {
    throw new Error(
      `[VoiceEngine] Audio output is not a file: ${outputPath}`
    );
  }

  if (stats.size < MIN_AUDIO_BYTES) {
    throw new Error(
      `[VoiceEngine] Audio output is invalid or too small: ${stats.size} bytes`
    );
  }

  return outputPath;
}

function writeAudioFile(outputPath, audioBuffer) {
  if (
    !Buffer.isBuffer(audioBuffer) ||
    audioBuffer.length < MIN_AUDIO_BYTES
  ) {
    throw new Error(
      '[VoiceEngine] Provider returned invalid audio data.'
    );
  }

  ensureOutputDirectory(outputPath);

  fs.writeFileSync(
    outputPath,
    audioBuffer
  );

  return validateAudioFile(outputPath);
}

// ============================================================
// ENVIRONMENT / CONFIG HELPERS
// ============================================================

function getLanguageCode() {
  return (
    config?.ttsConfig?.language ||
    process.env.TTS_LANGUAGE ||
    DEFAULT_LANGUAGE
  );
}

function getElevenLabsApiKey() {
  return (
    config?.elevenLabsApiKey ||
    process.env.ELEVENLABS_API_KEY ||
    ''
  );
}

function getElevenLabsVoiceId() {
  return (
    config?.elevenLabsVoiceId ||
    process.env.ELEVENLABS_VOICE_ID ||
    ''
  );
}

function getElevenLabsSettings() {
  const settings =
    config?.ttsConfig?.elevenLabs ||
    {};

  return {
    modelId:
      settings.modelId ||
      process.env.ELEVENLABS_MODEL_ID ||
      DEFAULT_ELEVEN_MODEL,

    stability:
      Number(
        settings.stability ??
        process.env.ELEVENLABS_STABILITY ??
        DEFAULT_VOICE_PROFILE.stability
      ),

    similarityBoost:
      Number(
        settings.similarityBoost ??
        process.env.ELEVENLABS_SIMILARITY_BOOST ??
        DEFAULT_VOICE_PROFILE.similarityBoost
      ),

    style:
      Number(
        settings.style ??
        process.env.ELEVENLABS_STYLE ??
        DEFAULT_VOICE_PROFILE.style
      ),

    useSpeakerBoost:
      settings.useSpeakerBoost ??
      DEFAULT_VOICE_PROFILE.useSpeakerBoost
  };
}

function getGoogleApiKey() {
  return (
    config?.googleCloudTtsApiKey ||
    process.env.GOOGLE_CLOUD_TTS_API_KEY ||
    ''
  );
}

function getGoogleVoice() {
  return (
    config?.googleCloudTtsVoice ||
    process.env.GOOGLE_CLOUD_TTS_VOICE ||
    'en-US-Neural2-D'
  );
}

function getAwsCredentials() {
  return {
    accessKey:
      process.env.AWS_ACCESS_KEY_ID ||
      config?.awsAccessKeyId ||
      '',

    secretKey:
      process.env.AWS_SECRET_ACCESS_KEY ||
      config?.awsSecretAccessKey ||
      '',

    sessionToken:
      process.env.AWS_SESSION_TOKEN ||
      config?.awsSessionToken ||
      ''
  };
}

function getAwsRegion() {
  return (
    process.env.AWS_REGION ||
    config?.awsRegion ||
    'us-east-1'
  );
}

function getPollyVoice() {
  return (
    process.env.AWS_POLLY_VOICE ||
    config?.awsPollyVoice ||
    'Matthew'
  );
}

function getPollyEngine() {
  const engine = String(
    process.env.AWS_POLLY_ENGINE ||
    config?.awsPollyEngine ||
    'neural'
  )
    .trim()
    .toLowerCase();

  return engine === 'standard'
    ? 'standard'
    : 'neural';
}

// ============================================================
// BOOLEAN HELPER
// ============================================================

function readBoolean(value, fallback) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  return String(value)
    .trim()
    .toLowerCase() === 'true';
}

// ============================================================
// PROFESSIONAL VOICE PROFILE
// ============================================================

function getVoiceProfile(options = {}) {
  const mood = String(
    options.mood ||
    options.tone ||
    options.category ||
    ''
  )
    .trim()
    .toLowerCase();

  const profile = {
    ...DEFAULT_VOICE_PROFILE
  };

  switch (mood) {
    case 'mystery':
    case 'mysterious':
    case 'suspense':
      profile.stability = 0.38;
      profile.similarityBoost = 0.84;
      profile.style = 0.38;
      break;

    case 'emotional':
    case 'emotion':
      profile.stability = 0.36;
      profile.similarityBoost = 0.84;
      profile.style = 0.42;
      break;

    case 'funny':
    case 'comedy':
      profile.stability = 0.34;
      profile.similarityBoost = 0.80;
      profile.style = 0.48;
      break;

    case 'motivation':
    case 'motivational':
      profile.stability = 0.40;
      profile.similarityBoost = 0.84;
      profile.style = 0.36;
      break;

    case 'facts':
    case 'interesting':
    case 'educational':
      profile.stability = 0.48;
      profile.similarityBoost = 0.84;
      profile.style = 0.24;
      break;

    default:
      break;
  }

  if (options.voiceSettings) {
    if (
      Number.isFinite(
        Number(
          options.voiceSettings.stability
        )
      )
    ) {
      profile.stability =
        Number(
          options.voiceSettings.stability
        );
    }

    if (
      Number.isFinite(
        Number(
          options.voiceSettings.similarityBoost
        )
      )
    ) {
      profile.similarityBoost =
        Number(
          options.voiceSettings.similarityBoost
        );
    }

    if (
      Number.isFinite(
        Number(
          options.voiceSettings.style
        )
      )
    ) {
      profile.style =
        Number(
          options.voiceSettings.style
        );
    }
  }

  return profile;
}

// ============================================================
// NARRATION PROCESSING
// ============================================================

function prepareNarration(text, options = {}) {
  let narration = validateText(text);

  // Remove unnecessary markdown artifacts.
  narration = narration
    .replace(/[*_`#]+/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  // Professional pause handling.
  if (options.addNaturalPauses !== false) {
    narration = narration
      .replace(/,\s*/g, ', ')
      .replace(/;\s*/g, '; ')
      .replace(/:\s*/g, ': ')
      .replace(/\.\s+/g, '. ');
  }

  return narration;
}

// ============================================================
// HTTPS JSON REQUEST
// ============================================================

function requestJson({
  hostname,
  path: requestPath,
  method = 'POST',
  headers = {},
  body = null
}) {
  return new Promise(
    (resolve, reject) => {
      const request =
        https.request(
          {
            hostname,
            path: requestPath,
            method,
            headers,
            timeout:
              REQUEST_TIMEOUT_MS
          },
          response => {
            let data = '';

            response.setEncoding(
              'utf8'
            );

            response.on(
              'data',
              chunk => {
                data += chunk;
              }
            );

            response.on(
              'end',
              () => {
                const status =
                  response.statusCode ||
                  0;

                if (
                  status < 200 ||
                  status >= 300
                ) {
                  reject(
                    new Error(
                      `HTTP ${status}: ${data.slice(
                        0,
                        1500
                      )}`
                    )
                  );
                  return;
                }

                if (!data) {
                  resolve({});
                  return;
                }

                try {
                  resolve(
                    JSON.parse(data)
                  );
                } catch {
                  resolve(data);
                }
              }
            );
          }
        );

      request.on(
        'timeout',
        () => {
          request.destroy(
            new Error(
              `Request timeout after ${
                REQUEST_TIMEOUT_MS /
                1000
              } seconds.`
            )
          );
        }
      );

      request.on(
        'error',
        reject
      );

      if (body) {
        request.write(body);
      }

      request.end();
    }
  );
}

// ============================================================
// HTTPS BINARY REQUEST
// ============================================================

function requestBinary({
  hostname,
  path: requestPath,
  method = 'POST',
  headers = {},
  body = null
}) {
  return new Promise(
    (resolve, reject) => {
      const request =
        https.request(
          {
            hostname,
            path: requestPath,
            method,
            headers,
            timeout:
              REQUEST_TIMEOUT_MS
          },
          response => {
            const chunks = [];

            response.on(
              'data',
              chunk => {
                chunks.push(chunk);
              }
            );

            response.on(
              'end',
              () => {
                const buffer =
                  Buffer.concat(
                    chunks
                  );

                const status =
                  response.statusCode ||
                  0;

                if (
                  status < 200 ||
                  status >= 300
                ) {
                  reject(
                    new Error(
                      `HTTP ${status}: ${buffer
                        .toString(
                          'utf8'
                        )
                        .slice(
                          0,
                          1500
                        )}`
                    )
                  );
                  return;
                }

                resolve(buffer);
              }
            );
          }
        );

      request.on(
        'timeout',
        () => {
          request.destroy(
            new Error(
              `Request timeout after ${
                REQUEST_TIMEOUT_MS /
                1000
              } seconds.`
            )
          );
        }
      );

      request.on(
        'error',
        reject
      );

      if (body) {
        request.write(body);
      }

      request.end();
    }
  );
}

// ============================================================
// RETRY SYSTEM
// ============================================================

function sleep(ms) {
  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );
}

async function withRetry(
  operation,
  provider
) {
  let lastError;

  for (
    let attempt = 1;
    attempt <=
      MAX_PROVIDER_RETRIES;
    attempt += 1
  ) {
    try {
      return await operation(
        attempt
      );
    } catch (error) {
      lastError =
        error;

      if (
        attempt >=
        MAX_PROVIDER_RETRIES
      ) {
        break;
      }

      const delay =
        1000 *
        Math.pow(
          2,
          attempt - 1
        );

      console.warn(
        `[VoiceEngine] ${provider} failed on attempt ${attempt}. Retrying...`
      );

      await sleep(
        delay
      );
    }
  }

  throw lastError;
}

// ============================================================
// ELEVENLABS PROFESSIONAL GENERATION
// ============================================================

async function generateWithElevenLabs(
  text,
  outputPath,
  options = {}
) {
  const apiKey =
    getElevenLabsApiKey();

  const voiceId =
    getElevenLabsVoiceId();

  if (!apiKey) {
    throw new Error(
      'ELEVENLABS_API_KEY is missing.'
    );
  }

  if (!voiceId) {
    throw new Error(
      'ELEVENLABS_VOICE_ID is missing.'
    );
  }

  const settings =
    getElevenLabsSettings();

  const profile =
    getVoiceProfile(
      options
    );

  const body =
    JSON.stringify({
      text,

      model_id:
        settings.modelId,

      voice_settings: {
        stability:
          profile.stability,

        similarity_boost:
          profile.similarityBoost,

        style:
          profile.style,

        use_speaker_boost:
          profile.useSpeakerBoost
      }
    });

  const audio =
    await withRetry(
      () =>
        requestBinary({
          hostname:
            'api.elevenlabs.io',

          path:
            `/v1/text-to-speech/${encodeURIComponent(
              voiceId
            )}`,

          method:
            'POST',

          headers: {
            Accept:
              'audio/mpeg',

            'Content-Type':
              'application/json',

            'xi-api-key':
              apiKey,

            'Content-Length':
              Buffer.byteLength(
                body
              )
          },

          body
        }),

      'ElevenLabs'
    );

  return writeAudioFile(
    outputPath,
    audio
  );
}

// ============================================================
// GOOGLE CLOUD TTS BACKUP
// ============================================================

async function generateWithGoogleCloud(
  text,
  outputPath
) {
  const apiKey =
    getGoogleApiKey();

  if (!apiKey) {
    throw new Error(
      'GOOGLE_CLOUD_TTS_API_KEY is missing.'
    );
  }

  const languageCode =
    getLanguageCode();

  const voiceName =
    getGoogleVoice();

  const body =
    JSON.stringify({
      input: {
        text
      },

      voice: {
        languageCode,
        name:
          voiceName
      },

      audioConfig: {
        audioEncoding:
          'MP3',

        speakingRate:
          1.0,

        pitch:
          0,

        volumeGainDb:
          0
      }
    });

  const result =
    await withRetry(
      () =>
        requestJson({
          hostname:
            'texttospeech.googleapis.com',

          path:
            `/v1/text:synthesize?key=${encodeURIComponent(
              apiKey
            )}`,

          method:
            'POST',

          headers: {
            'Content-Type':
              'application/json',

            'Content-Length':
              Buffer.byteLength(
                body
              )
          },

          body
        }),

      'Google Cloud TTS'
    );

  if (
    !result?.audioContent
  ) {
    throw new Error(
      'Google Cloud TTS returned no audioContent.'
    );
  }

  const audio =
    Buffer.from(
      result.audioContent,
      'base64'
    );

  return writeAudioFile(
    outputPath,
    audio
  );
}

// ============================================================
// AWS CRYPTOGRAPHY
// ============================================================

function sha256Hex(data) {
  return crypto
    .createHash(
      'sha256'
    )
    .update(data)
    .digest('hex');
}

function hmacSha256(
  key,
  data,
  encoding
) {
  return crypto
    .createHmac(
      'sha256',
      key
    )
    .update(
      data,
      'utf8'
    )
    .digest(
      encoding
    );
}

function buildAmzDate(
  date = new Date()
) {
  return date
    .toISOString()
    .replace(
      /[:-]|\.\d{3}/g,
      ''
    );
}

function getDateStamp(
  amzDate
) {
  return amzDate.slice(
    0,
    8
  );
}

// ============================================================
// AWS SIGNATURE V4
// ============================================================

function createAwsAuthorization({
  accessKey,
  secretKey,
  sessionToken,
  region,
  host,
  body,
  amzDate
}) {
  const service =
    'polly';

  const method =
    'POST';

  const canonicalUri =
    '/v1/speech';

  const canonicalQueryString =
    '';

  const payloadHash =
    sha256Hex(
      body
    );

  const headerValues = {
    host,

    'content-type':
      'application/json',

    'x-amz-content-sha256':
      payloadHash,

    'x-amz-date':
      amzDate
  };

  if (sessionToken) {
    headerValues[
      'x-amz-security-token'
    ] =
      sessionToken;
  }

  const signedHeaderNames =
    Object.keys(
      headerValues
    )
      .map(
        key =>
          key.toLowerCase()
      )
      .sort();

  const canonicalHeaders =
    signedHeaderNames
      .map(
        key =>
          `${key}:${String(
            headerValues[key]
          )
            .trim()
            .replace(
              /\s+/g,
              ' '
            )}\n`
      )
      .join('');

  const signedHeaders =
    signedHeaderNames.join(
      ';'
    );

  // IMPORTANT:
  // canonicalHeaders already ends with \n.
  // Do not add another newline inside it.
  const canonicalRequest =
    [
      method,
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      payloadHash
    ].join('\n');

  const algorithm =
    'AWS4-HMAC-SHA256';

  const dateStamp =
    getDateStamp(
      amzDate
    );

  const credentialScope =
    `${dateStamp}/${region}/${service}/aws4_request`;

  const stringToSign =
    [
      algorithm,
      amzDate,
      credentialScope,
      sha256Hex(
        canonicalRequest
      )
    ].join('\n');

  const kDate =
    hmacSha256(
      `AWS4${secretKey}`,
      dateStamp
    );

  const kRegion =
    hmacSha256(
      kDate,
      region
    );

  const kService =
    hmacSha256(
      kRegion,
      service
    );

  const kSigning =
    hmacSha256(
      kService,
      'aws4_request'
    );

  const signature =
    hmacSha256(
      kSigning,
      stringToSign,
      'hex'
    );

  const authorization =
    `${algorithm} Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    payloadHash,
    authorization
  };
}

// ============================================================
// AMAZON POLLY BACKUP
// ============================================================

async function generateWithAmazonPolly(
  text,
  outputPath
) {
  const credentials =
    getAwsCredentials();

  if (
    !credentials.accessKey ||
    !credentials.secretKey
  ) {
    throw new Error(
      'AWS credentials are missing.'
    );
  }

  const region =
    getAwsRegion();

  const voiceId =
    getPollyVoice();

  const configuredEngine =
    getPollyEngine();

  const host =
    `polly.${region}.amazonaws.com`;

  async function requestPolly(
    engine
  ) {
    const body =
      JSON.stringify({
        OutputFormat:
          'mp3',

        Text:
          text,

        TextType:
          'text',

        VoiceId:
          voiceId,

        Engine:
          engine
      });

    const amzDate =
      buildAmzDate();

    const signing =
      createAwsAuthorization({
        ...credentials,

        region,

        host,

        body,

        amzDate
      });

    const headers = {
      Host:
        host,

      'Content-Type':
        'application/json',

      'Content-Length':
        Buffer.byteLength(
          body
        ),

      'X-Amz-Date':
        amzDate,

      'X-Amz-Content-Sha256':
        signing.payloadHash,

      Authorization:
        signing.authorization
    };

    if (
      credentials.sessionToken
    ) {
      headers[
        'X-Amz-Security-Token'
      ] =
        credentials.sessionToken;
    }

    return requestBinary({
      hostname:
        host,

      path:
        '/v1/speech',

      method:
        'POST',

      headers,

      body
    });
  }

  try {
    const audio =
      await withRetry(
        () =>
          requestPolly(
            configuredEngine
          ),

        'Amazon Polly'
      );

    return writeAudioFile(
      outputPath,
      audio
    );
  } catch (primaryError) {
    if (
      configuredEngine !==
      'neural'
    ) {
      throw primaryError;
    }

    console.warn(
      '[VoiceEngine] Polly neural failed. Trying standard Polly engine.'
    );

    const audio =
      await withRetry(
        () =>
          requestPolly(
            'standard'
          ),

        'Amazon Polly Standard'
      );

    return writeAudioFile(
      outputPath,
      audio
    );
  }
}

// ============================================================
// gTTS EMERGENCY FALLBACK
// ============================================================

async function generateWithGTTS(
  text,
  outputPath,
  language = 'en'
) {
  ensureOutputDirectory(
    outputPath
  );

  return new Promise(
    (
      resolve,
      reject
    ) => {
      try {
        const tts =
          new gTTS(
            text,
            language
          );

        tts.save(
          outputPath,
          error => {
            if (error) {
              reject(
                error
              );
              return;
            }

            try {
              resolve(
                validateAudioFile(
                  outputPath
                )
              );
            } catch (
              validationError
            ) {
              reject(
                validationError
              );
            }
          }
        );
      } catch (error) {
        reject(
          error
        );
      }
    }
  );
}

// ============================================================
// PROVIDER CONFIGURATION
// ============================================================

function providerConfigured(
  provider
) {
  const name =
    String(provider)
      .trim()
      .toLowerCase();

  switch (name) {
    case 'elevenlabs':
      return Boolean(
        getElevenLabsApiKey() &&
        getElevenLabsVoiceId()
      );

    case 'google':
    case 'google-cloud':
    case 'googlecloud':
      return Boolean(
        getGoogleApiKey()
      );

    case 'amazon':
    case 'polly':
    case 'amazon-polly': {
      const credentials =
        getAwsCredentials();

      return Boolean(
        credentials.accessKey &&
        credentials.secretKey
      );
    }

    case 'gtts':
      return true;

    default:
      return false;
  }
}

// ============================================================
// PROVIDER ORDER
// ============================================================

function buildProviderOrder(
  requestedProvider
) {
  const providers =
    [];

  const primary =
    String(
      requestedProvider ||
      config?.ttsConfig
        ?.primaryProvider ||
      process.env.TTS_PRIMARY_PROVIDER ||
      'elevenlabs'
    )
      .trim()
      .toLowerCase();

  function add(
    provider
  ) {
    if (
      !providers.includes(
        provider
      )
    ) {
      providers.push(
        provider
      );
    }
  }

  // Primary provider first.
  add(
    primary
  );

  // Professional primary.
  add(
    'elevenlabs'
  );

  const googleEnabled =
    readBoolean(
      config?.ttsConfig
        ?.enableGoogleBackup ??
        process.env
          .TTS_ENABLE_GOOGLE_BACKUP,
      true
    );

  if (
    googleEnabled
  ) {
    add(
      'google'
    );
  }

  const amazonEnabled =
    readBoolean(
      config?.ttsConfig
        ?.enableAmazonBackup ??
        process.env
          .TTS_ENABLE_AMAZON_BACKUP,
      true
    );

  if (
    amazonEnabled
  ) {
    add(
      'amazon'
    );
  }

  // Emergency-only final fallback.
  add(
    'gtts'
  );

  return providers;
}

// ============================================================
// PROVIDER DISPATCH
// ============================================================

async function generateByProvider(
  provider,
  text,
  outputPath,
  options = {}
) {
  switch (
    String(provider)
      .trim()
      .toLowerCase()
  ) {
    case 'elevenlabs':
      return generateWithElevenLabs(
        text,
        outputPath,
        options
      );

    case 'google':
    case 'google-cloud':
    case 'googlecloud':
      return generateWithGoogleCloud(
        text,
        outputPath
      );

    case 'amazon':
    case 'polly':
    case 'amazon-polly':
      return generateWithAmazonPolly(
        text,
        outputPath
      );

    case 'gtts':
      return generateWithGTTS(
        text,
        outputPath,
        options.language ||
          'en'
      );

    default:
      throw new Error(
        `Unsupported TTS provider: ${provider}`
      );
  }
}

// ============================================================
// MAIN PROFESSIONAL VOICEOVER
// ============================================================

export async function generateVoiceover(
  text,
  outputPath,
  options = {}
) {
  if (!outputPath) {
    throw new Error(
      '[VoiceEngine] outputPath is required.'
    );
  }

  const narration =
    prepareNarration(
      text,
      options
    );

  ensureOutputDirectory(
    outputPath
  );

  const providers =
    buildProviderOrder(
      options.provider
    );

  console.log(
    `[VoiceEngine] Starting professional voice generation.`
  );

  console.log(
    `[VoiceEngine] Providers: ${providers.join(
      ' -> '
    )}`
  );

  if (
    options.mood ||
    options.tone ||
    options.category
  ) {
    console.log(
      `[VoiceEngine] Voice mood: ${
        options.mood ||
        options.tone ||
        options.category
      }`
    );
  }

  const errors =
    [];

  for (
    const provider of
      providers
  ) {
    if (
      !providerConfigured(
        provider
      )
    ) {
      errors.push(
        `${provider}: not configured`
      );

      console.warn(
        `[VoiceEngine] Skipping ${provider}: not configured.`
      );

      continue;
    }

    try {
      removeExistingFile(
        outputPath
      );

      console.log(
        `[VoiceEngine] Trying ${provider}...`
      );

      const result =
        await generateByProvider(
          provider,
          narration,
          outputPath,
          options
        );

      const finalPath =
        validateAudioFile(
          result ||
            outputPath
        );

      console.log(
        `[VoiceEngine] SUCCESS: professional narration generated with ${provider}.`
      );

      return finalPath;
    } catch (error) {
      const message =
        error?.message ||
        String(error);

      errors.push(
        `${provider}: ${message}`
      );

      console.warn(
        `[VoiceEngine] ${provider} failed: ${message}`
      );

      try {
        removeExistingFile(
          outputPath
        );
      } catch (
        cleanupError
      ) {
        console.warn(
          `[VoiceEngine] Cleanup warning: ${
            cleanupError?.message ||
            String(cleanupError)
          }`
        );
      }
    }
  }

  throw new Error(
    `[VoiceEngine] Complete voice generation failure.\n${errors.join(
      '\n'
    )}`
  );
}

// ============================================================
// SCENE-BY-SCENE PROFESSIONAL VOICEOVER
// ============================================================

export async function generateSceneVoiceovers(
  scenes,
  outputDirectory,
  options = {}
) {
  if (
    !Array.isArray(
      scenes
    ) ||
    scenes.length === 0
  ) {
    throw new Error(
      '[VoiceEngine] No scenes supplied.'
    );
  }

  if (!outputDirectory) {
    throw new Error(
      '[VoiceEngine] outputDirectory is required.'
    );
  }

  fs.mkdirSync(
    outputDirectory,
    {
      recursive: true
    }
  );

  console.log(
    `[VoiceEngine] Generating professional narration for ${scenes.length} scenes.`
  );

  const results =
    [];

  for (
    let index = 0;
    index < scenes.length;
    index += 1
  ) {
    const scene =
      scenes[index];

    const sceneNumber =
      index + 1;

    const narration =
      scene?.narration ||
      scene?.voiceover ||
      scene?.text ||
      '';

    const outputPath =
      path.join(
        outputDirectory,
        `scene-${String(
          sceneNumber
        ).padStart(
          2,
          '0'
        )}.mp3`
      );

    // Allow scene-level mood/tone to reach ElevenLabs.
    const sceneOptions =
      {
        ...options,

        mood:
          scene?.mood ||
          scene?.tone ||
          options.mood,

        tone:
          scene?.tone ||
          options.tone,

        category:
          scene?.category ||
          options.category,

        sceneIndex:
          index,

        sceneNumber
      };

    console.log(
      `[VoiceEngine] Scene ${sceneNumber}/${scenes.length}: generating narration...`
    );

    const audioPath =
      await generateVoiceover(
        narration,
        outputPath,
        sceneOptions
      );

    results.push({
      sceneIndex:
        index,

      sceneNumber,

      narration:
        cleanText(
          narration
        ),

      path:
        audioPath,

      outputPath:
        audioPath,

      audioPath:
        audioPath
    });

    console.log(
      `[VoiceEngine] Scene ${sceneNumber}/${scenes.length}: complete.`
    );
  }

  console.log(
    `[VoiceEngine] All scene voiceovers completed successfully.`
  );

  return results;
}

// ============================================================
// DEFAULT EXPORT
// ============================================================

export default {
  generateVoiceover,
  generateSceneVoiceovers
};