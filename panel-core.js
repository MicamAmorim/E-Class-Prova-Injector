'use strict';

const API = {
  question: 'https://api-avaliacoes.educacaoadventista.org.br/api/v1/questao',
  assessment: 'https://api-avaliacoes.educacaoadventista.org.br/api/v1/aplicacao-avaliacao',
  mathUpload: 'https://ti5v892yac.execute-api.sa-east-1.amazonaws.com/develop/upload',
  terms: entityId => `https://api-usuario.educacaoadventista.org.br/api/v2/bimestres?entity_id=${encodeURIComponent(entityId)}`,
  classes: entityId => `https://api-usuario.educacaoadventista.org.br/api/v2/school-groups?strict_user=true&entity_id=${encodeURIComponent(entityId)}`,
  subjects: entity => `https://api-usuario.educacaoadventista.org.br/api/v1/hub-educacional/padrao/1/disciplinas?entity=${encodeURIComponent(JSON.stringify(entity))}&strict_user=true`
};

const DEFAULTS = {
  academicYear: 2026,
  association: 6,
  division: 1,
  entityId: 89,
  profileId: 155722,
  publisher: 1,
  union: 4,
  entityName: 'Colégio Adventista de Itabuna',
  entityType: 1,
  subjectId: 140,
  levelId: 4,
  countryId: 1,
  publishingId: 1,
  termId: 18315,
  classes: [247646]
};

const KNOWN_CLASSES = [
  { id: 247646, name: '1MA' },
  { id: 245735, name: '1MB' },
  { id: 242576, name: '2MA' },
  { id: 250051, name: '2MB' },
  { id: 243501, name: '3MA' },
  { id: 244682, name: '3MB' }
];
const KNOWN_SUBJECTS = [
  { id: 140, name: 'Matemática' },
  { id: 390, name: 'Investigação Matemática' },
  { id: 60, name: 'Filosofia' }
];
const KNOWN_TERMS = [{ id: 18315, name: '4º Bimestre' }];

const state = {
  token: null,
  parsed: [],
  macroMap: new Map(),
  latex: '',
  fileName: null,
  mathCache: new Map(),
  createdQuestions: [],
  lastAssessmentPayload: null,
  lastRun: null,
  remote: { classes: null, terms: null, subjects: null }
};

const $ = id => document.getElementById(id);

function nowDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

function log(msg, kind = 'info') {
  const line = `[${new Date().toLocaleTimeString()}] ${kind === 'error' ? 'ERRO: ' : kind === 'warn' ? 'AVISO: ' : ''}${msg}`;
  $('log').textContent += line + '\n';
  $('log').scrollTop = $('log').scrollHeight;
}

function setSessionStatus(text, kind = 'neutral') {
  const el = $('sessionStatus');
  el.textContent = text;
  el.className = `status ${kind}`;
}

function decodeJwt(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(Array.from(atob(payload)).map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
    return JSON.parse(json);
  } catch (_) { return null; }
}

function normalizeToken(raw) {
  return raw ? raw.trim().replace(/^Bearer\s+/i, '') : null;
}

async function runtimeMessage(msg) {
  return chrome.runtime.sendMessage(msg);
}

async function apiFetch(url, { method = 'GET', headers = {}, body = null } = {}) {
  const res = await runtimeMessage({ type: 'api:fetch', request: { url, method, headers, body } });
  if (!res?.ok) {
    const details = res?.networkError ? res?.text : (typeof res?.data === 'string' ? res.data : JSON.stringify(res?.data));
    const err = new Error(`${res?.status || 0} ${res?.statusText || 'Network Error'} em ${url}${details ? `\n${details}` : ''}`);
    err.status = res?.status || 0;
    err.data = res?.data;
    err.responseHeaders = res?.responseHeaders;
    throw err;
  }
  return res.data;
}

function formConfig() {
  const selectedClasses = [...document.querySelectorAll('.classCheck:checked')].map(x => Number(x.value));
  return {
    academicYear: Number($('academicYear').value),
    association: Number($('association').value),
    division: Number($('division').value),
    entityId: Number($('entityId').value),
    profileId: Number($('profileId').value),
    publisher: Number($('publisher').value),
    union: Number($('union').value),
    entityName: $('entityName').value.trim(),
    entityType: DEFAULTS.entityType,
    subjectId: Number($('subject').value),
    levelId: Number($('levelId').value),
    countryId: Number($('countryId').value),
    publishingId: DEFAULTS.publishingId,
    termId: Number($('term').value),
    classes: selectedClasses,
    title: $('title').value.trim(),
    section: $('sectionName').value.trim(),
    startDate: $('startDate').value,
    resultDate: $('resultDate').value,
    dryRun: $('dryRun').checked,
    onlyQuestions: $('onlyQuestions').checked
  };
}

function tokenForRequest() {
  const manual = normalizeToken($('manualToken').value);
  return manual || state.token;
}

function portalHeaders(contentType = true) {
  const c = formConfig();
  const token = tokenForRequest();
  if (!token) throw new Error('Sessão não detectada. Abra o E-Class, clique “Detectar sessão” ou informe o token manualmente.');
  const h = {
    accept: 'application/json, text/plain, */*',
    authorization: `Bearer ${token}`,
    'content-language': 'pt-BR',
    'x-portal-academic-year': String(c.academicYear),
    'x-portal-association': String(c.association),
    'x-portal-division': String(c.division),
    'x-portal-entity': String(c.entityId),
    'x-portal-profile-id': String(c.profileId),
    'x-portal-publisher': String(c.publisher),
    'x-portal-union': String(c.union)
  };
  if (contentType) h['content-type'] = 'application/json';
  return h;
}

