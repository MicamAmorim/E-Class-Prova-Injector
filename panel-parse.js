async function loadPortalData() {
  if (!tokenForRequest()) await detectSession();
  const c = formConfig();
  const entity = { id: c.entityId, nome: c.entityName, tipo: c.entityType, externo: false };
  log('Consultando turmas, bimestres e disciplinas...');
  const [classes, terms, subjects] = await Promise.all([
    apiFetch(API.classes(c.entityId), { headers: portalHeaders(false) }),
    apiFetch(API.terms(c.entityId), { headers: portalHeaders(false) }),
    apiFetch(API.subjects(entity), { headers: portalHeaders(false) })
  ]);
  state.remote.classes = classes?.data || [];
  state.remote.terms = terms?.data || [];
  state.remote.subjects = subjects?.data || [];
  if (state.remote.classes[0]?.entidade?.nome) $('entityName').value = state.remote.classes[0].entidade.nome;
  rebuildSelectors();
  log(`Portal carregado: ${state.remote.classes.length} turmas, ${state.remote.terms.length} períodos, ${state.remote.subjects.length} disciplinas.`, 'ok');
}

function renderPreview() {
  $('preview').classList.remove('empty');
  $('preview').innerHTML = '';
  for (const q of state.parsed) {
    const card = document.createElement('div');
    card.className = 'qcard';
    const corr = q.correct == null ? '⚠ sem gabarito' : String.fromCharCode(65 + q.correct);
    card.innerHTML = `<div class="qhead"><span>Q${q.number}</span><span>correta: ${corr}</span></div><div class="qraw">${escapeHtml(q.stem)}</div><ol type="A">${q.choices.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ol>`;
    $('preview').appendChild(card);
  }
  $('questionCount').textContent = `${state.parsed.length} questões`;
}

function analyzeLatex() {
  if (!state.latex.trim()) throw new Error('Selecione um arquivo .tex primeiro.');
  const parsed = EClassParser.parseLatex(state.latex, $('sectionName').value.trim());
  state.parsed = parsed.questions;
  state.macroMap = parsed.macroMap;
  const missing = state.parsed.filter(q => q.correct == null).map(q => q.number);
  const formulaCount = state.parsed.reduce((acc, q) => {
    const all = [q.stem, ...q.choices];
    return acc + all.reduce((n, s) => n + EClassParser.latexTextToHtmlSkeleton(s, state.macroMap).math.length, 0);
  }, 0);
  $('analysisSummary').textContent = `${state.fileName || 'LaTeX'} · ${state.parsed.length} questões · ${formulaCount} fórmulas · gabarito ${state.parsed.length - missing.length}/${state.parsed.length}`;
  if (missing.length) log(`Gabarito ausente nas questões: ${missing.join(', ')}`, 'warn');
  else log(`LaTeX analisado: ${state.parsed.length} questões com gabarito.`, 'ok');
  renderPreview();
}

async function fileChanged(file) {
  state.fileName = file?.name || null;
  state.latex = file ? await file.text() : '';
  $('analysisSummary').textContent = file ? `${file.name} carregado. Clique “Analisar LaTeX”.` : 'Nenhum arquivo analisado.';
}

async function uploadMath(latex) {
  if (state.mathCache.has(latex)) return state.mathCache.get(latex);
  const data = await apiFetch(API.mathUpload, {
    method: 'POST',
    headers: portalHeaders(true),
    body: JSON.stringify({ latex })
  });
  if (!data?.url) throw new Error(`Upload de fórmula não retornou URL: ${JSON.stringify(data)}`);
  state.mathCache.set(latex, data.url);
  return data.url;
}

async function latexFragmentToHtml(raw, doNetwork) {
  const x = EClassParser.latexTextToHtmlSkeleton(raw, state.macroMap);
  let html = x.skeleton;
  if (doNetwork) {
    for (let i = 0; i < x.math.length; i++) {
      const url = await uploadMath(x.math[i]);
      html = html.replace(`@@ECIMATH${i}@@`, `<img src="${url}">`);
    }
  } else {
    x.math.forEach((f, i) => { html = html.replace(`@@ECIMATH${i}@@`, `<code>${escapeHtml(f)}</code>`); });
  }
  return { html, warnings: x.warnings, formulas: x.math };
}

