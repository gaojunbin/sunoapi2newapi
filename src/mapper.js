const MUSIC_FAILURE_STATUSES = new Set([
  'CREATE_TASK_FAILED',
  'GENERATE_AUDIO_FAILED',
  'CALLBACK_EXCEPTION',
  'SENSITIVE_WORD_ERROR'
]);

const LYRICS_FAILURE_STATUSES = new Set([
  'CREATE_TASK_FAILED',
  'GENERATE_LYRICS_FAILED',
  'CALLBACK_EXCEPTION',
  'SENSITIVE_WORD_ERROR'
]);

const SUNO_MODELS = new Set(['V4', 'V4_5', 'V4_5PLUS', 'V4_5ALL', 'V5', 'V5_5']);
const CLIP_DONE_STATUSES = new Set(['COMPLETE', 'COMPLETED', 'SUCCESS', 'STREAMING']);
const CLIP_PENDING_STATUSES = new Set(['SUBMITTED', 'QUEUED', 'PENDING', 'GENERATING', 'RUNNING', 'PROCESSING']);

function boolFromAny(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function firstString(...values) {
  for (const value of values) {
    const str = nonEmptyString(value);
    if (str) return str;
  }
  return '';
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function objectFrom(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function copyIfPresent(target, source, ...keys) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
      target[key] = source[key];
    }
  }
}

export function normalizeMusicModel(value, config) {
  const raw = nonEmptyString(value);
  if (!raw) return config.defaultMusicModel;
  if (SUNO_MODELS.has(raw)) return raw;
  const lowered = raw.toLowerCase();
  return config.modelMap[lowered] || config.modelMap[raw] || config.defaultMusicModel;
}

export function legacyMusicToSuno(body, callbackUrl, config) {
  const explicitCustomMode =
    typeof body.customMode === 'boolean' ||
    typeof body.custom_mode === 'boolean' ||
    typeof body.customMode === 'string' ||
    typeof body.custom_mode === 'string';

  const prompt = firstString(body.prompt, body.gpt_description_prompt, body.description);
  const style = firstString(body.style, body.tags);
  const title = firstString(body.title);
  const instrumental = boolFromAny(body.instrumental, boolFromAny(body.make_instrumental, false));
  let customMode = explicitCustomMode
    ? boolFromAny(body.customMode, boolFromAny(body.custom_mode, false))
    : Boolean(style && title);

  if (!explicitCustomMode && customMode && !style && !title) {
    customMode = false;
  }

  const payload = {
    customMode,
    instrumental,
    model: normalizeMusicModel(body.model || body.mv, config),
    callBackUrl: firstString(body.callBackUrl, body.callbackUrl, body.callback_url) || callbackUrl
  };

  if (prompt) payload.prompt = prompt;
  if (customMode && style) payload.style = style;
  if (customMode && title) payload.title = title;

  copyIfPresent(
    payload,
    body,
    'personaId',
    'personaModel',
    'negativeTags',
    'vocalGender',
    'styleWeight',
    'weirdnessConstraint',
    'audioWeight'
  );

  validateMusicPayload(payload);
  return payload;
}

export function nativeMusicPayload(body, callbackUrl, config) {
  const payload = { ...body };
  payload.customMode = boolFromAny(payload.customMode, false);
  payload.instrumental = boolFromAny(payload.instrumental, false);
  payload.model = normalizeMusicModel(payload.model, config);
  payload.callBackUrl = firstString(payload.callBackUrl, payload.callbackUrl, payload.callback_url) || callbackUrl;
  delete payload.callbackUrl;
  delete payload.callback_url;
  validateMusicPayload(payload);
  return payload;
}

export function legacyLyricsToSuno(body, callbackUrl) {
  const prompt = firstString(body.prompt, body.gpt_description_prompt, body.description);
  if (!prompt) {
    throw new Error('prompt is required for lyrics generation');
  }
  return {
    prompt,
    callBackUrl: firstString(body.callBackUrl, body.callbackUrl, body.callback_url) || callbackUrl
  };
}

export function nativeLyricsPayload(body, callbackUrl) {
  const payload = { ...body };
  payload.callBackUrl = firstString(payload.callBackUrl, payload.callbackUrl, payload.callback_url) || callbackUrl;
  delete payload.callbackUrl;
  delete payload.callback_url;
  if (!nonEmptyString(payload.prompt)) {
    throw new Error('prompt is required for lyrics generation');
  }
  if (!nonEmptyString(payload.callBackUrl)) {
    throw new Error('callBackUrl is required');
  }
  return payload;
}

