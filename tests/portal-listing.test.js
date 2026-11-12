'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const F = require('../features.js');

const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'panel-core.js'), 'utf8');
const panelEnhancements = fs.readFileSync(path.join(root, 'panel-enhancements.js'), 'utf8');

test('consulta de provas usa a rota /avaliacao e parâmetros reais do HAR', () => {
  const api = vm.runInNewContext(core + '\nAPI', { URLSearchParams });
  const c = {
    publisher: 1, entityId: 89, entityName: 'Escola de teste',
    entityType: 1, academicYear: 2026
  };
  const url = new URL(api.assessmentList(c, 2, 25));
  assert.equal(url.pathname, '/api/v1/avaliacao');
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.get('page_size'), '25');
  assert.equal(url.searchParams.get('ano'), '2026');
  assert.equal(url.searchParams.get('editora_id'), '1');
  assert.equal(url.searchParams.get('tipo_gerenciada_except'), '3');
  assert.equal(url.searchParams.get('orderBy'), '1');
  assert.deepEqual(JSON.parse(url.searchParams.get('entidade')), {
    id: 89, nome: 'Escola de teste', tipo: 1, externo: false
  });
});

test('fluxo real de listagem percorre páginas e usa created_at da aplicação', async () => {
  const ui = {
    assessmentDays: { value: '15' },
    loadAssessments: { disabled: false },
    assessmentListStatus: { textContent: '' },
    existingAssessmentId: { value: '' },
    existingAssessments: {
      value: '', options: [],
      replaceChildren(option) { this.options = [option]; },
      add(option) { this.options.push(option); }
    }
  };
  const recent = new Date(Date.now() - 3 * 86400000).toISOString();
  const old = new Date(Date.now() - 45 * 86400000).toISOString();
  const calls = [];
  const item = n => ({
    uuid: 'avaliacao-' + n,
    titulo: 'Prova ' + n,
    aplicacoes: [{ uuid: 'aplicacao-' + n, status: n === 3 ? 1 : 0, data_inicio: '2027-01-10T03:00:00Z' }]
  });
  const apiFetch = async url => {
    calls.push(url);
    if (url.includes('/api/v1/avaliacao?')) {
      const page = Number(new URL(url).searchParams.get('page'));
      return {
        ret: 1,
        data: { current_page: page, last_page: 2, total: 3,
          data: page === 1 ? [item(1), item(2)] : [item(3)] }
      };
    }
    const id = url.split('/').pop();
    return {
      ret: 1,
      data: {
        uuid: id,
        status: id === 'aplicacao-3' ? 1 : 0,
        tentativa_count: 0,
        created_at: id === 'aplicacao-2' ? old : recent,
        avaliacao: { uuid: 'avaliacao', questoes: [] }
      }
    };
  };

  const api = vm.runInNewContext(core + '\nAPI', { URLSearchParams });
  const deps = {
    EClassFeatures: F,
    state: { remote: {}, figureBindings: {} },
    $: id => ui[id],
    tokenForRequest: () => 'TEST-TOKEN-NOT-REAL',
    detectSession: async () => true,
    formConfig: () => ({ publisher: 1, entityId: 89, entityName: 'Escola de teste', entityType: 1, academicYear: 2026 }),
    portalHeaders: () => ({}),
    apiFetch,
    API: api,
    chrome: { storage: { local: { get: async () => ({ eciHistory: [] }) } } },
    log: () => {},
    Option: class Option {
      constructor(label, value) {
        this.text = label;
        this.value = value;
        this.disabled = false;
        this.selected = false;
      }
    }
  };
  const controller = new Function(...Object.keys(deps), panelEnhancements + '\nreturn {loadExistingAssessments};')
    (...Object.values(deps));
  await controller.loadExistingAssessments();
  assert.equal(calls.filter(url => url.includes('/api/v1/avaliacao?')).length, 2);
  assert.equal(calls.filter(url => url.includes('/api/v1/aplicacao-avaliacao/')).length, 3);
  assert.deepEqual(ui.existingAssessments.options.slice(1).map(o => o.value), [
    'aplicacao-1', 'aplicacao-3'
  ]);
  assert.equal(ui.existingAssessments.options[2].disabled, true, 'prova ativa deve ficar indisponível');
  assert.match(ui.assessmentListStatus.textContent, /2 aplicação\(ões\) listada\(s\)/);
  assert.match(ui.assessmentListStatus.textContent, /1 fora dos últimos 15 dias/);
  assert.equal(ui.loadAssessments.disabled, false);
});


