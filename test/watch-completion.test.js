import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('completion watcher retries latest summary before each audit', async () => {
  const script = await readFile(new URL('../scripts/watch-completion.js', import.meta.url), 'utf8');

  assert.match(script, /await runRetrySummary\(\)/);
  assert.match(script, /scripts\/retry-latest-summary-sync\.js/);
  assert.match(script, /scripts\/completion-audit\.js/);
  assert.ok(
    script.indexOf('await runRetrySummary()') < script.indexOf('const result = await runAudit()'),
    'retry should happen before audit in each watch loop'
  );
});
