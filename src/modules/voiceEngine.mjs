import fs from 'fs';
import path from 'path';
import https from 'https';
import crypto from 'crypto';

import gTTS from 'gtts';

import { config } from '../config/index.mjs';

const MIN_AUDIO_BYTES = 1024;
const REQUEST_TIMEOUT_MS = 60000;

/* =========================================================
   Helpers
   ========================================================= */

function cleanText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

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
      `[VoiceEngine] Could not remove old audio file: ${
        error?.message || String(error)
      }`
    );
  }
}

function validateAudioFile(outputPath) {
  if (!fs.existsSync(outputPath)) {
    throw new Error(
      `[VoiceEngine] Audio file was not created: ${outputPath}`
    );
  }

  const stats = fs.statSync(outputPath);

  if (!stats.isFile()) {
    throw new Error(
      `[VoiceEngine] Audio path is not a regular file: ${outputPath}`
    );
  }

  if (stats.size < MIN_AUDIO_BYTES) {
    throw new Error(
      `[VoiceEngine] Generated audio is too small or invalid: ${outputPath} (${stats.size} bytes)`
    );
  }

  return outputPath;
}

/* =========================================================
   Configuration
   ========================================================= */

function getElevenLabsApiKey() {
  return (
    config.elevenLabsApiKey ||
    process.env.ELEVENLABS_API_KEY ||
    ''
  );
}

function getElevenLabsVoiceId() {
  return (
    config.elevenLabsVoiceId ||
    process.env.ELEVENLABS_VOICE_ID ||
    ''
  );
}

function getElevenLabsSettings() {
  const settings =
    config.ttsConfig?.elevenLabs || {};

  return {
    modelId:
      settings.modelId ||
      process.env.ELEVENLABS_MODEL_ID ||
      'eleven_multilingual_v2',

    stability:
      settings.stability ?? 0.45,

    similarityBoost:
      settings.similarityBoost ?? 0.80,

    style:
      settings.style ?? 0.20,

    useSpeakerBoost:
      settings.useSpeakerBoost ?? true
  };
}

function getGoogleApiKey() {
  return (
    config.googleCloudTtsApiKey ||
    process.env.GOOGLE_CLOUD_TTS_API_KEY ||
    ''
  );
}

function getGoogleVoice() {
  return (
    config.googleCloudTtsVoice ||
    process.env.GOOGLE_CLOUD_TTS_VOICE ||
    'en-US-Neural2-D'
  );
}

function getLanguageCode() {
  return (
    config.ttsConfig?.language ||
    process.env.TTS_LANGUAGE ||
    'en-US'
  );
}

function getGttsLanguage() {
  const language =
    getLanguageCode();

  if (
    language
      .toLowerCase()
      .startsWith('en')
  ) {
    return 'en';
  }

  return language
    .split('-')[0]
    .split('_')[0]
    .toLowerCase();
}

/* =========================================================
   HTTPS helpers
   ========================================================= */

