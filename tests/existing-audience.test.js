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
  const access = new Function('EClassFeatures', src + '\nreturn assertExistingQuestionAccess;')(F);
  assert.throws(() => access(existingDetail({ owner: false })),
    /não confirmou permissão de editar as questões/);
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
