import {
  eventStatusText,
  findMinutesPermissionWarning,
  getOAuthDisplayState,
  getRecordStatusText,
  getSummaryDisplayState,
  getSummaryStepState,
  hasMinuteLink,
  isVerifiedRecordSummary
} from './status-logic.js';

const meetingForm = document.querySelector('#meetingForm');
const summaryForm = document.querySelector('#summaryForm');
const meetingState = document.querySelector('#meetingState');
const summaryState = document.querySelector('#summaryState');
const refreshButton = document.querySelector('#refreshButton');
const syncButton = document.querySelector('#syncButton');
const createButton = document.querySelector('#createButton');
const reloadRecordsButton = document.querySelector('#reloadRecordsButton');
const recordsBody = document.querySelector('#recordsBody');
const toast = document.querySelector('#toast');
const reloadEventsButton = document.querySelector('#reloadEventsButton');
const retrySummaryButton = document.querySelector('#retrySummaryButton');
const eventsBody = document.querySelector('#eventsBody');
const eventHint = document.querySelector('#eventHint');
const oauthStatus = document.querySelector('#oauthStatus');
const oauthButton = document.querySelector('#oauthButton');
const oauthInlineButton = document.querySelector('#oauthInlineButton');
const oauthDetail = document.querySelector('#oauthDetail');
const stepSso = document.querySelector('#stepSso');
const stepSsoText = document.querySelector('#stepSsoText');
const stepMeeting = document.querySelector('#stepMeeting');
const stepMeetingText = document.querySelector('#stepMeetingText');
const stepBase = document.querySelector('#stepBase');
const stepBaseText = document.querySelector('#stepBaseText');
const stepSummary = document.querySelector('#stepSummary');
const stepSummaryText = document.querySelector('#stepSummaryText');
const baseLink = document.querySelector('#baseLink');

let currentMeeting = null;
let latestRecords = [];
let latestEvents = [];
let minutesPermissionAuthUrl = '';
let currentAuth = { authenticated: false, openId: '', name: '' };
let currentOAuthStatus = null;
let latestConfig = null;

createButton.disabled = true;

loadConfigStatus();
loadOAuthStatus();

meetingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!currentAuth.authenticated) {
    showToast('请先登录飞书，再发起会议。', true);
    return;
  }
  createButton.disabled = true;
  createButton.textContent = '发起中';
  try {
    const form = new FormData(meetingForm);
    const payload = {
      topic: String(form.get('topic') || '').trim(),
      durationMinutes: Number(form.get('durationMinutes') || 60),
      password: String(form.get('password') || '').trim() || undefined,
      autoRecord: form.get('autoRecord') === 'on'
    };
    const data = await api('/api/meetings', { method: 'POST', body: payload });
    setMeeting(data.meeting);
    await loadRecords();
    showToast('飞书会议已创建，数据已写入会议数据表。');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    updateCreateButtonState();
  }
});

refreshButton.addEventListener('click', async () => {
  if (!currentMeeting?.reserveId) return;
  refreshButton.disabled = true;
  try {
    const data = await api(`/api/meetings/${encodeURIComponent(currentMeeting.reserveId)}`);
    setMeeting(data.meeting);
    showToast('会议状态已刷新。');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    refreshButton.disabled = false;
  }
});

summaryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!currentAuth.authenticated) {
    showToast('请先登录飞书，再同步纪要。', true);
    return;
  }
  if (!currentMeeting?.reserveId) return;
  syncButton.disabled = true;
  syncButton.textContent = '同步中';
  try {
    const form = new FormData(summaryForm);
    const payload = {
      minuteUrl: String(form.get('minuteUrl') || '').trim() || undefined,
      noteId: String(form.get('noteId') || '').trim() || undefined
    };
    const data = await api(`/api/meetings/${encodeURIComponent(currentMeeting.reserveId)}/sync-summary`, {
      method: 'POST',
      body: payload
    });
    setMeeting(data.meeting);
    await loadRecords();
    showToast('纪要已同步并更新数据表。');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    syncButton.disabled = false;
    syncButton.textContent = '同步纪要到数据表';
  }
});

