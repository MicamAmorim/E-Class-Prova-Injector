'use strict';

const API_HOSTS = [
  'https://api-avaliacoes.educacaoadventista.org.br/*',
  'https://api-usuario.educacaoadventista.org.br/*',
  'https://ti5v892yac.execute-api.sa-east-1.amazonaws.com/*'
];

// Mantidos apenas em memória. Não salvamos token no chrome.storage.
let sessionToken = null;
let sessionContext = {};
let lastSeenAt = null;

const CONTEXT_HEADERS = {
  'x-portal-academic-year': 'academicYear',
  'x-portal-association': 'association',
  'x-portal-division': 'division',
  'x-portal-entity': 'entityId',
  'x-portal-profile-id': 'profileId',
  'x-portal-publisher': 'publisher',
  'x-portal-union': 'union'
};

function captureHeaders(details) {
  const headers = details.requestHeaders || [];
  let touched = false;
  for (const h of headers) {
    const name = String(h.name || '').toLowerCase();
    const value = h.value ?? '';
    if (name === 'authorization' && /^Bearer\s+/i.test(value)) {
      sessionToken = value.replace(/^Bearer\s+/i, '').trim();
      touched = true;
    }
    if (CONTEXT_HEADERS[name]) {
      const n = Number(value);
      sessionContext[CONTEXT_HEADERS[name]] = Number.isFinite(n) ? n : value;
      touched = true;
    }
  }
  if (touched) lastSeenAt = new Date().toISOString();
}

chrome.webRequest.onBeforeSendHeaders.addListener(
  captureHeaders,
  { urls: API_HOSTS },
  ['requestHeaders', 'extraHeaders']
);

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  }
});

async function responseObject(res) {
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    data,
    text,
    responseHeaders: Object.fromEntries([...res.headers.entries()])
  };
}

async function performFetch({ url, method = 'GET', headers = {}, body = null }) {
  const opts = { method, headers, cache: 'no-store' };
  if (body != null) opts.body = body;
  try {
    return await responseObject(await fetch(url, opts));
  } catch (e) {
    return { ok: false, networkError: true, status: 0, statusText: '', data: null, text: String(e?.message || e) };
  }
}

async function performUpload({ url, headers = {}, fileName = 'image.png', mime = 'application/octet-stream', bytes }) {
  try {
    const safeHeaders = { ...headers };
    delete safeHeaders['content-type'];
    delete safeHeaders['Content-Type'];
    const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    const form = new FormData();
    form.append('upload', new Blob([raw], { type: mime }), fileName);
    return await responseObject(await fetch(url, { method: 'POST', headers: safeHeaders, body: form, cache: 'no-store' }));
  } catch (e) {
    return { ok: false, networkError: true, status: 0, statusText: '', data: null, text: String(e?.message || e) };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'session:get') {
    sendResponse({ token: sessionToken, context: sessionContext, lastSeenAt });
    return;
  }

  if (msg.type === 'session:setToken') {
    sessionToken = msg.token || null;
    lastSeenAt = sessionToken ? new Date().toISOString() : lastSeenAt;
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === 'api:fetch') {
    performFetch(msg.request).then(sendResponse);
    return true;
  }

  if (msg.type === 'api:upload') {
    performUpload(msg.request).then(sendResponse);
    return true;
  }

  if (msg.type === 'history:save') {
    chrome.storage.local.get({ eciHistory: [] }).then(({ eciHistory }) => {
      const history = Array.isArray(eciHistory) ? eciHistory : [];
      history.unshift(msg.item);
      return chrome.storage.local.set({ eciHistory: history.slice(0, 20) });
    }).then(() => sendResponse({ ok: true })).catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
});
