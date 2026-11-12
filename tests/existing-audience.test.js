'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const F = require('../features.js');

const audienceFixture = () => [
  {
    turma_id: 10, entidade_id: 89, user_id: null, liberar_tipo: 1,
    liberar_data_inicio: null, total_publico_alvo: 28,
    turma: { id: 10, descricao: '1MA', cod_turma: 'EMERE01MA' }
  },
  {
    turma_id: 11, entidade_id: 89, user_id: null, liberar_tipo: 1,
    liberar_data_inicio: null, total_publico_alvo: 26,
    turma: { id: 11, descricao: '1MB' }
  }
];

function existingDetail({ owner = false, status = 0, rights = {} } = {}) {
  return {
    aplicacao: {
      uuid: 'app-1', status, is_owner: owner, tentativa_count: 0,
      publico_alvo: audienceFixture(),
      ...rights
    },
    avaliacao: { uuid: 'assessment-1', titulo: 'Prova definida pela coordenação' },
    questoes: []
  };
}

test('identifica duas turmas vinculadas na resposta de aplicação do HAR anonimizada', () => {
  const detail = existingDetail();
  const audience = F.assessmentAudience(detail);
  assert.equal(audience.verified, true);
  assert.deepEqual(audience.classIds, [10, 11]);
  assert.deepEqual(audience.classes.map(x => x.name), ['1MA', '1MB']);
  assert.equal(audience.classes[0].count, 28);
  assert.equal(audience.hasIndividuals, false);
  assert.deepEqual(audience.entries, detail.aplicacao.publico_alvo);
  assert.equal(F.assessmentPermissions(detail).isOwner, false);
  assert.equal(F.assessmentPermissions(detail).canChangeClasses, false);
});

test('is_owner=true isoladamente não concede permissão de alterar turmas', () => {
  const detail = existingDetail({ owner: true });
  const permissions = F.assessmentPermissions(detail);
  assert.equal(permissions.isOwner, true);
  assert.equal(permissions.canChangeClasses, false);
});

test('somente autorização positiva explícita da API marca permissão de público-alvo', () => {
  const detail = existingDetail({
    rights: { can_edit_publico_alvo: true, can_edit_questoes: true }
  });
  const permissions = F.assessmentPermissions(detail);
  assert.equal(permissions.canChangeClasses, true);
  assert.equal(permissions.canEditQuestions, true);
  detail.aplicacao.status = 1;
  const disabled = F.assessmentPermissions(detail);
  assert.equal(disabled.canChangeClasses, false);
  assert.equal(disabled.canEditQuestions, false);
});

test('não inventa público-alvo caso lista esteja ausente', () => {
  assert.equal(F.assessmentAudience({ aplicacao: { uuid: 'a' } }).verified, false);
  assert.deepEqual(F.assessmentAudience({ aplicacao: { publico_alvo: null } }).classIds, []);
});

test('mesclagem nunca troca, filtra ou reconstitui turmas do publico_alvo', () => {
  const detail = existingDetail({ owner: true });
  const before = JSON.stringify(detail.aplicacao.publico_alvo);
  const merged = F.mergeAssessment(detail, [{ uuid: 'new-question' }], n => Array(n).fill(100 / n));
  assert.equal(JSON.stringify(merged.aplicacao.publico_alvo), before);
  assert.equal(JSON.stringify(detail.aplicacao.publico_alvo), before);
  assert.deepEqual(merged.questoes.map(q => q.uuid), ['new-question']);
  assert.throws(() => F.assertUnchangedAudience(detail, {
    ...merged,
    aplicacao: { ...merged.aplicacao, publico_alvo: [merged.aplicacao.publico_alvo[0]] }
  }), /alterar o público-alvo/);
});

test('preflight bloqueia aplicação não pertencente à sessão antes de criar questões', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../panel-run.js'), 'utf8');
  const access = new Function('EClassFeatures', 'state', src + '\nreturn assertExistingQuestionAccess;')(F, { currentPortalUserId: 123 });
  assert.throws(() => access(existingDetail({ owner: false })),
    /não foi identificada como proprietária nem como coautora/);
  assert.throws(() => access(existingDetail({ owner: true, status: 1 })),
    /ativa, encerrada/);
  const positive = access(existingDetail({ owner: true }));
  assert.deepEqual(positive.audience.classIds, [10, 11]);
  const coauthor = access(existingDetail({ owner: false, rights: { can_edit_questoes: true } }));
  assert.equal(coauthor.rights.canEditQuestions, true);
  assert.throws(() => access({
    aplicacao: { uuid: 'app-1', status: 0, is_owner: true },
    avaliacao: {}, questoes: []
  }), /turmas oficiais/);
});