reloadRecordsButton.addEventListener('click', loadRecords);
reloadEventsButton.addEventListener('click', loadEvents);
retrySummaryButton.addEventListener('click', retryLatestSummary);
oauthButton.addEventListener('click', startOAuthLogin);
if (oauthInlineButton) oauthInlineButton.addEventListener('click', startOAuthLogin);
recordsBody.addEventListener('click', (event) => {
  const button = event.target.closest('[data-use-record]');
  if (!button) return;
  if (!currentAuth.authenticated) {
    showToast('请先登录飞书，再查看演示数据。', true);
    return;
  }
  const record = latestRecords.find((item) => item.reserveId === button.dataset.useRecord);
  if (!record) return;
  setMeeting(meetingFromRecord(record));
  showToast('已切换为当前会议，可继续同步纪要。');
});

if (new URLSearchParams(location.search).get('feishu_auth') === 'success') {
  history.replaceState({}, '', location.pathname);
  showToast('飞书登录已完成，可以发起会议了。');
  loadOAuthStatus();
}

async function startOAuthLogin() {
  oauthButton.disabled = true;
  if (oauthInlineButton) oauthInlineButton.disabled = true;
  try {
    const data = await api('/api/feishu/oauth/login-url');
    window.location.href = data.url;
  } catch (error) {
    showToast(error.message, true);
    oauthButton.disabled = false;
    if (oauthInlineButton) oauthInlineButton.disabled = false;
  }
}

async function retryLatestSummary() {
  if (!currentAuth.authenticated) {
    showToast('请先登录飞书，再重试同步。', true);
    return;
  }
  retrySummaryButton.disabled = true;
  retrySummaryButton.textContent = '重试中';
  try {
    const data = await api('/api/feishu/events/retry-latest-summary', { method: 'POST' });
    if (data.record) {
      setMeeting(meetingFromRecord(data.record));
    }
    await Promise.all([loadRecords(), loadEvents()]);
    showToast('最近一次真实妙记已重新同步到数据表。');
  } catch (error) {
    showToast(error.message, true);
    await loadEvents();
  } finally {
    retrySummaryButton.disabled = false;
    retrySummaryButton.textContent = '重试最近同步';
  }
}

async function loadConfigStatus() {
  try {
    const status = await api('/api/config/status');
    latestConfig = status;
    minutesPermissionAuthUrl = status.minutesPermissionAuthUrl || '';
    if (status.baseUrl) {
      baseLink.hidden = false;
      baseLink.href = status.baseUrl;
    }
    updateBaseStep(status);
  } catch {}
}

async function loadOAuthStatus() {
  try {
    const status = await api('/api/feishu/oauth/status');
    currentAuth = {
      authenticated: Boolean(status.authenticated || status.authorized || status.canRefresh),
      openId: status.openId || '',
      name: status.name || ''
    };
    currentOAuthStatus = status;
    applyLoginGate();
    updateCreateButtonState();
    if (currentAuth.authenticated) {
      updateOAuthDisplay();
      setFlowStep(stepSso, stepSsoText, 'ok', `已登录 ${displayUserName(status)}`);
      await Promise.all([loadRecords(), loadEvents()]);
    } else {
      updateOAuthDisplay();
      if (oauthInlineButton) oauthInlineButton.textContent = '去登录';
      setFlowStep(stepSso, stepSsoText, 'warn', '等待飞书登录');
      resetProtectedDataView();
    }
  } catch (error) {
    currentAuth = { authenticated: false, openId: '', name: '' };
    applyLoginGate();
    resetProtectedDataView();
    updateCreateButtonState();
    oauthStatus.textContent = '授权检查失败';
    oauthStatus.className = 'status-badge warn';
    if (oauthDetail) oauthDetail.textContent = error.message;
    setFlowStep(stepSso, stepSsoText, 'warn', '登录状态未知');
  } finally {
    oauthButton.disabled = false;
    if (oauthInlineButton) oauthInlineButton.disabled = false;
  }
}

