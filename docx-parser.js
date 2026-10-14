(function (root) {
  'use strict';
  const C = root.EClassDocxCore;
  if (!C) throw new Error('EClassDocxCore não foi carregado.');

  function extractAnswerKey(paragraphs) {
    const key = new Map();
    const all = paragraphs.map(p => p.text).join('\n');
    const idx = all.search(/\bGABARITO\b/i);
    const source = idx >= 0 ? all.slice(idx) : all;
    const re = /(\d+)\s*[-–:.]\s*([A-E])/gi;
    let m;
    while ((m = re.exec(source))) key.set(Number(m[1]), m[2].toUpperCase().charCodeAt(0) - 65);
    return key;
  }

  function trimSection(paragraphs, sectionName) {
    if (!sectionName) return paragraphs;
    const wanted = sectionName.trim().toLocaleUpperCase('pt-BR');
    const idx = paragraphs.findIndex(p => p.text.trim().toLocaleUpperCase('pt-BR') === wanted);
    return idx < 0 ? paragraphs : paragraphs.slice(idx + 1);
  }

  function parseQuestions(paragraphs, key) {
    const questions = [];
    let q = null, lastChoice = -1;
    const finish = () => {
      if (!q) return;
      q.stem = q.stem.trim();
      q.choices = q.choices.map(x => x.trim()).filter(Boolean);
      if (q.choices.length >= 2) {
        if (key.has(q.number)) q.correct = key.get(q.number);
        questions.push(q);
      }
      q = null; lastChoice = -1;
    };

    for (const p of paragraphs) {
      let text = p.text.trim();
      if (!text) continue;
      if (/^GABARITO\b/i.test(text)) { finish(); break; }
      const manualQ = /^(\d+)\s*[.)\-:]\s*(.+)$/s.exec(text);
      const manualC = /^([A-Ea-e])\s*[.)\-:]\s*(.+)$/s.exec(text);
      const isDecimalList = p.list && /decimal|roman/i.test(p.list.numFmt) && p.list.ilvl === 0;
      const isLetterList = p.list && /letter/i.test(p.list.numFmt);

      if (manualQ || isDecimalList) {
        finish();
        const number = manualQ ? Number(manualQ[1]) : Number(p.list.index || questions.length + 1);
        q = { number, stem:manualQ ? manualQ[2] : text, choices:[], correct:null };
        continue;
      }
      if (q && (manualC || isLetterList)) {
        let choice = manualC ? manualC[2] : text;
        const ci = manualC ? manualC[1].toUpperCase().charCodeAt(0) - 65 : Math.max(0, Number(p.list.index || q.choices.length + 1) - 1);
        while (q.choices.length < ci) q.choices.push('');
        if (/✅/.test(choice)) { q.correct = ci; choice = choice.replace(/✅/g,''); }
        q.choices[ci] = (q.choices[ci] ? q.choices[ci] + ' ' : '') + choice.trim();
        lastChoice = ci;
        continue;
      }
      if (!q) continue;
      if (!q.choices.length) q.stem += `\n${text}`;
      else if (lastChoice >= 0) q.choices[lastChoice] += ` ${text}`;
      else q.stem += `\n${text}`;
    }
    finish();
    if (!questions.length) throw new Error('Nenhuma questão objetiva foi reconhecida no DOCX. Use numeração 1., 2. e alternativas A), B)... ou listas numeradas do Word.');
    return questions;
  }

  function questionsFromPackage(pkg, sectionName = '') {
    const section = trimSection(pkg.paragraphs, sectionName);
    const questions = parseQuestions(section, pkg.key);
    for (const q of questions) if (q.correct == null && pkg.key.has(q.number)) q.correct = pkg.key.get(q.number);
    return { questions, key:pkg.key, macroMap:new Map(), warnings:pkg.warnings, media:pkg.media };
  }

  async function parsePackage(arrayBuffer) {
    const zip = new C.ZipReader(arrayBuffer);
    const docText = await zip.text('word/document.xml');
    if (!docText) throw new Error('DOCX inválido: word/document.xml não encontrado.');
    const relText = await zip.text('word/_rels/document.xml.rels');
    const numberingText = await zip.text('word/numbering.xml');
    const typesText = await zip.text('[Content_Types].xml');
    const doc = C.xml(docText,'document.xml');
    const rels = relText ? C.parseRelationships(C.xml(relText,'document.xml.rels')) : new Map();
    const numbering = numberingText ? C.parseNumbering(C.xml(numberingText,'numbering.xml')) : C.parseNumbering(null);
    const types = typesText ? C.parseContentTypes(C.xml(typesText,'[Content_Types].xml')) : { byExt:new Map(), byPart:new Map() };
    const warnings = [], counters = new Map(), paragraphs = [];
    const body = C.descendants(doc,'body')[0];
    if (!body) throw new Error('DOCX inválido: corpo do documento não encontrado.');

    for (const n of C.kids(body)) {
      if (C.lname(n) === 'p') {
        const x = C.paragraphText(n,rels,warnings);
        const list = C.paragraphNumInfo(n,numbering,counters);
        const style = C.attr(C.child(C.child(n,'pPr'),'pStyle'),'val') || '';
        paragraphs.push({ text:x.text, list, style, imageRefs:x.imageRefs });
      } else if (C.lname(n) === 'tbl') {
        const t = C.tableText(n,rels,warnings);
        if (t) paragraphs.push({ text:t, list:null, style:'table', imageRefs:[] });
      }
    }

    const key = extractAnswerKey(paragraphs);
    const media = [];
    const paths = new Set(paragraphs.flatMap(p => p.imageRefs || []));
    for (const path of paths) {
      const bytes = await zip.bytesFor(path);
      if (bytes) media.push({ path, name:path.split('/').pop(), mime:C.mimeFor(path,types), bytes });
    }
    return { paragraphs, key, warnings:[...new Set(warnings)], media };
  }

  async function parseDocx(arrayBuffer, sectionName = '') {
    return questionsFromPackage(await parsePackage(arrayBuffer), sectionName);
  }

  root.EClassDocxParser = { parsePackage, questionsFromPackage, parseDocx, ommlToLatex:C.ommlToLatex };
})(typeof globalThis !== 'undefined' ? globalThis : this);