test('coautor autenticado pode contribuir mesmo quando is_owner é false', () => {
  const d = existingDetail({ owner: false });
  d.aplicacao.coautores = [
    { user_id: 123, padrao_disciplina_id: 140, qtd_questoes: 15,
      data_limite: '2099-11-19 23:59:00',
      padrao_disciplina: { descricao: 'Matemática' } },
    { user_id: 123, padrao_disciplina_id: 390, qtd_questoes: 5,
      data_limite: '2099-11-19 23:59:00',
      padrao_disciplina: { descricao: 'Investigação Matemática' } }
  ];
  const grant = F.coauthorGrant(d, 123);
  assert.equal(grant.matched, true);
  assert.equal(grant.valid, true);
  assert.equal(grant.totalLimit, 20);
  assert.equal(grant.remaining, 20);
  assert.equal(grant.assignments.length, 2);
  assert.equal(F.assessmentPermissions(d, 123).canEditQuestions, true);
  assert.equal(F.assessmentPermissions(d, 123).isCoauthor, true);
  assert.equal(F.assessmentPermissions(d, 123).canChangeClasses, false);
  assert.equal(F.assessmentPermissions(d, 333).canEditQuestions, false);
  const access = new Function('EClassFeatures', 'state',
    fs.readFileSync(path.resolve(__dirname, '../panel-run.js'), 'utf8') +
    '\nreturn assertExistingQuestionAccess;')(F, { currentPortalUserId: 123 });
  assert.deepEqual(access(d, { questionCount: 15, subjectId: 140 }).audience.classIds, [10, 11]);
  assert.throws(() => access(d, { questionCount: 20, subjectId: 140 }), /Limite da disciplina excedido/);
  assert.doesNotThrow(() => access(d, { questionCount: 20, recovery: true }));
});

test('coautoria expirada não habilita edição', () => {
  const d = existingDetail();
  d.aplicacao.coautores = [
    { user_id: 123, qtd_questoes: 20, data_limite: '2020-01-01 00:00:00' }
  ];
  assert.equal(F.assessmentPermissions(d, 123).isCoauthor, false);
  assert.equal(F.coauthorGrant(d, 123).expired, true);
});

test('PUT usa contrato de seis campos do editor oficial e mantém mesmas turmas', () => {
  const d = existingDetail({ owner: true });
  d.avaliacao.avaliacao_disciplinas = [
    { padrao_disciplina_id: 140 }, { padrao_disciplina_id: 390 }
  ];
  const questions = [{ uuid: 'nova-a', padrao_disciplina_id: 140 },
    { uuid: 'nova-b', padrao_disciplina_id: 390 }];
  const config = { entityId: 89, entityName: 'Escola fictícia', entityType: 1 };
  const payload = F.portalUpdatePayload(d, questions, config, n => Array(n).fill(100/n));
  assert.deepEqual(Object.keys(payload), [
    'aplicacao', 'avaliacao', 'questoes', 'entidade', 'questoesIncluidas', 'questoesRemovidas'
  ]);
  assert.deepEqual(payload.aplicacao.publico_alvo, [
    { turma_id: 10, user_id: null, padrao_serie_id: null, entidade_id: 89 },
    { turma_id: 11, user_id: null, padrao_serie_id: null, entidade_id: 89 }
  ]);
  assert.deepEqual(payload.avaliacao.avaliacao_disciplinas, [140, 390]);
  assert.equal('questoes' in payload.avaliacao, false);
  assert.deepEqual(payload.questoesIncluidas.map(q => q.uuid), ['nova-a','nova-b']);
  assert.deepEqual(payload.questoesRemovidas, []);
  assert.equal(d.aplicacao.publico_alvo.length, 2);
});

test('painel possui bloco de turmas oficiais e seleção bloqueada no modo existente', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'panel.html'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'panel-enhancements.js'), 'utf8');
  const init = fs.readFileSync(path.join(root, 'panel-init.js'), 'utf8');
  assert.match(html, /id="existingAudiencePanel"/);
  assert.match(html, /id="existingAudienceStatus"/);
  assert.match(html, /id="classesLockStatus"/);
  assert.match(source, /box\.disabled = true/);
  assert.match(source, /loadExistingAudience/);
  assert.match(source, /EClassFeatures\.assessmentAudience/);
  assert.match(init, /enhancementsBind/);
});


