import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import config from './config/index.mjs';

async function generateFullShort() {
  console.log("=== Generating Full 30-Second AI Short ===");

  const outputFolder = path.resolve('output_artifacts');
  if (!fs.existsSync(outputFolder)) {
    fs.mkdirSync(outputFolder, { recursive: true });
  }

  const audioPath = path.join(outputFolder, 'voiceover.wav');
  const videoPath = path.join(outputFolder, `viral_short_${Date.now()}.mp4`);

  const textScript = "Here is the top viral news from USA, UK and Europe today. Stay tuned for more trending updates!";

  try {
    // 1. Generate Voice Audio (eSpeak NG Engine)
    console.log("Creating TTS Audio...");
    execSync(`espeak-ng "${textScript}" -w "${audioPath}" -s 140`, { stdio: 'inherit' });

    // 2. Render Full 30 Second HD Video (1080x1920) with Audio Sync
    console.log("Rendering 30s HD Video with Audio Track...");
    const ffmpegCmd = `ffmpeg -f lavfi -i color=c=0x0f172a:s=1080x1920:d=30 -i "${audioPath}" -filter_complex "[0:v]drawtext=text='VIRAL TRENDS USA/UK/EU':fontcolor=gold:fontsize=50:x=(w-text_w)/2:y=200,drawtext=text='${textScript}':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=800:line_spacing=15[v]" -map "[v]" -map 1:a -c:v libx264 -c:a aac -b:a 192k -pix_fmt yuv420p -t 30 -y "${videoPath}"`;

    execSync(ffmpegCmd, { stdio: 'inherit' });
    console.log(`SUCCESS: Full 30s Video Created at: ${videoPath}`);

  } catch (err) {
    console.error("Pipeline Error:", err);
    process.exit(1);
  }
}

generateFullShort();