function validateMusicPayload(payload) {
  if (!nonEmptyString(payload.callBackUrl)) {
    throw new Error('callBackUrl is required');
  }
  if (!SUNO_MODELS.has(payload.model)) {
    throw new Error(`unsupported model: ${payload.model}`);
  }
  if (payload.customMode) {
    if (!nonEmptyString(payload.style)) throw new Error('style is required when customMode is true');
    if (!nonEmptyString(payload.title)) throw new Error('title is required when customMode is true');
    if (!payload.instrumental && !nonEmptyString(payload.prompt)) {
      throw new Error('prompt is required when customMode is true and instrumental is false');
    }
  } else if (!nonEmptyString(payload.prompt)) {
    throw new Error('prompt is required when customMode is false');
  }
}

export function extractTaskId(upstreamBody) {
  if (!upstreamBody || typeof upstreamBody !== 'object') return '';
  const data = upstreamBody.data;
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object') {
    return firstString(data.taskId, data.task_id, data.id);
  }
  return '';
}

export function isUpstreamSuccess(upstreamBody) {
  if (!upstreamBody || typeof upstreamBody !== 'object') return false;
  return upstreamBody.code === 200 || upstreamBody.code === '200' || upstreamBody.code === 'success';
}

export function toNewApiSubmitResponse(taskId, message = 'success') {
  return {
    code: 'success',
    message,
    data: taskId
  };
}

export function toNewApiTaskResponse(data) {
  return {
    code: 'success',
    message: 'success',
    data
  };
}

export function mapMusicRecordToNewApi(recordBody, taskMeta = {}) {
  const data = recordBody?.data && typeof recordBody.data === 'object' ? recordBody.data : {};
  const upstreamStatus = mapTaskStatus(data.status, 'MUSIC');
  const now = Math.floor(Date.now() / 1000);
  const submitTime = taskMeta.submit_time || taskMeta.created_at || 0;
  const clips = normalizeMusicClips(data.response?.sunoData || data.response?.data || data.data || [], taskMeta);
  const allPlayable = clips.length > 0 && clips.every((clip) => clip.audio_url && clip.status === 'complete');
  const completedByClips = allPlayable && (upstreamStatus === 'SUCCESS' || clips.length >= 2);
  const status = upstreamStatus === 'FAILURE' ? 'FAILURE' : completedByClips ? 'SUCCESS' : upstreamStatus;
  const isDone = status === 'SUCCESS' || status === 'FAILURE';

  return {
    task_id: data.taskId || taskMeta.task_id || '',
    action: 'MUSIC',
    status,
    fail_reason: status === 'FAILURE' ? firstString(data.errorMessage, recordBody?.msg, 'music generation failed') : '',
    submit_time: submitTime,
    start_time: status === 'QUEUED' ? 0 : submitTime,
    finish_time: isDone ? now : 0,
    data: clips
  };
}

export function mapLyricsRecordToNewApi(recordBody, taskMeta = {}) {
  const data = recordBody?.data && typeof recordBody.data === 'object' ? recordBody.data : {};
  const status = mapTaskStatus(data.status, 'LYRICS');
  const now = Math.floor(Date.now() / 1000);
  const submitTime = taskMeta.submit_time || taskMeta.created_at || 0;
  const isDone = status === 'SUCCESS' || status === 'FAILURE';
  const lyrics = normalizeLyrics(data.response?.data || data.data || []);

  return {
    task_id: data.taskId || taskMeta.task_id || '',
    action: 'LYRICS',
    status,
    fail_reason: status === 'FAILURE' ? firstString(data.errorMessage, recordBody?.msg, 'lyrics generation failed') : '',
    submit_time: submitTime,
    start_time: status === 'QUEUED' ? 0 : submitTime,
    finish_time: isDone ? now : 0,
    data: lyrics
  };
}

export function mapCallbackToNewApi(callbackBody, taskMeta = {}) {
  const data = callbackBody?.data && typeof callbackBody.data === 'object' ? callbackBody.data : {};
  const callbackType = firstString(data.callbackType);
  const taskId = firstString(data.task_id, data.taskId, taskMeta.task_id);
  const action = taskMeta.action || (data.taskId ? 'LYRICS' : 'MUSIC');
  const status = callbackBody?.code === 200 && callbackType === 'complete' ? 'SUCCESS' : 'IN_PROGRESS';

  return {
    task_id: taskId,
    action,
    status,
    fail_reason: '',
    submit_time: taskMeta.submit_time || taskMeta.created_at || 0,
    start_time: taskMeta.submit_time || taskMeta.created_at || 0,
    finish_time: status === 'SUCCESS' ? Math.floor(Date.now() / 1000) : 0,
    data: action === 'LYRICS' ? normalizeLyrics(data.data || []) : normalizeMusicClips(data.data || [], taskMeta)
  };
}

