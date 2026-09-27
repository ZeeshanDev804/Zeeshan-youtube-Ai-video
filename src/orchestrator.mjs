import path from 'path';
import fs from 'fs';
import { generateScript } from './modules/scriptEngine.mjs';
import { generateVoiceover } from './modules/voiceEngine.mjs';
import { fetchStockVideos } from './modules/visualEngine.mjs';
import { renderFinalVideo } from './modules/renderEngine.mjs';

export async function runVideoGenerator(topic) {
  console.log(`\n=== Starting Video Generation Pipeline for: "${topic}" ===\n`);
  
  const tempDir = path.join(process.cwd(), 'temp');
  const outputDir = path.join(process.cwd(), 'output');
  
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const audioPath = path.join(tempDir, 'voice.mp3');
  const finalVideoPath = path.join(outputDir, 'final_shorts.mp4');

  try {
    // 1. Script Generation
    const script = await generateScript(topic);
    
    // 2. Voiceover Generation
    await generateVoiceover(script.scriptText, audioPath);
    
    // 3. Visual Search
    const videos = await fetchStockVideos(topic);
    
    // 4. Video Rendering
    await renderFinalVideo(audioPath, [], finalVideoPath);

    console.log(`\n🎉 Pipeline completed successfully! Video saved at: ${finalVideoPath}\n`);
  } catch (error) {
    console.error('\n❌ Error in Video Pipeline:', error.message);
  }
}

// Auto-run test
runVideoGenerator('Space Secrets');
