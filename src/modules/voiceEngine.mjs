import fs from 'fs';
import path from 'path';
import https from 'https';

import gTTS from 'gtts';

import { config } from '../config/index.mjs';

function cleanText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function ensureOutputDirectory(outputPath) {
  const directory = path.dirname(
    path.resolve(outputPath)
  );

  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, {
      recursive: true
    });
  }
}

function validateAudioFile(outputPath) {
  if (!fs.existsSync(outputPath)) {
    throw new Error(
      `[VoiceEngine] Audio file was not created: ${outputPath}`
    );
  }

  const stats = fs.statSync(outputPath);

  if (stats.size === 0) {
    throw new Error(
      `[VoiceEngine] Generated audio file is empty: ${outputPath}`
    );
  }

  return outputPath;
}

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
        headers
      },
      response => {
        let data = '';

        response.setEncoding('utf8');

        response.on('data', chunk => {
          data += chunk;
        });

        response.on('end', () => {
          const statusCode = response.statusCode || 0;

          if (
            statusCode < 200 ||
            statusCode >= 300
          ) {
            return reject(
              new Error(
                `HTTP ${statusCode}: ${data.slice(0, 500)}`
              )
            );
          }

          try {
            resolve(
              data
                ? JSON.parse(data)
                : {}
            );
          } catch {
            resolve(data);
          }
        });
      }
    );

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
        headers
      },
      response => {
        const chunks = [];

        response.on('data', chunk => {
          chunks.push(chunk);
        });

        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const statusCode = response.statusCode || 0;

          if (
            statusCode < 200 ||
            statusCode >= 300
          ) {
            return reject(
              new Error(
                `HTTP ${statusCode}: ${buffer
                  .toString('utf8')
                  .slice(0, 500)}`
              )
            );
          }

          resolve(buffer);
        });
      }
    );

    request.on('error', reject);

    if (body) {
      request.write(body);
    }

    request.end();
  });
}

/**
 * ElevenLabs
 */
