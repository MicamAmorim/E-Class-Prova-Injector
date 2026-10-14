async function simulate() {
  analyzeLatex();
  const c = formConfig();
  validate(c);
  const payloads = [];
  const warns = [];
  for (const q of state.parsed.slice(0, 3)) {
    const stem = await latexFragmentToHtml(q.stem, false);
    const choices = [];
    for (const choice of q.choices) {
      const x = await latexFragmentToHtml(choice, false);
      choices.push(x.html); warns.push(...x.warnings.map(w => `Q${q.number}: ${w}`));
    }
    payloads.push(questionPayload(c, q, stem.html, choices));
    warns.push(...stem.warnings.map(w => `Q${q.number}: ${w}`));
  }
  console.group('E-Class Injector — simulação');
  console.log('Configuração', c);
  console.log('Questões', state.parsed);
  console.log('Payloads de amostra', payloads);
  console.log('Avaliação simulada', assessmentPayload(c, payloads.map((p,i) => ({ uuid:`DRY-${i+1}`, code:`DRY${i+1}`, ...p.dadosGerais, alternativas:p.alternativas }))));
  console.groupEnd();
  [...new Set(warns)].forEach(w => log(w, 'warn'));
  log('Simulação concluída. Nenhuma escrita foi feita. Abra o DevTools da extensão se quiser ver os payloads completos.', 'ok');
}

async function createQuestion(q, c) {
  const stem = await latexFragmentToHtml(q.stem, true);
  const choices = [];
  for (const choice of q.choices) choices.push((await latexFragmentToHtml(choice, true)).html);
  const payload = questionPayload(c, q, stem.html, choices);
  const res = await apiFetch(API.question, { method: 'POST', headers: portalHeaders(true), body: JSON.stringify(payload) });
  if (!res?.data?.uuid) throw new Error(`Questão ${q.number}: resposta inesperada ${JSON.stringify(res)}`);
  return res.data;
}

function setProgress(done, total, text) {
  $('progressWrap').classList.remove('hidden');
  const pct = total ? Math.round(done / total * 100) : 0;
  $('progressBar').style.width = pct + '%';
  $('progressText').textContent = text || `${done}/${total}`;
}

async function saveRunHistory(status, c, error = null, assessmentResponse = null) {
  const item = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    status,
    title: c.title,
    fileName: state.fileName,
    config: { ...c, dryRun: undefined },
    createdQuestions: state.createdQuestions,
    assessmentPayload: state.lastAssessmentPayload,
    assessmentResponse,
    error: error ? { message: error.message, status: error.status, data: error.data } : null
  };
  state.lastRun = item;
  await runtimeMessage({ type: 'history:save', item });
  $('retryAssessment').disabled = !state.lastAssessmentPayload || !state.createdQuestions.length;
}

async function persistPendingAssessment() {
  if (!state.lastAssessmentPayload || !state.createdQuestions.length) {
    await chrome.storage.local.remove('eciPendingAssessment');
    $('retryAssessment').disabled = true;
    $('clearPending').disabled = true;
    return;
  }
  await chrome.storage.local.set({
    eciPendingAssessment: {
      savedAt: new Date().toISOString(),
      fileName: state.fileName,
      createdQuestions: state.createdQuestions,
      assessmentPayload: state.lastAssessmentPayload
    }
  });
  $('retryAssessment').disabled = false;
  $('clearPending').disabled = false;
}

async function restorePendingAssessment() {
  const { eciPendingAssessment } = await chrome.storage.local.get('eciPendingAssessment');
  if (!eciPendingAssessment?.assessmentPayload || !Array.isArray(eciPendingAssessment?.createdQuestions) || !eciPendingAssessment.createdQuestions.length) return false;
  state.createdQuestions = eciPendingAssessment.createdQuestions;
  state.lastAssessmentPayload = eciPendingAssessment.assessmentPayload;
  $('retryAssessment').disabled = false;
  $('clearPending').disabled = false;
  const when = eciPendingAssessment.savedAt ? new Date(eciPendingAssessment.savedAt).toLocaleString() : 'data desconhecida';
  log(`Pendência restaurada: ${state.createdQuestions.length} questão(ões) já criadas; prova ainda não criada. Salva em ${when}.`, 'warn');
  return true;
}

