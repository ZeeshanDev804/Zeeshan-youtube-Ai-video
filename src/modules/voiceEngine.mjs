import fs from 'fs';
import path from 'path';
import https from 'https';
import crypto from 'crypto';

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

  if (!stats.isFile() || stats.size === 0) {
    throw new Error(
      `[VoiceEngine] Generated audio file is empty or invalid: ${outputPath}`
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
        headers,
        timeout: 60000
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
            return reject(
              new Error(
                `HTTP ${statusCode}: ${data.slice(
                  0,
                  1000
                )}`
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

    request.on('timeout', () => {
      request.destroy(
        new Error(
          'HTTPS request timed out after 60 seconds.'
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
        timeout: 60000
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
            return reject(
              new Error(
                `HTTP ${statusCode}: ${buffer
                  .toString('utf8')
                  .slice(0, 1000)}`
              )
            );
          }

          resolve(buffer);
        });
      }
    );

    request.on('timeout', () => {
      request.destroy(
        new Error(
          'HTTPS request timed out after 60 seconds.'
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
        config.ttsConfig?.stability ??
        0.45,

      similarity_boost:
        config.ttsConfig
          ?.similarityBoost ??
        0.75,

      style:
        config.ttsConfig?.style ??
        0.15,

      use_speaker_boost:
        config.ttsConfig
          ?.speakerBoost ??
        true
    }
  });

  const audioBuffer =
    await requestBinary({
      hostname:
        'api.elevenlabs.io',

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

  if (
    !audioBuffer ||
    audioBuffer.length === 0
  ) {
    throw new Error(
      'ElevenLabs returned empty audio.'
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
    config.googleCloudTtsApiKey;

  if (!apiKey) {
    throw new Error(
      'GOOGLE_CLOUD_TTS_API_KEY is missing.'
    );
  }

  const languageCode =
    config.ttsConfig?.language ||
    'en-US';

  const voiceName =
    config.googleCloudTtsVoice ||
    'en-US-Neural2-D';

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

      speakingRate: 1.0,

      pitch: 0
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
    audioBuffer.length === 0
  ) {
    throw new Error(
      'Google Cloud TTS returned empty decoded audio.'
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
   AWS Signature V4 helpers
   ========================================================= */

function hmacSha256(
  key,
  data,
  encoding = undefined
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

function awsEncode(value) {
  return encodeURIComponent(
    String(value)
  )
    .replace(
      /!/g,
      '%21'
    )
    .replace(
      /'/g,
      '%27'
    )
    .replace(
      /\(/g,
      '%28'
    )
    .replace(
      /\)/g,
      '%29'
    )
    .replace(
      /\*/g,
      '%2A'
    );
}

function buildAmzDate(date = new Date()) {
  const iso =
    date.toISOString();

  return iso
    .replace(
      /[:-]|\.\d{3}/g,
      ''
    )
    .replace(
      'Z',
      'Z'
    );
}

function getDateStamp(amzDate) {
  return amzDate.slice(
    0,
    8
  );
}

function getAwsPollyCredentials() {
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

function createAwsPollyAuthorization({
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

  const headers = {
    host,
    'content-type':
      'application/json',
    'x-amz-content-sha256':
      payloadHash,
    'x-amz-date':
      amzDate
  };

  if (sessionToken) {
    headers[
      'x-amz-security-token'
    ] = sessionToken;
  }

  const sortedHeaderNames =
    Object.keys(headers)
      .map(name =>
        name.toLowerCase()
      )
      .sort();

  const canonicalHeaders =
    sortedHeaderNames
      .map(name => {
        const value =
          headers[name];

        return `${name}:${String(
          value
        ).trim()}\n`;
      })
      .join('');

  const signedHeaders =
    sortedHeaderNames.join(
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
    signedHeaders,
    authorization,
    headers
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
    getAwsPollyCredentials();

  const region =
    getAwsRegion();

  const voiceId =
    getAwsPollyVoice();

  const engine =
    getAwsPollyEngine();

  const host =
    `polly.${region}.amazonaws.com`;

  const bodyObject = {
    OutputFormat:
      'mp3',

    Text: text,

    TextType:
      'text',

    VoiceId:
      voiceId,

    Engine:
      engine
  };

  const body =
    JSON.stringify(
      bodyObject
    );

  const amzDate =
    buildAmzDate();

  const signing =
    createAwsPollyAuthorization({
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

  let audioBuffer;

  try {
    audioBuffer =
      await requestBinary({
        hostname: host,

        path:
          '/v1/speech',

        method:
          'POST',

        headers,

        body
      });
  } catch (error) {
    const message =
      error?.message ||
      String(error);

    /*
     * Some AWS regions/accounts may not
     * support the selected neural voice.
     * Retry with standard engine before
     * giving the provider up.
     */
    if (
      engine === 'neural'
    ) {
      console.warn(
        `[VoiceEngine] Amazon Polly neural request failed. Retrying with standard engine: ${message}`
      );

      const fallbackBody =
        JSON.stringify({
          OutputFormat:
            'mp3',

          Text: text,

          TextType:
            'text',

          VoiceId:
            voiceId,

          Engine:
            'standard'
        });

      const fallbackAmzDate =
        buildAmzDate();

      const fallbackSigning =
        createAwsPollyAuthorization({
          ...credentials,
          region,
          host,
          body:
            fallbackBody,
          amzDate:
            fallbackAmzDate
        });

      const fallbackHeaders = {
        'Content-Type':
          'application/json',

        'Content-Length':
          Buffer.byteLength(
            fallbackBody
          ),

        Host:
          host,

        'X-Amz-Date':
          fallbackAmzDate,

        'X-Amz-Content-Sha256':
          fallbackSigning.payloadHash,

        Authorization:
          fallbackSigning.authorization
      };

      if (
        credentials.sessionToken
      ) {
        fallbackHeaders[
          'X-Amz-Security-Token'
        ] =
          credentials.sessionToken;
      }

      audioBuffer =
        await requestBinary({
          hostname: host,

          path:
            '/v1/speech',

          method:
            'POST',

          headers:
            fallbackHeaders,

          body:
            fallbackBody
        });
    } else {
      throw error;
    }
  }

  if (
    !audioBuffer ||
    audioBuffer.length === 0
  ) {
    throw new Error(
      'Amazon Polly returned empty audio.'
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
              return reject(
                error
              );
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

  order.push(
    primary
  );

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
    'elevenlabs'
  );

  const googleBackup =
    config.ttsConfig
      ?.enableGoogleBackup ??
    String(
      process.env.TTS_ENABLE_GOOGLE_BACKUP ||
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
      process.env.TTS_ENABLE_AMAZON_BACKUP ||
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
        options.languageCode ||
          'en'
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

  for (
    const provider of providers
  ) {
    try {
      /*
       * Remove an old failed output before
       * attempting the next provider.
       */
      if (
        fs.existsSync(
          outputPath
        )
      ) {
        fs.unlinkSync(
          outputPath
        );
      }

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

      validateAudioFile(
        outputPath
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

    console.log(
      `[VoiceEngine] Preparing scene ${
        index + 1
      }/${scenes.length} narration...`
    );

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
        ).padStart(
          2,
          '0'
        )}.mp3`
      );

    console.log(
      `[VoiceEngine] Scene ${
        index + 1
      } text length: ${narration.length} characters`
    );

    const audioPath =
      await generateVoiceover(
        narration,
        outputPath,
        options
      );

    results.push({
      sceneIndex:
        index,

      sceneNumber:
        index + 1,

      narration,

      audioPath
    });

    console.log(
      `[VoiceEngine] Scene ${
        index + 1
      } narration complete.`
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