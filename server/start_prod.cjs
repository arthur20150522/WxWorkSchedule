/**
 * PM2 production starter — runs tsc before launching the server.
 * Ensures dist/ is always up-to-date on every restart, eliminating the
 * "stale dist → white screen" class of bugs.
 */
const { execSync } = require('child_process');
const { spawn } = require('child_process');

try {
  console.log('[startup] Running tsc...');
  execSync('npx tsc', { cwd: __dirname, stdio: 'inherit' });
  console.log('[startup] tsc compiled successfully');
} catch (e) {
  console.error('[startup] tsc failed:', e.message);
  process.exit(1);
}

const server = spawn('node', ['dist/api.js'], {
  cwd: __dirname,
  stdio: 'inherit',
  shell: true
});

server.on('exit', (code) => process.exit(code || 0));