export function mapTaskStatus(status, action) {
  const normalized = firstString(status).toUpperCase();
  if (!normalized) return 'IN_PROGRESS';
  if (normalized === 'SUCCESS') return 'SUCCESS';
  if (normalized === 'PENDING') return 'QUEUED';
  if (normalized === 'TEXT_SUCCESS' || normalized === 'FIRST_SUCCESS') return 'IN_PROGRESS';
  if (action === 'LYRICS' && LYRICS_FAILURE_STATUSES.has(normalized)) return 'FAILURE';
  if (action !== 'LYRICS' && MUSIC_FAILURE_STATUSES.has(normalized)) return 'FAILURE';
  if (normalized.includes('FAILED') || normalized.includes('ERROR')) return 'FAILURE';
  return 'IN_PROGRESS';
}

function taskPrompt(taskMeta) {
  const request = objectFrom(taskMeta.request);
  const userRequest = objectFrom(taskMeta.user_request);
  return firstString(
    taskMeta.requested_gpt_description_prompt,
    userRequest.gpt_description_prompt,
    userRequest.gptDescriptionPrompt,
    userRequest.prompt,
    userRequest.description,
    request.gpt_description_prompt,
    request.prompt,
    request.description
  );
}

function requestedTitle(taskMeta) {
  const request = objectFrom(taskMeta.request);
  const userRequest = objectFrom(taskMeta.user_request);
  return firstString(taskMeta.requested_title, userRequest.title, request.title);
}

function normalizeMusicClipStatus(item) {
  const raw = firstString(item.status, item.state);
  const normalized = raw.toUpperCase();
  const hasAudio = Boolean(firstString(item.audio_url, item.audioUrl, item.audio, item.source_audio_url, item.sourceAudioUrl));
  if (normalized.includes('FAILED') || normalized.includes('ERROR')) return 'failed';
  if (hasAudio) return 'complete';
  if (CLIP_DONE_STATUSES.has(normalized)) return 'complete';
  if (CLIP_PENDING_STATUSES.has(normalized)) return 'submitted';
  return raw || 'submitted';
}

function normalizeMusicMetadata(item, taskMeta) {
  const sourceMetadata = objectFrom(item.metadata);
  const title = firstString(requestedTitle(taskMeta), item.title, item.song_title, sourceMetadata.title);
  const lyrics = firstString(item.lyrics, item.prompt, sourceMetadata.prompt);
  const gptDescriptionPrompt = firstString(
    item.gpt_description_prompt,
    item.gptDescriptionPrompt,
    sourceMetadata.gpt_description_prompt,
    sourceMetadata.gptDescriptionPrompt,
    taskPrompt(taskMeta)
  );
  const timedLyrics = firstDefined(
    item.timed_lyrics,
    item.timedLyrics,
    sourceMetadata.timed_lyrics,
    sourceMetadata.timedLyrics
  ) ?? '';

  const metadata = { ...sourceMetadata };
  if (lyrics) metadata.prompt = lyrics;
  if (gptDescriptionPrompt) metadata.gpt_description_prompt = gptDescriptionPrompt;
  if (timedLyrics !== '') metadata.timed_lyrics = timedLyrics;
  if (!metadata.tags && item.tags) metadata.tags = item.tags;
  if (title) metadata.title = title;
  if (metadata.duration === undefined && item.duration !== undefined) metadata.duration = item.duration;

  return {
    title,
    lyrics,
    gptDescriptionPrompt,
    timedLyrics,
    metadata
  };
}

function normalizeMusicClips(items, taskMeta = {}) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const compat = normalizeMusicMetadata(item, taskMeta);
    return {
      id: item.id || '',
      audio_url: item.audio_url || item.audioUrl || '',
      source_audio_url: item.source_audio_url || item.sourceAudioUrl || item.audioUrl || '',
      stream_audio_url: item.stream_audio_url || item.streamAudioUrl || '',
      source_stream_audio_url: item.source_stream_audio_url || item.sourceStreamAudioUrl || item.streamAudioUrl || '',
      image_url: item.image_url || item.imageUrl || '',
      source_image_url: item.source_image_url || item.sourceImageUrl || item.imageUrl || '',
      prompt: item.prompt || '',
      lyrics: compat.lyrics,
      gpt_description_prompt: compat.gptDescriptionPrompt,
      timed_lyrics: compat.timedLyrics,
      metadata: compat.metadata,
      model_name: item.model_name || item.modelName || '',
      status: normalizeMusicClipStatus(item),
      title: compat.title,
      tags: item.tags || '',
      createTime: item.createTime || item.create_time || '',
      duration: item.duration ?? null,
      error: item.error || item.error_message || item.metadata?.error_message || null
    };
  });
}

function normalizeLyrics(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    id: item.id || '',
    text: item.text || '',
    title: item.title || '',
    status: item.status || '',
    errorMessage: item.errorMessage || item.error_message || ''
  }));
}

export function extractCallbackTaskId(callbackBody) {
  const data = callbackBody?.data && typeof callbackBody.data === 'object' ? callbackBody.data : {};
  return firstString(data.task_id, data.taskId, callbackBody?.task_id, callbackBody?.taskId);
}