test('carregamento de uma aplicação desativa seleção de turmas e bloqueia adicionar para não proprietário', async () => {
  const checkboxes = [
    { value: '10', checked: false, disabled: false },
    { value: '11', checked: false, disabled: false },
    { value: '12', checked: true, disabled: false }
  ];
  const audienceItems = {
    children: [],
    replaceChildren() { this.children = []; },
    appendChild(x) { this.children.push(x); }
  };
  const ui = {
    useExistingAssessment: { checked: true },
    existingAssessmentId: { value: 'app-1' },
    existingAssessments: { value: '' },
    existingAudienceList: audienceItems,
    existingAudienceStatus: { textContent: '' },
    classesLockStatus: { textContent: '' },
    inject: { disabled: false }
  };
  const state = { remote: {}, figureBindings: {}, existingTarget: null, existingLookupSeq: 0 };
  const document = {
    querySelectorAll: selector => selector === '.classCheck' ? checkboxes : [],
    createElement: () => ({ textContent: '' })
  };
  const source = fs.readFileSync(path.resolve(__dirname, '../panel-enhancements.js'), 'utf8');
  const module = new Function(
    'state', '$', 'document', 'EClassFeatures', 'API',
    'apiFetch', 'portalHeaders', 'log',
    source + '\nreturn {loadExistingAudience, renderExistingAudience};'
  )(
    state, id => ui[id], document, F,
    { assessment: 'https://example.org/api/v1/aplicacao-avaliacao' },
    async url => {
      assert.match(url, /\/app-1$/);
      const d = existingDetail();
      return { data: {
        ...d.aplicacao, avaliacao: { ...d.avaliacao, questoes: d.questoes }
      }};
    },
    () => ({}), () => {}
  );
  await module.loadExistingAudience();
  assert.deepEqual(checkboxes.map(x => x.checked), [true,true,false]);
  assert.ok(checkboxes.every(x => x.disabled));
  assert.equal(ui.inject.disabled, true);
  assert.equal(audienceItems.children.length, 2);
  assert.match(ui.existingAudienceStatus.textContent, /não confirma permissão/);
  assert.equal(state.existingTarget.id, 'app-1');
});


test('GET de identificação da conta habilita o botão para coautor, sem destravar turmas', async () => {
  const checkboxes = [
    { value: '10', checked: false, disabled: false },
    { value: '11', checked: false, disabled: false }
  ];
  const ui = {
    useExistingAssessment: { checked: true },
    existingAssessmentId: { value: 'app-1' },
    existingAssessments: { value: '' },
    existingAudienceList: { children: [], replaceChildren(){this.children=[];},appendChild(x){this.children.push(x);} },
    existingAudienceStatus: { textContent: '' },
    classesLockStatus: { textContent: '' },
    inject: { disabled: true }
  };
  const document = {
    querySelectorAll: () => checkboxes,
    createElement: () => ({ textContent: '' })
  };
  const detail = existingDetail();
  detail.aplicacao.coautores = [
    { user_id: 123, padrao_disciplina_id: 140, qtd_questoes: 15,
      data_limite: '2099-11-19 23:59:00',
      padrao_disciplina: { descricao: 'Matemática' } },
    { user_id: 123, padrao_disciplina_id: 390, qtd_questoes: 5,
      data_limite: '2099-11-19 23:59:00',
      padrao_disciplina: { descricao: 'Investigação Matemática' } }
  ];
  const state = { existingLookupSeq: 0, existingTarget: null, remote: {} };
  const source = fs.readFileSync(path.resolve(__dirname, '../panel-enhancements.js'), 'utf8');
  const controller = new Function('state','$','document','EClassFeatures',
    'API','apiFetch','portalHeaders','log',
    source + '\nreturn {loadExistingAudience};'
  )(state, id => ui[id], document, F,
    { assessment: 'https://example.org/api/v1/aplicacao-avaliacao',
      currentUser: 'https://example.org/api/v1/dados-usuario' },
    async url => url.endsWith('dados-usuario') ?
      { usuario_id: 123 } :
      { data: { ...detail.aplicacao, avaliacao: { ...detail.avaliacao, questoes: detail.questoes } } },
    () => ({}), () => {});
  await controller.loadExistingAudience();
  assert.equal(ui.inject.disabled, false, 'coautor autenticado deve poder clicar');
  assert.ok(checkboxes.every(x => x.checked && x.disabled));
  assert.equal(state.currentPortalUserId, 123);
  assert.match(ui.existingAudienceStatus.textContent, /Coautoria reconhecida/);
  assert.match(ui.existingAudienceStatus.textContent, /Matemática/);
  assert.match(ui.existingAudienceStatus.textContent, /Investigação Matemática/);
});

test('inspeção de pendência é somente leitura e não exige recriar questões', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../panel-run.js'), 'utf8');
  const start = source.indexOf('async function inspectPendingAssessment()');
  const end = source.indexOf('async function retryAssessment()', start);
  assert.ok(start > 0 && end > start);
  const pending = [
    { uuid: 'q-1', padrao_disciplina_id: 140 },
    { uuid: 'q-2', padrao_disciplina_id: 140 }
  ];
  const status = { textContent: '' };
  const state = {
    pendingOperation: { type: 'update', id: 'app-1' },
    createdQuestions: pending
  };
  let getCount = 0;
  const inspector = new Function('state', 'fetchExistingAssessment', 'expectedQuestionIds',
    'EClassFeatures', '$', 'log',
    source.slice(start, end) + '\nreturn inspectPendingAssessment;')(
    state,
    async id => {
      assert.equal(id, 'app-1');
      getCount++;
      return { questoes: [{ uuid: 'q-1' }] };
    },
    () => pending.map(q => q.uuid),
    F, id => {
      assert.equal(id, 'pendingInspectionStatus');
      return status;
    }, () => {});
  const result = await inspector();
  assert.equal(result.linked, 1);
  assert.equal(result.missing, 1);
  assert.match(status.textContent, /NÃO use/);
  assert.equal(getCount, 1);
});
