# suno2newapi

`suno2newapi` is a small protocol bridge for using SunoAPI.org from an unchanged new-api deployment.

It exposes the Suno routes that new-api already knows how to call:

```text
POST /suno/submit/MUSIC
POST /suno/submit/LYRICS
POST /suno/fetch
GET  /suno/fetch/:id
```

It translates those requests to SunoAPI.org:

```text
POST /api/v1/generate
GET  /api/v1/generate/record-info?taskId=...
POST /api/v1/lyrics
GET  /api/v1/lyrics/record-info?taskId=...
```

It also exposes `/api/v1/...` as a native SunoAPI.org-compatible proxy, so direct clients can call the upstream-style API through the same service.

## Quick Start

```bash
cd ~/Documents/GitHub/suno2newapi
cp .env.example .env
docker compose up -d --build
```

Or use the one-command helper:

```bash
./start.sh
```

If new-api will pass the SunoAPI key as the channel key, `SUNO_API_KEY` may stay empty. For direct calls to this bridge without an `Authorization` header, set `SUNO_API_KEY` in `.env`.

## new-api Configuration

Create or edit a channel in new-api:

```text
Type: SunoAPI
Base URL: http://YOUR_BRIDGE_HOST:3000
Key: YOUR_SUNOAPI_ORG_KEY
Models: suno_music,suno_lyrics
```

new-api will send:

```text
POST http://YOUR_BRIDGE_HOST:3000/suno/submit/MUSIC
POST http://YOUR_BRIDGE_HOST:3000/suno/fetch
```

The bridge will forward to SunoAPI.org with the key from new-api's `Authorization: Bearer ...` header.

If new-api is also running in Docker, do not use `127.0.0.1` as the bridge host in new-api. Use a host address reachable from the new-api container, or put both containers on the same Docker network and use the bridge container name.

## Legacy new-api Request Mapping

For `POST /suno/submit/MUSIC`, legacy fields are mapped as follows:

```text
prompt or gpt_description_prompt -> prompt
tags                             -> style
title                            -> title
make_instrumental                -> instrumental
mv                               -> model
```

If `style` and `title` are both present, the bridge uses `customMode: true`; otherwise it uses `customMode: false`.

For chatall compatibility, a manually supplied `title` is preserved in returned clips even when SunoAPI.org generates a different title. The bridge also returns lyrics in `metadata.prompt`, `lyrics`, `gpt_description_prompt`, and `timed_lyrics`, and marks playable clips as `complete` so chatall can finish loading once all clips have audio.

Default model mapping:

```text
chirp-v3-0       -> V4
chirp-v3-5       -> V4
chirp-v4         -> V4
chirp-v4-5       -> V4_5
chirp-v4-5-plus  -> V4_5PLUS
chirp-v4-5-all   -> V4_5ALL
```

Unknown legacy `mv` values use `DEFAULT_MUSIC_MODEL`, defaulting to `V4_5ALL`.

## Native SunoAPI.org Proxy

The following endpoints accept SunoAPI.org-style payloads:

```bash
curl http://localhost:3000/api/v1/generate \
  -H "Authorization: Bearer $SUNO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "customMode": false,
    "instrumental": false,
    "model": "V4_5ALL",
    "prompt": "A calm piano track"
  }'
```

If `callBackUrl` is omitted, the bridge adds one. Set `CALLBACK_URL` in `.env` for production deployments:

```text
CALLBACK_URL=https://suno-bridge.example.com/callbacks/sunoapi
```

Polling still works without a public callback URL, but SunoAPI.org requires a callback URL in submit requests.

## State

Task metadata is stored in `DATA_DIR/tasks.json` (`./data/tasks.json` locally, `/data/tasks.json` in Docker). This lets the bridge remember whether a task is `MUSIC` or `LYRICS` after restarts.

## Health Check

```bash
curl http://localhost:3000/healthz
```

Expected response:

```json
{"ok":true,"service":"suno2newapi","upstream":"https://api.sunoapi.org"}
```

## Local Verification

```bash
npm test
npm run check
```

The tests use a local mock SunoAPI.org server and do not require a real API key.

## Environment

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listen port. In Docker Compose the container listens on `3000`; `.env` `PORT` controls the published host port. |
| `SUNO_API_BASE_URL` | `https://api.sunoapi.org` | SunoAPI.org upstream base URL |
| `SUNO_API_KEY` | empty | Fallback key when request has no `Authorization` header |
| `CALLBACK_URL` | derived from request host | Callback URL sent to SunoAPI.org |
| `DATA_DIR` | `/data` in Docker | Persistent task metadata directory |
| `DEFAULT_MUSIC_MODEL` | `V4_5ALL` | Fallback SunoAPI.org model |
| `UPSTREAM_TIMEOUT_MS` | `60000` | Upstream request timeout |
| `MODEL_MAP_JSON` | empty | Optional JSON override for legacy `mv` mapping |

When using the Docker Compose bind mount, the container fixes `/data` ownership at startup and then runs the Node process as the unprivileged `app` user.
