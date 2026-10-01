// ---------------------------------------------------------
// PREPARE BACKGROUND MUSIC
// ---------------------------------------------------------

async function prepareBackgroundMusic(
  musicPath,
  duration,
  workingDirectory
) {
  validateMusicVolume();

  const requestedDuration = Number(duration);

  if (
    !Number.isFinite(requestedDuration) ||
    requestedDuration <= 0
  ) {
    throw new Error(
      `[RenderEngine] Invalid background music duration: ${duration}`
    );
  }

  const outputPath = path.join(
    workingDirectory,
    "background-music.m4a"
  );

  fs.mkdirSync(
    workingDirectory,
    {
      recursive: true
    }
  );

  console.log(
    `[RenderEngine] Preparing background music: ${musicPath}`
  );

  console.log(
    `[RenderEngine] Music volume: ${MUSIC_VOLUME}`
  );

  console.log(
    `[RenderEngine] Music duration target: ${requestedDuration.toFixed(3)}s`
  );

  // -------------------------------------------------------
  // CHECK SOURCE FILE
  // -------------------------------------------------------

  let sourceIsReadable = false;

  try {
    assertFile(
      musicPath,
      "Background music"
    );

    const sourceStats =
      fs.statSync(musicPath);

    console.log(
      `[RenderEngine] Background music size: ${sourceStats.size} bytes`
    );

    /*
     * Do not trust file extension or file existence.
     * The previous background.mp3 existed but was corrupt.
     *
     * FFprobe must successfully detect a real audio stream.
     */

    const probe =
      await runFFprobe([
        "-v",
        "error",

        "-select_streams",
        "a:0",

        "-show_entries",
        "stream=codec_name,duration",

        "-of",
        "json",

        musicPath
      ]);

    let probeData;

    try {
      probeData =
        JSON.parse(
          probe.stdout
        );
    } catch {
      probeData = null;
    }

    const audioStreams =
      Array.isArray(
        probeData?.streams
      )
        ? probeData.streams
        : [];

    if (
      audioStreams.length > 0 &&
      audioStreams[0]?.codec_name
    ) {
      sourceIsReadable = true;

      console.log(
        `[RenderEngine] Background music source validation: PASS`
      );

      console.log(
        `[RenderEngine] Detected audio codec: ${audioStreams[0].codec_name}`
      );
    } else {
      console.warn(
        `[RenderEngine] Background music source validation: FAIL`
      );

      console.warn(
        `[RenderEngine] FFprobe could not detect a valid audio stream.`
      );
    }
  } catch (error) {
    console.warn(
      `[RenderEngine] Background music source validation failed.`
    );

    console.warn(
      `[RenderEngine] Reason: ${error.message}`
    );
  }

  // -------------------------------------------------------
  // SILENT FALLBACK
  // -------------------------------------------------------

  async function createSilentBackgroundMusic() {
    console.warn(
      `[RenderEngine] Creating exact-duration silent background track: ${requestedDuration.toFixed(3)}s`
    );

    await runFFmpeg([
      "-y",

      "-f",
      "lavfi",

      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=48000",

      "-t",
      requestedDuration.toFixed(3),

      "-vn",

      "-c:a",
      "aac",

      "-b:a",
      "192k",

      "-ar",
      "48000",

      "-ac",
      "2",

      outputPath
    ]);

    assertFile(
      outputPath,
      "Silent background music"
    );

    const silentInfo =
      await getMediaInfo(
        outputPath
      );

    if (!silentInfo.hasAudio) {
      throw new Error(
        "[RenderEngine] Silent background music has no audio stream."
      );
    }

    if (
      silentInfo.duration <
      requestedDuration - 0.25
    ) {
      throw new Error(
        `[RenderEngine] Silent background music is too short. Expected ${requestedDuration}s, got ${silentInfo.duration}s`
      );
    }

    console.log(
      `[RenderEngine] Silent background music ready: ${silentInfo.duration.toFixed(3)}s`
    );

    return outputPath;
  }

  // -------------------------------------------------------
  // INVALID/CORRUPT SOURCE
  // -------------------------------------------------------

  if (!sourceIsReadable) {
    console.warn(
      `[RenderEngine] Source background music is invalid/corrupt.`
    );

    console.warn(
      `[RenderEngine] Skipping corrupt MP3 and using silent fallback.`
    );

    return createSilentBackgroundMusic();
  }

  // -------------------------------------------------------
  // PREPARE VALID MUSIC
  // -------------------------------------------------------

  try {
    await runFFmpeg([
      "-y",

      "-stream_loop",
      "-1",

      "-i",
      musicPath,

      "-t",
      requestedDuration.toFixed(3),

      "-vn",

      "-af",
      [
        `volume=${MUSIC_VOLUME}`,
        "aresample=48000",
        `apad=pad_dur=${requestedDuration.toFixed(3)}`,
        `atrim=duration=${requestedDuration.toFixed(3)}`,
        "asetpts=N/SR/TB"
      ].join(","),

      "-ar",
      "48000",

      "-ac",
      "2",

      "-c:a",
      "aac",

      "-b:a",
      "192k",

      outputPath
    ]);
  } catch (error) {
    console.warn(
      `[RenderEngine] Background music processing failed.`
    );

    console.warn(
      `[RenderEngine] Reason: ${error.message}`
    );

    console.warn(
      `[RenderEngine] Falling back to silent background music.`
    );

    return createSilentBackgroundMusic();
  }

  // -------------------------------------------------------
  // VERIFY PREPARED MUSIC
  // -------------------------------------------------------

  assertFile(
    outputPath,
    "Prepared background music"
  );

  const preparedInfo =
    await getMediaInfo(
      outputPath
    );

  if (!preparedInfo.hasAudio) {
    console.warn(
      `[RenderEngine] Prepared background music has no audio stream.`
    );

    return createSilentBackgroundMusic();
  }

  if (
    preparedInfo.duration <
    requestedDuration - 0.25
  ) {
    console.warn(
      `[RenderEngine] Prepared background music is too short.`
    );

    console.warn(
      `[RenderEngine] Expected: ${requestedDuration.toFixed(3)}s`
    );

    console.warn(
      `[RenderEngine] Actual: ${preparedInfo.duration.toFixed(3)}s`
    );

    return createSilentBackgroundMusic();
  }

  console.log(
    `[RenderEngine] Prepared background music PASS: ${preparedInfo.duration.toFixed(3)}s`
  );

  return outputPath;
}