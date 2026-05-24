import {
  eventStatusText,
  findMinutesPermissionWarning,
  getOAuthDisplayState,
  getRecordStatusText,
  getSummaryDisplayState,
  getSummaryStepState,
  hasMinuteLink,
  isMeetingActiveForStatus,
  isVerifiedRecordSummary
} from './status-logic.js';

const meetingForm = document.querySelector('#meetingForm');
const meetingState = document.querySelector('#meetingState');
const summaryState = document.querySelector('#summaryState');
const meetingStatusBadge = document.querySelector('#meetingStatusBadge');
const refreshButton = document.querySelector('#refreshButton');
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
const stepMeeting = document.querySelector('#stepMeeting');
const stepMeetingText = document.querySelector('#stepMeetingText');
const stepJoin = document.querySelector('#stepJoin');
const stepJoinText = document.querySelector('#stepJoinText');
const stepContent = document.querySelector('#stepContent');
const stepContentText = document.querySelector('#stepContentText');
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

const initialFlowState = {
  meeting: '待发起会议',
  join: '待加入会议',
  content: '待会议结束',
  summary: '待自动回写'
};

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
      password: String(form.get('password') || '').trim() || undefined
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

reloadRecordsButton.addEventListener('click', loadRecords);
reloadEventsButton.addEventListener('click', loadEvents);
retrySummaryButton.addEventListener('click', retryLatestSummary);
oauthButton.addEventListener('click', startOAuthLogin);
if (oauthInlineButton) oauthInlineButton.addEventListener('click', startOAuthLogin);

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
    if (latestRecords.length) renderRecords(latestRecords);
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
      await Promise.all([loadRecords(), loadEvents()]);
    } else {
      updateOAuthDisplay();
      if (oauthInlineButton) oauthInlineButton.textContent = '去登录';
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
  reloadRecordsButton.disabled = disabled;
  reloadEventsButton.disabled = disabled;
  retrySummaryButton.disabled = disabled;
}

function resetProtectedDataView() {
  currentMeeting = null;
  latestRecords = [];
  latestEvents = [];
  meetingState.className = 'empty-state';
  meetingState.innerHTML = '<strong>暂无会议</strong><span>发起会议后，这里会显示会议号和预约信息。</span>';
  setMeetingStatusBadge('');
  summaryState.className = 'summary-state';
  summaryState.hidden = true;
  summaryState.innerHTML = '';
  recordsBody.innerHTML = '<tr><td colspan="7" class="table-empty">请先登录飞书，再查看演示数据。</td></tr>';
  eventsBody.innerHTML = '<tr><td colspan="5" class="table-empty">请先登录飞书，再查看事件日志。</td></tr>';
  eventHint.hidden = true;
  eventHint.innerHTML = '';
  resetFlowSteps();
}