function updateCreateButtonState() {
  createButton.disabled = !currentAuth.authenticated;
  createButton.textContent = currentAuth.authenticated ? '发起飞书会议' : '登录后发起会议';
}

function applyLoginGate() {
  const disabled = !currentAuth.authenticated;
  createButton.disabled = disabled;
  refreshButton.disabled = disabled || !currentMeeting?.reserveId;
  syncButton.disabled = disabled || !currentMeeting?.reserveId;
  reloadRecordsButton.disabled = disabled;
  reloadEventsButton.disabled = disabled;
  retrySummaryButton.disabled = disabled;
}

function resetProtectedDataView() {
  currentMeeting = null;
  latestRecords = [];
  latestEvents = [];
  meetingState.className = 'empty-state';
  meetingState.innerHTML = '<strong>暂无会议</strong><span>发起会议后，这里会显示会议号和入会链接。</span>';
  summaryState.className = 'summary-state';
  summaryState.innerHTML = '<strong>等待纪要</strong><span>会议结束后等待飞书生成妙记和智能纪要。</span>';
  recordsBody.innerHTML = '<tr><td colspan="7" class="table-empty">请先登录飞书，再查看演示数据。</td></tr>';
  eventsBody.innerHTML = '<tr><td colspan="5" class="table-empty">请先登录飞书，再查看事件日志。</td></tr>';
  eventHint.hidden = true;
  eventHint.innerHTML = '';
  setFlowStep(stepMeeting, stepMeetingText, 'pending', '登录后可创建');
  setFlowStep(stepSummary, stepSummaryText, 'pending', '等待登录');
}

