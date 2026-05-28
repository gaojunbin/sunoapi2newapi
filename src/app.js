import http from 'node:http';

import { loadConfig } from './config.js';
import {
  HttpError,
  deriveCallbackUrl,
  errorBody,
  getBearerAuth,
  readBodyBuffer,
  readJsonBody,
  sendJson,
  sendText
} from './http.js';
import {
  extractCallbackTaskId,
  extractTaskId,
  isUpstreamSuccess,
  legacyLyricsToSuno,
  legacyMusicToSuno,
  mapCallbackToNewApi,
  mapLyricsRecordToNewApi,
  mapMusicRecordToNewApi,
  nativeLyricsPayload,
  nativeMusicPayload,
  toNewApiSubmitResponse,
  toNewApiTaskResponse
} from './mapper.js';
import { TaskStore } from './store.js';
import { UpstreamClient } from './upstream.js';

function callbackUrlFor(req, config) {
  return config.callbackUrl || deriveCallbackUrl(req);
}

function apiMessage(body, fallback = 'upstream error') {
  if (!body || typeof body !== 'object') return fallback;
  return body.msg || body.message || body.error || fallback;
}

function upstreamErrorStatus(upstreamResponse) {
  if (!upstreamResponse.ok) return upstreamResponse.status || 502;
  const code = upstreamResponse.json?.code;
  const parsed = Number(code);
  if (Number.isInteger(parsed) && parsed >= 400 && parsed <= 599) return parsed;
  return 502;
}

function actionFromPath(pathname) {
  const match = pathname.match(/^\/suno\/submit\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]).toUpperCase() : '';
}

