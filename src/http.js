import { StringDecoder } from 'node:string_decoder';

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

export class HttpError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export function sendJson(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': JSON_CONTENT_TYPE,
    'content-length': Buffer.byteLength(body),
    ...headers
  });
  res.end(body);
}

export function sendText(res, status, text, headers = {}) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    ...headers
  });
  res.end(text);
}

export async function readRawBody(req, limitBytes = 2 * 1024 * 1024) {
  const decoder = new StringDecoder('utf8');
  let total = 0;
  let body = '';

  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) {
      throw new HttpError(413, 'request body too large');
    }
    body += decoder.write(chunk);
  }
  body += decoder.end();
  return body;
}

export async function readBodyBuffer(req, limitBytes = 25 * 1024 * 1024) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) {
      throw new HttpError(413, 'request body too large');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJsonBody(req, limitBytes) {
  const raw = await readRawBody(req, limitBytes);
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new HttpError(400, 'invalid JSON body', error.message);
  }
}

export function getHeader(req, name) {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

export function getBearerAuth(req, fallbackKey = '') {
  const authorization = getHeader(req, 'authorization');
  if (authorization) return authorization;
  if (fallbackKey) return `Bearer ${fallbackKey}`;
  return '';
}

export function deriveCallbackUrl(req) {
  const proto = getHeader(req, 'x-forwarded-proto') || (req.socket.encrypted ? 'https' : 'http');
  const host = getHeader(req, 'x-forwarded-host') || getHeader(req, 'host');
  if (!host) return '';
  return `${proto.split(',')[0].trim()}://${host.split(',')[0].trim()}/callbacks/sunoapi`;
}

export function requestPathname(req) {
  const url = new URL(req.url, 'http://127.0.0.1');
  return url.pathname;
}

export function errorBody(error) {
  return {
    code: 'error',
    message: error.message || 'internal error',
    data: error.details ?? null
  };
}
