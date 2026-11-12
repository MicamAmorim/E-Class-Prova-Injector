'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Import = require('../image-import.js');
const Parser = require('../parser.js');
const fs = require('node:fs');
const path = require('node:path');

function records(...paths) {
  return paths.map(relativePath => ({
    relativePath,
    file: { name: relativePath.split('/').pop() }
  }));
}

test('identifica imagens em enunciados e alternativas, com caminhos e marcadores', () => {
  const q = {
    number: 3,
    stem: 'Antes\n\\includegraphics[width=0.5\\textwidth]{figs/grafico.png}\nDepois',
    choices: ['\\includegraphics{figs/a.png}', 'TAGFIGURAAQUI_2', 'Texto simples']
  };
  const refs = Import.allImageReferences(q);
  assert.deepEqual(refs.map(r => r.key), [
    'file:figs/grafico.png', 'file:figs/a.png', 'TAGFIGURAAQUI_2'
  ]);
  const tokenized = Import.tokenizeImages(q.stem);
  assert.equal(tokenized.refs.length, 1);
  assert.match(tokenized.text, /Antes\n@@ECIIMAGE0@@\nDepois/);
});

test('substitui imagens no HTML gerado pelo parser, sem omitir includegraphics', () => {
  const input = 'Parágrafo 1\n\n\\includegraphics{figura1}\n\nParágrafo 2';
  const tokenized = Import.tokenizeImages(input);
  const skeleton = Parser.latexTextToHtmlSkeleton(tokenized.text, new Map());
  const result = Import.replaceImageTokens(skeleton.skeleton, tokenized.refs, {
    'file:figura1': 'https://cdn.example.org/figura1.jpg'
  }, 2);
  assert.match(result, /Parágrafo 1/);
  assert.match(result, /Parágrafo 2/);
  assert.match(result, /<img src="https:\/\/cdn\.example\.org\/figura1\.jpg"/);
  assert.ok(!result.includes('Imagem omitida'));
  assert.ok(!skeleton.warnings.some(w => /includegraphics/.test(w)));
});

test('importa a figura correta usando caminho relativo ao .tex, ignorando outras iguais', () => {
  const items = records(
    'Prova2026/provas/matematica.tex',
    'Prova2026/provas/figuras/grafico.png',
    'Prova2026/outro/figuras/grafico.png'
  );
  const ref = Import.imageReferences('\\includegraphics{figuras/grafico.png}')[0];
  const found = Import.findImageFile(ref, 1, items, items[0].relativePath);
  assert.equal(found.record.relativePath, 'Prova2026/provas/figuras/grafico.png');
});

test('localiza imagem sem extensão e interpreta graphicspath', () => {
  const paths = Import.graphicPaths('\\graphicspath{{figuras/}{imagens/}}');
  assert.deepEqual(paths, ['figuras/', 'imagens/']);
  const items = records('MinhaProva/prova.tex', 'MinhaProva/imagens/geometria.webp');
  const ref = Import.imageReferences('\\includegraphics[scale=0.4]{geometria}')[0];
  assert.equal(Import.findImageFile(ref, 3, items, items[0].relativePath, paths).record, items[1]);
});

test('vincula TAGFIGURAAQUI pelo nome da questão e permite múltiplas tags', () => {
  const items = records('P/prova.tex', 'P/Q2_TAGFIGURAAQUI.png', 'P/Q2_TAGFIGURAAQUI_2.jpeg');
  for (const [tag, index] of [['TAGFIGURAAQUI', 1], ['TAGFIGURAAQUI_2', 2]]) {
    const ref = Import.imageReferences(tag)[0];
    assert.equal(Import.findImageFile(ref, 2, items, 'P/prova.tex').record, items[index]);
  }
});

test('não seleciona imagem ambígua com nome repetido em subpastas', () => {
  const items = records('P/prova.tex', 'P/f1/grafico.jpg', 'P/f2/grafico.jpg');
  const ref = Import.imageReferences('\\includegraphics{grafico.jpg}')[0];
  const found = Import.findImageFile(ref, 1, items, 'P/prova.tex');
  assert.equal(found.record, null);
  assert.equal(found.reason, 'ambíguo');
});

test('sem vínculo a geração é bloqueada; URL insegura é recusada', () => {
  const refs = Import.tokenizeImages('X\\includegraphics{a.png}Y').refs;
  assert.throws(() => Import.replaceImageTokens('@@ECIIMAGE0@@', refs, {}, 2), /não vinculada/);
  assert.throws(() => Import.replaceImageTokens('@@ECIIMAGE0@@', refs, {
    'file:a.png': 'file:///etc/passwd'
  }, 2), /inválida/);
});

test('figuras independentes nas alternativas geram imagens distintas no HTML', () => {
  const bindings = {
    'file:figs/opcao-a.png': 'https://cdn.example.org/a.png',
    'file:figs/opcao-b.png': 'https://cdn.example.org/b.png'
  };
  const choices = [
    '\\includegraphics{figs/opcao-a.png}',
    '\\includegraphics{figs/opcao-b.png}'
  ];
  const converted = choices.map(raw => {
    const t = Import.tokenizeImages(raw);
    const x = Parser.latexTextToHtmlSkeleton(t.text, new Map());
    return Import.replaceImageTokens(x.skeleton, t.refs, bindings, 1);
  });
  assert.match(converted[0], /a\.png/);
  assert.match(converted[1], /b\.png/);
  assert.notEqual(converted[0], converted[1]);
});

test('painel disponibiliza importação de pasta sem remover upload manual', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../panel.html'), 'utf8');
  assert.match(html, /id="folderFile"[^>]*webkitdirectory/);
  assert.match(html, /id="texFile"/);
  assert.match(html, /panel-image-import\.js/);
  const source = fs.readFileSync(path.resolve(__dirname, '../panel-enhancements.js'), 'utf8');
  assert.match(source, /file\.addEventListener\('change'/);
  assert.match(source, /allImageReferences\(q\)/);
});
