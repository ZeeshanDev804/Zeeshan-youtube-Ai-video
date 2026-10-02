import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const DEFAULT_VOLUME = Number(
  process.env.BACKGROUND_MUSIC_VOLUME ?? 0.10
);

const DEFAULT_MUSIC_PATH = path.resolve(
  process.env.BACKGROUND_MUSIC_PATH ??
    "./output/music/background.mp3"
);

function assertValidVolume(volume) {
  if (
    !Number.isFinite(volume) ||
    volume < 0 ||
    volume > 1
  ) {
    throw new Error(
      `[MusicEngine] Invalid music volume: ${volume}. Use 0.0 to 1.0.`
    );
  }
}

function assertValidDuration(duration) {
  if (
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    throw new Error(
      `[MusicEngine] Invalid duration: ${duration}`
    );
  }
}

async function runFFmpeg(args) {
  try {
    console.log(
      `[MusicEngine] FFmpeg args: ${JSON.stringify(args)}`
    );

    await execFileAsync("ffmpeg", args, {
      maxBuffer: 1024 * 1024 * 30
    });
  } catch (error) {
    const details =
      error?.stderr ||
      error?.stdout ||
      error?.message ||
      "Unknown FFmpeg error";

    throw new Error(
      `[MusicEngine] FFmpeg failed: ${details}`
    );
  }
}

async function runFFprobe(args) {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      args,
      {
        maxBuffer: 1024 * 1024 * 20
      }
    );

    return stdout.trim();
  } catch (error) {
    const details =
      error?.stderr ||
      error?.stdout ||
      error?.message ||
      "Unknown FFprobe error";

    throw new Error(
      `[MusicEngine] FFprobe failed: ${details}`
    );
  }
}

export function getBackgroundMusicPath() {
  return DEFAULT_MUSIC_PATH;
}

export function validateMusicFile(
  musicPath = DEFAULT_MUSIC_PATH
) {
  if (!fs.existsSync(musicPath)) {
    throw new Error(
      `[MusicEngine] Background music file not found: ${musicPath}`
    );
  }

  const stats = fs.statSync(musicPath);

  if (!stats.isFile()) {
    throw new Error(
      `[MusicEngine] Background music path is not a file: ${musicPath}`
    );
  }

  if (stats.size <= 0) {
    throw new Error(
      `[MusicEngine] Background music file is empty: ${musicPath}`
    );
  }

  console.log(
    `[MusicEngine] Background music size: ${stats.size} bytes`
  );

  return true;
}

export async function isMusicFileReadable(
  musicPath = DEFAULT_MUSIC_PATH
) {
  try {
    validateMusicFile(musicPath);

    const output = await runFFprobe([
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_name,duration,sample_rate,channels",
      "-of",
      "default=noprint_wrappers=1:nokey=0",
      musicPath
    ]);

    if (!output) {
      throw new Error(
        "FFprobe returned no audio stream information."
      );
    }

    const codecMatch =
      output.match(/codec_name=([^\r\n]+)/);

    const durationMatch =
      output.match(/duration=([^\r\n]+)/);

    const sampleRateMatch =
      output.match(/sample_rate=([^\r\n]+)/);

    const channelsMatch =
      output.match(/channels=([^\r\n]+)/);

    if (!codecMatch) {
      throw new Error(
        "No readable audio codec was detected."
      );
    }

    const codecName = codecMatch[1].trim();

    const duration =
      durationMatch
        ? Number(durationMatch[1].trim())
        : NaN;

    const sampleRate =
      sampleRateMatch
        ? Number(sampleRateMatch[1].trim())
        : NaN;

    const channels =
      channelsMatch
        ? Number(channelsMatch[1].trim())
        : NaN;

    if (!codecName) {
      throw new Error(
        "Audio codec is empty."
      );
    }

    if (
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      throw new Error(
        `Invalid audio duration: ${duration}`
      );
    }

    if (
      !Number.isFinite(sampleRate) ||
      sampleRate <= 0
    ) {
      throw new Error(
        `Invalid sample rate: ${sampleRate}`
      );
    }

    if (
      !Number.isFinite(channels) ||
      channels <= 0
    ) {
      throw new Error(
        `Invalid channel count: ${channels}`
      );
    }

    console.log(
      `[MusicEngine] Music validation passed: codec=${codecName}, duration=${duration.toFixed(
        3
      )}s, sampleRate=${sampleRate}, channels=${channels}`
    );

    return {
      valid: true,
      codec: codecName,
      duration,
      sampleRate,
      channels
    };
  } catch (error) {
    console.error(
      `[MusicEngine] Music validation failed: ${error.message}`
    );

    return {
      valid: false,
      error: error.message
    };
  }
}