async function scanActivePortalStorage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !String(tab.url || '').startsWith('https://portal.educacaoadventista.org.br/')) return null;
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: () => {
      const jwtRe = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
      const deepFind = (value, seen = new Set()) => {
        if (value == null) return null;
        if (typeof value === 'string') {
          const direct = value.match(jwtRe);
          if (direct) return direct[0];
          try {
            if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))) return deepFind(JSON.parse(value), seen);
          } catch (_) {}
          return null;
        }
        if (typeof value !== 'object' || seen.has(value)) return null;
        seen.add(value);
        for (const v of Object.values(value)) {
          const x = deepFind(v, seen);
          if (x) return x;
        }
        return null;
      };
      for (const store of [localStorage, sessionStorage]) {
        for (let i = 0; i < store.length; i++) {
          const x = deepFind(store.getItem(store.key(i)));
          if (x) return { token: x, source: 'storage', href: location.href };
        }
      }
      const c = deepFind(document.cookie);
      return c ? { token: c, source: 'cookie', href: location.href } : { token: null, source: null, href: location.href };
    }
  });
  return result;
}

async function detectSession() {
  try {
    setSessionStatus('Procurando...', 'neutral');
    let info = await runtimeMessage({ type: 'session:get' });
    if (info?.token) {
      state.token = info.token;
      applyCapturedContext(info.context || {});
      const p = decodeJwt(state.token);
      const exp = p?.exp ? new Date(p.exp * 1000).toLocaleString() : '?';
      setSessionStatus(`Conectada · expira ${exp}`, 'ok');
      log('Sessão capturada das requisições normais do E-Class.', 'ok');
      return true;
    }

    const storage = await scanActivePortalStorage();
    if (storage?.token) {
      state.token = storage.token;
      await runtimeMessage({ type: 'session:setToken', token: state.token });
      const p = decodeJwt(state.token);
      const exp = p?.exp ? new Date(p.exp * 1000).toLocaleString() : '?';
      setSessionStatus(`Conectada · expira ${exp}`, 'ok');
      log('Sessão detectada no armazenamento da aba do Portal.', 'ok');
      return true;
    }

    setSessionStatus('Não detectada', 'warn');
    log('Não encontrei o token automaticamente. Recarregue o E-Class e tente novamente; se necessário use o campo manual.', 'warn');
    return false;
  } catch (e) {
    setSessionStatus('Erro ao detectar', 'error');
    log(e.message || String(e), 'error');
    return false;
  }
}

function applyCapturedContext(ctx) {
  const map = { academicYear:'academicYear', association:'association', division:'division', entityId:'entityId', profileId:'profileId', publisher:'publisher', union:'union' };
  for (const [k, id] of Object.entries(map)) {
    if (ctx[k] != null && $(id)) $(id).value = ctx[k];
  }
}

function populateDefaults() {
  $('academicYear').value = DEFAULTS.academicYear;
  $('association').value = DEFAULTS.association;
  $('division').value = DEFAULTS.division;
  $('entityId').value = DEFAULTS.entityId;
  $('profileId').value = DEFAULTS.profileId;
  $('publisher').value = DEFAULTS.publisher;
  $('union').value = DEFAULTS.union;
  $('entityName').value = DEFAULTS.entityName;
  $('levelId').value = DEFAULTS.levelId;
  $('countryId').value = DEFAULTS.countryId;
  $('startDate').value = nowDate(12);
  $('resultDate').value = nowDate(16);
  rebuildSelectors();
}

function rebuildSelectors() {
  const currentClasses = new Set([...document.querySelectorAll('.classCheck:checked')].map(x => Number(x.value)));
  const classes = state.remote.classes?.length
    ? state.remote.classes.map(x => ({ id: x.id, name: x.description || String(x.id) }))
    : KNOWN_CLASSES;
  $('classes').innerHTML = classes.map(x => `<label><input class="classCheck" type="checkbox" value="${x.id}" ${(currentClasses.has(x.id) || (!currentClasses.size && DEFAULTS.classes.includes(x.id))) ? 'checked' : ''}> ${escapeHtml(x.name)}</label>`).join('');

  const oldSubject = Number($('subject').value || DEFAULTS.subjectId);
  const subjects = state.remote.subjects?.length
    ? state.remote.subjects.map(x => ({ id: x.id, name: x.descricao || x.description || String(x.id) }))
    : KNOWN_SUBJECTS;
  $('subject').innerHTML = subjects.map(x => `<option value="${x.id}" ${x.id === oldSubject ? 'selected' : ''}>${escapeHtml(x.name)} (${x.id})</option>`).join('');

  const oldTerm = Number($('term').value || DEFAULTS.termId);
  const terms = state.remote.terms?.length
    ? state.remote.terms.map(x => ({ id: x.id, name: x.descricao || String(x.id) }))
    : KNOWN_TERMS;
  $('term').innerHTML = terms.map(x => `<option value="${x.id}" ${x.id === oldTerm ? 'selected' : ''}>${escapeHtml(x.name)} (${x.id})</option>`).join('');
}
