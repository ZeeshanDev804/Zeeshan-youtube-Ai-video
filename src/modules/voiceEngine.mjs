 import fs from 'fs';
import path from 'path';
import gTTS from 'gtts';

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

export async function generateVoiceover(
  text,
  outputPath,
  options = {}
) {
  const cleanTextValue = cleanText(text);

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

  const language = options.language || 'en';

  ensureOutputDirectory(outputPath);

  console.log(
    `[VoiceEngine] Generating ${language} voiceover...`
  );

  return new Promise((resolve, reject) => {
    try {
      const tts = new gTTS(
        cleanTextValue,
        language
      );

      tts.save(
        outputPath,
        error => {
          if (error) {
            console.error(
              '[VoiceEngine] TTS Error:',
              error.message || error
            );

            return reject(error);
          }

          if (!fs.existsSync(outputPath)) {
            return reject(
              new Error(
                '[VoiceEngine] TTS finished but audio file was not created.'
              )
            );
          }

          const stats = fs.statSync(outputPath);

          if (stats.size === 0) {
            return reject(
              new Error(
                '[VoiceEngine] Generated audio file is empty.'
              )
            );
          }

          console.log(
            `[VoiceEngine] Audio saved: ${outputPath}`
          );

          resolve(outputPath);
        }
      );
    } catch (error) {
      reject(error);
    }
  });
}