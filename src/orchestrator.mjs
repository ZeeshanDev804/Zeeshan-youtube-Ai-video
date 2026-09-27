import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import https from 'https';

const OUTPUT_DIR = path.resolve('output_artifacts');
const VISUAL_DIR = path.join(OUTPUT_DIR, 'visuals');

const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const TARGET_DURATION = 40;
const WIDTH = 1080;
const HEIGHT = 1920;

const SCRIPT =
  'Here is the top viral news from USA, UK and Europe today. Stay tuned for more trending updates!';

function ensureDirectories() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(VISUAL_DIR, { recursive: true });
}

function run(command) {
  console.log(`\n$ ${command}\n`);
  execSync(command, {
    stdio: 'inherit',
    shell: '/bin/bash'
  });
}

function escapeShell(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`');
}

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);

    https
      .get(url, response => {
        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          file.close();
          fs.unlinkSync(destination);

          downloadFile(response.headers.location, destination)
            .then(resolve)
            .catch(reject);

          return;
        }

        if (response.statusCode !== 200) {
          file.close();

          if (fs.existsSync(destination)) {
            fs.unlinkSync(destination);
          }

          reject(
            new Error(
              `Download failed: HTTP ${response.statusCode} - ${url}`
            )
          );

          return;
        }

        response.pipe(file);

        file.on('finish', () => {
          file.close(resolve);
        });
      })
      .on('error', error => {
        file.close();

        if (fs.existsSync(destination)) {
          fs.unlinkSync(destination);
        }

        reject(error);
      });
  });
}

async function pexelsSearch(query) {
  if (!PEXELS_API_KEY) {
    throw new Error('PEXELS_API_KEY is missing.');
  }

  const url =
    `https://api.pexels.com/videos/search?` +
    `query=${encodeURIComponent(query)}` +
    `per_page=10` +
    `orientation=portrait`;

  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          Authorization: PEXELS_API_KEY
        }
      },
      response => {
        let data = '';

        response.on('data', chunk => {
          data += chunk;
        });

        response.on('end', () => {
          if (response.statusCode !== 200) {
            reject(
              new Error(
                `Pexels API failed: HTTP ${response.statusCode}`
              )
            );
            return;
          }

          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    request.on('error', reject);
  });
}

function selectVideoFile(video) {
  if (!video || !Array.isArray(video.video_files)) {
    return null;
  }

  const files = video.video_files
    .filter(file => file && file.link)
    .sort((a, b) => {
      const aPortrait =
        Number(a.height || 0) > Number(a.width || 0);

      const bPortrait =
        Number(b.height || 0) > Number(b.width || 0);

      if (aPortrait !== bPortrait) {
        return bPortrait - aPortrait;
      }

      return Number(b.width || 0) - Number(a.width || 0);
    });

  return files[0] || null;
}

async function findAndDownloadVisual(query, index) {
  console.log(`\nSearching Pexels visuals: "${query}"`);

  const result = await pexelsSearch(query);

  if (!result.videos || result.videos.length === 0) {
    throw new Error(`No Pexels videos found for: ${query}`);
  }

  for (const video of result.videos) {
    const selectedFile = selectVideoFile(video);

    if (!selectedFile) {
      continue;
    }

    const destination = path.join(
      VISUAL_DIR,
      `scene_${index}.mp4`
    );

    console.log(
      `Downloading visual ${index} from Pexels...`
    );

    await downloadFile(
      selectedFile.link,
      destination
    );

    if (
      fs.existsSync(destination) &&
      fs.statSync(destination).size > 50000
    ) {
      console.log(
        `Visual ${index} downloaded successfully.`
      );

      return destination;
    }
  }

  throw new Error(
    `Could not download a valid Pexels visual for: ${query}`
  );
}

function generateVoice(audioPath) {
  console.log('\nCreating TTS audio...');

  const safeScript = escapeShell(SCRIPT);
  const safeAudio = escapeShell(audioPath);

  run(
    `espeak-ng "${safeScript}" -w "${safeAudio}" -s 140`
  );

  if (!fs.existsSync(audioPath)) {
    throw new Error('Voiceover file was not created.');
  }

  if (fs.statSync(audioPath).size < 1000) {
    throw new Error('Voiceover file is empty or invalid.');
  }
}

