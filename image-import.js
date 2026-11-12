(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EClassImageImport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Suporta imagens nas questões e também em cada alternativa.
  const IMAGE_RE = /\\includegraphics\*?\s*(?:\[[^\]]*\]\s*)?\{([^{}]+)\}|\bTAGFIGURAAQUI(?:[_-]?\d+)?\b/g;
  const EXT_RE = /\.(?:png|jpe?g|webp|gif)$/i;
  const SAFE_DATA_RE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/i;

  function normalizePath(path) {
    const parts = [];
    const pathStr = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    for (const part of pathStr.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') {
        if (!parts.length) return null;
        parts.pop();
      } else parts.push(part.toLowerCase());
    }
    return parts.join('/');
  }

  function imageReferences(raw) {
    const references = [];
    const text = String(raw || '');
    for (const m of text.matchAll(IMAGE_RE)) {
      const path = m[1] ? m[1].trim() : null;
      references.push({
        key: path ? 'file:' + (normalizePath(path) || path.toLowerCase()) : m[0],
        label: path ? '\\includegraphics{' + path + '}' : m[0],
        path,
        start: m.index,
        end: m.index + m[0].length
      });
    }
    return references;
  }

  function tokenizeImages(raw) {
    const refs = imageReferences(raw);
    let text = '';
    let start = 0;
    refs.forEach((ref, index) => {
      text += String(raw).slice(start, ref.start) + '@@ECIIMAGE' + index + '@@';
      start = ref.end;
    });
    return { text: text + String(raw).slice(start), refs };
  }

  function replaceImageTokens(html, refs, bindings, questionNumber) {
    let value = String(html);
    refs.forEach((ref, i) => {
      const src = bindings && bindings[ref.key];
      if (!src) throw new Error('Q' + questionNumber + ': imagem não vinculada a ' + ref.label + '.');
      if (!(SAFE_DATA_RE.test(src) || /^https:\/\//i.test(src))) {
        throw new Error('Q' + questionNumber + ': URL de imagem inválida para ' + ref.label + '.');
      }
      const escapedSrc = src.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      const label = String(ref.label).replace(/[&<>"']/g, '');
      const image = '<img src="' + escapedSrc + '" alt="Figura da questão ' +
        Number(questionNumber) + ': ' + label + '" style="max-width:100%;height:auto;display:block;margin:12px auto">';
      value = value.replace('@@ECIIMAGE' + i + '@@', image);
    });
    return value;
  }

  function allImageReferences(question) {
    const refs = [question.stem, ...(question.choices || [])].flatMap(imageReferences);
    return [...new Map(refs.map(r => [r.key, r])).values()];
  }

  function graphicPaths(tex) {
    const result = [];
    const content = String(tex || '');
    // \graphicspath{{imagens/}{figuras/}} tem a mesma convenção de caminhos do LaTeX.
    for (const entry of content.matchAll(/\\graphicspath\s*\{((?:\s*\{[^{}]+\}\s*)+)\}/g)) {
      for (const dir of entry[1].matchAll(/\{([^{}]+)\}/g)) result.push(dir[1]);
    }
    return result;
  }

  function stripRoot(relativePath) {
    const norm = normalizePath(relativePath);
    if (!norm) return '';
    return norm.split('/').slice(1).join('/');
  }

  function findImageFile(reference, questionNumber, records, texRelativePath = '', directories = []) {
    const valid = records.filter(r => EXT_RE.test(r.relativePath || r.file?.name || ''));
    const tex = stripRoot(texRelativePath);
    const texDir = tex.includes('/') ? tex.slice(0, tex.lastIndexOf('/') + 1) : '';
    const searches = [];
    const add = name => {
      const normalized = normalizePath(name);
      if (normalized && !searches.includes(normalized)) searches.push(normalized);
    };
    const extOptions = name => {
      if (EXT_RE.test(name)) return [name];
      return ['.png', '.jpg', '.jpeg', '.webp', '.gif'].map(ext => name + ext);
    };
    if (reference.path) {
      const raw = reference.path.replace(/\\/g, '/');
      for (const name of extOptions(raw)) add(texDir + name);
      for (const dir of directories) for (const name of extOptions(raw)) add(texDir + dir + name);
      // Se o .tex aponta por caminho a partir da raiz da pasta selecionada.
      for (const name of extOptions(raw)) add(name);
    } else {
      const tag = reference.key;
      const names = [
        'q' + questionNumber + '_' + tag, 'questao_' + questionNumber + '_' + tag,
        'questão_' + questionNumber + '_' + tag, tag
      ];
      for (const name of names) for (const candidate of extOptions(name)) {
        add(texDir + candidate);
        for (const dir of directories) add(texDir + dir + candidate);
      }
    }

    for (const search of searches) {
      const matches = valid.filter(r => stripRoot(r.relativePath) === search);
      if (matches.length === 1) return { record: matches[0], reason: 'caminho', path: search };
      if (matches.length > 1) return { record: null, reason: 'ambíguo', path: search };
    }

    // Um nome de arquivo explícito pode ser encontrado em subpasta não declarada,
    // mas somente quando for ÚNICO (nunca atribuir uma figura por adivinhação).
    if (reference.path) {
      const name = reference.path.replace(/\\/g, '/').split('/').pop().toLowerCase();
      const endings = extOptions(name).map(x => x.toLowerCase());
      const matches = valid.filter(r => endings.includes(normalizePath(r.file?.name || '') || ''));
      if (matches.length === 1) return { record: matches[0], reason: 'nome único', path: matches[0].relativePath };
      if (matches.length > 1) return { record: null, reason: 'ambíguo', path: name };
    }
    return { record: null, reason: 'não encontrado', path: reference.path || reference.key };
  }

  return {
    IMAGE_RE, imageReferences, tokenizeImages, replaceImageTokens,
    allImageReferences, graphicPaths, findImageFile, normalizePath
  };
});