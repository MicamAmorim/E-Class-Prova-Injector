(function () {
  'use strict';

  API.students = entityId => `https://api-usuario.educacaoadventista.org.br/api/v2/entity/${encodeURIComponent(entityId)}/students?strict_user=true`;
  API.imageUpload = 'https://api-avaliacoes.educacaoadventista.org.br/api/v1/upload/ckeditor-image?path=avaliacoes';
  state.remote.students = null;
  state.imageCache = new Map();
  state.omrExternalId = null;
  state.omrExportFileName = null;

  function defaultOpenFormat() { return $('openDefaultFormat')?.value || 'lines'; }
  function defaultOpenLines() { return Math.max(1, Number($('openDefaultLines')?.value || 10)); }

  function applyOpenDefaults(q) {
    if (q.type !== 'open') return q;
    q.response = q.response || {};
    q.response.format = q.response.format || defaultOpenFormat();
    q.response.lines = Math.max(1, Number(q.response.lines || defaultOpenLines()));
    return q;
  }

  function friendlyClassName(raw) {
    const s = String(raw || '').trim();
    const m = /^EMERE0?(\d)M([A-Z])$/i.exec(s);
    return m ? `${Number(m[1])}M${m[2].toUpperCase()}` : s;
  }

  async function loadPortalData() {
    if (!tokenForRequest()) await detectSession();
    const c = formConfig();
    const entity = { id: c.entityId, nome: c.entityName, tipo: c.entityType, externo: false };
    log('Consultando turmas, bimestres, disciplinas e alunos...');
    const [classes, terms, subjects, students] = await Promise.all([
      apiFetch(API.classes(c.entityId), { headers: portalHeaders(false) }),
      apiFetch(API.terms(c.entityId), { headers: portalHeaders(false) }),
      apiFetch(API.subjects(entity), { headers: portalHeaders(false) }),
      apiFetch(API.students(c.entityId), { headers: portalHeaders(false) })
    ]);
    state.remote.classes = classes?.data || [];
    state.remote.terms = terms?.data || [];
    state.remote.subjects = subjects?.data || [];
    state.remote.students = students?.data || [];
    if (state.remote.classes[0]?.entidade?.nome) $('entityName').value = state.remote.classes[0].entidade.nome;
    rebuildSelectors();
    log(`Portal carregado: ${state.remote.classes.length} turmas, ${state.remote.terms.length} períodos, ${state.remote.subjects.length} disciplinas e ${state.remote.students.length} alunos.`, 'ok');
  }

  function renderPreview() {
    $('preview').classList.remove('empty');
    $('preview').innerHTML = '';
    state.parsed.forEach((q, index) => {
      const card = document.createElement('div');
      card.className = 'qcard';
      if (q.type === 'open') {
        applyOpenDefaults(q);
        card.innerHTML = `<div class="qhead"><span>Q${q.number} · ABERTA</span><span>sem gabarito OMR</span></div>` +
          `<div class="qraw">${escapeHtml(q.stem)}</div>` +
          `<div class="grid2" style="margin-top:10px">` +
          `<label>Resposta impressa<select class="openFormat" data-q="${index}"><option value="lines" ${q.response.format === 'lines' ? 'selected' : ''}>Com linhas</option><option value="blank" ${q.response.format === 'blank' ? 'selected' : ''}>Espaço em branco</option></select></label>` +
          `<label>Número de linhas / altura<input class="openLines" data-q="${index}" type="number" min="1" max="100" value="${q.response.lines}"></label>` +
          `</div>`;
      } else {
        const corr = q.correct == null ? '⚠ sem gabarito' : String.fromCharCode(65 + q.correct);
        card.innerHTML = `<div class="qhead"><span>Q${q.number} · OBJETIVA</span><span>correta: ${corr}</span></div><div class="qraw">${escapeHtml(q.stem)}</div><ol type="A">${q.choices.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ol>`;
      }
      $('preview').appendChild(card);
    });
    $('preview').querySelectorAll('.openFormat').forEach(el => el.addEventListener('change', e => {
      const q = state.parsed[Number(e.target.dataset.q)];
      if (q?.type === 'open') q.response.format = e.target.value;
    }));
    $('preview').querySelectorAll('.openLines').forEach(el => el.addEventListener('change', e => {
      const q = state.parsed[Number(e.target.dataset.q)];
      if (q?.type === 'open') q.response.lines = Math.max(1, Number(e.target.value || 1));
    }));
    const openCount = state.parsed.filter(q => q.type === 'open').length;
    $('questionCount').textContent = `${state.parsed.length} questões · ${state.parsed.length - openCount} objetivas · ${openCount} abertas`;
  }

  function analyzeLatex() {
    let parsed, kind;
    if (state.sourceType === 'docx') {
      if (!state.docxPackage) throw new Error('Selecione um arquivo .docx primeiro.');
      parsed = EClassMixedParser.parseDocxPackage(state.docxPackage, $('sectionName').value.trim());
      kind = 'Word';
    } else {
      if (!state.latex.trim()) throw new Error('Selecione um arquivo .tex primeiro.');
      parsed = EClassMixedParser.parseLatex(state.latex, $('sectionName').value.trim());
      kind = 'LaTeX';
    }
    state.parsed = parsed.questions.map(applyOpenDefaults);
    state.macroMap = parsed.macroMap || new Map();
    state.sourceWarnings = parsed.warnings || [];
    state.sourceMedia = parsed.media || [];
    if (state.omrExportFileName !== state.fileName) {
      state.omrExternalId = `eclass-injector:${crypto.randomUUID()}`;
      state.omrExportFileName = state.fileName;
    }

    const objectives = state.parsed.filter(q => q.type !== 'open');
    const opens = state.parsed.filter(q => q.type === 'open');
    const missing = objectives.filter(q => q.correct == null).map(q => q.number);
    const formulaCount = state.parsed.reduce((acc, q) => [q.stem, ...(q.choices || [])].reduce((n, s) => n + EClassParser.latexTextToHtmlSkeleton(s, state.macroMap).math.length, acc), 0);
    const mediaText = state.sourceMedia.length ? ` · ${state.sourceMedia.length} imagens` : '';
    $('analysisSummary').textContent = `${state.fileName || kind} · ${objectives.length} objetivas · ${opens.length} abertas · ${formulaCount} fórmulas · gabarito ${objectives.length - missing.length}/${objectives.length}${mediaText}`;
    if (missing.length) log(`Gabarito ausente nas objetivas: ${missing.join(', ')}`, 'warn');
    log(`${kind} analisado: ${state.parsed.length} questões (${objectives.length} objetivas, ${opens.length} abertas).`, 'ok');
    [...new Set(state.sourceWarnings)].forEach(w => log(`${kind}: ${w}`, 'warn'));
    if (state.sourceMedia.length) log(`${state.sourceMedia.length} imagem(ns) do Word pronta(s) para upload pelo endpoint oficial do CKEditor.`, 'ok');
    renderPreview();
  }

  async function uploadSourceImage(media) {
    const key = media.path || media.name;
    if (state.imageCache.has(key)) return state.imageCache.get(key);
    const res = await runtimeMessage({
      type: 'api:upload',
      request: {
        url: API.imageUpload,
        headers: portalHeaders(false),
        fileName: media.name || 'image.png',
        mime: media.mime || 'application/octet-stream',
        bytes: media.bytes
      }
    });
    if (!res?.ok) throw new Error(`${res?.status || 0} ${res?.statusText || 'Erro'} no upload da imagem ${media.name}`);
    const url = res?.data?.url || res?.url;
    if (!url) throw new Error(`Upload de imagem não retornou URL para ${media.name}.`);
    state.imageCache.set(key, url);
    return url;
  }

  async function latexFragmentToHtml(raw, doNetwork) {
    const images = [];
    let prepared = String(raw || '').replace(/\[Imagem do Word:\s*([^\]]+)\]/gi, (_, name) => {
      const media = state.sourceMedia.find(m => m.name === name.trim() || String(m.path || '').endsWith('/' + name.trim()));
      if (!media) return `[Imagem não encontrada: ${name.trim()}]`;
      const id = images.length;
      images.push(media);
      return `@@ECIWORDIMG${id}@@`;
    });

    const x = EClassParser.latexTextToHtmlSkeleton(prepared, state.macroMap);
    let html = x.skeleton;
    if (doNetwork) {
      for (let i = 0; i < x.math.length; i++) {
        const url = await uploadMath(x.math[i]);
        html = html.replace(`@@ECIMATH${i}@@`, `<img src="${url}">`);
      }
      for (let i = 0; i < images.length; i++) {
        const url = await uploadSourceImage(images[i]);
        html = html.replace(`@@ECIWORDIMG${i}@@`, `<img src="${url}">`);
      }
    } else {
      x.math.forEach((f, i) => { html = html.replace(`@@ECIMATH${i}@@`, `<code>${escapeHtml(f)}</code>`); });
      images.forEach((m, i) => { html = html.replace(`@@ECIWORDIMG${i}@@`, `<em>[imagem: ${escapeHtml(m.name)}]</em>`); });
    }
    return { html, warnings: x.warnings, formulas: x.math, images };
  }

  function questionPayload(c, q, stemHtml, choicesHtml) {
    const open = q.type === 'open';
    const dadosGerais = {
      uuid: null, parent_uuid: null, code: null,
      tipo: open ? 1 : 0,
      enunciado: stemHtml, nivel_complexidade: 0,
      publishing_id: c.publishingId, texto_base_id: null,
      sociodemografica: 0, status: 1, validada: 1,
      pais_id: c.countryId, padrao_disciplina_id: c.subjectId,
      padrao_serie_id: null, nivel_id: c.levelId, categories: [], matrix_id: null,
      compartilhada: 0, tri_a: null, tri_b: null, tri_c: null,
      orientacao: null, taxonomia_bloom: null, uc: false
    };
    if (open) {
      applyOpenDefaults(q);
      // HAR 14/10/2026: tipo=1, formato_resposta_impressao=1 e linhas=30.
      // Mapeamento adotado: 1 = com linhas; 0 = espaço em branco.
      dadosGerais.formato_resposta_impressao = q.response.format === 'blank' ? 0 : 1;
      dadosGerais.formato_resposta_impressao_linhas = String(q.response.lines);
    }
    return {
      dadosGerais,
      alternativas: open ? [] : choicesHtml.map((h, i) => ({ uuid: null, descricao: h, alternativa_correta: i === q.correct ? 1 : 0 })),
      entidade: { id: c.entityId, nome: c.entityName, tipo: c.entityType, externo: false }
    };
  }

  function validate(c) {
    if (!state.parsed.length) analyzeLatex();
    if (!c.title) throw new Error('Informe o título da prova.');
    if (!c.startDate || !c.resultDate) throw new Error('Informe as datas.');
    if (new Date(c.resultDate) < new Date(c.startDate)) throw new Error('A data de resultado é anterior à data inicial.');
    if (!c.classes.length) throw new Error('Selecione pelo menos uma turma.');
    if (!c.subjectId || !c.termId) throw new Error('Disciplina e bimestre são obrigatórios.');
    const missing = state.parsed.filter(q => q.type !== 'open' && q.correct == null);
    if (missing.length) throw new Error(`Falta gabarito nas questões objetivas: ${missing.map(x => x.number).join(', ')}`);
  }

  function studentsForClass(classId) {
    return (state.remote.students || []).filter(s => {
      if (Number(s.group_id) === Number(classId)) return true;
      return (s.student_groups || []).some(g => Number(g.turma_id) === Number(classId));
    });
  }

  function buildOmrPackage() {
    if (!state.parsed.length) analyzeLatex();
    const c = formConfig();
    const objectives = state.parsed.filter(q => q.type !== 'open');
    const missing = objectives.filter(q => q.correct == null);
    if (missing.length) throw new Error(`Não posso exportar: falta gabarito nas objetivas ${missing.map(q => q.number).join(', ')}.`);
    if (!objectives.length) throw new Error('A prova não possui questões objetivas para o corretor OMR.');

    const selected = new Set(c.classes.map(Number));
    const remoteClasses = (state.remote.classes || []).filter(x => selected.has(Number(x.id)));
    const classPackages = remoteClasses.map(x => {
      const roster = studentsForClass(x.id);
      return {
        externalId: `eclass-class:${x.id}`,
        eclassId: x.id,
        name: friendlyClassName(x.description || x.descricao || String(x.id)),
        students: roster.map(s => ({ externalId: `eclass-student:${s.id}`, name: s.name }))
      };
    });
    const hasRoster = classPackages.some(x => x.students.length);
    const subjectText = $('subject')?.selectedOptions?.[0]?.textContent?.replace(/\s*\(\d+\)\s*$/, '').trim() || 'Geral';
    const answerKey = objectives.map(q => String.fromCharCode(65 + q.correct));
    return {
      schema: 'eclass-omr-exam/1',
      version: 1,
      source: 'E-Class Prova Injector',
      exportedAt: new Date().toISOString(),
      externalId: state.omrExternalId || `eclass-injector:${crypto.randomUUID()}`,
      exam: {
        title: c.title,
        subject: subjectText,
        mode: hasRoster ? 'student' : 'general',
        questions: state.parsed.map(q => q.type === 'open'
          ? { number: q.number, type: 'open', response: { format: q.response.format, lines: q.response.lines } }
          : { number: q.number, type: 'objective', answer: String.fromCharCode(65 + q.correct) }),
        omr: {
          alternatives: ['A','B','C','D','E'],
          objectiveQuestionNumbers: objectives.map(q => q.number),
          answerKey
        },
        classes: hasRoster ? classPackages : []
      }
    };
  }

  function downloadJson(data, fileName) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportOmr() {
    const pkg = buildOmrPackage();
    const safeName = (pkg.exam.title || 'prova').replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^_+|_+$/g, '') || 'prova';
    downloadJson(pkg, `${safeName}.eclass-omr.json`);
    const classes = pkg.exam.classes?.length || 0;
    const students = (pkg.exam.classes || []).reduce((n, c) => n + c.students.length, 0);
    log(`Exportado para o Corretor: ${pkg.exam.omr.answerKey.length} objetivas${classes ? `, ${classes} turmas e ${students} alunos` : ', gabarito geral'}.`, 'ok');
  }

  if ($('exportOmr')) $('exportOmr').addEventListener('click', () => safe(exportOmr));
})();