export async function getMusicDuration(
  musicPath = DEFAULT_MUSIC_PATH
) {
  const validation =
    await isMusicFileReadable(musicPath);

  if (!validation.valid) {
    throw new Error(
      `[MusicEngine] Background music is not valid: ${validation.error}`
    );
  }

  return validation.duration;
}

export async function prepareBackgroundMusic(
  duration,
  outputPath,
  options = {}
) {
  assertValidDuration(duration);

  const musicPath =
    options.musicPath ||
    DEFAULT_MUSIC_PATH;

  const volume =
    options.volume ?? DEFAULT_VOLUME;

  assertValidVolume(volume);

  fs.mkdirSync(
    path.dirname(outputPath),
    {
      recursive: true
    }
  );

  console.log(
    `[MusicEngine] Preparing background music`
  );

  console.log(
    `[MusicEngine] Source: ${musicPath}`
  );

  console.log(
    `[MusicEngine] Target duration: ${duration.toFixed(
      3
    )}s`
  );

  console.log(
    `[MusicEngine] Volume: ${volume}`
  );

  const validation =
    await isMusicFileReadable(musicPath);

  if (!validation.valid) {
    throw new Error(
      `[MusicEngine] Cannot prepare background music because source audio is invalid: ${validation.error}`
    );
  }

  const fadeDuration =
    Math.min(1, Math.max(0.2, duration / 10));

  const fadeOutStart =
    Math.max(
      0,
      duration - fadeDuration
    );

  const audioFilter = [
    `volume=${volume}`,
    "aresample=48000",
    `atrim=duration=${duration.toFixed(3)}`,
    "asetpts=N/SR/TB",
    `afade=t=in:st=0:d=${fadeDuration.toFixed(3)}`,
    `afade=t=out:st=${fadeOutStart.toFixed(
      3
    )}:d=${fadeDuration.toFixed(3)}`
  ].join(",");

  const args = [
    "-y",
    "-stream_loop",
    "-1",
    "-i",
    musicPath,
    "-t",
    duration.toFixed(3),
    "-vn",
    "-af",
    audioFilter,
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    outputPath
  ];

  console.log(
    `[MusicEngine] Preparing processed music track`
  );

  await runFFmpeg(args);

  if (!fs.existsSync(outputPath)) {
    throw new Error(
      `[MusicEngine] Prepared music was not created: ${outputPath}`
    );
  }

  const stats =
    fs.statSync(outputPath);

  if (stats.size <= 0) {
    throw new Error(
      `[MusicEngine] Prepared music is empty: ${outputPath}`
    );
  }

  const preparedValidation =
    await isMusicFileReadable(outputPath);

  if (!preparedValidation.valid) {
    throw new Error(
      `[MusicEngine] Prepared music failed validation: ${preparedValidation.error}`
    );
  }

  const durationDifference =
    Math.abs(
      preparedValidation.duration -
        duration
    );

  if (durationDifference > 1.0) {
    throw new Error(
      `[MusicEngine] Prepared music duration mismatch. Expected ${duration.toFixed(
        3
      )}s but received ${preparedValidation.duration.toFixed(
        3
      )}s.`
    );
  }

  console.log(
    `[MusicEngine] Prepared music successfully: ${outputPath}`
  );

  return outputPath;
}

