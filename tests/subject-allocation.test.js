'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const F = require('../features.js');

const root = path.resolve(__dirname, '..');
const parseCode = fs.readFileSync(path.join(root, 'panel-parse.js'), 'utf8');
const enhancementsCode = fs.readFileSync(path.join(root, 'panel-enhancements.js'), 'utf8');

function fixture(options = {}) {
  const { usedMath = 0, usedInvestigation = 0 } = options;
  const math = Array.from({ length: usedMath }, (_, i) => ({
    uuid: 'old-m-' + i, criado_por: 123, padrao_disciplina_id: 140
  }));
  const investigation = Array.from({ length: usedInvestigation }, (_, i) => ({
    uuid: 'old-i-' + i, criado_por: 123, padrao_disciplina_id: 390
  }));
  return {
    aplicacao: {
      uuid: 'app-existing', is_owner: false, status: 0,
      publico_alvo: [{ turma_id: 10, entidade_id: 89 }, { turma_id: 11, entidade_id: 89 }],
      data_inicio: '2026-11-20T03:00:00.000Z',
      data_resultado: '2026-11-25 00:00:00',
      bimestre_id: 18315,
      bimestre_n: 4,
      coautores: [
        { user_id: 123, padrao_disciplina_id: 140,
          padrao_disciplina: { descricao: 'Matemática' }, qtd_questoes: 15,
          data_limite: '2099-11-19 23:59:00' },
        { user_id: 123, padrao_disciplina_id: 390,
          padrao_disciplina: { descricao: 'Investigação Matemática' }, qtd_questoes: 5,
          data_limite: '2099-11-19 23:59:00' }
      ]
    },
    avaliacao: {
      titulo: 'Prova da coordenação', uuid: 'exam-existing',
      avaliacao_disciplinas: [140, 390]
    },
    questoes: [...math, ...investigation]
  };
}
const questions = count => Array.from({ length: count }, (_, i) => ({
  number: i + 1,
  stem: 'Enunciado ' + (i+1),
  choices: ['A','B','C','D','E'],
  correct: i % 5
}));

test('atribui Q1–Q15 a Matemática e Q16–Q20 a Investigação Matemática', () => {
  const result = F.existingSubjectPlan(fixture(), 123, questions(20));
  assert.equal(result.valid, true);
  assert.equal(result.entries.length, 20);
  assert.deepEqual(result.assignments.map(x => x.subjectId), [140, 390]);
  assert.deepEqual(result.entries.slice(0,15).map(x => x.subjectId), Array(15).fill(140));
  assert.deepEqual(result.entries.slice(15).map(x => x.subjectId), Array(5).fill(390));
  assert.equal(result.mapping['15'], 140);
  assert.equal(result.mapping['16'], 390);
  assert.equal(result.mapping['20'], 390);
  assert.equal(result.assignments[0].subjectName, 'Matemática');
});

test('não cria 21ª questão ou ultrapassa cota restante se já houver questões do professor', () => {
  const tooMany = F.existingSubjectPlan(fixture(), 123, questions(21));
  assert.equal(tooMany.valid, false);
  assert.match(tooMany.reason, /cotas disponíveis/);
  const withPrevious = F.existingSubjectPlan(fixture({ usedMath: 3 }), 123, questions(17));
  assert.equal(withPrevious.valid, true);
  assert.deepEqual(withPrevious.entries.slice(0,12).map(x => x.subjectId), Array(12).fill(140));
  assert.deepEqual(withPrevious.entries.slice(12).map(x => x.subjectId), Array(5).fill(390));
  const exceed = F.existingSubjectPlan(fixture({ usedMath: 3 }), 123, questions(18));
  assert.equal(exceed.valid, false);
});

test('recusa coautoria vencida ou identificador de disciplina ausente', () => {
  const expired = fixture();
  expired.aplicacao.coautores.forEach(a => { a.data_limite = '2020-01-01 00:00:00'; });
  assert.equal(F.existingSubjectPlan(expired, 123, questions(2)).valid, false);
  assert.equal(F.existingSubjectPlan(fixture(), 321, questions(2)).valid, false);
  const unknown = fixture();
  unknown.aplicacao.coautores[0].padrao_disciplina_id = null;
  assert.equal(F.existingSubjectPlan(unknown, 123, questions(2)).valid, false);
});

