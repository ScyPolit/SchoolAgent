import { readFileSync } from 'node:fs';

// Docker secrets are read inside the process, never printed or put in CLI arguments.
if (process.env.ENCRYPTION_KEY_FILE) {
  process.env.ENCRYPTION_KEY = readFileSync(process.env.ENCRYPTION_KEY_FILE, 'utf8').trim();
}
if (process.env.NODE_ENV === 'production') {
  if (!/^[a-f0-9]{64}$/i.test(process.env.ENCRYPTION_KEY || '')) {
    console.error('Production startup requires a unique 32-byte ENCRYPTION_KEY secret. Run scripts/bootstrap.js.');
    process.exit(1);
  }
  process.env.COOKIE_SECURE = 'true';
  process.env.ENABLE_DEMO_ADAPTER = 'false';
}
const { startServer } = await import('../server/index.js');
startServer();
