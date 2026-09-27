import axios from 'axios';
import { config } from '../config/index.mjs';

export async function fetchStockVideos(query) {
  console.log(`[VisualEngine] Searching footage for: ${query}`);
  try {
    const response = await axios.get(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=3&orientation=portrait`, {
      headers: { Authorization: config.pexelsApiKey }
    });
    return response.data.videos || [];
  } catch (error) {
    console.error('[VisualEngine] Pexels API Error:', error.message);
    return [];
  }
}
