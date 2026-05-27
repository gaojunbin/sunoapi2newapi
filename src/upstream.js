import { HttpError } from './http.js';

function joinUrl(baseUrl, pathWithQuery) {
  return `${baseUrl.replace(/\/+$/, '')}${pathWithQuery.startsWith('/') ? '' : '/'}${pathWithQuery}`;
}

export class UpstreamClient {
  constructor(config) {
    this.config = config;
  }

  async request(pathWithQuery, { method = 'GET', authHeader = '', body, headers = {} } = {}) {
    if (!authHeader) {
      throw new HttpError(401, 'missing Authorization header or SUNO_API_KEY');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.upstreamTimeoutMs);
    const requestHeaders = {
      authorization: authHeader,
      accept: 'application/json',
      ...headers
    };

    let requestBody;
    if (body !== undefined) {
      requestHeaders['content-type'] = requestHeaders['content-type'] || 'application/json';
      requestBody = typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body);
    }

    try {
      const response = await fetch(joinUrl(this.config.sunoApiBaseUrl, pathWithQuery), {
        method,
        headers: requestHeaders,
        body: requestBody,
        signal: controller.signal
      });
      const text = await response.text();
      let json = null;
      if (text.trim()) {
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
      }
      return {
        status: response.status,
        headers: response.headers,
        ok: response.ok,
        text,
        json
      };
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new HttpError(504, 'upstream request timed out');
      }
      throw new HttpError(502, `upstream request failed: ${error.message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}
