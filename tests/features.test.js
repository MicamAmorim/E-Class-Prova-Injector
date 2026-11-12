'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const F = require('../features.js');

test('marcadores identificados no enunciado e alternativas, inclusive numerados', () => {
  const q = { stem: 'A\nTAGFIGURAAQUI\nB\nTAGFIGURAAQUI_2', choices: ['TAGFIGURAAQUI', 'Nenhum'] };
  assert.deepEqual(F.figureTags(q), ['TAGFIGURAAQUI', 'TAGFIGURAAQUI_2']);
});

test('figuras substituem apenas marcador e preservam parágrafos', () => {
  const html = '<p>Primeiro<br>TAGFIGURAAQUI<br>Segundo</p>';
  const result = F.replaceFigureTags(html, { TAGFIGURAAQUI: 'https://example.org/figura.png' }, 7);
  assert.match(result, /Primeiro<br><img /);
  assert.match(result, /<br>Segundo/);
  assert.match(result, /alt="Figura da questão 7"/);
});

test('figuras sem upload ou com protocolo inseguro bloqueiam criação', () => {
  assert.throws(() => F.replaceFigureTags('TAGFIGURAAQUI', {}, 1), /associe uma figura/);
  assert.throws(() => F.replaceFigureTags('TAGFIGURAAQUI', { TAGFIGURAAQUI: 'javascript:alert(1)' }, 1), /inválida/);
  assert.match(F.replaceFigureTags('TAGFIGURAAQUI', { TAGFIGURAAQUI: 'data:image/png;base64,aGVsbG8=' }, 1), /data:image\/png/);
});

test('listar provas suporta envelope paginado e filtrar últimos dias', () => {
  const data = { data: { items: [{ id: 14, titulo: 'Teste', created_at: '2026-11-10T13:00:00Z' }] } };
  const rows = F.extractRows(data);
  assert.equal(rows.length, 1);
  const rec = F.assessmentRecord(rows[0]);
  assert.equal(rec.title, 'Teste');
  assert.equal(F.withinDays(rec, 15, new Date('2026-11-12T13:00:00Z')), true);
  assert.equal(F.withinDays(rec, 1, new Date('2026-11-12T13:00:00Z')), false);
});

test('atualização mantém configuração da prova original e questões', () => {
  const detail = {
    aplicacao: { uuid: 'abc', status: false, publico_alvo: [{ turma_id: 2 }] },
    avaliacao: { uuid: 'xyz', titulo: 'Minha prova', orientacoes: 'Preservar' },
    questoes: [{ uuid: 'antiga', peso: 100 }]
  };
  const weights = n => Array(n).fill(100 / n);
  const merged = F.mergeAssessment(detail, [{ uuid: 'nova' }], weights);
  assert.equal(merged.avaliacao.titulo, 'Minha prova');
  assert.equal(merged.avaliacao.orientacoes, 'Preservar');
  assert.deepEqual(merged.aplicacao.publico_alvo, detail.aplicacao.publico_alvo);
  assert.deepEqual(merged.questoes.map(x => x.uuid), ['antiga', 'nova']);
  assert.deepEqual(merged.questoes.map(x => x.peso), [50, 50]);
  assert.equal(detail.questoes.length, 1, 'não modifica objeto retornado');
  assert.equal(F.mergeAssessment(merged, [{ uuid: 'nova' }], weights).questoes.length, 2, 'idempotência');
});

test('atualização bloqueia aplicação ativa, respostas ou registro incompleto', () => {
  const base = { aplicacao: { status: false }, avaliacao: {}, questoes: [{ uuid: 'old' }] };
  assert.throws(() => F.mergeAssessment({ ...base, aplicacao: { status: true } }, [{ uuid: 'new' }], n => Array(n).fill(100 / n)), /ativa/);
  assert.throws(() => F.mergeAssessment({ ...base, total_respostas: 1 }, [{ uuid: 'new' }], n => Array(n).fill(100 / n)), /ativa/);
  assert.throws(() => F.mergeAssessment({ aplicacao: {}, avaliacao: {} }, [{ uuid: 'new' }], n => Array(n).fill(100 / n)), /completas/);
});

test('seleção individual exige turma selecionada e modelo restritivo', () => {
  const template = { turma_id: '{{turma_id}}', entidade_id: '{{entidade_id}}', alunos: '{{alunos_ids}}' };
  const c = { classes: [10, 20], entityId: 89 };
  const result = F.makeIndividualAudience(c, [{ classId: 10, id: '22' }, { classId: 10, id: '22' }, { classId: 20, id: '33' }], template);
  assert.deepEqual(result, [
    { turma_id: 10, entidade_id: 89, alunos: [22] },
    { turma_id: 20, entidade_id: 89, alunos: [33] }
  ]);
  assert.throws(() => F.makeIndividualAudience(c, [{ classId: 30, id: '55' }], template), /inválido/);
  assert.throws(() => F.makeIndividualAudience(c, [{ classId: 10, id: '22' }], { turma_id: '{{turma_id}}' }), /modelo deve conter/);
});

test('arquivos JavaScript da extensão têm sintaxe válida e painel referencia os módulos', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'panel.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(x => x[1]);
  for (const file of scripts) {
    assert.ok(fs.existsSync(path.join(root, file)), file);
    new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
  }
  new vm.Script(fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8'), { filename: 'service-worker.js' });
  assert.ok(scripts.indexOf('features.js') < scripts.indexOf('panel-enhancements.js'));
  assert.ok(scripts.indexOf('panel-enhancements.js') < scripts.indexOf('panel-run.js'));
});