(function (root) {
  'use strict';

  function findBalancedBrace(text, openIndex) {
    let depth = 0;
    for (let i = openIndex; i < text.length; i++) {
      if (text[i] === '{' && text[i - 1] !== '\\') depth++;
      else if (text[i] === '}' && text[i - 1] !== '\\') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  function findEnvironment(text, envName, from = 0) {
    const beginRe = new RegExp('\\\\begin\\{' + envName + '\\}(?:\\[[^\\]]*\\])?', 'g');
    beginRe.lastIndex = from;
    const m = beginRe.exec(text);
    if (!m) return null;
    const start = m.index;
    const contentStart = beginRe.lastIndex;
    const tokenRe = new RegExp('\\\\(begin|end)\\{' + envName + '\\}(?:\\[[^\\]]*\\])?', 'g');
    tokenRe.lastIndex = contentStart;
    let depth = 1;
    let t;
    while ((t = tokenRe.exec(text))) {
      if (t[1] === 'begin') depth++;
      else depth--;
      if (depth === 0) return { start, contentStart, contentEnd: t.index, end: tokenRe.lastIndex, content: text.slice(contentStart, t.index) };
    }
    return null;
  }

  function splitTopLevelItems(content) {
    const starts = [];
    let depth = 0, braceDepth = 0;
    for (let i = 0; i < content.length; i++) {
      if (content.startsWith('\\begin{enumerate}', i)) { depth++; i += 16; continue; }
      if (content.startsWith('\\end{enumerate}', i)) { depth--; i += 14; continue; }
      if (content[i] === '{' && content[i - 1] !== '\\') braceDepth++;
      if (content[i] === '}' && content[i - 1] !== '\\') braceDepth--;
      if (depth === 0 && braceDepth === 0 && content.startsWith('\\item', i)) starts.push(i);
    }
    return starts.map((a, k) => content.slice(a + 5, k + 1 < starts.length ? starts[k + 1] : content.length).trim());
  }

  function extractQuestaoMacros(sectionText) {
    const out = [];
    let pos = 0;
    while (true) {
      const idx = sectionText.indexOf('\\Questao{', pos);
      if (idx < 0) break;
      const open = idx + '\\Questao'.length;
      const close = findBalancedBrace(sectionText, open);
      if (close < 0) break;
      out.push(sectionText.slice(open + 1, close));
      pos = close + 1;
    }
    return out;
  }

  function extractSection(tex, sectionName) {
    if (!sectionName) return tex;
    const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(?:\\\\noindent\\s*)?\\\\textbf\\{' + escaped + '\\}', 'i');
    const m = re.exec(tex);
    if (!m) return tex;
    const tail = tex.slice(m.index + m[0].length);
    const next = /\\newpage[\s\S]{0,180}?(?:\\noindent\s*)?\\textbf\{[^}]+\}/i.exec(tail);
    return next ? tail.slice(0, next.index) : tail;
  }

  function extractAnswerKey(tex, sectionName) {
    const key = new Map();
    const names = [sectionName, 'Matemática', 'MATEMÁTICA'].filter(Boolean);
    let block = '';
    for (const name of names) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = new RegExp('%\\s*Gabarito\\s+' + escaped + '\\s*:\\s*([\\s\\S]{0,1200})', 'i').exec(tex);
      if (m) { block = m[1]; break; }
    }
    if (!block) {
      const m = /%\s*Gabarito[^:]*:\s*([\s\S]{0,1200})/i.exec(tex);
      if (m) block = m[1];
    }
    block = block.split('\n').slice(0, 10).join(' ');
    const re = /(\d+)\s*[-–:.]\s*([a-e])/gi;
    let m;
    while ((m = re.exec(block))) key.set(Number(m[1]), m[2].toUpperCase().charCodeAt(0) - 65);
    return key;
  }

  function responseDirective(text) {
    const re = /\[\[\s*ECLASS\s*:\s*(?:OPEN|ABERTA)([^\]]*)\]\]/i;
    const m = re.exec(text || '');
    if (!m) return { text, response: null };
    const opts = m[1] || '';
    const lm = /(?:lines|linhas)\s*=\s*(\d+)/i.exec(opts);
    const fm = /(?:format|formato)\s*=\s*([\wÀ-ÿ-]+)/i.exec(opts);
    let format = null;
    if (fm) {
      const v = fm[1].toLocaleLowerCase('pt-BR');
      format = /blank|branco|espaco|espaço/.test(v) ? 'blank' : 'lines';
    }
    return {
      text: text.replace(m[0], '').trim(),
      response: { lines: lm ? Math.max(1, Number(lm[1])) : null, format }
    };
  }

  function parseRawQuestion(raw, number, key) {
    const env = findEnvironment(raw, 'enumerate', 0);
    if (!env) {
      const d = responseDirective(raw.trim());
      return { number, type: 'open', stem: d.text, choices: [], correct: null, response: d.response };
    }
    const choices = splitTopLevelItems(env.content);
    if (choices.length < 2) {
      const d = responseDirective(raw.trim());
      return { number, type: 'open', stem: d.text, choices: [], correct: null, response: d.response };
    }
    const stemRaw = `${raw.slice(0, env.start).trim()}${raw.slice(env.end).trim() ? '\n' + raw.slice(env.end).trim() : ''}`.trim();
    const d = responseDirective(stemRaw);
    let correct = key.has(number) ? key.get(number) : null;
    const cleaned = choices.map((c, ci) => {
      let text = c;
      if (/\\CorrectChoice\b/.test(text) || /✅/.test(text)) {
        correct = ci;
        text = text.replace(/\\CorrectChoice\b/g, '').replace(/✅/g, '');
      }
      return text.trim();
    });
    return { number, type: 'objective', stem: d.text, choices: cleaned, correct, response: null };
  }

  function parseLatex(tex, sectionName) {
    const macroMap = root.EClassParser.collectSimpleMacros(tex);
    const section = extractSection(tex, sectionName);
    const key = extractAnswerKey(tex, sectionName);
    let rawQuestions = extractQuestaoMacros(section);
    if (!rawQuestions.length) {
      const main = findEnvironment(section, 'enumerate', 0);
      if (!main) throw new Error('Não encontrei bloco de questões (\\Questao{...} ou enumerate principal).');
      rawQuestions = splitTopLevelItems(main.content);
    }
    const questions = rawQuestions.map((raw, idx) => parseRawQuestion(raw, idx + 1, key)).filter(q => q.stem.trim());
    if (!questions.length) throw new Error('Nenhuma questão pôde ser extraída do LaTeX.');
    return { questions, key, macroMap, warnings: [], media: [] };
  }

  function trimSection(paragraphs, sectionName) {
    if (!sectionName) return paragraphs;
    const wanted = sectionName.trim().toLocaleUpperCase('pt-BR');
    const idx = paragraphs.findIndex(p => p.text.trim().toLocaleUpperCase('pt-BR') === wanted);
    return idx < 0 ? paragraphs : paragraphs.slice(idx + 1);
  }

  function parseDocxPackage(pkg, sectionName = '') {
    const paragraphs = trimSection(pkg.paragraphs || [], sectionName);
    const key = pkg.key || new Map();
    const questions = [];
    let q = null, lastChoice = -1;

    const finish = () => {
      if (!q) return;
      q.stem = q.stem.trim();
      q.choices = q.choices.map(x => x.trim()).filter(Boolean);
      const d = responseDirective(q.stem);
      q.stem = d.text;
      if (q.choices.length >= 2) {
        q.type = 'objective';
        q.response = null;
        if (key.has(q.number)) q.correct = key.get(q.number);
      } else {
        q.type = 'open';
        q.choices = [];
        q.correct = null;
        q.response = d.response;
      }
      if (q.stem) questions.push(q);
      q = null; lastChoice = -1;
    };

    for (const p of paragraphs) {
      const text = String(p.text || '').trim();
      if (!text) continue;
      if (/^GABARITO\b/i.test(text)) { finish(); break; }
      const manualQ = /^(\d+)\s*[.)\-:]\s*(.+)$/s.exec(text);
      const manualC = /^([A-Ea-e])\s*[.)\-:]\s*(.+)$/s.exec(text);
      const isDecimalList = p.list && /decimal|roman/i.test(p.list.numFmt) && p.list.ilvl === 0;
      const isLetterList = p.list && /letter/i.test(p.list.numFmt);

      if (manualQ || isDecimalList) {
        finish();
        q = { number: manualQ ? Number(manualQ[1]) : Number(p.list.index || questions.length + 1), stem: manualQ ? manualQ[2] : text, choices: [], correct: null, type: null, response: null };
        continue;
      }
      if (q && (manualC || isLetterList)) {
        let choice = manualC ? manualC[2] : text;
        const ci = manualC ? manualC[1].toUpperCase().charCodeAt(0) - 65 : Math.max(0, Number(p.list.index || q.choices.length + 1) - 1);
        while (q.choices.length < ci) q.choices.push('');
        if (/✅/.test(choice)) { q.correct = ci; choice = choice.replace(/✅/g, ''); }
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
    if (!questions.length) throw new Error('Nenhuma questão foi reconhecida no DOCX. Use 1., 2. para questões e A), B)... para alternativas.');
    return { questions, key, macroMap: new Map(), warnings: pkg.warnings || [], media: pkg.media || [] };
  }

  root.EClassMixedParser = { parseLatex, parseDocxPackage, responseDirective };
})(typeof globalThis !== 'undefined' ? globalThis : this);
