'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const OMR = require('../omr-export.js');

function questions() {
  return [
    { number: 1, stem: 'Primeira', choices: ['A','B','C','D','E'], correct: 2 },
    { number: 2, stem: 'Segunda', choices: ['A','B','C','D','E'], correct: 0 },
    { number: 3, stem: 'Terceira', choices: ['A','B','C','D','E'], correct: 4 }
  ];
}

test('o Corretor recebe o schema original da branch word, com gabarito A-E', () => {
  const pkg = OMR.buildPackage({
    title: 'Prova de Matemática', subject: 'Matemática',
    externalId: 'eclass-injector:stable-id',
    exportedAt: '2026-11-12T20:00:00.000Z',
    questions: questions(), classIds: []
  });
  assert.equal(pkg.schema, 'eclass-omr-exam/1');
  assert.equal(pkg.version, 1);
  assert.equal(pkg.source, 'E-Class Prova Injector');
  assert.equal(pkg.externalId, 'eclass-injector:stable-id');
  assert.equal(pkg.exam.mode, 'general');
  assert.equal(pkg.exam.title, 'Prova de Matemática');
  assert.deepEqual(pkg.exam.omr.alternatives, ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(pkg.exam.omr.answerKey, ['C', 'A', 'E']);
  assert.deepEqual(pkg.exam.omr.objectiveQuestionNumbers, [1, 2, 3]);
  assert.deepEqual(pkg.exam.questions, [
    { number: 1, type: 'objective', answer: 'C' },
    { number: 2, type: 'objective', answer: 'A' },
    { number: 3, type: 'objective', answer: 'E' }
  ]);
});

test('preserva numeração original e exclui abertas da leitura automática', () => {
  const pkg = OMR.buildPackage({
    title: 'Prova mista',
    questions: [
      { number: 1, type: 'objective', choices: ['A','B'], correct: 1 },
      { number: 2, type: 'open', response: { format: 'blank', lines: 8 } },
      { number: 4, choices: ['A','B','C'], correct: 2 }
    ]
  });
  assert.deepEqual(pkg.exam.omr.answerKey, ['B','C']);
  assert.deepEqual(pkg.exam.omr.objectiveQuestionNumbers, [1,4]);
  assert.deepEqual(pkg.exam.questions[1], {
    number: 2, type: 'open', response: { format: 'blank', lines: 8 }
  });
});

test('inclui alunos das turmas selecionadas e remove duplicatas de matrícula', () => {
  const pkg = OMR.buildPackage({
    title: 'Teste', questions: questions(), classIds: [10],
    classes: [{ id: 10, description: 'EMERE01MA' }, { id: 20, description: 'Outra' }],
    students: [
      { classId: 10, id: 33, name: 'Aluno de teste' },
      { classId: 10, id: 33, name: 'Aluno de teste' },
      { classId: 20, id: 44, name: 'Outro aluno' }
    ]
  });
  assert.equal(pkg.exam.mode, 'student');
  assert.equal(pkg.exam.classes.length, 1);
  assert.equal(pkg.exam.classes[0].name, '1MA');
  assert.deepEqual(pkg.exam.classes[0].students,
    [{ externalId: 'eclass-student:33', name: 'Aluno de teste' }]);
});

test('exportação para alunos específicos nunca inclui alunos não selecionados', () => {
  const pkg = OMR.buildPackage({
    questions: questions(), classIds: [10],
    classes: [{ id: 10, description: '1MA' }],
    students: [
      { classId: 10, id: '12', name: 'Selecionado' },
      { classId: 10, id: '14', name: 'Não selecionado' }
    ],
    selectedStudents: [{ classId: 10, id: '12' }],
    specificStudents: true
  });
  assert.deepEqual(pkg.exam.classes[0].students,
    [{ externalId: 'eclass-student:12', name: 'Selecionado' }]);
});

test('não perde alunos escolhidos manualmente quando o portal não fornece lista', () => {
  const pkg = OMR.buildPackage({
    questions: questions(), classIds: [10],
    classes: [{ id: 10, description: '1MA' }],
    students: [],
    selectedStudents: [{ classId: 10, id: '12' }],
    specificStudents: true
  });
  assert.equal(pkg.exam.classes[0].students[0].externalId, 'eclass-student:12');
  assert.equal(pkg.exam.classes[0].students[0].name, '12');
});

test('falta de gabarito, seis opções, questão repetida e ausência de objetiva são bloqueadas', () => {
  assert.throws(() => OMR.buildPackage({ questions: [
    { number: 1, choices: ['A','B'], correct: null }
  ] }), /Gabarito ausente/);
  assert.throws(() => OMR.buildPackage({ questions: [
    { number: 1, choices: ['A','B','C','D','E','F'], correct: 5 }
  ] }), /Gabarito ausente/);
  assert.throws(() => OMR.buildPackage({ questions: [
    { number: 1, choices: ['A','B'], correct: 1 },
    { number: 1, choices: ['A','B'], correct: 0 }
  ] }), /repetidos/);
  assert.throws(() => OMR.buildPackage({ questions: [
    { number: 1, type: 'open' }
  ] }), /objetivas/);
  assert.throws(() => OMR.buildPackage({
    questions: questions(), specificStudents: true, classIds: [10],
    selectedStudents: []
  }), /alunos específicos/);
});

test('nome do download preserva Unicode e sanitiza caracteres inválidos', () => {
  assert.equal(OMR.fileNameForExam('Matemática 4º bimestre'), 'Matemática_4º_bimestre.eclass-omr.json');
  assert.equal(OMR.fileNameForExam('../<teste>'), '.._teste.eclass-omr.json');
});

test('painel mantém funcionalidades anteriores e carrega exportador antes do bind', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'panel.html'), 'utf8');
  assert.match(html, /id="exportOmr"/);
  assert.match(html, /id="useExistingAssessment"/);
  assert.match(html, /id="folderFile"/);
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  assert.ok(scripts.indexOf('omr-export.js') < scripts.indexOf('panel-omr.js'));
  assert.ok(scripts.indexOf('panel-omr.js') < scripts.indexOf('panel-init.js'));
  new vm.Script(fs.readFileSync(path.join(root, 'panel-omr.js'), 'utf8'));
});