test('listagem permanece visível quando todos os detalhes falham e a sessão não tem token', async () => {
  const ui = {
    assessmentDays: { value: '15' },
    loadAssessments: { disabled: false },
    assessmentListStatus: { textContent: '' },
    existingAssessmentId: { value: '' },
    existingAssessments: {
      value: '', options: [],
      replaceChildren(option) { this.options = [option]; },
      add(option) { this.options.push(option); }
    }
  };
  let detailCalls = 0, headerCalls = 0;
  const records = Array.from({ length: 7 }, (_, i) => ({
    uuid: 'exam-' + i, titulo: 'Prova ' + i,
    aplicacoes: [{ uuid: 'app-' + i, status: 0, data_inicio: '2026-12-01T00:00:00Z' }]
  }));
  const api = vm.runInNewContext(core + '\nAPI', { URLSearchParams });
  const controller = new Function(
    'EClassFeatures', 'state', '$', 'tokenForRequest', 'detectSession', 'formConfig',
    'portalHeaders', 'apiFetch', 'API', 'chrome', 'log', 'Option',
    panelEnhancements + '\nreturn {loadExistingAssessments};'
  )(
    F, { figureBindings: {}, remote: {} }, id => ui[id], () => null, async () => false,
    () => ({ publisher: 1, entityId: 89, entityName: 'Escola fictícia', entityType: 1, academicYear: 2026 }),
    (contentType, requireToken) => {
      assert.equal(requireToken, false, 'consultas GET devem aceitar ausência de Bearer');
      headerCalls++;
      return {};
    },
    async url => {
      if (url.includes('/api/v1/avaliacao?')) {
        return { ret: 1, data: { current_page: 1, last_page: 1, total: 7, data: records } };
      }
      detailCalls++;
      const err = new Error('Proibido'); err.status = 403; throw err;
    },
    api, { storage: { local: { get: async () => ({ eciHistory: [] }) } } },
    () => {}, class Option {
      constructor(text, value) { this.text = text; this.value = value; this.disabled = false; }
    }
  );
  await controller.loadExistingAssessments();
  assert.equal(ui.existingAssessments.options.length, 8, 'os sete exames devem continuar visíveis');
  assert.equal(detailCalls, 4, 'HTTP 403 interrompe novas páginas de detalhes');
  assert.equal(headerCalls, 5);
  assert.match(ui.assessmentListStatus.textContent, /detalhe\(s\) não acessível\(is\), mantidos na lista/);
  assert.match(ui.assessmentListStatus.textContent, /HTTP 403/);
  assert.equal(ui.loadAssessments.disabled, false);
});

test('falha da rota principal exibe HTTP em vez de esconder o erro atrás de lista vazia', async () => {
  const ui = {
    assessmentDays: { value: '15' }, loadAssessments: { disabled: false },
    assessmentListStatus: { textContent: '' }, existingAssessmentId: { value: '' },
    existingAssessments: {
      value: '', options: [],
      replaceChildren(option) { this.options = [option]; }, add(option) { this.options.push(option); }
    }
  };
  const api = vm.runInNewContext(core + '\nAPI', { URLSearchParams });
  const deps = {
    EClassFeatures: F, state: { figureBindings: {}, remote: {} }, $: id => ui[id],
    tokenForRequest: () => 'dummy', detectSession: async () => true,
    formConfig: () => ({ publisher: 1, entityId: 89, entityName: 'Escola fictícia', entityType: 1, academicYear: 2026 }),
    portalHeaders: () => ({}),
    apiFetch: async () => {
      const e = new Error('Internal server error'); e.status = 503; throw e;
    },
    API: api, chrome: { storage: { local: { get: async () => ({ eciHistory: [] }) } } },
    log: () => {}, Option: class Option {
      constructor(text, value) { this.text = text; this.value = value; this.disabled = false; }
    }
  };
  const controller = new Function(...Object.keys(deps), panelEnhancements + '\nreturn {loadExistingAssessments};')(...Object.values(deps));
  await controller.loadExistingAssessments();
  assert.equal(ui.existingAssessments.options.length, 1);
  assert.match(ui.assessmentListStatus.textContent, /ERRO NA LISTAGEM: HTTP 503/);
  assert.equal(ui.loadAssessments.disabled, false);
});

test('cabeçalhos de leitura sem Bearer são permitidos, escrita continua exigindo token', () => {
  const document = {
    getElementById: () => ({ value: '' }),
    querySelectorAll: () => []
  };
  const getApi = vm.runInNewContext(core + '\n({portalHeaders})', {
    document, enhancementsFormConfig: () => ({})
  });
  const read = getApi.portalHeaders(false, false);
  assert.equal(read.authorization, undefined);
  assert.equal(read['content-language'], 'pt-BR');
  assert.throws(() => getApi.portalHeaders(true), /Sessão não detectada/);
});