test('prova do proprietário de uma disciplina usa a disciplina oficial, não o seletor local', () => {
  const exam = fixture();
  exam.aplicacao.is_owner = true;
  exam.aplicacao.coautores = [];
  exam.avaliacao.avaliacao_disciplinas = [140];
  const result = F.existingSubjectPlan(exam, 123, questions(3));
  assert.equal(result.valid, true);
  assert.deepEqual(result.entries.map(x => x.subjectId), [140,140,140]);
  exam.avaliacao.avaliacao_disciplinas = [140,390];
  assert.equal(F.existingSubjectPlan(exam, 123, questions(3)).valid, false);
});

test('bimestre e datas vêm da aplicação, sem recorrer a datas de criação', () => {
  const got = F.assessmentCalendar(fixture());
  assert.equal(got.startDate, '2026-11-20');
  assert.equal(got.resultDate, '2026-11-25');
  assert.equal(got.termId, 18315);
  assert.equal(got.termNumber, 4);
  const noInfo = F.assessmentCalendar({ aplicacao: { created_at: '2026-11-01' } });
  assert.equal(noInfo.startDate, '');
  assert.equal(noInfo.resultDate, '');
  assert.equal(noInfo.termId, null);
});

test('payload individual define disciplina conforme a ordem somente para prova EXISTENTE', () => {
  const questionPayload = new Function(parseCode + '\nreturn questionPayload;')();
  const config = {
    existingMode: true, subjectId: 140,
    questionSubjectIds: F.existingSubjectPlan(fixture(), 123, questions(20)).mapping,
    publishingId: 1, countryId: 1, levelId: 4,
    entityId: 89, entityName: 'Escola fictícia', entityType: 1
  };
  const q15 = questionPayload(config, questions(20)[14], '<p>A</p>', ['A','B','C','D','E']);
  const q16 = questionPayload(config, questions(20)[15], '<p>B</p>', ['A','B','C','D','E']);
  assert.equal(q15.dadosGerais.padrao_disciplina_id, 140);
  assert.equal(q16.dadosGerais.padrao_disciplina_id, 390);
  assert.throws(() => questionPayload({
    ...config, questionSubjectIds: {}
  }, questions(1)[0], 'X', ['A','B']), /disciplina não atribuída/);
});

test('REGRESSÃO: questionPayload de prova NOVA mantém disciplina, tipo e alternativas originais', () => {
  const questionPayload = new Function(parseCode + '\nreturn questionPayload;')();
  const q = questions(1)[0];
  const c = {
    existingMode: false, subjectId: 140,
    questionSubjectIds: { '1': 390 }, // ignorada para criação do zero
    publishingId: 1, countryId: 1, levelId: 4,
    entityId: 89, entityName: 'Escola fictícia', entityType: 1
  };
  const out = questionPayload(c, q, '<p>A</p>', ['texto A','texto B','texto C','texto D','texto E']);
  assert.equal(out.dadosGerais.padrao_disciplina_id, 140);
  assert.equal(out.dadosGerais.tipo, 0);
  assert.equal(out.dadosGerais.enunciado, '<p>A</p>');
  assert.equal(out.alternativas.length, 5);
  assert.deepEqual(out.alternativas.map(x => x.alternativa_correta), [1,0,0,0,0]);
  assert.deepEqual(out.entidade, { id: 89, nome: 'Escola fictícia', tipo: 1, externo: false });
});

