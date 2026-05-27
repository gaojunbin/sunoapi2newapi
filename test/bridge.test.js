import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createServer } from '../src/app.js';
import { loadConfig } from '../src/config.js';

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

async function readBuffer(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function sendJson(res, status, body) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(raw)
  });
  res.end(raw);
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function createMockSuno() {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const body = req.method === 'GET' ? null : await readJson(req);
    calls.push({
      method: req.method,
      path: url.pathname,
      search: url.search,
      auth: req.headers.authorization,
      body
    });

    if (req.method === 'POST' && url.pathname === '/api/v1/generate') {
      sendJson(res, 200, { code: 200, msg: 'success', data: { taskId: 'music-task-1' } });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/generate/record-info') {
      if (url.searchParams.get('taskId')?.startsWith('lyrics')) {
        sendJson(res, 200, { code: 400, msg: 'music task not found' });
        return;
      }
      sendJson(res, 200, {
        code: 200,
        msg: 'success',
        data: {
          taskId: url.searchParams.get('taskId'),
          status: 'SUCCESS',
          response: {
            taskId: url.searchParams.get('taskId'),
            sunoData: [
              {
                id: 'clip-1',
                audioUrl: 'https://cdn.example/music.mp3',
                streamAudioUrl: 'https://cdn.example/music',
                imageUrl: 'https://cdn.example/cover.jpeg',
                prompt: 'calm piano',
                modelName: 'chirp-v4',
                title: 'Calm',
                tags: 'Classical',
                createTime: '2026-01-01 00:00:00',
                duration: 180
              }
            ]
          }
        }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/v1/lyrics') {
      sendJson(res, 200, { code: 200, msg: 'success', data: { taskId: 'lyrics-task-1' } });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/lyrics/record-info') {
      if (url.searchParams.get('taskId')?.startsWith('music')) {
        sendJson(res, 200, { code: 400, msg: 'lyrics task not found' });
        return;
      }
      sendJson(res, 200, {
        code: 200,
        msg: 'success',
        data: {
          taskId: url.searchParams.get('taskId'),
          status: 'SUCCESS',
          response: {
            taskId: url.searchParams.get('taskId'),
            data: [
              {
                text: '[Verse]\nA quiet city night',
                title: 'Night',
                status: 'complete',
                errorMessage: ''
              }
            ]
          }
        }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/v1/binary-echo') {
      const buffer = Buffer.from(JSON.stringify(body));
      sendJson(res, 200, {
        code: 200,
        msg: 'success',
        data: {
          contentType: req.headers['content-type'],
          length: buffer.length,
          body
        }
      });
      return;
    }

    sendJson(res, 404, { code: 404, msg: 'not found' });
  });
  const baseUrl = await listen(server);
  return { server, baseUrl, calls };
}

async function createBridge(upstreamBaseUrl) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'suno2newapi-'));
  const config = loadConfig({
    PORT: '0',
    DATA_DIR: tempDir,
    SUNO_API_BASE_URL: upstreamBaseUrl,
    DEFAULT_MUSIC_MODEL: 'V4_5ALL',
    UPSTREAM_TIMEOUT_MS: '5000'
  });
  const server = createServer({ config });
  const baseUrl = await listen(server);
  return { server, baseUrl, tempDir };
}

test('new-api MUSIC submit and fetch are translated to SunoAPI.org', async () => {
  const mock = await createMockSuno();
  const bridge = await createBridge(mock.baseUrl);
  try {
    const submit = await fetch(`${bridge.baseUrl}/suno/submit/MUSIC`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-key',
        'content-type': 'application/json',
        host: 'bridge.example.test'
      },
      body: JSON.stringify({
        prompt: 'calm piano',
        make_instrumental: true,
        mv: 'chirp-v4-5-all'
      })
    });
    assert.equal(submit.status, 200);
    assert.deepEqual(await submit.json(), {
      code: 'success',
      message: 'success',
      data: 'music-task-1'
    });

    const upstreamSubmit = mock.calls.find((call) => call.path === '/api/v1/generate');
    assert.equal(upstreamSubmit.auth, 'Bearer test-key');
    assert.equal(upstreamSubmit.body.customMode, false);
    assert.equal(upstreamSubmit.body.instrumental, true);
    assert.equal(upstreamSubmit.body.model, 'V4_5ALL');
    assert.equal(upstreamSubmit.body.prompt, 'calm piano');
    assert.match(upstreamSubmit.body.callBackUrl, /\/callbacks\/sunoapi$/);

    const fetchResp = await fetch(`${bridge.baseUrl}/suno/fetch`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-key',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ ids: ['music-task-1'] })
    });
    assert.equal(fetchResp.status, 200);
    const fetched = await fetchResp.json();
    assert.equal(fetched.code, 'success');
    assert.equal(fetched.data[0].task_id, 'music-task-1');
    assert.equal(fetched.data[0].action, 'MUSIC');
    assert.equal(fetched.data[0].status, 'SUCCESS');
    assert.equal(fetched.data[0].data[0].audio_url, 'https://cdn.example/music.mp3');

    const stored = JSON.parse(await fs.readFile(path.join(bridge.tempDir, 'tasks.json'), 'utf8'));
    assert.equal(stored['music-task-1'].action, 'MUSIC');
  } finally {
    await close(bridge.server);
    await close(mock.server);
  }
});

