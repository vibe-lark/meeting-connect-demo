import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('page styling follows the Feishu design system spacing and density baseline', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

  assert.match(css, /--primary:\s*#1456f0;/);
  assert.match(css, /\.main\s*\{[\s\S]*width:\s*min\(1200px,\s*100%\)/);
  assert.match(css, /\.main\s*\{[\s\S]*padding:\s*24px 16px/);
  assert.match(css, /\.topbar\s*\{[\s\S]*border-radius:\s*6px/);
  assert.match(css, /\.panel\s*\{[\s\S]*border-radius:\s*6px/);
  assert.match(css, /input,\s*\nselect\s*\{[\s\S]*height:\s*32px/);
  assert.match(css, /button\s*\{[\s\S]*height:\s*32px/);
  assert.match(css, /th,\s*\ntd\s*\{[\s\S]*padding:\s*8px 12px/);
});

test('mobile workflow keeps the primary action visible before secondary status badges', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

  assert.match(html, /<button id="oauthButton" class="primary compact-button" type="button">飞书登录<\/button>/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.top-actions\s*\{[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.top-actions\s+\{\s*order:\s*-1/);
});

test('login area avoids duplicate unauthenticated copy', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

  assert.match(html, /<span id="oauthStatus" class="status-badge" hidden>检查授权中<\/span>/);
  assert.match(app, /oauthStatus\.hidden = !currentAuth\.authenticated && !permissionWarning/);
  assert.match(app, /oauthButton\.hidden = currentAuth\.authenticated && !permissionWarning/);
  assert.match(css, /\[hidden\]\s*\{[\s\S]*display:\s*none !important/);
});

test('create and meeting status panels keep matching height on desktop', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

  assert.match(css, /\.command-panel,\s*\n\.status-panel\s*\{[\s\S]*min-height:\s*360px/);
  assert.match(css, /\.command-panel\s*\{[\s\S]*display:\s*grid/);
  assert.match(css, /\.status-panel\s*\{[\s\S]*display:\s*grid/);
});

test('primary demo surface uses customer-facing copy instead of integration jargon', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const primarySurface = html.split('<details class="panel table-panel technical-panel"')[0];
  const primaryText = primarySurface.replace(/<[^>]+>/g, ' ');

  assert.match(primarySurface, /<title>MeetBack 会议同步台<\/title>/);
  assert.match(primarySurface, /<img class="brand-logo" src="\/logo\.svg" alt="MeetBack"/);
  assert.match(primarySurface, /<h1>MeetBack 会议同步台<\/h1>/);
  assert.match(primaryText, /演示飞书会议开放能力：在自研页面发起真实会议，并把会后的妙记和智能纪要回写到多维表格。/);
  assert.match(primarySurface, /<p>体验流程：状态与真实状态保持一致<\/p>/);
  assert.doesNotMatch(primarySurface, /<span>体验流程<\/span>/);
  assert.doesNotMatch(primarySurface, /<strong>状态与真实状态保持一致<\/strong>/);
  assert.match(primarySurface, /<strong>发起会议<\/strong>/);
  assert.match(primarySurface, /<strong>加入会议<\/strong>/);
  assert.match(primarySurface, /待发起会议/);
  assert.match(primarySurface, /待加入会议/);
  assert.match(primarySurface, /<strong>播放一段内容后退出<\/strong>/);
  assert.match(primarySurface, /待会议结束/);
  assert.match(primarySurface, /<strong>自动回写多维表格<\/strong>/);
  assert.match(primarySurface, /待自动回写/);
  assert.doesNotMatch(primaryText, /技术链路|可验收的开放能力/);
  assert.doesNotMatch(primaryText, /登录飞书|写入多维表格|回写智能纪要/);
  assert.doesNotMatch(primaryText, /飞书会议开放能力演示/);
  assert.doesNotMatch(primaryText, /自研业务页演示/);
  assert.doesNotMatch(primaryText, /飞书会议纪要回写 Demo/);
  assert.doesNotMatch(primaryText, /飞书会议配置已就绪|同步真实数据表/);
  assert.doesNotMatch(primarySurface, /<section class="metrics"/);
  assert.doesNotMatch(primarySurface, /<ol class="demo-checklist"/);
  assert.doesNotMatch(primarySurface, /<h2 id="summary-title">同步进度<\/h2>/);
  assert.match(primarySurface, /<h2 id="status-title" class="status-title-line">会议状态 <span id="meetingStatusBadge"/);
  assert.match(primarySurface, /会议号、预约信息和纪要回写进度都在这里。/);
  assert.match(primarySurface, /发起会议后，这里会显示会议号和预约信息。/);
  assert.doesNotMatch(primarySurface, /入会链接、纪要回写进度和查看入口都在这里。/);
  assert.match(app, /<div class="field"><span>预约时间<\/span><strong>\$\{escapeHtml\(formatFullTime\(meeting\.createdAt\) \|\| '-'\)\}<\/strong><\/div>/);
  assert.match(app, /<div class="field"><span>会议主题<\/span>/);
  assert.match(app, /<div class="field"><span>会议号<\/span><strong>\$\{joinUrl \? `<a class="inline-link"/);
  assert.match(app, /records\.find\(isMeetingActiveForStatus\)/);
  assert.match(app, /过期会议不会显示在这里，可在下方数据表查看历史记录。/);
  assert.doesNotMatch(app, /<div class="meeting-link">/);
  assert.doesNotMatch(app, /<span>会议归属人<\/span>/);
  assert.doesNotMatch(app, /<span>入会链接<\/span>/);
  assert.doesNotMatch(primaryText, /SSO|Owner|Meeting Base|recording_ready|minute token|user token/);
  assert.doesNotMatch(primaryText, /token|note_id/);
  assert.doesNotMatch(primarySurface, /brand-mark/);
});

test('meeting table copy guides users to the demo Base instead of exposing summary contents', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(app, /去数据表查看/);
  assert.match(app, /打开会议/);
  assert.match(app, /data-label="查看"><a class="table-action"/);
  assert.match(app, /href="\$\{escapeAttribute\(recordBitableUrl\(record\)\)\}"/);
  assert.match(app, /function recordBitableUrl\(record = \{\}\)/);
  assert.match(app, /if \(latestRecords\.length\) renderRecords\(latestRecords\)/);
  assert.doesNotMatch(app, /<strong>关键结论<\/strong>/);
  assert.doesNotMatch(app, /<strong>待办事项<\/strong>/);
  assert.doesNotMatch(app, />处理</);
  assert.doesNotMatch(app, /data-use-record/);
  assert.match(html, /<th>查看<\/th>/);
});

test('technical log section uses event-log wording and removes manual sync form', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(html, /<span>日志事件<\/span>/);
  assert.match(html, /<small>查看飞书事件和同步日志<\/small>/);
  assert.doesNotMatch(html, /手动补同步|summaryForm|minuteUrl|noteId|syncButton/);
  assert.doesNotMatch(app, /summaryForm|syncButton|sync-summary|同步纪要到数据表/);
  assert.match(app, /LOCAL_SAVED: \['info', '待写入数据表'\]/);
  assert.doesNotMatch(app, /本地兜底缓存/);
});

test('page disables demo actions until Feishu login is confirmed', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(html, /<button id="reloadRecordsButton" class="secondary" type="button" disabled>刷新数据<\/button>/);
  assert.match(app, /applyLoginGate/);
  assert.match(app, /请先登录飞书，再查看演示数据。/);
});
