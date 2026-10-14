(function (root) {
  'use strict';

  const td = new TextDecoder('utf-8');
  const u16 = (view, off) => view.getUint16(off, true);
  const u32 = (view, off) => view.getUint32(off, true);

  class ZipReader {
    constructor(buffer) {
      this.buffer = buffer;
      this.bytes = new Uint8Array(buffer);
      this.view = new DataView(buffer);
      this.entries = new Map();
      this.readDirectory();
    }
    readDirectory() {
      const min = Math.max(0, this.bytes.length - 65557);
      let eocd = -1;
      for (let i = this.bytes.length - 22; i >= min; i--) {
        if (u32(this.view, i) === 0x06054b50) { eocd = i; break; }
      }
      if (eocd < 0) throw new Error('DOCX inválido: diretório ZIP não encontrado.');
      const count = u16(this.view, eocd + 10);
      let pos = u32(this.view, eocd + 16);
      for (let n = 0; n < count; n++) {
        if (u32(this.view, pos) !== 0x02014b50) throw new Error('DOCX inválido: entrada ZIP corrompida.');
        const method = u16(this.view, pos + 10);
        const compressedSize = u32(this.view, pos + 20);
        const size = u32(this.view, pos + 24);
        const nameLen = u16(this.view, pos + 28);
        const extraLen = u16(this.view, pos + 30);
        const commentLen = u16(this.view, pos + 32);
        const localOffset = u32(this.view, pos + 42);
        const name = td.decode(this.bytes.slice(pos + 46, pos + 46 + nameLen));
        this.entries.set(name, { name, method, compressedSize, size, localOffset });
        pos += 46 + nameLen + extraLen + commentLen;
      }
    }
    has(name) { return this.entries.has(name); }
    async bytesFor(name) {
      const e = this.entries.get(name);
      if (!e) return null;
      const p = e.localOffset;
      if (u32(this.view, p) !== 0x04034b50) throw new Error(`DOCX inválido: cabeçalho local ausente em ${name}.`);
      const nameLen = u16(this.view, p + 26);
      const extraLen = u16(this.view, p + 28);
      const start = p + 30 + nameLen + extraLen;
      const compressed = this.bytes.slice(start, start + e.compressedSize);
      if (e.method === 0) return compressed;
      if (e.method !== 8) throw new Error(`DOCX usa compressão ZIP não suportada (${e.method}) em ${name}.`);
      if (typeof DecompressionStream !== 'function') throw new Error('Este Edge não oferece DecompressionStream para abrir DOCX.');
      let ds;
      try { ds = new DecompressionStream('deflate-raw'); }
      catch (_) { throw new Error('Este Edge não oferece descompressão deflate-raw necessária para DOCX.'); }
      const stream = new Blob([compressed]).stream().pipeThrough(ds);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    async text(name) {
      const bytes = await this.bytesFor(name);
      return bytes == null ? null : td.decode(bytes);
    }
  }

  function xml(text, label) {
    const doc = new DOMParser().parseFromString(text || '', 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error(`XML inválido no DOCX (${label}).`);
    return doc;
  }
  const lname = n => n?.localName || String(n?.nodeName || '').split(':').pop();
  const kids = n => [...(n?.childNodes || [])].filter(x => x.nodeType === 1);
  const child = (n, name) => kids(n).find(x => lname(x) === name) || null;
  const children = (n, name) => kids(n).filter(x => lname(x) === name);
  const descendants = (n, name) => [...(n?.getElementsByTagName('*') || [])].filter(x => lname(x) === name);
  function attr(n, name) {
    if (!n?.attributes) return null;
    for (const a of [...n.attributes]) if ((a.localName || a.name.split(':').pop()) === name) return a.value;
    return null;
  }

  const SYMBOLS = new Map([
    ['−','-'], ['×','\\times '], ['÷','\\div '], ['·','\\cdot '], ['±','\\pm '], ['∓','\\mp '],
    ['≤','\\le '], ['≥','\\ge '], ['≠','\\ne '], ['≈','\\approx '], ['∞','\\infty '],
    ['π','\\pi '], ['α','\\alpha '], ['β','\\beta '], ['γ','\\gamma '], ['δ','\\delta '], ['θ','\\theta '],
    ['λ','\\lambda '], ['μ','\\mu '], ['ρ','\\rho '], ['σ','\\sigma '], ['τ','\\tau '], ['φ','\\phi '], ['ω','\\omega '],
    ['Δ','\\Delta '], ['Σ','\\Sigma '], ['Ω','\\Omega '], ['∑','\\sum '], ['∏','\\prod '], ['∫','\\int '],
    ['→','\\to '], ['←','\\leftarrow '], ['↔','\\leftrightarrow '], ['∈','\\in '], ['∉','\\notin '], ['∩','\\cap '], ['∪','\\cup ']
  ]);
  function mathTextToLatex(s) {
    let out = '';
    for (const ch of String(s || '')) out += SYMBOLS.get(ch) || ch;
    return out.replace(/\s+/g, ' ').trim();
  }
  const content = n => n ? kids(n).map(renderMathNode).join('') : '';
  const mathPart = (n, part) => content(child(n, part));
  function mathPropChar(n, propName, fallback = '') {
    const prop = child(n, propName);
    const chr = prop ? descendants(prop, 'chr')[0] : null;
    return attr(chr, 'val') || fallback;
  }
  function delimiterLatex(ch, side) {
    const map = { '(': '(', ')': ')', '[': '[', ']': ']', '{': '\\{', '}': '\\}', '|': '|', '‖': '\\|', '⌈':'\\lceil', '⌉':'\\rceil', '⌊':'\\lfloor', '⌋':'\\rfloor' };
    return map[ch] || ch || (side === 'left' ? '(' : ')');
  }
  function naryOp(ch) {
    return ({ '∑':'\\sum', '∏':'\\prod', '∐':'\\coprod', '∫':'\\int', '∬':'\\iint', '∭':'\\iiint', '∮':'\\oint', '⋃':'\\bigcup', '⋂':'\\bigcap' })[ch] || mathTextToLatex(ch || '∑');
  }
  function renderMathNode(n) {
    if (!n) return '';
    const name = lname(n);
    if (name === 't') return mathTextToLatex(n.textContent || '');
    if (name === 'r') return descendants(n, 't').map(x => mathTextToLatex(x.textContent || '')).join('');
    if (name === 'f') return `\\frac{${mathPart(n,'num')}}{${mathPart(n,'den')}}`;
    if (name === 'sSup') return `{${mathPart(n,'e')}}^{${mathPart(n,'sup')}}`;
    if (name === 'sSub') return `{${mathPart(n,'e')}}_{${mathPart(n,'sub')}}`;
    if (name === 'sSubSup') return `{${mathPart(n,'e')}}_{${mathPart(n,'sub')}}^{${mathPart(n,'sup')}}`;
    if (name === 'rad') {
      const degree = mathPart(n,'deg'), body = mathPart(n,'e');
      return degree ? `\\sqrt[${degree}]{${body}}` : `\\sqrt{${body}}`;
    }
    if (name === 'nary') {
      const op = naryOp(mathPropChar(n,'naryPr','∑'));
      const sub = mathPart(n,'sub'), sup = mathPart(n,'sup'), body = mathPart(n,'e');
      return `${op}${sub ? `_{${sub}}` : ''}${sup ? `^{${sup}}` : ''}${body ? ` ${body}` : ''}`;
    }
    if (name === 'd') {
      const pr = child(n,'dPr');
      const beg = pr ? attr(descendants(pr,'begChr')[0],'val') : '(';
      const end = pr ? attr(descendants(pr,'endChr')[0],'val') : ')';
      return `\\left${delimiterLatex(beg,'left')} ${children(n,'e').map(content).join(',')} \\right${delimiterLatex(end,'right')}`;
    }
    if (name === 'func') {
      let fn = mathPart(n,'fName').replace(/\s+/g,'');
      if (/^(sin|cos|tan|cot|sec|csc|log|ln|exp|max|min)$/i.test(fn)) fn = '\\' + fn.toLowerCase();
      return `${fn}${mathPart(n,'e')}`;
    }
    if (name === 'acc') {
      const mark = mathPropChar(n,'accPr','^'), body = mathPart(n,'e');
      const cmd = ({ '^':'hat', 'ˆ':'hat', '¯':'bar', '→':'vec', '~':'tilde', '˜':'tilde', '˙':'dot', '¨':'ddot' })[mark];
      return cmd ? `\\${cmd}{${body}}` : body;
    }
    if (name === 'bar') {
      const pr = child(n,'barPr'), pos = pr ? attr(descendants(pr,'pos')[0],'val') : 'top';
      return pos === 'bot' ? `\\underline{${mathPart(n,'e')}}` : `\\overline{${mathPart(n,'e')}}`;
    }
    if (name === 'limLow') return `{${mathPart(n,'e')}}_{${mathPart(n,'lim')}}`;
    if (name === 'limUpp') return `{${mathPart(n,'e')}}^{${mathPart(n,'lim')}}`;
    if (name === 'm') return `\\begin{matrix}${children(n,'mr').map(r => children(r,'e').map(content).join(' & ')).join(' \\\\ ')}\\end{matrix}`;
    if (name === 'eqArr') return children(n,'e').map(content).join(' \\\\ ');
    if (name === 'groupChr') {
      const pr = child(n,'groupChrPr'), pos = pr ? attr(descendants(pr,'pos')[0],'val') : 'top', chr = pr ? attr(descendants(pr,'chr')[0],'val') : null, body = mathPart(n,'e');
      if (chr === '⏟' || pos === 'bot') return `\\underbrace{${body}}`;
      if (chr === '⏞' || pos === 'top') return `\\overbrace{${body}}`;
      return body;
    }
    return content(n);
  }
  const ommlToLatex = node => renderMathNode(node).replace(/\s+/g,' ').trim();

  function parseRelationships(doc) {
    const map = new Map();
    for (const rel of descendants(doc,'Relationship')) {
      const id = attr(rel,'Id'); let target = attr(rel,'Target');
      if (!id || !target) continue;
      target = target.replace(/^\.\//,'');
      if (!target.startsWith('/')) target = 'word/' + target.replace(/^\.\.\//,'');
      else target = target.replace(/^\//,'');
      map.set(id,target);
    }
    return map;
  }
  function parseContentTypes(doc) {
    const byExt = new Map(), byPart = new Map();
    for (const n of descendants(doc,'Default')) byExt.set(String(attr(n,'Extension') || '').toLowerCase(), attr(n,'ContentType'));
    for (const n of descendants(doc,'Override')) byPart.set(String(attr(n,'PartName') || '').replace(/^\//,''), attr(n,'ContentType'));
    return { byExt, byPart };
  }
  function mimeFor(path, types) {
    if (types.byPart.has(path)) return types.byPart.get(path);
    const ext = path.split('.').pop().toLowerCase();
    return types.byExt.get(ext) || ({ png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', svg:'image/svg+xml', emf:'image/x-emf', wmf:'image/wmf' })[ext] || 'application/octet-stream';
  }

  function parseNumbering(doc) {
    const abstracts = new Map(), nums = new Map();
    if (!doc) return { resolve: () => null };
    for (const abs of descendants(doc,'abstractNum')) {
      const levels = new Map();
      for (const lvl of children(abs,'lvl')) {
        const ilvl = Number(attr(lvl,'ilvl') || 0);
        levels.set(ilvl, {
          numFmt: attr(child(lvl,'numFmt'),'val') || 'decimal',
          lvlText: attr(child(lvl,'lvlText'),'val') || `%${ilvl + 1}`,
          start: Number(attr(child(lvl,'start'),'val') || 1)
        });
      }
      abstracts.set(String(attr(abs,'abstractNumId')), levels);
    }
    for (const num of descendants(doc,'num')) nums.set(String(attr(num,'numId')), String(attr(child(num,'abstractNumId'),'val')));
    return { resolve(numId, ilvl) { return abstracts.get(nums.get(String(numId)))?.get(Number(ilvl)) || null; } };
  }
  function alpha(n, upper) {
    let x = Math.max(1,n), s = '';
    while (x) { x--; s = String.fromCharCode((upper ? 65 : 97) + (x % 26)) + s; x = Math.floor(x / 26); }
    return s;
  }
  function roman(n) {
    const pairs = [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
    let x = n, s = '';
    for (const [v,r] of pairs) while (x >= v) { s += r; x -= v; }
    return s;
  }
  function formatNumber(n, fmt) {
    if (fmt === 'lowerLetter') return alpha(n,false);
    if (fmt === 'upperLetter') return alpha(n,true);
    if (fmt === 'lowerRoman') return roman(n).toLowerCase();
    if (fmt === 'upperRoman') return roman(n);
    if (fmt === 'bullet') return '•';
    return String(n);
  }
  function paragraphNumInfo(p, numbering, counters) {
    const numPr = child(child(p,'pPr'),'numPr');
    if (!numPr) return null;
    const numId = attr(child(numPr,'numId'),'val'), ilvl = Number(attr(child(numPr,'ilvl'),'val') || 0);
    if (numId == null) return null;
    const def = numbering.resolve(numId, ilvl) || { numFmt: ilvl ? 'lowerLetter' : 'decimal', lvlText:`%${ilvl+1}.`, start:1 };
    let levels = counters.get(String(numId));
    if (!levels) { levels = []; counters.set(String(numId), levels); }
    if (levels[ilvl] == null) levels[ilvl] = def.start - 1;
    levels[ilvl] += 1; levels.length = ilvl + 1;
    const label = def.lvlText.replace(/%(\d+)/g, (_,d) => {
      const level = Number(d) - 1, value = levels[level] == null ? 1 : levels[level];
      return formatNumber(value, (numbering.resolve(numId,level) || def).numFmt);
    });
    return { numId:String(numId), ilvl, numFmt:def.numFmt, label, index:levels[ilvl] };
  }

  function runText(run, relationships, imageRefs, warnings) {
    let text = '';
    for (const n of kids(run)) {
      const name = lname(n);
      if (name === 't' || name === 'instrText') text += n.textContent || '';
      else if (name === 'tab') text += '\t';
      else if (name === 'br' || name === 'cr') text += '\n';
      else if (name === 'drawing' || name === 'pict' || name === 'object') {
        for (const blip of descendants(n,'blip')) {
          const target = relationships.get(attr(blip,'embed') || attr(blip,'link'));
          if (target) {
            imageRefs.push(target);
            text += ` [Imagem do Word: ${target.split('/').pop()}] `;
            warnings.push(`imagem ${target.split('/').pop()} detectada; upload de imagens comuns ainda não foi mapeado no E-Class`);
          }
        }
      }
    }
    const rPr = child(run,'rPr');
    if (rPr && child(rPr,'b') && text.trim()) text = `\\textbf{${text}}`;
    if (rPr && child(rPr,'i') && text.trim()) text = `\\textit{${text}}`;
    return text;
  }
  function paragraphText(p, relationships, warnings) {
    const imageRefs = []; let out = '';
    const walk = n => {
      for (const c of kids(n)) {
        const name = lname(c);
        if (name === 'r') out += runText(c, relationships, imageRefs, warnings);
        else if (name === 'oMath' || name === 'oMathPara') {
          const formula = ommlToLatex(c); if (formula) out += ` $${formula}$ `;
        } else if (name !== 'pPr') walk(c);
      }
    };
    walk(p);
    return { text:out.replace(/[ \t]+\n/g,'\n').replace(/\n[ \t]+/g,'\n').replace(/[ \t]{2,}/g,' ').trim(), imageRefs };
  }
  function tableText(tbl, relationships, warnings) {
    const rows = [];
    for (const tr of children(tbl,'tr')) {
      const cells = children(tr,'tc').map(tc => children(tc,'p').map(p => paragraphText(p,relationships,warnings).text).filter(Boolean).join(' '));
      rows.push(cells.join(' | '));
    }
    if (rows.length) warnings.push('tabela do Word convertida para texto com colunas separadas por “|”');
    return rows.length ? `[Tabela]\n${rows.join('\n')}` : '';
  }

  root.EClassDocxCore = {
    ZipReader, xml, lname, kids, child, children, descendants, attr,
    ommlToLatex, parseRelationships, parseContentTypes, mimeFor,
    parseNumbering, paragraphNumInfo, paragraphText, tableText
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