test('generic native proxy preserves non-JSON request body path', async () => {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const buffer = await readBuffer(req);
    calls.push({
      method: req.method,
      path: url.pathname,
      contentType: req.headers['content-type'],
      bodyHex: buffer.toString('hex')
    });
    sendJson(res, 200, {
      code: 200,
      msg: 'success',
      data: {
        length: buffer.length,
        bodyHex: buffer.toString('hex')
      }
    });
  });
  const upstreamBaseUrl = await listen(server);
  const bridge = await createBridge(upstreamBaseUrl);
  try {
    const body = Buffer.from([0, 1, 2, 255, 10]);
    const response = await fetch(`${bridge.baseUrl}/api/v1/binary-echo`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-key',
        'content-type': 'application/octet-stream'
      },
      body
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      code: 200,
      msg: 'success',
      data: {
        length: 5,
        bodyHex: '000102ff0a'
      }
    });
    assert.equal(calls[0].contentType, 'application/octet-stream');
    assert.equal(calls[0].bodyHex, '000102ff0a');
  } finally {
    await close(bridge.server);
    await close(server);
  }
});

test('native /api/v1/generate stays SunoAPI-compatible and stores task metadata', async () => {
  const mock = await createMockSuno();
  const bridge = await createBridge(mock.baseUrl);
  try {
    const response = await fetch(`${bridge.baseUrl}/api/v1/generate`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer native-key',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        customMode: true,
        instrumental: true,
        model: 'V5',
        style: 'Jazz',
        title: 'Blue Morning'
      })
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      code: 200,
      msg: 'success',
      data: { taskId: 'music-task-1' }
    });

    const upstreamSubmit = mock.calls.find((call) => call.path === '/api/v1/generate');
    assert.equal(upstreamSubmit.body.customMode, true);
    assert.equal(upstreamSubmit.body.model, 'V5');
    assert.equal(upstreamSubmit.body.style, 'Jazz');
    assert.equal(upstreamSubmit.body.title, 'Blue Morning');
    assert.match(upstreamSubmit.body.callBackUrl, /\/callbacks\/sunoapi$/);
  } finally {
    await close(bridge.server);
    await close(mock.server);
  }
});

test('new-api LYRICS submit and fetch are translated', async () => {
  const mock = await createMockSuno();
  const bridge = await createBridge(mock.baseUrl);
  try {
    const submit = await fetch(`${bridge.baseUrl}/suno/submit/LYRICS`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-key',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        prompt: 'A quiet city night'
      })
    });
    assert.equal(submit.status, 200);
    assert.equal((await submit.json()).data, 'lyrics-task-1');

    const fetchResp = await fetch(`${bridge.baseUrl}/suno/fetch`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-key',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ ids: ['lyrics-task-1'] })
    });
    assert.equal(fetchResp.status, 200);
    const fetched = await fetchResp.json();
    assert.equal(fetched.data[0].action, 'LYRICS');
    assert.equal(fetched.data[0].status, 'SUCCESS');
    assert.equal(fetched.data[0].data[0].text, '[Verse]\nA quiet city night');
  } finally {
    await close(bridge.server);
    await close(mock.server);
  }
});

test('single fetch recovers lyrics task type when local metadata is missing', async () => {
  const mock = await createMockSuno();
  const bridge = await createBridge(mock.baseUrl);
  try {
    const response = await fetch(`${bridge.baseUrl}/suno/fetch/lyrics-task-unknown`, {
      headers: {
        authorization: 'Bearer test-key'
      }
    });

    assert.equal(response.status, 200);
    const fetched = await response.json();
    assert.equal(fetched.code, 'success');
    assert.equal(fetched.data.task_id, 'lyrics-task-unknown');
    assert.equal(fetched.data.action, 'LYRICS');
    assert.equal(fetched.data.status, 'SUCCESS');
    assert.equal(fetched.data.data[0].title, 'Night');

    const recordCalls = mock.calls.filter((call) => call.path.endsWith('/record-info'));
    assert.deepEqual(
      recordCalls.map((call) => call.path),
      ['/api/v1/generate/record-info', '/api/v1/lyrics/record-info']
    );
  } finally {
    await close(bridge.server);
    await close(mock.server);
  }
});