function questionPayload(c, q, stemHtml, choicesHtml) {
  return {
    dadosGerais: {
      uuid: null, parent_uuid: null, code: null, tipo: 0,
      enunciado: stemHtml, nivel_complexidade: 0,
      publishing_id: c.publishingId, texto_base_id: null,
      sociodemografica: 0, status: 1, validada: 1,
      pais_id: c.countryId, padrao_disciplina_id: c.subjectId,
      padrao_serie_id: null, nivel_id: c.levelId, categories: [], matrix_id: null,
      compartilhada: 0, tri_a: null, tri_b: null, tri_c: null,
      orientacao: null, taxonomia_bloom: null, uc: false
    },
    alternativas: choicesHtml.map((h, i) => ({ uuid: null, descricao: h, alternativa_correta: i === q.correct ? 1 : 0 })),
    entidade: { id: c.entityId, nome: c.entityName, tipo: c.entityType, externo: false }
  };
}

function creatorId() {
  const p = decodeJwt(tokenForRequest() || '');
  return Number(p?.sub || p?.user?.id || 0) || null;
}

function weights(n) {
  if (!n) return [];
  const base = Math.floor((100 / n) * 10000) / 10000;
  const arr = Array(n).fill(base);
  const sum = arr.reduce((a,b) => a+b, 0);
  arr[n - 1] = Number((arr[n - 1] + (100 - sum)).toFixed(4));
  return arr;
}

function assessmentPayload(c, created) {
  const w = weights(created.length);
  const questions = created.map((q, i) => ({ ...q, peso: w[i] }));
  return {
    aplicacao: {
      uuid: null, qtd_minimo: null,
      embaralhar_questoes: false, embaralhar_alternativas: false,
      permitir_copy_paste: false, mostrar_gabarito: false,
      mostrar_gabarito_professor: false,
      mostrar_gabarito_professor_imediatamente: false,
      mostrar_gabarito_professor_data_pre_aplicacao: false,
      mostrar_resultado: false, modo_aplicacao: 1, status: false,
      pre_aplicacao: false,
      publico_alvo: c.classes.map(id => ({ turma_id: id, entidade_id: c.entityId })),
      duplicar: false, disciplina_opcionais: [],
      data_inicio: `${c.startDate} 00:00:00`,
      bimestre_id: c.termId, bimestre_n: null, bloquear_saida: 0,
      coautores: [], coautores_data_limite: null,
      data_resultado: `${c.resultDate} 00:00:00`,
      mostrar_gabarito_data_pre_aplicacao: false,
      previewer: false, has_disciplina_opcional: false, exibir_regra: false
    },
    avaliacao: {
      orientacoes: null, orientacao_inicial: null, orientacao_cartao: null,
      origem: 1, titulo: c.title, uuid: null, editora_id: c.publisher,
      tipo: 0, peso_tipo: 0, peso: 100,
      avaliacao_disciplinas: [c.subjectId], pais_id: c.countryId,
      criado_por: creatorId(), status: 1, compartilhada: false,
      compartilhar_imediatamente: false
    },
    entidade: { id: c.entityId, nome: c.entityName, tipo: c.entityType, externo: false },
    questoes: questions
  };
}

function validate(c) {
  if (!state.parsed.length) analyzeLatex();
  if (!c.title) throw new Error('Informe o título da prova.');
  if (!c.startDate || !c.resultDate) throw new Error('Informe as datas.');
  if (new Date(c.resultDate) < new Date(c.startDate)) throw new Error('A data de resultado é anterior à data inicial.');
  if (!c.classes.length) throw new Error('Selecione pelo menos uma turma.');
  if (!c.subjectId || !c.termId) throw new Error('Disciplina e bimestre são obrigatórios.');
  const missing = state.parsed.filter(q => q.correct == null);
  if (missing.length) throw new Error(`Falta gabarito nas questões: ${missing.map(x => x.number).join(', ')}`);
}