async function generateWithElevenLabs(
  text,
  outputPath
) {
  const apiKey =
    config.elevenLabsApiKey;

  const voiceId =
    config.elevenLabsVoiceId;

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

  const urlPath =
    `/v1/text-to-speech/${encodeURIComponent(
      voiceId
    )}`;

  const body = JSON.stringify({
    text,

    model_id:
      'eleven_multilingual_v2',

    voice_settings: {
      stability:
        config.ttsConfig.stability,

      similarity_boost:
        config.ttsConfig.similarityBoost,

      style:
        config.ttsConfig.style,

      use_speaker_boost:
        config.ttsConfig.speakerBoost
    }
  });

  const audioBuffer =
    await requestBinary({
      hostname: 'api.elevenlabs.io',

      path: urlPath,

      method: 'POST',

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

  fs.writeFileSync(
    outputPath,
    audioBuffer
  );

  return validateAudioFile(
    outputPath
  );
}

/**
 * Google Cloud TTS
 */
async function generateWithGoogleCloud(
  text,
  outputPath
) {
  const apiKey =
    config.googleCloudTtsApiKey;

  if (!apiKey) {
    throw new Error(
      'GOOGLE_CLOUD_TTS_API_KEY is missing.'
    );
  }

  const body = JSON.stringify({
    input: {
      text
    },

    voice: {
      languageCode:
        config.ttsConfig.language,

      name:
        config.googleCloudTtsVoice
    },

    audioConfig: {
      audioEncoding:
        'MP3',

      speakingRate: 1
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

      method: 'POST',

      headers: {
        'Content-Type':
          'application/json',

        'Content-Length':
          Buffer.byteLength(body)
      },

      body
    });

  if (!result.audioContent) {
    throw new Error(
      'Google Cloud TTS returned no audio.'
    );
  }

  fs.writeFileSync(
    outputPath,
    Buffer.from(
      result.audioContent,
      'base64'
    )
  );

  return validateAudioFile(
    outputPath
  );
}

/**
 * Amazon Polly
 *
 * This function expects AWS credentials.
 * Full AWS Signature V4 support is intentionally
 * kept isolated here so the main voice pipeline
 * remains provider-independent.
 */
async function generateWithAmazonPolly(
  text,
  outputPath
) {
  throw new Error(
    'Amazon Polly provider is configured as a backup slot but AWS Polly request signing is not implemented yet.'
  );
}

/**
 * gTTS emergency fallback
 */
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
        const tts =
          new gTTS(
            text,
            language
          );

        tts.save(
          outputPath,
          error => {
            if (error) {
              return reject(error);
            }

            try {
              resolve(
                validateAudioFile(
                  outputPath
                )
              );
            } catch (validationError) {
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

function buildProviderOrder(
  requestedProvider
) {
  const order = [];

  const primary =
    requestedProvider ||
    config.ttsConfig
      .primaryProvider ||
    'elevenlabs';

  order.push(primary);

  if (
    primary !== 'elevenlabs'
  ) {
    order.push(
      'elevenlabs'
    );
  }

  if (
    config.ttsConfig
      .enableGoogleBackup &&
    !order.includes(
      'google'
    )
  ) {
    order.push(
      'google'
    );
  }

  if (
    config.ttsConfig
      .enableAmazonBackup &&
    !order.includes(
      'amazon'
    )
  ) {
    order.push(
      'amazon'
    );
  }

  if (
    !order.includes(
      'gtts'
    )
  ) {
    order.push(
      'gtts'
    );
  }

  return order;
}

async function generateByProvider(
  provider,
  text,
  outputPath,
  options
) {
  switch (provider) {
    case 'elevenlabs':
      return generateWithElevenLabs(
        text,
        outputPath
      );

    case 'google':
    case 'google-cloud':
      return generateWithGoogleCloud(
        text,
        outputPath
      );

    case 'amazon':
    case 'polly':
      return generateWithAmazonPolly(
        text,
        outputPath
      );

    case 'gtts':
      return generateWithGTTS(
        text,
        outputPath,
        options.languageCode || 'en'
      );

    default:
      throw new Error(
        `Unknown TTS provider: ${provider}`
      );
  }
}

/**
 * Main voice generation function.
 *
 * Supports:
 * ElevenLabs -> Google -> Amazon -> gTTS
 *
 * The function keeps the existing orchestrator
 * signature compatible:
 *
 * generateVoiceover(
 *   text,
 *   outputPath,
 *   options
 * )
 */
export async function generateVoiceover(
  text,
  outputPath,
  options = {}
) {
  const cleanTextValue =
    cleanText(text);

  if (!cleanTextValue) {
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

  const errors = [];

  console.log(
    `[VoiceEngine] Provider order: ${providers.join(
      ' -> '
    )}`
  );

  for (const provider of providers) {
    try {
      console.log(
        `[VoiceEngine] Trying provider: ${provider}`
      );

      const result =
        await generateByProvider(
          provider,
          cleanTextValue,
          outputPath,
          options
        );

      console.log(
        `[VoiceEngine] Voice generated successfully with ${provider}.`
      );

      return result;
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

/**
 * Generate separate audio files for scene narration.
 *
 * This will be used by the next render/sync stage.
 */
export async function generateSceneVoiceovers(
  scenes,
  outputDirectory,
  options = {}
) {
  if (
    !Array.isArray(scenes) ||
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

  const results = [];

  for (
    let index = 0;
    index < scenes.length;
    index += 1
  ) {
    const scene =
      scenes[index];

    const narration =
      cleanText(
        scene?.narration ||
        scene?.voiceover ||
        ''
      );

    if (!narration) {
      throw new Error(
        `[VoiceEngine] Scene ${
          index + 1
        } has no narration.`
      );
    }

    const outputPath =
      path.join(
        outputDirectory,
        `scene-${String(
          index + 1
        ).padStart(2, '0')}.mp3`
      );

    const audioPath =
      await generateVoiceover(
        narration,
        outputPath,
        options
      );

    results.push({
      sceneIndex: index,
      sceneNumber:
        index + 1,
      narration,
      audioPath
    });
  }

  return results;
}