test('REGRESSÃO: assessmentPayload da prova NOVA preserva campos de turmas, disciplina, datas e bimestre', () => {
  const makeAssessment = new Function('composeAudience','decodeJwt','tokenForRequest',
    parseCode + '\nreturn assessmentPayload;')(
    c => c.classes.map(id => ({ turma_id:id, entidade_id:c.entityId })),
    () => ({ sub: '55' }),
    () => 'fake-token'
  );
  const c = {
    classes: [10,11], entityId: 89, entityName: 'Escola fictícia', entityType: 1,
    startDate: '2026-11-20', resultDate: '2026-11-25',
    title: 'Teste novo', publisher: 1, subjectId: 140,
    countryId: 1, termId: 18315
  };
  const result = makeAssessment(c, [{ uuid:'a' }, { uuid:'b' }]);
  assert.equal(result.aplicacao.data_inicio, '2026-11-20 00:00:00');
  assert.equal(result.aplicacao.data_resultado, '2026-11-25 00:00:00');
  assert.equal(result.aplicacao.bimestre_id, 18315);
  assert.deepEqual(result.aplicacao.publico_alvo, [
    { turma_id: 10, entidade_id: 89 }, { turma_id:11, entidade_id:89 }
  ]);
  assert.deepEqual(result.avaliacao.avaliacao_disciplinas, [140]);
  assert.equal(result.avaliacao.titulo, 'Teste novo');
  assert.deepEqual(result.questoes.map(q=>q.peso), [50,50]);
});

test('reenvio pendente não tenta mesclar 20 questões de Matemática numa cota de 15', () => {
  const d = fixture();
  const wrong = Array.from({length:20},(_,i)=>({uuid:'new-'+i,padrao_disciplina_id:140}));
  const check = F.verifyPendingCoauthorSubjects(d,123,wrong);
  assert.equal(check.valid,false);
  assert.match(check.reason,/limite é 15/);
  const correct = Array.from({length:20},(_,i)=>({
    uuid:'new-'+i,padrao_disciplina_id:i<15?140:390
  }));
  assert.equal(F.verifyPendingCoauthorSubjects(d,123,correct).valid,true);
  assert.equal(F.verifyPendingCoauthorSubjects(d,123,[{uuid:'q',code:'q'}]).valid,false);
});

test('GUI de prova existente apresenta distribuição por disciplina e trava bimestre/datas', () => {
  const plan = F.existingSubjectPlan(fixture(), 123, questions(20));
  const detail = fixture();
  const elements = {
    useExistingAssessment: { checked:true },
    existingAssessmentId: { value:'app-existing' },
    existingAssessments: { value:'' },
    existingSubjectPanel: { classList: { toggle(){} } },
    subjectSelectLabel: { classList: { toggle(){} } },
    subject: { value:'140',disabled:false },
    term: {value:'',disabled:false, options:[{value:'18315',textContent:'4º bimestre'}],add(o){this.options.push(o)}, selectedOptions:[{textContent:'4º bimestre'}]},
    startDate: {value:'2027-01-01',disabled:false},
    resultDate: {value:'2027-01-04',disabled:false},
    existingSubjectList: {children:[],replaceChildren(){this.children=[]},appendChild(x){this.children.push(x)}},
    existingSubjectStatus:{textContent:''}, existingCalendarStatus:{textContent:''}
  };
  const state = {
    existingTarget: { id:'app-existing',detail, calendar:F.assessmentCalendar(detail) },
    currentPortalUserId:123, parsed:questions(20), existingSubjectPlan:null,
    remote: {},figureBindings:{}
  };
  const d = {createElement:()=>({textContent:''})};
  const onlyDestination = enhancementsCode.slice(
    enhancementsCode.indexOf('function renderExistingDestination()'),
    enhancementsCode.indexOf('function renderExistingAudience()')
  );
  const render = new Function('state','$','document','EClassFeatures','targetAssessmentId','Option',
    onlyDestination + '\nreturn renderExistingDestination;')(
    state, id => elements[id], d, F, () => elements.existingAssessmentId.value,
    class { constructor(text, value) { this.textContent = text; this.value = value; } }
  );
  render();
  assert.equal(elements.subject.disabled, true);
  assert.equal(elements.term.disabled, true);
  assert.equal(elements.startDate.disabled, true);
  assert.equal(elements.resultDate.disabled, true);
  assert.equal(elements.startDate.value, '2026-11-20');
  assert.equal(elements.resultDate.value, '2026-11-25');
  assert.equal(elements.term.value, '18315');
  assert.equal(elements.existingSubjectList.children.length, 2);
  assert.match(elements.existingSubjectList.children[0].textContent, /Q1–Q15/);
  assert.match(elements.existingSubjectList.children[1].textContent, /Q16–Q20/);
  assert.deepEqual(state.existingSubjectPlan.mapping, plan.mapping);
});
