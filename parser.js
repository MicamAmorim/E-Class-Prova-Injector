(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EClassParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function collectSimpleMacros(tex) {
    const map = new Map();
    const re = /\\newcommand\s*\{\\([A-Za-z]+)\}\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
    let m;
    while ((m = re.exec(tex))) {
      if (!m[2].includes('#')) map.set(m[1], m[2]);
    }
    return map;
  }

  function expandMacros(s, macroMap) {
    let out = s;
    for (const [name, repl] of macroMap || []) {
      out = out.replace(new RegExp('\\\\' + name + '(?![A-Za-z])', 'g'), repl);
    }
    return out;
  }

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
      if (depth === 0) {
        return { start, contentStart, contentEnd: t.index, end: tokenRe.lastIndex, content: text.slice(contentStart, t.index) };
      }
    }
    return null;
  }

  function splitTopLevelItems(content) {
    const starts = [];
    let depth = 0;
    let braceDepth = 0;
    for (let i = 0; i < content.length; i++) {
      if (content.startsWith('\\begin{enumerate}', i)) { depth++; i += 16; continue; }
      if (content.startsWith('\\end{enumerate}', i)) { depth--; i += 14; continue; }
      if (content[i] === '{' && content[i - 1] !== '\\') braceDepth++;
      if (content[i] === '}' && content[i - 1] !== '\\') braceDepth--;
      if (depth === 0 && braceDepth === 0 && content.startsWith('\\item', i)) starts.push(i);
    }
    const items = [];
    for (let k = 0; k < starts.length; k++) {
      const a = starts[k] + 5;
      const b = k + 1 < starts.length ? starts[k + 1] : content.length;
      items.push(content.slice(a, b).trim());
    }
    return items;
  }

  function parseChoicesFromQuestion(raw) {
    const env = findEnvironment(raw, 'enumerate', 0);
    if (!env) return null;
    const before = raw.slice(0, env.start).trim();
    const after = raw.slice(env.end).trim();
    const choices = splitTopLevelItems(env.content);
    return { stem: `${before}${after ? '\n' + after : ''}`.trim(), choices };
  }

  function extractSection(tex, sectionName) {
    if (!sectionName) return tex;
    const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(?:\\\\noindent\\s*)?\\\\textbf\\{' + escaped + '\\}', 'i');
    const m = re.exec(tex);
    if (!m) return tex;
    const start = m.index + m[0].length;
    const tail = tex.slice(start);
    const nextHeader = /\\newpage[\s\S]{0,180}?(?:\\noindent\s*)?\\textbf\{[^}]+\}/i.exec(tail);
    return nextHeader ? tail.slice(0, nextHeader.index) : tail;
  }

  function extractAnswerKey(tex, sectionName) {
    const key = new Map();
    const names = [sectionName, 'Matemática', 'MATEMÁTICA'].filter(Boolean);
    let block = '';
    for (const name of names) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('%\\s*Gabarito\\s+' + escaped + '\\s*:\\s*([\\s\\S]{0,700})', 'i');
      const m = re.exec(tex);
      if (m) { block = m[1]; break; }
    }
    if (!block) {
      const m = /%\s*Gabarito[^:]*:\s*([\s\S]{0,700})/i.exec(tex);
      if (m) block = m[1];
    }
    block = block.split('\n').slice(0, 6).join(' ');
    const rePair = /(\d+)\s*[-–:]\s*([a-e])/gi;
    let m;
    while ((m = rePair.exec(block))) key.set(Number(m[1]), m[2].toLowerCase().charCodeAt(0) - 97);
    return key;
  }

  function parseLatex(tex, sectionName) {
    const macroMap = collectSimpleMacros(tex);
    const section = extractSection(tex, sectionName);
    const key = extractAnswerKey(tex, sectionName);
    let rawQuestions = extractQuestaoMacros(section);

    if (!rawQuestions.length) {
      const main = findEnvironment(section, 'enumerate', 0);
      if (!main) throw new Error('Não encontrei bloco de questões (\\Questao{...} ou enumerate principal).');
      rawQuestions = splitTopLevelItems(main.content);
    }

    const questions = [];
    rawQuestions.forEach((raw, idx) => {
      const p = parseChoicesFromQuestion(raw);
      if (!p || p.choices.length < 2) return;
      let correct = key.has(idx + 1) ? key.get(idx + 1) : null;
      const choices = p.choices.map((c, ci) => {
        let text = c;
        if (/\\CorrectChoice\b/.test(text) || /✅/.test(text)) {
          correct = ci;
          text = text.replace(/\\CorrectChoice\b/g, '').replace(/✅/g, '');
        }
        return text.trim();
      });
      questions.push({ number: idx + 1, stem: p.stem, choices, correct });
    });

    if (!questions.length) throw new Error('Nenhuma questão objetiva pôde ser extraída do LaTeX.');
    return { questions, key, macroMap };
  }

  function stripUnsupportedBlocks(s, warnings) {
    let out = s;
    const blocks = [
      ['tikzpicture', /\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/gi, '[Figura/TikZ omitida no protótipo]'],
      ['tabular', /\\begin\{tabular\*?\}[\s\S]*?\\end\{tabular\*?\}/gi, '[Tabela omitida no protótipo]'],
      ['tabularx', /\\begin\{tabularx\}[\s\S]*?\\end\{tabularx\}/gi, '[Tabela omitida no protótipo]']
    ];
    for (const [name, re, repl] of blocks) {
      if (re.test(out)) warnings.push(`conteúdo ${name} não é convertido nesta versão`);
      out = out.replace(re, repl);
    }
    if (/\\includegraphics\b/.test(out)) warnings.push('includegraphics não é enviado nesta versão');
    out = out.replace(/\\includegraphics(?:\[[^\]]*\])?\{[^}]+\}/g, '[Imagem omitida no protótipo]');
    return out;
  }

  function extractMathSegments(input, macroMap) {
    const segments = [];
    let s = input;
    const stash = latex => {
      const id = segments.length;
      segments.push(expandMacros(latex.trim(), macroMap));
      return `@@ECIMATH${id}@@`;
    };
    s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_, x) => stash(x));
    s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_, x) => stash(x));
    s = s.replace(/\\\(([\s\S]*?)\\\)/g, (_, x) => stash(x));
    s = s.replace(/(^|[^\\])\$([^$\n]+?)\$/g, (_, p, x) => p + stash(x));
    return { text: s, math: segments };
  }

  function latexTextToHtmlSkeleton(raw, macroMap) {
    const warnings = [];
    let s = stripUnsupportedBlocks(raw, warnings);
    const math = extractMathSegments(s, macroMap);
    s = math.text;
    for (let i = 0; i < 4; i++) {
      s = s.replace(/\\textbf\{([^{}]*)\}/g, '<strong>$1</strong>');
      s = s.replace(/\\(?:textit|emph)\{([^{}]*)\}/g, '<em>$1</em>');
    }
    s = s.replace(/\\begin\{(?:center|samepage|minipage)\}(?:\[[^\]]*\])?(?:\{[^}]*\})?/g, '');
    s = s.replace(/\\end\{(?:center|samepage|minipage)\}/g, '');
    s = s.replace(/\\(?:Needspace|vspace\*?|hspace\*?)(?:\[[^\]]*\])?\{[^}]*\}/g, ' ');
    s = s.replace(/\\(?:noindent|par|small|normalsize|large|Large|centering|raggedright|smallskip|medskip|bigskip)\b/g, ' ');
    s = s.replace(/\\\\/g, '<br>');
    s = s.replace(/\\%/g, '%').replace(/\\&/g, '&').replace(/\\#/g, '#').replace(/\\_/g, '_');
    s = s.replace(/~/g, ' ');
    s = s.replace(/\n\s*\n+/g, '<br>');
    s = s.replace(/\s+/g, ' ').trim();
    return { skeleton: `<p>${s}</p>`, math: math.math, warnings };
  }

  return { parseLatex, latexTextToHtmlSkeleton, collectSimpleMacros };
});