function requestJson({
  hostname,
  path: requestPath,
  method = 'POST',
  headers = {},
  body = null
}) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname,
        path: requestPath,
        method,
        headers,
        timeout: REQUEST_TIMEOUT_MS
      },
      response => {
        let data = '';

        response.setEncoding('utf8');

        response.on('data', chunk => {
          data += chunk;
        });

        response.on('end', () => {
          const statusCode =
            response.statusCode || 0;

          if (
            statusCode < 200 ||
            statusCode >= 300
          ) {
            reject(
              new Error(
                `HTTP ${statusCode}: ${data.slice(
                  0,
                  1000
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
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      }
    );

    request.on('timeout', () => {
      request.destroy(
        new Error(
          `HTTPS request timed out after ${
            REQUEST_TIMEOUT_MS / 1000
          } seconds.`
        )
      );
    });

    request.on('error', reject);

    if (body) {
      request.write(body);
    }

    request.end();
  });
}

function requestBinary({
  hostname,
  path: requestPath,
  method = 'POST',
  headers = {},
  body = null
}) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname,
        path: requestPath,
        method,
        headers,
        timeout: REQUEST_TIMEOUT_MS
      },
      response => {
        const chunks = [];

        response.on('data', chunk => {
          chunks.push(chunk);
        });

        response.on('end', () => {
          const buffer =
            Buffer.concat(chunks);

          const statusCode =
            response.statusCode || 0;

          if (
            statusCode < 200 ||
            statusCode >= 300
          ) {
            reject(
              new Error(
                `HTTP ${statusCode}: ${buffer
                  .toString('utf8')
                  .slice(0, 1000)}`
              )
            );
            return;
          }

          resolve(buffer);
        });
      }
    );

    request.on('timeout', () => {
      request.destroy(
        new Error(
          `HTTPS request timed out after ${
            REQUEST_TIMEOUT_MS / 1000
          } seconds.`
        )
      );
    });

    request.on('error', reject);

    if (body) {
      request.write(body);
    }

    request.end();
  });
}

/* =========================================================
   ElevenLabs
   ========================================================= */

async function generateWithElevenLabs(
  text,
  outputPath
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

  const requestPath =
    `/v1/text-to-speech/${encodeURIComponent(
      voiceId
    )}`;

  const body = JSON.stringify({
    text,

    model_id:
      settings.modelId,

    voice_settings: {
      stability:
        settings.stability,

      similarity_boost:
        settings.similarityBoost,

      style:
        settings.style,

      use_speaker_boost:
        settings.useSpeakerBoost
    }
  });

  const audioBuffer =
    await requestBinary({
      hostname:
        'api.elevenlabs.io',

      path:
        requestPath,

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
          Buffer.byteLength(body)
      },

      body
    });

  if (
    !audioBuffer ||
    audioBuffer.length <
      MIN_AUDIO_BYTES
  ) {
    throw new Error(
      'ElevenLabs returned invalid or empty audio.'
    );
  }

  fs.writeFileSync(
    outputPath,
    audioBuffer
  );

  return validateAudioFile(
    outputPath
  );
}

/* =========================================================
   Google Cloud TTS
   ========================================================= */

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

  const body = JSON.stringify({
    input: {
      text
    },

    voice: {
      languageCode,
      name: voiceName
    },

    audioConfig: {
      audioEncoding:
        'MP3',

      speakingRate:
        1.0,

      pitch:
        0
    }
  });

  const result =
    await requestJson({
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
          Buffer.byteLength(body)
      },

      body
    });

  if (!result?.audioContent) {
    throw new Error(
      'Google Cloud TTS returned no audioContent.'
    );
  }

  const audioBuffer =
    Buffer.from(
      result.audioContent,
      'base64'
    );

  if (
    !audioBuffer ||
    audioBuffer.length <
      MIN_AUDIO_BYTES
  ) {
    throw new Error(
      'Google Cloud TTS returned invalid or empty audio.'
    );
  }

  fs.writeFileSync(
    outputPath,
    audioBuffer
  );

  return validateAudioFile(
    outputPath
  );
}

/* =========================================================
   AWS Signature V4
   ========================================================= */

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
    .update(data, 'utf8')
    .digest(encoding);
}

function sha256Hex(data) {
  return crypto
    .createHash('sha256')
    .update(data)
    .digest('hex');
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

function getDateStamp(amzDate) {
  return amzDate.slice(
    0,
    8
  );
}

function getAwsCredentials() {
  const accessKey =
    process.env.AWS_ACCESS_KEY_ID ||
    config.awsAccessKeyId ||
    '';

  const secretKey =
    process.env.AWS_SECRET_ACCESS_KEY ||
    config.awsSecretAccessKey ||
    '';

  const sessionToken =
    process.env.AWS_SESSION_TOKEN ||
    config.awsSessionToken ||
    '';

  if (!accessKey) {
    throw new Error(
      'AWS_ACCESS_KEY_ID is missing.'
    );
  }

  if (!secretKey) {
    throw new Error(
      'AWS_SECRET_ACCESS_KEY is missing.'
    );
  }

  return {
    accessKey,
    secretKey,
    sessionToken
  };
}

function getAwsRegion() {
  return (
    process.env.AWS_REGION ||
    config.awsRegion ||
    'us-east-1'
  );
}

function getAwsPollyVoice() {
  return (
    process.env.AWS_POLLY_VOICE ||
    config.awsPollyVoice ||
    'Matthew'
  );
}

function getAwsPollyEngine() {
  return (
    process.env.AWS_POLLY_ENGINE ||
    config.awsPollyEngine ||
    'neural'
  );
}

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
    sha256Hex(body);

  const canonicalHeaderValues = {
    host,
    'content-type':
      'application/json',
    'x-amz-content-sha256':
      payloadHash,
    'x-amz-date':
      amzDate
  };

  if (sessionToken) {
    canonicalHeaderValues[
      'x-amz-security-token'
    ] = sessionToken;
  }

  const signedHeaderNames =
    Object.keys(
      canonicalHeaderValues
    )
      .map(name =>
        name.toLowerCase()
      )
      .sort();

  const canonicalHeaders =
    signedHeaderNames
      .map(name => {
        const value =
          canonicalHeaderValues[
            name
          ];

        return `${name}:${String(
          value
        ).trim()}\n`;
      })
      .join('');

  const signedHeaders =
    signedHeaderNames.join(
      ';'
    );

  const canonicalRequest = [
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
    getDateStamp(amzDate);

  const credentialScope =
    `${dateStamp}/${region}/${service}/aws4_request`;

  const stringToSign = [
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

/* =========================================================
   Amazon Polly
   ========================================================= */

async function generateWithAmazonPolly(
  text,
  outputPath
) {
  const credentials =
    getAwsCredentials();

  const region =
    getAwsRegion();

  const voiceId =
    getAwsPollyVoice();

  const engine =
    getAwsPollyEngine();

  const host =
    `polly.${region}.amazonaws.com`;

  const createRequest =
    async selectedEngine => {
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
            selectedEngine
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
        'Content-Type':
          'application/json',

        'Content-Length':
          Buffer.byteLength(body),

        Host:
          host,

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
    };

  let audioBuffer;

  try {
    audioBuffer =
      await createRequest(
        engine
      );
  } catch (error) {
    if (
      engine === 'neural'
    ) {
      console.warn(
        '[VoiceEngine] Polly neural failed. Trying standard engine.'
      );

      audioBuffer =
        await createRequest(
          'standard'
        );
    } else {
      throw error;
    }
  }

  if (
    !audioBuffer ||
    audioBuffer.length <
      MIN_AUDIO_BYTES
  ) {
    throw new Error(
      'Amazon Polly returned invalid or empty audio.'
    );
  }

  fs.writeFileSync(
    outputPath,
    audioBuffer
  );

  return validateAudioFile(
    outputPath
  );
}

/* =========================================================
   gTTS emergency fallback
   ========================================================= */

async function generateWithGTTS(
  text,
  outputPath,
  language = 'en'
) {
  ensureOutputDirectory(
    outputPath
  );

  return new Promise(
    (resolve, reject) => {
      try {
        console.log(
          '[VoiceEngine] Starting gTTS emergency fallback...'
        );

        const tts =
          new gTTS(
            text,
            language
          );

        tts.save(
          outputPath,
          error => {
            if (error) {
              reject(error);
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
        reject(error);
      }
    }
  );
}

/* =========================================================
   Provider order
   ========================================================= */

function buildProviderOrder(
  requestedProvider
) {
  const order = [];

  const primary =
    String(
      requestedProvider ||
        config.ttsConfig
          ?.primaryProvider ||
        process.env.TTS_PRIMARY_PROVIDER ||
        'elevenlabs'
    )
      .trim()
      .toLowerCase();

  const addProvider =
    provider => {
      if (
        !order.includes(
          provider
        )
      ) {
        order.push(
          provider
        );
      }
    };

  addProvider(
    primary
  );

  addProvider(
    'elevenlabs'
  );

  const googleBackup =
    config.ttsConfig
      ?.enableGoogleBackup ??
    String(
      process.env
        .TTS_ENABLE_GOOGLE_BACKUP ||
        'true'
    ).toLowerCase() ===
      'true';

  if (
    googleBackup
  ) {
    addProvider(
      'google'
    );
  }

  const amazonBackup =
    config.ttsConfig
      ?.enableAmazonBackup ??
    String(
      process.env
        .TTS_ENABLE_AMAZON_BACKUP ||
        'true'
    ).toLowerCase() ===
      'true';

  if (
    amazonBackup
  ) {
    addProvider(
      'amazon'
    );
  }

  addProvider(
    'gtts'
  );

  return order;
}

/* =========================================================
   Provider dispatcher
   ========================================================= */

async function generateByProvider(
  provider,
  text,
  outputPath,
  options
) {
  switch (
    String(provider)
      .trim()
      .toLowerCase()
  ) {
    case 'elevenlabs':
      return generateWithElevenLabs(
        text,
        outputPath
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
        getGttsLanguage()
      );

    default:
      throw new Error(
        `Unknown TTS provider: ${provider}`
      );
  }
}

/* =========================================================
   Main voice generation
   ========================================================= */

export async function generateVoiceover(
  text,
  outputPath,
  options = {}
) {
  console.log(
    '[VoiceEngine] generateVoiceover() started.'
  );

  const narration =
    cleanText(text);

  if (!narration) {
    throw new Error(
      '[VoiceEngine] Voiceover text is empty.'
    );
  }

  if (!outputPath) {
    throw new Error(
      '[VoiceEngine] outputPath is required.'
    );
  }

  ensureOutputDirectory(
    outputPath
  );

  const providers =
    buildProviderOrder(
      options.provider
    );

  console.log(
    `[VoiceEngine] Provider order: ${providers.join(
      ' -> '
    )}`
  );

  const errors = [];

  for (
    const provider of providers
  ) {
    try {
      removeExistingFile(
        outputPath
      );

      console.log(
        `[VoiceEngine] Trying provider: ${provider}`
      );

      const result =
        await generateByProvider(
          provider,
          narration,
          outputPath,
          options
        );

      const validatedPath =
        validateAudioFile(
          result ||
            outputPath
        );

      console.log(
        `[VoiceEngine] Voice generated successfully with ${provider}.`
      );

      return validatedPath;
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
    }
  }

  throw new Error(
    `[VoiceEngine] All TTS providers failed.\n${errors.join(
      '\n'
    )}`
  );
}

/* =========================================================
   Scene voiceovers
   ========================================================= */

export async function generateSceneVoiceovers(
  scenes,
  outputDirectory,
  options = {}
) {
  console.log(
    '[VoiceEngine] generateSceneVoiceovers() started.'
  );

  if (
    !Array.isArray(
      scenes
    ) ||
    scenes.length === 0
  ) {
    throw new Error(
      '[VoiceEngine] No scenes provided.'
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
    `[VoiceEngine] Scene count: ${scenes.length}`
  );

  const results = [];

  for (
    let index = 0;
    index < scenes.length;
    index += 1
  ) {
    const scene =
      scenes[index];

    const sceneNumber =
      index + 1;

    console.log(
      `[VoiceEngine] Preparing scene ${sceneNumber}/${scenes.length} narration...`
    );

    const narration =
      cleanText(
        scene?.narration ||
          scene?.voiceover ||
          scene?.text ||
          ''
      );

    if (!narration) {
      throw new Error(
        `[VoiceEngine] Scene ${sceneNumber} has no narration.`
      );
    }

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

    console.log(
      `[VoiceEngine] Scene ${sceneNumber} text length: ${narration.length} characters`
    );

    const generatedAudioPath =
      await generateVoiceover(
        narration,
        outputPath,
        options
      );

    const validatedPath =
      validateAudioFile(
        generatedAudioPath ||
          outputPath
      );

    results.push({
      sceneIndex:
        index,

      sceneNumber,

      narration,

      path:
        validatedPath,

      outputPath:
        validatedPath,

      audioPath:
        validatedPath
    });

    console.log(
      `[VoiceEngine] Scene ${sceneNumber} narration complete.`
    );
  }

  console.log(
    `[VoiceEngine] All scene narrations complete: ${results.length}/${scenes.length}`
  );

  return results;
}

export default {
  generateVoiceover,
  generateSceneVoiceovers
};