async function loadRecords() {
  try {
    const data = await api('/api/records');
    const records = data.records || [];
    renderRecords(records);
    updateRecordSteps(records);
    if (!currentMeeting && records.length) {
      setMeeting(meetingFromRecord(records[0]));
    }
    renderEventHint();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadEvents() {
  try {
    const data = await api('/api/feishu/events/status');
    latestEvents = data.events || [];
    renderEvents(latestEvents);
  } catch (error) {
    showToast(error.message, true);
  }
}

function setMeeting(meeting) {
  currentMeeting = meeting;
  applyLoginGate();
  renderMeeting(meeting);
  renderSummary(meeting.summary);
  updateCurrentMeetingSteps(meeting);
}

function renderMeeting(meeting) {
  const joinUrl = meeting.url || meeting.appLink;
  meetingState.className = 'meeting-card';
  meetingState.innerHTML = `
    <div class="meeting-link">
      <div>
        <strong>${escapeHtml(meeting.topic || '飞书视频会议')}</strong>
        <div class="muted">${escapeHtml(getRecordStatusText(meeting))}</div>
      </div>
      ${joinUrl ? `<a href="${escapeAttribute(joinUrl)}" target="_blank" rel="noreferrer">打开飞书会议</a>` : '<span class="muted">暂无入会链接</span>'}
    </div>
    <div class="field-grid">
      <div class="field"><span>预约 ID</span><strong>${escapeHtml(meeting.reserveId || '-')}</strong></div>
      <div class="field"><span>会议号</span><strong>${escapeHtml(meeting.meetingNo || '-')}</strong></div>
      <div class="field"><span>会议归属人</span><strong>${escapeHtml(displayUserName(meeting))}</strong></div>
    </div>
    <div class="field">
      <span>入会链接</span>
      <strong>${joinUrl ? `<a class="inline-link" href="${escapeAttribute(joinUrl)}" target="_blank" rel="noreferrer">${escapeHtml(joinUrl)}</a>` : '-'}</strong>
    </div>
  `;
}

function renderSummary(summary) {
  const summaryRecord = currentMeeting?.summaryTitle ? currentMeeting : summary;
  const displayState = getSummaryDisplayState(summaryRecord);
  if (!summary || !displayState) {
    summaryState.className = 'summary-state';
    summaryState.innerHTML = '<span>会议创建后，请在飞书会议里开启录制和智能纪要，结束后等待自动回写。</span>';
    return;
  }

  summaryState.className = 'summary-card';
  summaryState.innerHTML = `
    <h3>${escapeHtml(displayState.title || '纪要已同步')}</h3>
    <div class="doc-token">${escapeHtml(displayState.verified ? '纪要内容已写入演示数据表，请打开数据表查看完整内容。' : displayState.description)}</div>
    <div class="summary-actions">
      ${latestConfig?.baseUrl ? `<a class="secondary link-button" href="${escapeAttribute(latestConfig.baseUrl)}" target="_blank" rel="noreferrer">去数据表查看</a>` : ''}
      ${minuteUrlFrom(summary) ? `<a class="secondary link-button" href="${escapeAttribute(minuteUrlFrom(summary))}" target="_blank" rel="noreferrer">打开妙记</a>` : ''}
      ${smartNoteUrlFrom(summary) ? `<a class="secondary link-button" href="${escapeAttribute(smartNoteUrlFrom(summary))}" target="_blank" rel="noreferrer">打开智能纪要</a>` : ''}
    </div>
  `;
}

function renderRecords(records) {
  latestRecords = records;
  updateOAuthDisplay();
  if (!records.length) {
    recordsBody.innerHTML = '<tr><td colspan="7" class="table-empty">暂无会议记录，登录飞书后发起第一场真实会议。</td></tr>';
    return;
  }

  recordsBody.innerHTML = records.map((record) => `
    <tr>
      <td data-label="会议主题">
        <strong>${escapeHtml(record.topic || '-')}</strong>
        <div class="muted">${escapeHtml(record.reserveId || '-')}</div>
      </td>
      <td data-label="状态">${statusPill(record)}</td>
      <td data-label="会议号">${record.meetingUrl ? `<a class="link-cell" href="${escapeAttribute(record.meetingUrl)}" target="_blank" rel="noreferrer">${escapeHtml(record.meetingNo || '打开会议')}</a>` : escapeHtml(record.meetingNo || '-')}</td>
      <td data-label="纪要">${summaryCell(record)}</td>
      <td data-label="数据表同步">${syncPill(record.bitableSyncStatus)}</td>
      <td data-label="更新时间">${escapeHtml(formatTime(record.updatedAt))}</td>
      <td data-label="查看"><button class="table-action" type="button" data-use-record="${escapeAttribute(record.reserveId)}">查看</button></td>
    </tr>
  `).join('');
}

function meetingFromRecord(record) {
  return {
    reserveId: record.reserveId,
    topic: record.topic,
    meetingNo: record.meetingNo,
    password: record.password,
    url: record.meetingUrl,
    endTime: record.endTime,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ownerId: record.ownerId,
    ownerName: record.ownerName,
    minuteToken: record.minuteToken,
    minuteUrl: record.minuteUrl,
    bitableSyncStatus: record.bitableSyncStatus,
    summaryTitle: record.summaryTitle,
    highlights: record.highlights || [],
    actions: record.actions || [],
    artifacts: record.artifacts || [],
    summary: record.summaryTitle ? {
      source: record.summarySource,
      title: record.summaryTitle,
      minuteToken: record.minuteToken,
      minuteUrl: record.minuteUrl,
      highlights: record.highlights || [],
      actions: record.actions || [],
      artifacts: record.artifacts || []
    } : null
  };
}

function renderEvents(events) {
  const latest = events[0];
  const latestRecord = latestRecords.find((record) => record.meetingNo === latest?.meetingNo) || latestRecords[0];
  const summaryState = getSummaryStepState({ latestRecord, recordingEvent: latest });
  updateEventStep(events);
  renderEventHint(events);
  if (!events.length) {
    eventsBody.innerHTML = '<tr><td colspan="5" class="table-empty">暂无事件</td></tr>';
    return;
  }

  eventsBody.innerHTML = events.map((event) => `
    <tr>
      <td data-label="事件类型">${escapeHtml(event.type || '-')}</td>
      <td data-label="状态">${eventStatusPill(event.status)}</td>
      <td data-label="会议号">${escapeHtml(event.meetingNo || '-')}</td>
      <td data-label="妙记线索">${escapeHtml(event.minuteToken || event.error || '-')}</td>
      <td data-label="时间">${escapeHtml(formatTime(event.at))}</td>
    </tr>
  `).join('');
}

function updateBaseStep(status) {
  if (status.tableStorage === 'FEISHU_BITABLE' && status.baseUrl) {
    setFlowStep(stepBase, stepBaseText, 'ok', '多维表格已连接');
  } else {
    setFlowStep(stepBase, stepBaseText, 'warn', '等待数据表配置');
  }
}

function updateRecordSteps(records) {
  const latest = records[0];
  if (!latest) {
    setFlowStep(stepMeeting, stepMeetingText, currentAuth.authenticated ? 'info' : 'pending', currentAuth.authenticated ? '可发起会议' : '登录后可创建');
    setFlowStep(stepSummary, stepSummaryText, 'pending', '等待会议结束');
    return;
  }
  setFlowStep(stepMeeting, stepMeetingText, 'ok', latest.meetingNo ? `会议号 ${latest.meetingNo}` : '已创建');
  const summaryState = getSummaryStepState({ latestRecord: latest });
  setFlowStep(stepSummary, stepSummaryText, summaryState.status, summaryState.text);
}

function updateCurrentMeetingSteps(meeting) {
  if (!meeting) return;
  setFlowStep(stepMeeting, stepMeetingText, 'ok', meeting.meetingNo ? `会议号 ${meeting.meetingNo}` : '已创建');
  const summaryState = getSummaryStepState({ latestRecord: meeting });
  setFlowStep(stepSummary, stepSummaryText, summaryState.status, summaryState.text);
}

function updateEventStep(events) {
  const recordingEvent = events.find((event) => event.type === 'vc.meeting.recording_ready_v1');
  if (!recordingEvent) return;
  const latestRecord = latestRecords.find((record) => record.meetingNo === recordingEvent.meetingNo) || latestRecords[0];
  const summaryState = getSummaryStepState({ latestRecord, recordingEvent });
  setFlowStep(stepSummary, stepSummaryText, summaryState.status, summaryState.text);
}

function setFlowStep(element, textElement, status, text) {
  element.className = `flow-step ${status}`;
  textElement.textContent = text;
}

function renderEventHint(events) {
  const permissionWarning = findMinutesPermissionWarning({ records: latestRecords, events });
  updateOAuthDisplay(permissionWarning);
  if (!permissionWarning) {
    eventHint.hidden = true;
    eventHint.innerHTML = '';
    return;
  }

  const authUrl = minutesPermissionAuthUrl || extractAuthUrl(permissionWarning.message);
  eventHint.hidden = false;
  eventHint.innerHTML = `
    <strong>会后已经拿到妙记，但还缺少读取权限。</strong>
    <span><code>minutes:minutes.basic:read</code> 和 <code>minutes:minutes.artifacts:read</code> 是用户授权权限。请点击页面上的“飞书登录”，授权完成后点击“重试最近同步”。</span>
    ${authUrl ? `<a href="${escapeAttribute(authUrl)}" target="_blank" rel="noreferrer">查看权限配置</a>` : ''}
  `;
}

function updateOAuthDisplay(permissionWarning = findMinutesPermissionWarning({ records: latestRecords, events: latestEvents })) {
  const state = getOAuthDisplayState({
    authenticated: currentAuth.authenticated,
    openId: currentOAuthStatus?.openId || currentAuth.openId,
    name: currentOAuthStatus?.name || currentAuth.name,
    updatedAt: currentOAuthStatus?.updatedAt || '',
    permissionWarning,
    formatTime: formatFullTime
  });
  oauthStatus.textContent = state.statusText;
  oauthStatus.className = state.statusClass;
  oauthStatus.hidden = !currentAuth.authenticated && !permissionWarning;
  oauthButton.textContent = state.buttonText;
  oauthButton.hidden = currentAuth.authenticated && !permissionWarning;
  if (oauthInlineButton) oauthInlineButton.textContent = currentAuth.authenticated ? state.buttonText : '去登录';
  if (oauthDetail) oauthDetail.textContent = state.detailText || oauthDetail.textContent;
}

function extractAuthUrl(value) {
  const match = String(value || '').match(/https:\/\/open\.feishu\.cn\/app\/[^\s，。；]+/);
  return match?.[0] || '';
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || '请求失败。');
  }
  return payload;
}

