'use strict';

// A leitura é explícita: o navegador não divulga a pasta de um .tex escolhido isoladamente.
// "Selecionar pasta" entrega arquivos locais autorizados e suas rotas RELATIVAS.
state.imageFolderRecords = [];
state.imageTexRecords = [];
state.texRelativePath = '';
state.imageDataCache = new Map();
state.imageImportGeneration = 0;

function clearFolderSelection() {
  state.imageFolderRecords = [];
  state.imageTexRecords = [];
  state.texRelativePath = '';
  state.imageDataCache.clear();
  $('folderTexChoice').replaceChildren(new Option('Nenhum arquivo da pasta', ''));
  $('folderTexArea').classList.add('hidden');
  $('folderFile').value = '';
  $('figureImportStatus').textContent = 'Sem pasta vinculada. Selecione uma pasta para identificar figuras automaticamente.';
}

function sniffImageMime(bytes) {
  if (bytes.length >= 8 &&
      [137,80,78,71,13,10,26,10].every((x, i) => bytes[i] === x)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 6) {
    const magic = String.fromCharCode(...bytes.slice(0, 6));
    if (magic === 'GIF87a' || magic === 'GIF89a') return 'image/gif';
  }
  if (bytes.length >= 12 &&
      String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

async function localImageData(record) {
  const key = record.relativePath;
  if (state.imageDataCache.has(key)) return state.imageDataCache.get(key);
  const file = record.file;
  if (file.size > 1500000) throw new Error(file.name + ': imagem acima de 1,5 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffImageMime(bytes);
  if (!mime) throw new Error(file.name + ': formato ou assinatura de imagem não suportado.');
  const encoded = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Leitura inválida'));
    reader.onerror = () => reject(reader.error || new Error('Falha ao ler arquivo'));
    reader.readAsDataURL(new Blob([bytes], { type: mime }));
  });
  state.imageDataCache.set(key, encoded);
  return encoded;
}

async function autoBindImageFiles() {
  const records = state.imageFolderRecords;
  const generation = state.imageImportGeneration;
  if (!state.parsed.length || !records.length) {
    const count = state.parsed.reduce((n, q) =>
      n + EClassImageImport.allImageReferences(q).length, 0);
    $('figureImportStatus').textContent = count ?
      count + ' referência(s) de imagem. Selecione a pasta da prova para carregá-las automaticamente.' :
      'Nenhuma imagem referenciada neste arquivo.';
    return;
  }
  let imported = 0, unresolved = 0, ambiguous = 0;
  const directories = EClassImageImport.graphicPaths(state.latex);
  for (const q of state.parsed) {
    const bindings = questionImages(q);
    for (const ref of EClassImageImport.allImageReferences(q)) {
      if (bindings[ref.key]) continue; // Preserve imagens adicionadas/substituídas manualmente.
      const result = EClassImageImport.findImageFile(ref, q.number, records, state.texRelativePath, directories);
      if (!result.record) {
        unresolved++;
        if (result.reason === 'ambíguo') ambiguous++;
        continue;
      }
      try {
        const data = await localImageData(result.record);
        if (generation !== state.imageImportGeneration) return;
        bindings[ref.key] = data;
        imported++;
        log('Q' + q.number + ': imagem importada de ' + result.record.relativePath + ' para ' + ref.label, 'ok');
      } catch (error) {
        unresolved++;
        log('Q' + q.number + ': ' + error.message + '. Use o seletor manual.', 'warn');
      }
    }
  }
  const unresolvedText = unresolved ? ' · ' + unresolved + ' imagem(ns) a vincular manualmente' : '';
  $('figureImportStatus').textContent =
    imported + ' imagem(ns) importada(s) automaticamente' + unresolvedText +
    (ambiguous ? ' (' + ambiguous + ' nomes ambíguos)' : '') + '.';
  if (unresolved) log('Há ' + unresolved + ' referência(s) sem arquivo identificado. Revise a prévia e associe manualmente.', 'warn');
}

async function selectTexFromFolder(index) {
  const record = state.imageTexRecords[Number(index)];
  if (!record) return;
  state.texRelativePath = record.relativePath;
  await fileChanged(record.file);
  await analyzeLatex();
}

async function folderChanged(files) {
  const entries = [...files];
  if (!entries.length) return;
  // webkitRelativePath inclui o nome da pasta selecionada, mas não seu caminho absoluto.
  state.imageFolderRecords = entries.map(file => ({
    file, relativePath: String(file.webkitRelativePath || file.name).replace(/\\/g, '/')
  }));
  state.imageTexRecords = state.imageFolderRecords.filter(r => /\.tex$/i.test(r.file.name));
  state.imageDataCache.clear();
  $('folderTexChoice').replaceChildren();
  state.imageTexRecords.forEach((r, i) => {
    $('folderTexChoice').add(new Option(r.relativePath, String(i)));
  });
  $('folderTexArea').classList.toggle('hidden', !state.imageTexRecords.length);
  if (state.imageTexRecords.length) {
    const previouslyUsed = state.imageTexRecords.findIndex(r => r.file.name === state.fileName);
    await selectTexFromFolder(previouslyUsed >= 0 ? previouslyUsed : 0);
  } else if (state.latex) {
    // Permite selecionar uma pasta só de figuras após escolher o .tex.
    state.texRelativePath = '';
    await analyzeLatex();
  } else {
    $('figureImportStatus').textContent = 'Pasta não contém arquivos .tex. Selecione um arquivo de prova.';
    log('Pasta de imagens carregada. Nenhum .tex encontrado.', 'warn');
  }
}

function bindFolderImport() {
  $('folderFile').addEventListener('change', e => safe(async () => {
    await folderChanged(e.target.files || []);
  }));
  $('folderTexChoice').addEventListener('change', e => safe(async () => {
    await selectTexFromFolder(e.target.value);
  }));
}