function taskIdFromFetchPath(pathname) {
  const match = pathname.match(/^\/suno\/fetch\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : '';
}

async function storeSubmittedTaskWithMeta(store, taskId, action, payload, upstreamBody, meta = {}) {
  if (!taskId) return;
  await store.upsert(taskId, {
    action,
    request: payload,
    upstream_submit_response: upstreamBody,
    submit_time: Math.floor(Date.now() / 1000),
    last_status: 'SUBMITTED',
    ...meta
  });
}

async function handleCompatSubmit(req, res, context, action) {
  const { config, upstream, store } = context;
  const authHeader = getBearerAuth(req, config.sunoApiKey);
  const body = await readJsonBody(req);
  const callbackUrl = callbackUrlFor(req, config);

  let upstreamPath;
  let payload;
  let submitMeta = {};
  if (action === 'MUSIC') {
    upstreamPath = '/api/v1/generate';
    payload = legacyMusicToSuno(body, callbackUrl, config);
    submitMeta = {
      user_request: body,
      requested_title: typeof body.title === 'string' ? body.title.trim() : '',
      requested_gpt_description_prompt:
        typeof body.gpt_description_prompt === 'string' ? body.gpt_description_prompt.trim() : ''
    };
  } else if (action === 'LYRICS') {
    upstreamPath = '/api/v1/lyrics';
    payload = legacyLyricsToSuno(body, callbackUrl);
  } else {
    throw new HttpError(400, `unsupported Suno action: ${action}`);
  }

  const upstreamResponse = await upstream.request(upstreamPath, {
    method: 'POST',
    authHeader,
    body: payload
  });

  if (!upstreamResponse.ok || !isUpstreamSuccess(upstreamResponse.json)) {
    throw new HttpError(upstreamErrorStatus(upstreamResponse), apiMessage(upstreamResponse.json), upstreamResponse.json || upstreamResponse.text);
  }

  const taskId = extractTaskId(upstreamResponse.json);
  if (!taskId) {
    throw new HttpError(502, 'upstream response did not include taskId', upstreamResponse.json);
  }

  await storeSubmittedTaskWithMeta(store, taskId, action, payload, upstreamResponse.json, submitMeta);
  sendJson(res, 200, toNewApiSubmitResponse(taskId, apiMessage(upstreamResponse.json, 'success')));
}

async function fetchCompatTask(context, taskId, actionHint = '') {
  const { store } = context;
  const stored = (await store.get(taskId)) || {};
  const action = actionHint || stored.action || 'MUSIC';

  if (stored.last_callback) {
    const callbackTask = mapCallbackToNewApi(stored.last_callback, { ...stored, task_id: taskId, action });
    if (callbackTask.status === 'SUCCESS') return callbackTask;
  }

  const knownAction = Boolean(actionHint || stored.action);
  const actionsToTry = knownAction ? [action] : ['MUSIC', 'LYRICS'];

  for (const actionToTry of actionsToTry) {
    const result = await fetchCompatTaskByAction(context, taskId, actionToTry, stored);
    if (result.ok) return result.task;
  }

  return {
    task_id: taskId,
    action,
    status: 'IN_PROGRESS',
    fail_reason: '',
    submit_time: stored.submit_time || stored.created_at || 0,
    start_time: stored.submit_time || stored.created_at || 0,
    finish_time: 0,
    data: []
  };
}

async function fetchCompatTaskByAction(context, taskId, action, stored) {
  const { upstream, store, authHeader } = context;
  const recordPath =
    action === 'LYRICS'
      ? `/api/v1/lyrics/record-info?taskId=${encodeURIComponent(taskId)}`
      : `/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`;

  const upstreamResponse = await upstream.request(recordPath, {
    method: 'GET',
    authHeader
  });

  if (!upstreamResponse.ok || !isUpstreamSuccess(upstreamResponse.json)) {
    return { ok: false, task: null };
  }

  const mapped =
    action === 'LYRICS'
      ? mapLyricsRecordToNewApi(upstreamResponse.json, { ...stored, task_id: taskId })
      : mapMusicRecordToNewApi(upstreamResponse.json, { ...stored, task_id: taskId });

  await store.upsert(taskId, {
    action,
    last_status: mapped.status,
    last_record: upstreamResponse.json
  });
  return { ok: true, task: mapped };
}

async function handleCompatFetch(req, res, context, singleTaskId = '') {
  const { config } = context;
  const authHeader = getBearerAuth(req, config.sunoApiKey);
  const fetchContext = { ...context, authHeader };

  if (singleTaskId) {
    const task = await fetchCompatTask(fetchContext, singleTaskId);
    sendJson(res, 200, toNewApiTaskResponse(task));
    return;
  }

  const body = await readJsonBody(req);
  const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
  const actionHint = typeof body.action === 'string' ? body.action.toUpperCase() : '';
  const tasks = await Promise.all(ids.map((id) => fetchCompatTask(fetchContext, id, actionHint)));
  sendJson(res, 200, toNewApiTaskResponse(tasks));
}

async function handleNativeGenerate(req, res, context, action) {
  const { config, upstream, store } = context;
  const authHeader = getBearerAuth(req, config.sunoApiKey);
  const body = await readJsonBody(req);
  const callbackUrl = callbackUrlFor(req, config);
  const upstreamPath = action === 'LYRICS' ? '/api/v1/lyrics' : '/api/v1/generate';
  const payload =
    action === 'LYRICS'
      ? nativeLyricsPayload(body, callbackUrl)
      : nativeMusicPayload(body, callbackUrl, config);

  const upstreamResponse = await upstream.request(upstreamPath, {
    method: 'POST',
    authHeader,
    body: payload
  });

  const taskId = extractTaskId(upstreamResponse.json);
  if (taskId && isUpstreamSuccess(upstreamResponse.json)) {
    await storeSubmittedTaskWithMeta(store, taskId, action, payload, upstreamResponse.json, {
      user_request: body,
      requested_title: typeof body.title === 'string' ? body.title.trim() : '',
      requested_gpt_description_prompt:
        typeof body.gpt_description_prompt === 'string' ? body.gpt_description_prompt.trim() : ''
    });
  }
  sendJson(res, upstreamResponse.status, upstreamResponse.json || { raw: upstreamResponse.text });
}

async function handleNativeRecordProxy(req, res, context, action, url) {
  const { config, upstream, store } = context;
  const authHeader = getBearerAuth(req, config.sunoApiKey);
  const upstreamResponse = await upstream.request(`${url.pathname}${url.search}`, {
    method: req.method,
    authHeader
  });
  const taskId = url.searchParams.get('taskId');
  if (taskId && upstreamResponse.json && isUpstreamSuccess(upstreamResponse.json)) {
    await store.upsert(taskId, {
      action,
      last_record: upstreamResponse.json
    });
  }
  sendJson(res, upstreamResponse.status, upstreamResponse.json || { raw: upstreamResponse.text });
}

async function handleGenericNativeProxy(req, res, context, url) {
  const { config, upstream } = context;
  const authHeader = getBearerAuth(req, config.sunoApiKey);
  const rawBody = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBodyBuffer(req);
  const upstreamResponse = await upstream.request(`${url.pathname}${url.search}`, {
    method: req.method,
    authHeader,
    body: rawBody?.length ? rawBody : undefined,
    headers: {
      'content-type': req.headers['content-type'] || 'application/json'
    }
  });

  if (upstreamResponse.json) {
    sendJson(res, upstreamResponse.status, upstreamResponse.json);
  } else {
    sendText(res, upstreamResponse.status, upstreamResponse.text);
  }
}

async function handleCallback(req, res, context) {
  const { store } = context;
  const body = await readJsonBody(req, 5 * 1024 * 1024);
  const taskId = extractCallbackTaskId(body);
  if (taskId) {
    await store.addCallback(taskId, body);
  }
  sendJson(res, 200, { code: 200, msg: 'success' });
}

export function createApp(options = {}) {
  const config = options.config || loadConfig();
  const store = options.store || new TaskStore(config.taskStorePath);
  const upstream = options.upstream || new UpstreamClient(config);
  const context = { config, store, upstream };

  return async function app(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (req.method === 'GET' && pathname === '/healthz') {
        sendJson(res, 200, {
          ok: true,
          service: 'suno2newapi',
          upstream: config.sunoApiBaseUrl
        });
        return;
      }

      const action = actionFromPath(pathname);
      if (req.method === 'POST' && action) {
        await handleCompatSubmit(req, res, context, action);
        return;
      }

      if (req.method === 'POST' && pathname === '/suno/fetch') {
        await handleCompatFetch(req, res, context);
        return;
      }

      const singleTaskId = taskIdFromFetchPath(pathname);
      if (req.method === 'GET' && singleTaskId) {
        await handleCompatFetch(req, res, context, singleTaskId);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/v1/generate') {
        await handleNativeGenerate(req, res, context, 'MUSIC');
        return;
      }

      if (req.method === 'POST' && pathname === '/api/v1/lyrics') {
        await handleNativeGenerate(req, res, context, 'LYRICS');
        return;
      }

      if (req.method === 'GET' && pathname === '/api/v1/generate/record-info') {
        await handleNativeRecordProxy(req, res, context, 'MUSIC', url);
        return;
      }

      if (req.method === 'GET' && pathname === '/api/v1/lyrics/record-info') {
        await handleNativeRecordProxy(req, res, context, 'LYRICS', url);
        return;
      }

      if (req.method === 'POST' && pathname === '/callbacks/sunoapi') {
        await handleCallback(req, res, context);
        return;
      }

      if (pathname.startsWith('/api/v1/')) {
        await handleGenericNativeProxy(req, res, context, url);
        return;
      }

      throw new HttpError(404, 'not found');
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      sendJson(res, status, errorBody(error));
    }
  };
}

export function createServer(options = {}) {
  return http.createServer(createApp(options));
}
