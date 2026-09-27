import axios from 'axios';
import { config } from '../config/index.mjs';

const PEXELS_API_URL = 'https://api.pexels.com/videos/search';

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getVideoFiles(video) {
  return Array.isArray(video?.video_files)
    ? video.video_files.filter(file => file?.link)
    : [];
}

function scoreVideo(video) {
  const files = getVideoFiles(video);

  if (!files.length) return -1;

  const portraitFiles = files.filter(file => {
    const width = Number(file.width || 0);
    const height = Number(file.height || 0);

    return height > width;
  });

  const candidates =
    portraitFiles.length > 0 ? portraitFiles : files;

  const scored = candidates.map(file => {
    const width = Number(file.width || 0);
    const height = Number(file.height || 0);

    let score = 0;

    // Prefer portrait footage.
    if (height > width) score += 100;

    // Prefer reasonable vertical resolution.
    if (height >= 1280) score += 40;
    if (height >= 1920) score += 30;

    // Prefer 720p+ width.
    if (width >= 720) score += 20;
    if (width >= 1080) score += 20;

    // Avoid extremely tiny files.
    if (width < 480 || height < 640) {
      score -= 50;
    }

    // Prefer mp4.
    if (
      String(file.file_type || '').toLowerCase()
        .includes('mp4')
    ) {
      score += 10;
    }

    return {
      file,
      score
    };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored[0]?.score || 0;
}

function selectBestFile(video) {
  const files = getVideoFiles(video);

  if (!files.length) {
    return null;
  }

  const scored = files.map(file => {
    const width = Number(file.width || 0);
    const height = Number(file.height || 0);

    let score = 0;

    if (height > width) score += 100;
    if (height >= 1920) score += 40;
    else if (height >= 1280) score += 25;

    if (width >= 1080) score += 30;
    else if (width >= 720) score += 20;

    if (
      String(file.file_type || '')
        .toLowerCase()
        .includes('mp4')
    ) {
      score += 10;
    }

    return {
      file,
      score
    };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored[0]?.file || null;
}

function buildSearchQuery(scene, topic) {
  const prompt = cleanText(scene?.visualPrompt);

  if (prompt) {
    // Remove words that are less useful for stock-video search.
    return prompt
      .replace(
        /\b(cinematic|ultra|high quality|4k|8k|vertical|9:16|realistic)\b/gi,
        ''
      )
      .replace(/\s+/g, ' ')
      .trim();
  }

  const narration = cleanText(scene?.narration);

  if (narration) {
    return narration.slice(0, 100);
  }

  return cleanText(topic);
}

async function searchPexels(query, perPage = 8) {
  if (!config.pexelsApiKey) {
    throw new Error(
      '[VisualEngine] PEXELS_API_KEY is missing.'
    );
  }

  const response = await axios.get(
    PEXELS_API_URL,
    {
      params: {
        query,
        per_page: perPage,
        orientation: 'portrait'
      },
      headers: {
        Authorization: config.pexelsApiKey
      },
      timeout: 15000
    }
  );

  return response?.data?.videos || [];
}

export async function fetchStockVideos(query) {
  const cleanQuery = cleanText(query);

  if (!cleanQuery) {
    return [];
  }

  console.log(
    `[VisualEngine] Searching Pexels: ${cleanQuery}`
  );

  try {
    const videos = await searchPexels(cleanQuery, 8);

    return videos;
  } catch (error) {
    console.error(
      '[VisualEngine] Pexels API Error:',
      error.response?.data || error.message
    );

    return [];
  }
}

export async function findVisualForScene(scene, topic) {
  const query = buildSearchQuery(scene, topic);

  console.log(
    `[VisualEngine] Scene ${scene?.sceneNumber || '?'} query: ${query}`
  );

  const videos = await fetchStockVideos(query);

  if (!videos.length) {
    console.warn(
      `[VisualEngine] No footage found for: ${query}`
    );

    return null;
  }

  const ranked = videos
    .map(video => ({
      video,
      score: scoreVideo(video)
    }))
    .filter(item => item.score >= 0)
    .sort((a, b) => b.score - a.score);

  const best = ranked[0]?.video;

  if (!best) {
    return null;
  }

  const file = selectBestFile(best);

  if (!file?.link) {
    return null;
  }

  return {
    sceneNumber: scene?.sceneNumber || 1,
    query,
    videoId: best.id,
    duration: Number(best.duration || 0),
    width: Number(file.width || 0),
    height: Number(file.height || 0),
    url: file.link,
    photographer: best.user?.name || '',
    source: 'Pexels'
  };
}

export async function buildSceneVisuals(scenes, topic) {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error(
      '[VisualEngine] No scenes were provided.'
    );
  }

  const results = [];

  for (const scene of scenes) {
    const visual = await findVisualForScene(
      scene,
      topic
    );

    if (visual) {
      results.push({
        ...scene,
        visual
      });
    } else {
      console.warn(
        `[VisualEngine] Scene ${scene.sceneNumber} has no matching footage.`
      );
    }
  }

  if (results.length === 0) {
    throw new Error(
      '[VisualEngine] No usable visual footage found for any scene.'
    );
  }

  return results;
}