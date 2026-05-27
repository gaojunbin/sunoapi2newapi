import { loadConfig } from './config.js';
import { createServer } from './app.js';

const config = loadConfig();
const server = createServer({ config });

server.listen(config.port, '0.0.0.0', () => {
  console.log(`suno2newapi listening on :${config.port}`);
  console.log(`upstream: ${config.sunoApiBaseUrl}`);
});

function shutdown(signal) {
  console.log(`received ${signal}, shutting down`);
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
