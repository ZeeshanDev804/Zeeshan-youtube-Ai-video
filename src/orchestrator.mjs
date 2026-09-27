import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import config from './config/index.mjs';

async function generateViralShort() {
  console.log("=== Starting AI Video & Voice Pipeline ===");

  const outputFolder = path.resolve('output_artifacts');
  if (!fs.existsSync(outputFolder)) {
    fs.mkdirSync(outputFolder, { recursive: true });
  }

  const audioPath = path.join(outputFolder, 'voiceover.mp3');
  const finalVideoPath = path.join(outputFolder, `viral_short_${Date.now()}.mp4`);

  // Step 1: Generate Voiceover using eSpeak / TTS Engine
  console.log("Generating Voiceover Audio...");
  const scriptText = "Welcome to today's trending story. Top stories from US, UK and Europe making headlines right now.";
  
  try {
    // Generate clear voice audio
    execSync(`espeak-ng "${scriptText}" -w "${audioPath}"`, { stdio: 'inherit' });
  } catch (err) {
    console.log("eSpeak fallback to basic audio...");
    execSync(`ffmpeg -f lavfi -i sine=frequency=1000:duration=30 -y "${audioPath}"`, { stdio: 'inherit' });
  }

  // Step 2: Render 30-Second HD Video with Audio Track
  console.log("Rendering Final Video with Sound...");
  const ffmpegCmd = `ffmpeg -f lavfi -i color=c=0x111827:s=1080x1920:d=30 -i "${audioPath}" -vf "drawtext=text='TRENDING SHORT':fontcolor=gold:fontsize=60:x=(w-text_w)/2:y=300,drawtext=text='USA • UK • EU':fontcolor=white:fontsize=40:x=(w-text_w)/2:y=400" -c:v libx264 -c:a aac -pix_fmt yuv420p -shortest -y "${finalVideoPath}"`;

  try {
    execSync(ffmpegCmd, { stdio: 'inherit' });
    console.log(`SUCCESS: Video & Audio Created at ${finalVideoPath}`);
  } catch (error) {
    console.error("Rendering Error:", error);
    process.exit(1);
  }
}

generateViralShort();
