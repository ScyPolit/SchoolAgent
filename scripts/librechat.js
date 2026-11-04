import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'upstream/LibreChat');
const expectedCommit = 'f4154b649efa37e1345ccc517a4d8d1ed2178c82';
const mode = process.argv[2] || 'build';
const npmCli = process.env.npm_execpath;
if (!existsSync(resolve(source, 'client/package.json'))) throw new Error('Missing upstream/LibreChat source. See docs/librechat-latest.md.');
if (!npmCli || !existsSync(npmCli)) throw new Error('Run this tool through npm run install:client, build or dev:client.');
const baseline=JSON.parse(readFileSync(resolve(root,'third_party/librechat-latest/baseline.json'),'utf8'));
if(baseline.commit!==expectedCommit)throw new Error('LibreChat baseline metadata does not match the build tool.');
if(existsSync(resolve(source,'.git'))){
  const actual=execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();
  if(actual!==expectedCommit)throw new Error('LibreChat checkout moved. Review the new source and update the pinned baseline before building.');
}
const lockText=readFileSync(resolve(source,'package-lock.json'),'utf8').replace(/\r\n/g,'\n');
if(createHash('sha256').update(lockText).digest('hex')!==baseline.effectiveLockSha256)throw new Error('LibreChat lockfile changed. Review dependencies and update the baseline checksum before building.');

function npm(args, environment = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [npmCli, ...args], { cwd: source, stdio: 'inherit', env: { ...process.env, ...environment } });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolveResult() : reject(new Error(`LibreChat npm ${args.join(' ')} failed (${signal || code})`)));
  });
}

async function packages() {
  if (!existsSync(resolve(source, 'node_modules/librechat-data-provider'))) throw new Error('Install the original client workspaces first: npm run install:client');
  for (const script of ['build:data-provider', 'build:client-package', 'build:chat']) await npm(['run', script]);
}

async function buildClient() {
  await npm(['run', 'build:client']);
  const output = resolve(root, 'dist');
  // This is exclusively the generated root build directory, never source/data.
  if (dirname(output) !== root || basename(output) !== 'dist') throw new Error('Unexpected build output path');
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  cpSync(resolve(source, 'client/dist'), output, { recursive: true });
  const html = readFileSync(resolve(output, 'index.html'), 'utf8');
  const hashes = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(match => !/\bsrc\s*=/i.test(match[1]) && match[2].trim())
    .map(match => `'sha256-${createHash('sha256').update(match[2]).digest('base64')}'`);
  writeFileSync(resolve(output, 'csp-hashes.json'), JSON.stringify([...new Set(hashes)], null, 2) + '\n');
  const changesManifest = readFileSync(resolve(root, 'third_party/librechat-latest/changes.json'), 'utf8').replace(/\r\n/g, '\n');
  writeFileSync(resolve(output, 'librechat-build.json'), JSON.stringify({ commit: expectedCommit, version: JSON.parse(readFileSync(resolve(source, 'package.json'))).version, source: 'upstream/LibreChat/client', localChangesManifestSha256: createHash('sha256').update(changesManifest).digest('hex'), builtAt: new Date().toISOString() }, null, 2) + '\n');
  console.log(`Built the actual LibreChat client (${expectedCommit}) into ${output}`);
}

if (mode === 'install') {
  // Only the original frontend and shared browser packages are installed. The
  // original Mongo/Express backend is not built or run in this platform.
  await npm(['ci', '--workspace=client', '--workspace=packages/data-provider', '--workspace=packages/client', '--workspace=packages/chat', '--include-workspace-root', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org']);
} else if (mode === 'packages') {
  await packages();
} else if (mode === 'build') {
  await packages();
  await buildClient();
} else if (mode === 'client') {
  await buildClient();
} else if (mode === 'dev') {
  if (!existsSync(resolve(source, 'packages/chat/dist/index.mjs'))) await packages();
  await npm(['run', 'dev', '--workspace=client', '--', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], { BACKEND_PORT: '3000', HOST: '127.0.0.1' });
} else throw new Error(`Unknown LibreChat task: ${mode}`);
