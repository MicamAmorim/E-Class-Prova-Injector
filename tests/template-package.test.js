'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Parser = require('../parser.js');
const Import = require('../image-import.js');

const templateDir = path.resolve(__dirname, '../templates/prova_com_figuras');
const texName = 'prova_exemplo.tex';
const texFile = path.join(templateDir, texName);
const tex = fs.readFileSync(texFile, 'utf8');
const pngMagic = Buffer.from([137,80,78,71,13,10,26,10]);

function listFiles(dir, relative = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const childRel = relative ? relative + '/' + entry.name : entry.name;
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full, childRel) :
      [{ file: { name: entry.name }, relativePath: 'prova_com_figuras/' + childRel, full }];
  });
}

const expectedImages = [
  'Q3_TAGFIGURAAQUI.png',
  'figuras/grafico_frequencias.png',
  'alternativas/triangulo_retangulo.png',
  'alternativas/triangulo_acutangulo.png',
  'alternativas/triangulo_obtusangulo.png'
];

test('template inclui cinco PNGs reais e nenhum caminho de figura vazio', () => {
  let totalBase64 = 0;
  for (const name of expectedImages) {
    const absolute = path.join(templateDir, name);
    assert.ok(fs.existsSync(absolute), 'Figura ausente no Git: ' + name);
    const bytes = fs.readFileSync(absolute);
    assert.ok(bytes.subarray(0,8).equals(pngMagic), 'PNG inválido: ' + name);
    assert.ok(bytes.length <= 1500000, 'Imagem excede 1,5 MB: ' + name);
    const w = bytes.readUInt32BE(16), h = bytes.readUInt32BE(20);
    assert.ok(w >= 100 && h >= 100, 'Dimensões inesperadas: ' + name);
    totalBase64 += 4 * Math.ceil(bytes.length / 3);
  }
  assert.ok(totalBase64 < 3500000, 'Figuras excedem o limite de base64 por execução');
});

test('o parser importa quatro questões com gabarito 1-B, 2-A, 3-B, 4-C', () => {
  const parsed = Parser.parseLatex(tex, 'MATEMÁTICA');
  assert.equal(parsed.questions.length, 4);
  assert.deepEqual(parsed.questions.map(x => x.correct), [1,0,1,2]);
  assert.deepEqual(parsed.questions.map(x => x.choices.length), [4,3,4,4]);
  assert.deepEqual(parsed.questions.map(x => x.number), [1,2,3,4]);
});

test('todas as cinco referências de imagens são resolvidas sem ambiguidade na pasta', () => {
  const parsed = Parser.parseLatex(tex, 'MATEMÁTICA');
  const records = listFiles(templateDir);
  let refs = 0;
  const paths = new Set();
  for (const q of parsed.questions) {
    for (const ref of Import.allImageReferences(q)) {
      const result = Import.findImageFile(ref,q.number,records,
        'prova_com_figuras/' + texName,Import.graphicPaths(tex));
      assert.ok(result.record, 'Q' + q.number + ': figura não localizada: ' + ref.label);
      assert.equal(result.reason === 'ambíguo', false);
      assert.ok(fs.existsSync(result.record.full), 'Arquivo faltando: ' + ref.label);
      paths.add(result.record.full);
      refs++;
    }
  }
  assert.equal(refs,5);
  assert.equal(paths.size,5);
});

test('README e prompt são entregues junto com a prova de referência', () => {
  const readme = fs.readFileSync(path.join(templateDir,'README.md'),'utf8');
  const prompt = fs.readFileSync(path.resolve(__dirname,
    '../docs/PROMPT_GERAR_PROVA_COMPATIVEL.md'),'utf8');
  assert.match(readme, /Selecionar pasta da prova/);
  assert.match(readme, /1-B, 2-A, 3-B, 4-C/);
  assert.match(prompt, /arquivos binários/);
  assert.match(prompt, /Gabarito/);
});