function statusText(status) {
  return getRecordStatusText(status);
}

function statusPill(recordOrStatus) {
  const status = typeof recordOrStatus === 'string' ? recordOrStatus : recordOrStatus?.status;
  const verified = typeof recordOrStatus === 'object' && isVerifiedRecordSummary(recordOrStatus);
  const text = getRecordStatusText(recordOrStatus);
  const cls = status === 'SUMMARY_READY' ? (verified ? 'ok' : 'warn') : status === 'EXPIRED' ? 'warn' : 'info';
  return `<span class="pill ${cls}">${escapeHtml(text)}</span>`;
}

function summaryCell(record) {
  if (isVerifiedRecordSummary(record) || hasMinuteLink(record)) {
    const links = [
      isVerifiedRecordSummary(record) && latestConfig?.baseUrl ? `<a class="link-cell" href="${escapeAttribute(latestConfig.baseUrl)}" target="_blank" rel="noreferrer">去数据表查看</a>` : '',
      minuteUrlFrom(record) ? `<a class="link-cell" href="${escapeAttribute(minuteUrlFrom(record))}" target="_blank" rel="noreferrer">妙记</a>` : '',
      isVerifiedRecordSummary(record) && smartNoteUrlFrom(record) ? `<a class="link-cell" href="${escapeAttribute(smartNoteUrlFrom(record))}" target="_blank" rel="noreferrer">智能纪要</a>` : ''
    ].filter(Boolean);
    return links.join('<span class="link-separator"> · </span>') || '<span class="muted">去数据表查看</span>';
  }
  if (record.summaryTitle) return '<span class="muted">已拿到妙记，等待智能纪要</span>';
  return '<span class="muted">未同步</span>';
}

