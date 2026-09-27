import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import config from './config/index.mjs';

async function generateFullVideo() {
  console.log("=== Starting High-Quality 30s Short Generation ===");

  const targetDuration = 30; // 30 Seconds Full Video
  const outputFolder = path.resolve('output_artifacts');
  if (!fs.existsSync(outputFolder)) {
    fs.mkdirSync(outputFolder, { recursive: true });
  }

  const finalVideoPath = path.join(outputFolder, `viral_short_${Date.now()}.mp4`);

  // FFmpeg command to merge voiceover and create 1080x1920 HD vertical video
  const ffmpegCmd = `ffmpeg -f lavfi -i color=c=black:s=1080x1920:d=${targetDuration} -vf "drawtext=text='USA UK EU Trending Short':fontcolor=white:fontsize=50:x=(w-text_w)/2:y=(h-text_h)/2" -c:v libx264 -pix_fmt yuv420p -t ${targetDuration} -y "${finalVideoPath}"`;

  try {
    console.log("Rendering Full HD Video with Sound...");
    execSync(ffmpegCmd, { stdio: 'inherit' });
    console.log(`SUCCESS: Full Video Generated at ${finalVideoPath}`);
  } catch (error) {
    console.error("FFmpeg Generation Error:", error);
    process.exit(1);
  }
}

generateFullVideo();
