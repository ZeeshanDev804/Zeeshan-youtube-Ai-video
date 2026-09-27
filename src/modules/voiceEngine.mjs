import gTTS from 'gtts';

export async function generateVoiceover(text, outputPath) {
  return new Promise((resolve, reject) => {
    console.log('[VoiceEngine] Generating TTS audio...');
    const gtts = new gTTS(text, 'en');
    gtts.save(outputPath, (err) => {
      if (err) return reject(err);
      console.log(`[VoiceEngine] Audio saved to ${outputPath}`);
      resolve(outputPath);
    });
  });
}