async function loadRecords() {
  try {
    const data = await api('/api/records');
    const records = data.records || [];
    renderRecords(records);
    updateRecordSteps(records);
    const activeRecord = records.find(isMeetingActiveForStatus);
    if (currentMeeting && !isMeetingActiveForStatus(currentMeeting)) {
      clearMeetingStatus();
    }
    if (!currentMeeting && activeRecord) {
      setMeeting(meetingFromRecord(activeRecord));
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

function clearMeetingStatus() {
  currentMeeting = null;
  applyLoginGate();
  meetingState.className = 'empty-state';
  meetingState.innerHTML = '<strong>暂无进行中的会议</strong><span>过期会议不会显示在这里，可在下方数据表查看历史记录。</span>';
  setMeetingStatusBadge('');
  summaryState.className = 'summary-state';
  summaryState.hidden = true;
  summaryState.innerHTML = '';
}

function renderMeeting(meeting) {
  const joinUrl = meeting.url || meeting.appLink;
  setMeetingStatusBadge(getSummaryStepState({ latestRecord: meeting }).text || getRecordStatusText(meeting), getSummaryStepState({ latestRecord: meeting }).status);
  meetingState.className = 'meeting-card';
  meetingState.innerHTML = `
    <div class="field-grid">
      <div class="field"><span>会议主题</span><strong>${escapeHtml(meeting.topic || '飞书视频会议')}</strong></div>
      <div class="field"><span>预约 ID</span><strong>${escapeHtml(meeting.reserveId || '-')}</strong></div>
      <div class="field"><span>预约时间</span><strong>${escapeHtml(formatFullTime(meeting.createdAt) || '-')}</strong></div>
      <div class="field"><span>会议号</span><strong>${joinUrl ? `<a class="inline-link" href="${escapeAttribute(joinUrl)}" target="_blank" rel="noreferrer">${escapeHtml(meeting.meetingNo || '打开会议')}</a>` : escapeHtml(meeting.meetingNo || '-')}</strong></div>
    </div>
  `;
}

function renderSummary(summary) {
  const summaryRecord = currentMeeting?.summaryTitle ? currentMeeting : summary;
  const displayState = getSummaryDisplayState(summaryRecord);
  if (!summary || !displayState) {
    summaryState.className = 'summary-state';
    summaryState.hidden = true;
    summaryState.innerHTML = '';
    return;
  }

  setMeetingStatusBadge(displayState.title || '纪要已同步', displayState.verified ? 'ok' : 'warn');
  summaryState.hidden = true;
  summaryState.className = 'summary-state';
  summaryState.innerHTML = '';
}

function setMeetingStatusBadge(text, status = 'info') {
  if (!meetingStatusBadge) return;
  meetingStatusBadge.hidden = !text;
  meetingStatusBadge.textContent = text || '';
  const badgeStatus = status === 'ok' || status === 'warn' ? status : 'info';
  meetingStatusBadge.className = `status-badge ${badgeStatus}`;
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
      <td data-label="查看"><a class="table-action" href="${escapeAttribute(recordBitableUrl(record))}" target="_blank" rel="noreferrer" aria-disabled="${recordBitableUrl(record) === '#' ? 'true' : 'false'}">查看</a></td>
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

function updateRecordSteps(records) {
  const latest = records.find(isMeetingActiveForStatus);
  if (!latest) {
    resetFlowSteps();
    return;
  }
  setFlowStep(stepMeeting, stepMeetingText, 'ok', latest.meetingNo ? `会议号 ${latest.meetingNo}` : '已创建');
  setFlowStep(stepJoin, stepJoinText, hasMinuteLink(latest) ? 'ok' : 'info', hasMinuteLink(latest) ? '会议已结束' : '请用客户端加入会议');
  setFlowStep(stepContent, stepContentText, hasMinuteLink(latest) ? 'ok' : 'info', hasMinuteLink(latest) ? '会议已结束，正在处理产物' : '结束后等待妙记生成');
  const summaryState = getSummaryStepState({ latestRecord: latest });
  setFlowStep(stepSummary, stepSummaryText, summaryState.status, summaryState.text);
}

function updateCurrentMeetingSteps(meeting) {
  if (!meeting) return;
  setFlowStep(stepMeeting, stepMeetingText, 'ok', meeting.meetingNo ? `会议号 ${meeting.meetingNo}` : '已创建');
  setFlowStep(stepJoin, stepJoinText, meeting.url || meeting.appLink ? 'info' : 'pending', meeting.url || meeting.appLink ? '请用客户端加入会议' : initialFlowState.join);
  setFlowStep(stepContent, stepContentText, 'info', '结束后等待妙记生成');
  const summaryState = getSummaryStepState({ latestRecord: meeting });
  setFlowStep(stepSummary, stepSummaryText, summaryState.status, summaryState.text);
}

function updateEventStep(events) {
  const recordingEvent = events.find((event) => event.type === 'vc.meeting.recording_ready_v1');
  if (!recordingEvent) return;
  const latestRecord = latestRecords.find((record) => record.meetingNo === recordingEvent.meetingNo) || latestRecords[0];
  setFlowStep(stepContent, stepContentText, 'ok', '会议已结束，正在处理产物');
  const summaryState = getSummaryStepState({ latestRecord, recordingEvent });
  setFlowStep(stepSummary, stepSummaryText, summaryState.status, summaryState.text);
}

function setFlowStep(element, textElement, status, text) {
  element.className = `flow-step ${status}`;
  textElement.textContent = text;
}

function resetFlowSteps() {
  setFlowStep(stepMeeting, stepMeetingText, 'pending', initialFlowState.meeting);
  setFlowStep(stepJoin, stepJoinText, 'pending', initialFlowState.join);
  setFlowStep(stepContent, stepContentText, 'pending', initialFlowState.content);
  setFlowStep(stepSummary, stepSummaryText, 'pending', initialFlowState.summary);
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
      isVerifiedRecordSummary(record) && recordBitableUrl(record) !== '#' ? `<a class="link-cell" href="${escapeAttribute(recordBitableUrl(record))}" target="_blank" rel="noreferrer">去数据表查看</a>` : '',
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
    LOCAL_SAVED: ['info', '待写入数据表']
  };
  const [cls, text] = map[status] || ['info', '待写入数据表'];
  return `<span class="pill ${cls}">${escapeHtml(text)}</span>`;
}

function recordBitableUrl(record = {}) {
  return record.bitableRecordUrl || latestConfig?.baseUrl || '#';
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
  const artifact = (record.artifacts || []).find((item) => ['智能纪要文档', '纪要文档', '飞书文档'].includes(item?.type) && item.docToken);
  if (artifact?.docToken) {
    const origin = latestConfig?.baseUrl ? new URL(latestConfig.baseUrl).origin : 'https://feishu.cn';
    return `${origin}/docx/${encodeURIComponent(artifact.docToken)}`;
  }
  return '';
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
