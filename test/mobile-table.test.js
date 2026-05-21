import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('mobile tables render as labeled rows instead of clipped wide tables', async () => {
  const [appJs, css] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8')
  ]);

  assert.match(appJs, /data-label="会议主题"/);
  assert.match(appJs, /data-label="事件类型"/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*td::before[\s\S]*content: attr\(data-label\)/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*table-empty[\s\S]*display: table-cell/);
});
