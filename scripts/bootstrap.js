import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, chmodSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const secretDir = path.join(root, '.secrets');
mkdirSync(secretDir, { recursive: true, mode: 0o700 });
chmodSync(secretDir, 0o700);
const keyFile = path.join(secretDir, 'encryption_key');
if (!existsSync(keyFile)) {
  writeFileSync(keyFile, randomBytes(32).toString('hex') + '\n', { flag: 'wx', mode: 0o444 });
  console.log('Created a unique encryption key in .secrets/encryption_key (value hidden).');
} else if (!/^[a-f0-9]{64}$/i.test(readFileSync(keyFile, 'utf8').trim())) {
  throw new Error('Existing encryption key is invalid. Preserve it for recovery and investigate; it was not replaced.');
}
// Compose local file secrets retain host file permissions. The 0700 parent blocks
// other host users from traversing; the mounted file is readable by uid 10001.
chmodSync(keyFile, 0o444);
const envFile = path.join(root, '.env');
if (!existsSync(envFile)) {
  writeFileSync(envFile, readFileSync(path.join(root, '.env.example')), { flag: 'wx', mode: 0o600 });
  console.log('Created .env from .env.example. Configure the school intranet HTTPS PUBLIC_URL before production use.');
} else console.log('Existing .env preserved.');
console.log('Next: docker compose up -d --build; then docker compose exec app node scripts/init-admin.js');