function syncPill(status) {
  const map = {
    SYNCED: ['ok', '已写入数据表'],
    FAILED: ['warn', '数据表同步失败'],
    LOCAL_SAVED: ['info', '本地兜底缓存']
  };
  const [cls, text] = map[status] || ['info', '本地兜底缓存'];
  return `<span class="pill ${cls}">${escapeHtml(text)}</span>`;
}

function eventStatusPill(status) {
  const cls = status === 'SYNCED' ? 'ok' : status === 'FAILED' ? 'warn' : 'info';
  return `<span class="pill ${cls}">${escapeHtml(eventStatusText(status))}</span>`;
}

function maskOwnerId(ownerId) {
  if (!ownerId) return '未配置';
  if (ownerId.length <= 14) return ownerId;
  return `${ownerId.slice(0, 7)}...${ownerId.slice(-6)}`;
}

function displayUserName(value = {}) {
  const ownerId = value.openId || value.ownerId || '';
  if ((value.name || value.ownerName || value.userName)) return value.name || value.ownerName || value.userName;
  if (ownerId && ownerId === currentAuth.openId && currentAuth.name) return currentAuth.name;
  return maskOwnerId(ownerId || currentAuth.openId || '');
}

function minuteUrlFrom(record = {}) {
  const artifact = (record.artifacts || []).find((item) => item?.type === '妙记' && (item.url || item.token));
  const token = record.minuteToken || artifact?.token || '';
  return record.minuteUrl || artifact?.url || (token ? `https://meetings.feishu.cn/minutes/${encodeURIComponent(token)}` : '');
}

function smartNoteUrlFrom(record = {}) {
  const artifact = (record.artifacts || []).find((item) => ['纪要文档', '飞书文档'].includes(item?.type) && item.docToken);
  if (artifact?.docToken) {
    const origin = latestConfig?.baseUrl ? new URL(latestConfig.baseUrl).origin : 'https://feishu.cn';
    return `${origin}/docx/${encodeURIComponent(artifact.docToken)}`;
  }
  return minuteUrlFrom(record);
}

function formatTime(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function formatFullTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.className = `toast show${isError ? ' error' : ''}`;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.className = 'toast';
  }, 3600);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}