async function clearPendingAssessment() {
  const count = state.createdQuestions.length;
  const title = state.lastAssessmentPayload?.avaliacao?.titulo || 'prova pendente';
  if (!state.lastAssessmentPayload && !count) {
    await chrome.storage.local.remove('eciPendingAssessment');
    $('retryAssessment').disabled = true;
    $('clearPending').disabled = true;
    return;
  }
  const ok = confirm(`Remover da extensão a pendência de “${title}”?\n\nIsso NÃO apaga as ${count} questão(ões) já criadas no E-Class.`);
  if (!ok) return;
  state.createdQuestions = [];
  state.lastAssessmentPayload = null;
  await chrome.storage.local.remove('eciPendingAssessment');
  $('retryAssessment').disabled = true;
  $('clearPending').disabled = true;
  log('Pendência local removida. As questões já criadas no E-Class não foram apagadas.', 'warn');
}

async function inject() {
  analyzeLatex();
  const c = formConfig();
  validate(c);
  if (c.dryRun) return simulate();
  if (!tokenForRequest()) {
    const okSession = await detectSession();
    if (!okSession && !tokenForRequest()) throw new Error('Não há sessão disponível.');
  }
  const ok = confirm(`Isto criará ${state.parsed.length} questão(ões) reais no E-Class${c.onlyQuestions ? '' : ' e tentará criar a prova'} “${c.title}”.\n\nNão há rollback automático. Continuar?`);
  if (!ok) return;

  state.createdQuestions = [];
  state.lastAssessmentPayload = null;
  $('retryAssessment').disabled = true;
  setProgress(0, state.parsed.length, `0/${state.parsed.length}`);

  try {
    for (let i = 0; i < state.parsed.length; i++) {
      const q = state.parsed[i];
      log(`Criando Q${q.number} (${i + 1}/${state.parsed.length})...`);
      const created = await createQuestion(q, c);
      state.createdQuestions.push(created);
      setProgress(i + 1, state.parsed.length, `${i + 1}/${state.parsed.length} questões`);
      log(`Q${q.number} criada: ${created.code || created.uuid}`, 'ok');
      await new Promise(r => setTimeout(r, 150));
    }

    if (c.onlyQuestions) {
      await saveRunHistory('questions_only', c);
      log('Concluído: questões criadas; avaliação não enviada.', 'ok');
      return;
    }

    state.lastAssessmentPayload = assessmentPayload(c, state.createdQuestions);
    await persistPendingAssessment();
    setProgress(state.parsed.length, state.parsed.length, 'Criando prova...');
    log('Questões prontas. Enviando aplicação/avaliação...');
    try {
      const res = await apiFetch(API.assessment, { method: 'POST', headers: portalHeaders(true), body: JSON.stringify(state.lastAssessmentPayload) });
      await saveRunHistory('success', c, null, res);
      await chrome.storage.local.remove('eciPendingAssessment');
      state.lastAssessmentPayload = null;
      state.createdQuestions = [];
      $('retryAssessment').disabled = true;
      $('clearPending').disabled = true;
      setProgress(state.parsed.length, state.parsed.length, 'Concluído');
      log('PROVA CRIADA COM SUCESSO.', 'ok');
      alert('Prova criada. Confira no E-Class antes de liberar aos alunos.');
    } catch (e) {
      await persistPendingAssessment();
      await saveRunHistory('assessment_failed', c, e);
      log(`Falha ao criar a prova: ${e.message}`, 'error');
      log(`As ${state.createdQuestions.length} questões já foram criadas. Use “Reenviar só a prova” quando o backend voltar, para evitar duplicá-las.`, 'warn');
      throw e;
    }
  } catch (e) {
    if (!state.lastAssessmentPayload) await saveRunHistory('question_failed', c, e);
    throw e;
  }
}

async function retryAssessment() {
  if (!state.lastAssessmentPayload) throw new Error('Não há payload de prova pendente nesta sessão da extensão.');
  if (!tokenForRequest()) await detectSession();
  const c = formConfig();
  const ok = confirm(`Reenviar somente a criação da prova “${state.lastAssessmentPayload.avaliacao?.titulo || c.title}”, reutilizando ${state.createdQuestions.length} questões já criadas?`);
  if (!ok) return;
  log('Reenviando somente /aplicacao-avaliacao...');
  const res = await apiFetch(API.assessment, { method: 'POST', headers: portalHeaders(true), body: JSON.stringify(state.lastAssessmentPayload) });
  await saveRunHistory('retry_success', c, null, res);
  await chrome.storage.local.remove('eciPendingAssessment');
  state.lastAssessmentPayload = null;
  state.createdQuestions = [];
  $('retryAssessment').disabled = true;
  $('clearPending').disabled = true;
  log('Prova criada no reenvio. Pendência local removida.', 'ok');
  alert('Reenvio concluído. Confira a prova no E-Class.');
}