function getMediaDuration(filePath) {
  const safePath = escapeShell(filePath);

  const output = execSync(
    `ffprobe -v error -show_entries format=duration ` +
      `-of default=noprint_wrappers=1:nokey=1 "${safePath}"`,
    {
      encoding: 'utf8'
    }
  );

  return Number.parseFloat(output.trim());
}

function normalizeVisual(input, output, duration) {
  const safeInput = escapeShell(input);
  const safeOutput = escapeShell(output);

  run(
    `ffmpeg -y -stream_loop -1 -i "${safeInput}" ` +
      `-t ${duration} ` +
      `-vf "scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,` +
      `crop=${WIDTH}:${HEIGHT},` +
      `setsar=1,fps=30" ` +
      `-an ` +
      `-c:v libx264 ` +
      `-preset veryfast ` +
      `-pix_fmt yuv420p ` +
      `"${safeOutput}"`
  );
}

function createConcatFile(files) {
  const concatPath = path.join(
    VISUAL_DIR,
    'concat.txt'
  );

  const content = files
    .map(file => {
      const absolutePath = path
        .resolve(file)
        .replace(/'/g, "'\\''");

      return `file '${absolutePath}'`;
    })
    .join('\n');

  fs.writeFileSync(concatPath, content);

  return concatPath;
}

function concatenateVisuals(files, output) {
  if (files.length === 0) {
    throw new Error('No visual files available.');
  }

  const concatFile = createConcatFile(files);

  const safeConcat = escapeShell(concatFile);
  const safeOutput = escapeShell(output);

  run(
    `ffmpeg -y -f concat -safe 0 ` +
      `-i "${safeConcat}" ` +
      `-c:v libx264 ` +
      `-preset veryfast ` +
      `-pix_fmt yuv420p ` +
      `-r 30 ` +
      `"${safeOutput}"`
  );
}

function renderFinalVideo(
  visualVideo,
  audioPath,
  outputPath,
  duration
) {
  const safeVisual = escapeShell(visualVideo);
  const safeAudio = escapeShell(audioPath);
  const safeOutput = escapeShell(outputPath);

  const title = escapeShell(
    'VIRAL TRENDS USA / UK / EUROPE'
  );

  const subtitle = escapeShell(
    'AI NEWS UPDATE'
  );

  run(
    `ffmpeg -y ` +
      `-i "${safeVisual}" ` +
      `-i "${safeAudio}" ` +
      `-filter_complex "` +
      `[0:v]` +
      `drawbox=x=0:y=0:w=iw:h=170:color=black@0.55:t=fill,` +
      `drawtext=text='${title}':` +
      `fontcolor=white:` +
      `fontsize=48:` +
      `x=(w-text_w)/2:` +
      `y=55,` +
      `drawtext=text='${subtitle}':` +
      `fontcolor=gold:` +
      `fontsize=34:` +
      `x=(w-text_w)/2:` +
      `y=115` +
      `[v]" ` +
      `-map "[v]" ` +
      `-map 1:a:0 ` +
      `-t ${duration} ` +
      `-c:v libx264 ` +
      `-preset medium ` +
      `-crf 20 ` +
      `-c:a aac ` +
      `-b:a 192k ` +
      `-ar 48000 ` +
      `-pix_fmt yuv420p ` +
      `"${safeOutput}"`
  );
}

function validateFinalVideo(videoPath) {
  console.log('\nValidating final video...');

  if (!fs.existsSync(videoPath)) {
    throw new Error('FINAL_VIDEO_MISSING');
  }

  const size = fs.statSync(videoPath).size;

  if (size < 100000) {
    throw new Error('FINAL_VIDEO_TOO_SMALL');
  }

  const duration = getMediaDuration(videoPath);

  if (!Number.isFinite(duration)) {
    throw new Error('FINAL_VIDEO_DURATION_INVALID');
  }

  if (duration < 20 || duration > 59) {
    throw new Error(
      `FINAL_VIDEO_DURATION_INVALID: ${duration.toFixed(2)}s`
    );
  }

  const safePath = escapeShell(videoPath);

  const dimensions = execSync(
    `ffprobe -v error ` +
      `-select_streams v:0 ` +
      `-show_entries stream=width,height ` +
      `-of csv=s=x:p=0 "${safePath}"`,
    {
      encoding: 'utf8'
    }
  ).trim();

  if (dimensions !== `${WIDTH}x${HEIGHT}`) {
    throw new Error(
      `FINAL_VIDEO_RESOLUTION_INVALID: ${dimensions}`
    );
  }

  console.log(
    `FINAL VIDEO OK: ${duration.toFixed(2)}s, ${dimensions}`
  );
}

async function generateFullShort() {
  console.log(
    '=== Generating Full Visual AI Short ==='
  );

  ensureDirectories();

  const audioPath = path.join(
    OUTPUT_DIR,
    'voiceover.wav'
  );

  const rawVisuals = [];

  const normalizedVisuals = [];

  const combinedVisual = path.join(
    VISUAL_DIR,
    'combined_visual.mp4'
  );

  const finalVideo = path.join(
    OUTPUT_DIR,
    `viral_short_${Date.now()}.mp4`
  );

  try {
    // --------------------------------------------------
    // 1. VOICE
    // --------------------------------------------------

    generateVoice(audioPath);

    const audioDuration =
      getMediaDuration(audioPath);

    console.log(
      `Voice duration: ${audioDuration.toFixed(2)} seconds`
    );

    const finalDuration = Math.min(
      TARGET_DURATION,
      Math.max(20, audioDuration)
    );

    // --------------------------------------------------
    // 2. REAL PERSON / NEWS VISUALS
    // --------------------------------------------------

    const visualQueries = [
      'breaking news reporter person',
      'news presenter studio',
      'person looking at news',
      'business news person',
      'technology person',
      'world news city',
      'journalist reporter'
    ];

    const scenesNeeded = 7;

    for (let i = 0; i < scenesNeeded; i++) {
      const query =
        visualQueries[i % visualQueries.length];

      try {
        const visual =
          await findAndDownloadVisual(
            query,
            i + 1
          );

        rawVisuals.push(visual);
      } catch (error) {
        console.warn(
          `Visual ${i + 1} failed: ${error.message}`
        );
      }
    }

    if (rawVisuals.length === 0) {
      throw new Error(
        'NO_VALID_VISUALS: Pexels returned no usable video.'
      );
    }

    console.log(
      `Downloaded ${rawVisuals.length} real visual clips.`
    );

    // --------------------------------------------------
    // 3. NORMALIZE EVERY VISUAL TO 1080x1920
    // --------------------------------------------------

    const sceneDuration =
      finalDuration / rawVisuals.length;

    for (let i = 0; i < rawVisuals.length; i++) {
      const normalizedPath = path.join(
        VISUAL_DIR,
        `normalized_${i + 1}.mp4`
      );

      normalizeVisual(
        rawVisuals[i],
        normalizedPath,
        sceneDuration
      );

      normalizedVisuals.push(normalizedPath);
    }

    // --------------------------------------------------
    // 4. JOIN VISUAL SCENES
    // --------------------------------------------------

    concatenateVisuals(
      normalizedVisuals,
      combinedVisual
    );

    // --------------------------------------------------
    // 5. FINAL VIDEO + VOICE
    // --------------------------------------------------

    renderFinalVideo(
      combinedVisual,
      audioPath,
      finalVideo,
      finalDuration
    );

    // --------------------------------------------------
    // 6. FINAL VALIDATION
    // --------------------------------------------------

    validateFinalVideo(finalVideo);

    console.log(
      '\n======================================'
    );

    console.log(
      'SUCCESS: Full visual Short created.'
    );

    console.log(
      `Video: ${finalVideo}`
    );

    console.log(
      `Duration: ${finalDuration.toFixed(2)} seconds`
    );

    console.log(
      'Resolution: 1080x1920'
    );

    console.log(
      'Visuals: REAL Pexels video clips'
    );

    console.log(
      'Audio: eSpeak voiceover'
    );

    console.log(
      '======================================\n'
    );
  } catch (error) {
    console.error(
      '\nPIPELINE FAILED:'
    );

    console.error(error.message);

    // IMPORTANT:
    // Never leave a fake black video as success output.
    if (fs.existsSync(finalVideo)) {
      try {
        fs.unlinkSync(finalVideo);
      } catch {}
    }

    process.exit(1);
  }
}

generateFullShort();