export async function mixNarrationAndMusic(
  narrationPath,
  musicPath,
  outputPath,
  duration,
  options = {}
) {
  if (!fs.existsSync(narrationPath)) {
    throw new Error(
      `[MusicEngine] Narration file not found: ${narrationPath}`
    );
  }

  if (!fs.existsSync(musicPath)) {
    throw new Error(
      `[MusicEngine] Music file not found: ${musicPath}`
    );
  }

  assertValidDuration(duration);

  const musicVolume =
    options.volume ?? DEFAULT_VOLUME;

  assertValidVolume(musicVolume);

  const duckThreshold =
    Number(
      options.duckThreshold ?? 0.03
    );

  const duckRatio =
    Number(
      options.duckRatio ?? 8
    );

  const duckAttack =
    Number(
      options.duckAttack ?? 20
    );

  const duckRelease =
    Number(
      options.duckRelease ?? 500
    );

  if (
    !Number.isFinite(duckThreshold) ||
    duckThreshold <= 0
  ) {
    throw new Error(
      `[MusicEngine] Invalid duckThreshold: ${duckThreshold}`
    );
  }

  if (
    !Number.isFinite(duckRatio) ||
    duckRatio < 1
  ) {
    throw new Error(
      `[MusicEngine] Invalid duckRatio: ${duckRatio}`
    );
  }

  fs.mkdirSync(
    path.dirname(outputPath),
    {
      recursive: true
    }
  );

  const musicValidation =
    await isMusicFileReadable(musicPath);

  if (!musicValidation.valid) {
    throw new Error(
      `[MusicEngine] Cannot mix invalid background music: ${musicValidation.error}`
    );
  }

  console.log(
    `[MusicEngine] Mixing narration + background music`
  );

  console.log(
    `[MusicEngine] Music volume: ${musicVolume}`
  );

  console.log(
    `[MusicEngine] Ducking ratio: ${duckRatio}`
  );

  const filterComplex = [
    `[0:a]aresample=48000,asetpts=PTS-STARTPTS,atrim=duration=${duration.toFixed(
      3
    )}[narration]`,

    `[1:a]aresample=48000,asetpts=PTS-STARTPTS,atrim=duration=${duration.toFixed(
      3
    )},volume=${musicVolume}[music]`,

    `[music][narration]sidechaincompress=threshold=${duckThreshold}:ratio=${duckRatio}:attack=${duckAttack}:release=${duckRelease}:makeup=1[duckedMusic]`,

    `[narration][duckedMusic]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[mixed]`,

    `[mixed]atrim=duration=${duration.toFixed(
      3
    )},asetpts=N/SR/TB[outa]`
  ].join(";");

  const args = [
    "-y",
    "-i",
    narrationPath,
    "-i",
    musicPath,
    "-filter_complex",
    filterComplex,
    "-map",
    "[outa]",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-t",
    duration.toFixed(3),
    outputPath
  ];

  console.log(
    `[MusicEngine] Mix FFmpeg command: ffmpeg ${args.join(
      " "
    )}`
  );

  await runFFmpeg(args);

  if (!fs.existsSync(outputPath)) {
    throw new Error(
      `[MusicEngine] Mixed audio was not created: ${outputPath}`
    );
  }

  const stats =
    fs.statSync(outputPath);

  if (stats.size <= 0) {
    throw new Error(
      `[MusicEngine] Mixed audio is empty: ${outputPath}`
    );
  }

  const outputValidation =
    await isMusicFileReadable(outputPath);

  if (!outputValidation.valid) {
    throw new Error(
      `[MusicEngine] Final mixed audio failed validation: ${outputValidation.error}`
    );
  }

  const durationDifference =
    Math.abs(
      outputValidation.duration -
        duration
    );

  if (durationDifference > 1.0) {
    throw new Error(
      `[MusicEngine] Final mixed audio duration mismatch. Expected ${duration.toFixed(
        3
      )}s but received ${outputValidation.duration.toFixed(
        3
      )}s.`
    );
  }

  console.log(
    `[MusicEngine] Narration + music mix completed successfully`
  );

  return outputPath;
}

export default {
  getBackgroundMusicPath,
  validateMusicFile,
  isMusicFileReadable,
  getMusicDuration,
  prepareBackgroundMusic,
  mixNarrationAndMusic
};
