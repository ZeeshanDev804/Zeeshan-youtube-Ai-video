import dotenv from 'dotenv';
dotenv.config();

export const config = {
  pexelsApiKey: process.env.PEXELS_API_KEY || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  trendRegion: process.env.TREND_REGION || 'US,GB,EU',
  enableGoogleTrends: process.env.ENABLE_GOOGLE_TRENDS === 'true',
  enableYoutubeTrends: process.env.ENABLE_YOUTUBE_TRENDS === 'true',
  outputDir: process.env.OUTPUT_DIR || 'output_artifacts'
};

export default config;