test('normaliza matrículas com múltiplas turmas da API do E-Class', () => {
  const response = {
    data: [
      {
        id: 100, name: 'Aluna Exemplo',
        student_groups: [{ turma_id: 10 }, { turma_id: 20 }]
      },
      {
        id: 200, nome: 'Aluno Exemplo',
        group_id: 20
      }
    ]
  };
  assert.deepEqual(OMR.normalizeRoster(response), [
    { classId: 10, id: '100', name: 'Aluna Exemplo' },
    { classId: 20, id: '100', name: 'Aluna Exemplo' },
    { classId: 20, id: '200', name: 'Aluno Exemplo' }
  ]);
  const pkg = OMR.buildPackage({
    questions: questions(), classIds: [10,20],
    classes: [{ id: 10, description: '1MA' }, { id: 20, description: '1MB' }],
    students: OMR.normalizeRoster(response)
  });
  assert.equal(pkg.exam.classes.length, 2);
  assert.equal(pkg.exam.classes[0].students.length, 1);
  assert.equal(pkg.exam.classes[1].students.length, 2);
});

test('roster ausente ou retorno inesperado não impede exportação geral', () => {
  assert.deepEqual(OMR.normalizeRoster({ message: 'Não disponível' }), []);
  const pkg = OMR.buildPackage({
    questions: questions(), classIds: [10],
    students: OMR.normalizeRoster({ message: 'Não disponível' })
  });
  assert.equal(pkg.exam.mode, 'general');
  assert.deepEqual(pkg.exam.classes, []);
});
