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
  assert.match(ui.assessmentListStatus.textContent, /2 prova\(s\) criada\(s\) nos últimos 15 dias/);
  assert.equal(ui.loadAssessments.disabled, false);
});
