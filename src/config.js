import path from 'node:path';

const DEFAULT_MODEL_MAP = {
  'chirp-v3-0': 'V4',
  'chirp-v3-5': 'V4',
  'chirp-v4': 'V4',
  'chirp-v4-5': 'V4_5',
  'chirp-v4-5-plus': 'V4_5PLUS',
  'chirp-v4-5-all': 'V4_5ALL',
  'chirp-fenix': 'V5_5',
  'v4': 'V4',
  'v4_5': 'V4_5',
  'v4_5plus': 'V4_5PLUS',
  'v4_5all': 'V4_5ALL',
  'v5': 'V5',
  'v5_5': 'V5_5'
};

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseModelMap(value) {
  if (!value || !value.trim()) return DEFAULT_MODEL_MAP;
  try {
    const custom = JSON.parse(value);
    return { ...DEFAULT_MODEL_MAP, ...custom };
  } catch {
    return DEFAULT_MODEL_MAP;
  }
}

export function loadConfig(env = process.env) {
  const port = parseNumber(env.PORT, 3000);
  const dataDir = env.DATA_DIR || path.resolve(process.cwd(), 'data');

  return {
    port,
    dataDir,
    taskStorePath: path.join(dataDir, 'tasks.json'),
    sunoApiBaseUrl: (env.SUNO_API_BASE_URL || 'https://api.sunoapi.org').replace(/\/+$/, ''),
    sunoApiKey: env.SUNO_API_KEY || '',
    callbackUrl: env.CALLBACK_URL || '',
    defaultMusicModel: env.DEFAULT_MUSIC_MODEL || 'V4_5ALL',
    upstreamTimeoutMs: parseNumber(env.UPSTREAM_TIMEOUT_MS, 60000),
    modelMap: parseModelMap(env.MODEL_MAP_JSON || '')
  };
}
