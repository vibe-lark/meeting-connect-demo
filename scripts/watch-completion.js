import { spawn } from 'node:child_process';

const timeoutMs = Number(process.env.WATCH_TIMEOUT_MS || 15 * 60 * 1000);
const intervalMs = Number(process.env.WATCH_INTERVAL_MS || 15 * 1000);
const startedAt = Date.now();

main().catch((error) => {
  console.error(`Completion watch failed: ${error.message}`);
  process.exit(1);
});

async function main() {
  while (Date.now() - startedAt < timeoutMs) {
    console.log(`\n[${new Date().toISOString()}] Retrying latest summary, then running completion audit...`);
    await runRetrySummary();
    const result = await runAudit();
    if (result === 0) {
      console.log('Completion audit passed.');
      return;
    }
    await sleep(intervalMs);
  }

  console.error(`Completion audit did not pass within ${Math.round(timeoutMs / 1000)} seconds.`);
  process.exit(1);
}

function runRetrySummary() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/retry-latest-summary-sync.js'], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit'
    });
    child.on('exit', (code) => {
      if (code) {
        console.log(`Summary retry is not ready yet; continuing to audit. exit=${code}`);
      }
      resolve(code || 0);
    });
  });
}

function runAudit() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/completion-audit.js'], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit'
    });
    child.on('exit', (code) => resolve(code || 0));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
