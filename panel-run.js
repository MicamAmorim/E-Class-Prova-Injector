async function simulate() {
  await analyzeLatex();
  const c = formConfig();
  validate(c);
  const payloads = [];
  const warns = [];
  for (const q of state.parsed.slice(0, 3)) {
    const stem = await latexFragmentToHtml(q.stem, false, q.number);
    const choices = [];
    for (const choice of q.choices) {
      const x = await latexFragmentToHtml(choice, false, q.number);
      choices.push(x.html); warns.push(...x.warnings.map(w => `Q${q.number}: ${w}`));
    }
    payloads.push(questionPayload(c, q, stem.html, choices));
    warns.push(...stem.warnings.map(w => `Q${q.number}: ${w}`));
  }
  console.group('E-Class Injector — simulação');
  console.log('Configuração', c);
  console.log('Questões', state.parsed);
  console.log('Payloads de amostra', payloads);
  console.log('Destino simulado', c.existingMode ? { operacao: 'atualizar', uuid: c.targetAssessmentId, novasQuestoes: payloads } : assessmentPayload(c, payloads.map((p,i) => ({ uuid:`DRY-${i+1}`, code:`DRY${i+1}`, ...p.dadosGerais, alternativas:p.alternativas }))));
  console.groupEnd();
  [...new Set(warns)].forEach(w => log(w, 'warn'));
  log('Simulação concluída. Nenhuma escrita foi feita. Abra o DevTools da extensão se quiser ver os payloads completos.', 'ok');
}

async function createQuestion(q, c) {
  const stem = await latexFragmentToHtml(q.stem, true, q.number);
  const choices = [];
  for (const choice of q.choices) choices.push((await latexFragmentToHtml(choice, true, q.number)).html);
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
    config: { ...c, dryRun: undefined, students: undefined },
    // Histórico não duplica imagens em base64 nem dados completos da avaliação.
    pendingOperation: state.pendingOperation ? { ...state.pendingOperation } : null,
    createdQuestions: state.createdQuestions,
    assessmentPayload: state.lastAssessmentPayload ? {
      aplicacao: { uuid: state.lastAssessmentPayload.aplicacao?.uuid || null },
      avaliacao: {
        uuid: state.lastAssessmentPayload.avaliacao?.uuid || null,
        titulo: state.lastAssessmentPayload.avaliacao?.titulo || null
      },
      questoes: (state.lastAssessmentPayload.questoes || []).map(q => ({
        uuid: q.uuid, code: q.code, peso: q.peso
      }))
    } : null,
    assessmentResponse: (() => {
      const record = EClassFeatures.assessmentRecord(assessmentResponse);
      return record ? { data: { uuid: record.id, titulo: record.title, created_at: new Date().toISOString() } } : null;
    })(),
    error: error ? { message: error.message, status: error.status, data: error.data } : null
  };
  state.lastRun = item;
  await runtimeMessage({ type: 'history:save', item });
  $('retryAssessment').disabled = !state.createdQuestions.length || (!state.lastAssessmentPayload && state.pendingOperation?.type !== 'update');
}

async function persistPendingAssessment() {
  if ((!state.lastAssessmentPayload && state.pendingOperation?.type !== 'update') || !state.createdQuestions.length) {
    await chrome.storage.local.remove('eciPendingAssessment');
    $('retryAssessment').disabled = true;
    $('clearPending').disabled = true;
    $('inspectPending')?.setAttribute('disabled', '');
    return;
  }
  await chrome.storage.local.set({
    eciPendingAssessment: {
      savedAt: new Date().toISOString(),
      fileName: state.fileName,
      createdQuestions: state.createdQuestions,
      assessmentPayload: state.lastAssessmentPayload,
      pendingOperation: state.pendingOperation
    }
  });
  $('retryAssessment').disabled = false;
  $('clearPending').disabled = false;
  if ($('inspectPending')) $('inspectPending').disabled = state.pendingOperation?.type !== 'update';
}

async function restorePendingAssessment() {
  const { eciPendingAssessment } = await chrome.storage.local.get('eciPendingAssessment');
  if (!Array.isArray(eciPendingAssessment?.createdQuestions) || !eciPendingAssessment.createdQuestions.length || (!eciPendingAssessment.assessmentPayload && eciPendingAssessment.pendingOperation?.type !== 'update')) return false;
  state.createdQuestions = eciPendingAssessment.createdQuestions;
  state.lastAssessmentPayload = eciPendingAssessment.assessmentPayload || null;
  state.pendingOperation = eciPendingAssessment.pendingOperation || { type: 'create', method: 'POST', url: API.assessment };
  $('retryAssessment').disabled = false;
  $('clearPending').disabled = false;
  if ($('inspectPending')) $('inspectPending').disabled = state.pendingOperation?.type !== 'update';
  const when = eciPendingAssessment.savedAt ? new Date(eciPendingAssessment.savedAt).toLocaleString() : 'data desconhecida';
  log(`Pendência restaurada: ${state.createdQuestions.length} questão(ões) criadas; ${state.pendingOperation.type === 'update' ? 'atualização de prova existente' : 'criação de prova'} ainda pendente. Salva em ${when}.`, 'warn');
  return true;
}

async function clearPendingAssessment() {
  const count = state.createdQuestions.length;
  const title = state.lastAssessmentPayload?.avaliacao?.titulo || 'prova pendente';
  if (!state.lastAssessmentPayload && !count) {
    await chrome.storage.local.remove('eciPendingAssessment');
    $('retryAssessment').disabled = true;
    $('clearPending').disabled = true;
    if ($('inspectPending')) $('inspectPending').disabled = true;
    return;
  }
  const ok = confirm(`Remover da extensão a pendência de “${title}”?\n\nIsso NÃO apaga as ${count} questão(ões) já criadas no E-Class.`);
  if (!ok) return;
  state.createdQuestions = [];
  state.lastAssessmentPayload = null;
  state.pendingOperation = null;
  await chrome.storage.local.remove('eciPendingAssessment');
  $('retryAssessment').disabled = true;
  $('clearPending').disabled = true;
  if ($('inspectPending')) $('inspectPending').disabled = true;
  log('Pendência local removida. As questões já criadas no E-Class não foram apagadas.', 'warn');
}

async function fetchExistingAssessment(uuid) {
  const url = targetAssessmentUrl(uuid);
  const response = await apiFetch(url, { headers: portalHeaders(false) });
  const detail = normalizeAssessmentDetail(response);
  if (!detail) throw new Error('O portal não retornou aplicação, avaliação e questões completas. Nenhuma atualização será realizada.');
  const identifiers = [detail.aplicacao?.uuid, detail.aplicacao?.id, detail.avaliacao?.uuid, detail.avaliacao?.id]
    .filter(x => x != null).map(String);
  if (identifiers.length && !identifiers.includes(String(uuid))) {
    throw new Error('O identificador retornado pelo portal não corresponde à prova selecionada.');
  }
  return detail;
}

function assertExistingQuestionAccess(detail, options = {}) {
  if (EClassFeatures.isAssessmentActive(detail)) {
    throw new Error('A prova está ativa, encerrada ou possui tentativas. Atualização bloqueada.');
  }
  const audience = EClassFeatures.assessmentAudience(detail);
  if (!audience.verified) {
    throw new Error('Não foi possível verificar as turmas oficiais da aplicação; nenhuma questão nova será criada.');
  }
  const rights = EClassFeatures.assessmentPermissions(detail, state.currentPortalUserId);
  if (!rights.canEditQuestions) {
    throw new Error('A sessão não foi identificada como proprietária nem como coautora autorizada para esta prova. ' +
      'Nenhuma questão adicional será criada. Atualize a sessão e selecione novamente a avaliação.');
  }
  if (rights.isCoauthor) {
    const count = Number(options.questionCount || 0);
    const allowance = rights.coauthor.remaining;
    if (allowance != null && count > allowance) {
      throw new Error('A atribuição de coautoria permite ' + allowance +
        ' questão(ões) restante(s) nesta avaliação; tentativa de inserir ' + count + '.');
    }
    if (!options.recovery && Array.isArray(options.subjectDistribution)) {
      const assignments = new Map(rights.coauthor.assignments
        .filter(x => Number.isSafeInteger(Number(x.subjectId)))
        .map(x => [Number(x.subjectId), x]));
      const counts = new Map();
      for (const entry of options.subjectDistribution) {
        const id = Number(entry.subjectId);
        if (!assignments.has(id)) {
          throw new Error('A disciplina ' + id + ' não consta na coautoria.');
        }
        counts.set(id, (counts.get(id) || 0) + 1);
      }
      for (const [id, n] of counts) {
        const allowance = rights.coauthor.assignments
          .filter(x => Number(x.subjectId) === id);
        if (allowance.every(x => x.limit != null)) {
          const max = allowance.reduce((sum, x) => sum + Number(x.limit), 0);
          const used = detail.questoes.filter(q =>
            Number(q?.criado_por) === Number(state.currentPortalUserId) &&
            Number(q?.padrao_disciplina_id) === id).length;
          if (n + used > max) {
            throw new Error('Cota excedida na disciplina ' + id + ': ' +
              n + ' nova(s) + ' + used + ' vinculada(s) para ' + max + ' vagas.');
          }
        }
      }
    }
    if (!options.recovery && count > 0 && options.subjectId != null) {
      const forSubject = rights.coauthor.assignments.filter(x =>
        x.subjectId == null || Number(x.subjectId) === Number(options.subjectId));
      if (!forSubject.length) {
        throw new Error('Esta disciplina não consta na atribuição de coautoria da avaliação.');
      }
      if (forSubject.every(x => x.limit != null)) {
        const existingForSubject = detail.questoes.filter(q =>
          Number(q?.criado_por) === Number(state.currentPortalUserId) &&
          Number(q?.padrao_disciplina_id) === Number(options.subjectId)).length;
        const max = forSubject.reduce((sum, x) => sum + x.limit, 0);
        if (count + existingForSubject > max) {
          throw new Error('Limite da disciplina excedido: ' + max + ' questão(ões) atribuídas; ' +
            existingForSubject + ' já vinculada(s) e ' + count + ' para adicionar. ' +
            'Distribua as questões entre as disciplinas conforme a atribuição oficial.');
        }
      }
    }
  }
  return { audience, rights };
}

function expectedQuestionIds() {
  return state.createdQuestions.map(q => EClassFeatures.questionId ? EClassFeatures.questionId(q) : String(q.uuid || q.id || q.code)).filter(Boolean);
}

async function prepareExistingUpdate(uuid) {
  const detail = await fetchExistingAssessment(uuid);
  const newIds = expectedQuestionIds();
  const present = new Set(detail.questoes.map(q => String(q.uuid || q.id || q.code || '')));
  if (newIds.length && newIds.every(id => present.has(id))) return { alreadyApplied: true, payload: detail };
  await portalCurrentUserId().catch(error =>
    log('Não foi possível confirmar identidade na recuperação: ' + assessmentErrorBrief(error), 'warn'));
  const access = assertExistingQuestionAccess(detail, {
    questionCount: newIds.filter(id => !present.has(id)).length,
    recovery: true
  });
  if (access.rights.isCoauthor) {
    const quota = EClassFeatures.verifyPendingCoauthorSubjects(
      detail, state.currentPortalUserId, state.createdQuestions);
    if (!quota.valid) {
      throw new Error('Reenvio da aplicação bloqueado: ' + quota.reason +
        ' As questões existentes foram preservadas; verifique o vínculo pendente sem gravar.');
    }
  }
  const c = formConfig();
  const payload = EClassFeatures.portalUpdatePayload(detail, state.createdQuestions, c, weights);
  return { alreadyApplied: false, payload };
}

async function finishAssessmentWrite(c, response, operation) {
  await saveRunHistory(operation.type === 'update' ? 'update_success' : 'success', c, null, response);
  await chrome.storage.local.remove('eciPendingAssessment');
  state.lastAssessmentPayload = null;
  state.createdQuestions = [];
  state.pendingOperation = null;
  $('retryAssessment').disabled = true;
  $('clearPending').disabled = true;
  if ($('inspectPending')) $('inspectPending').disabled = true;
  setProgress(1, 1, 'Concluído');
  log(operation.type === 'update' ? 'QUESTÕES ADICIONADAS À PROVA.' : 'PROVA CRIADA COM SUCESSO.', 'ok');
  alert(operation.type === 'update' ?
    'Atualização enviada e conferida no E-Class. Verifique a prova antes de liberar.' :
    'Prova criada. Confira no E-Class antes de liberar aos alunos.');
}

async function submitAssessmentOperation(c) {
  const operation = state.pendingOperation || { type: 'create', method: 'POST', url: API.assessment };
  if (operation.type === 'update') {
    const prepared = await prepareExistingUpdate(operation.id);
    if (prepared.alreadyApplied) {
      await finishAssessmentWrite(c, { alreadyApplied: true }, operation);
      return;
    }
    state.lastAssessmentPayload = prepared.payload;
    await persistPendingAssessment();
  }
  if (!state.lastAssessmentPayload) throw new Error('Payload da avaliação pendente não encontrado.');
  const response = await apiFetch(operation.url, {
    method: operation.method, headers: portalHeaders(true), body: JSON.stringify(state.lastAssessmentPayload)
  });
  if (operation.type === 'update') {
    // PUT pode retornar sucesso mesmo quando o backend ignora uma alteração.
    // Por isso, nunca marcar como concluído sem conferir novamente os UUIDs.
    const after = await fetchExistingAssessment(operation.id);
    const present = new Set(after.questoes.map(q => String(q.uuid || q.id || q.code || '')));
    if (expectedQuestionIds().some(id => !present.has(id))) {
      throw new Error('O portal não confirmou a presença de todas as novas questões após a atualização. A pendência foi mantida.');
    }
  }
  await finishAssessmentWrite(c, response, operation);
}

async function inject() {
  await analyzeLatex();
  const c = formConfig();
  validate(c);
  if (c.dryRun) return simulate();
  if (state.createdQuestions.length && (state.lastAssessmentPayload || state.pendingOperation)) {
    throw new Error('Há uma operação pendente com questões já criadas. Reenvie ou limpe a pendência antes de iniciar outra.');
  }
  if (!tokenForRequest()) {
    const okSession = await detectSession();
    if (!okSession && !tokenForRequest()) throw new Error('Não há sessão disponível.');
  }
  const uuid = c.existingMode ? c.targetAssessmentId : null;
  if (uuid) {
    const detail = await fetchExistingAssessment(uuid);
    await portalCurrentUserId().catch(error =>
      log('Não foi possível confirmar identidade da conta: ' + assessmentErrorBrief(error), 'warn'));
    const plan = EClassFeatures.existingSubjectPlan(detail, state.currentPortalUserId, state.parsed);
    if (!plan.valid) {
      throw new Error('Distribuição por disciplina inválida: ' + plan.reason);
    }
    if (JSON.stringify(plan.mapping) !== JSON.stringify(c.questionSubjectIds)) {
      throw new Error('As cotas ou disciplinas da prova mudaram desde a análise. ' +
        'Selecione a prova novamente antes de enviar; nenhuma questão foi criada.');
    }
    const check = assertExistingQuestionAccess(detail, {
      questionCount: state.parsed.length,
      subjectDistribution: plan.entries
    }); // antes de criar a primeira questão
    log('Público-alvo conferido: ' + check.audience.classIds.length +
      ' turma(s) existentes; a atualização não modificará seus destinatários.', 'ok');
    if (check.rights.isCoauthor) {
      log('Coautoria confirmada: ' + check.rights.coauthor.assignments.map(
        x => x.subjectName + ': ' + (x.limit == null ? 'ilimitado' : x.limit)).join(', '), 'ok');
    }
  }
  const countImages = Object.values(state.figureBindings).reduce((n, group) =>
    n + Object.values(group).filter(x => x.startsWith('data:')).length, 0);
  const warningImages = countImages ? '\nATENÇÃO: há ' + countImages + ' imagem(ns) embutida(s) em base64. O aceite pelo E-Class precisa ser confirmado no ambiente real.' : '';
  const action = c.existingMode ? 'adicionará à prova existente ' + uuid :
    (c.onlyQuestions ? 'criará somente as questões' : 'criará uma nova avaliação');
  const ok = confirm('Isto criará ' + state.parsed.length + ' questão(ões) reais e ' + action +
    '.\n\nNão há rollback automático.' + warningImages + '\n\nContinuar?');
  if (!ok) return;

  state.createdQuestions = [];
  state.lastAssessmentPayload = null;
  state.pendingOperation = null;
  $('retryAssessment').disabled = true;
  setProgress(0, state.parsed.length, '0/' + state.parsed.length);
  try {
    for (let i = 0; i < state.parsed.length; i++) {
      const q = state.parsed[i];
      log('Criando Q' + q.number + ' (' + (i + 1) + '/' + state.parsed.length + ')...');
      const created = await createQuestion(q, c);
      state.createdQuestions.push(created);
      setProgress(i + 1, state.parsed.length, (i + 1) + '/' + state.parsed.length + ' questões');
      log('Q' + q.number + ' criada: ' + (created.code || created.uuid), 'ok');
      await new Promise(r => setTimeout(r, 150));
    }

    if (c.onlyQuestions) {
      await saveRunHistory('questions_only', c);
      log('Concluído: questões criadas; avaliação não enviada.', 'ok');
      return;
    }

    const context = {
      entityId: c.entityId, profileId: c.profileId, academicYear: c.academicYear
    };
    state.pendingOperation = c.existingMode ?
      { type: 'update', method: 'PUT', url: targetAssessmentUrl(uuid), id: uuid, context } :
      { type: 'create', method: 'POST', url: API.assessment, context };
    if (!c.existingMode) state.lastAssessmentPayload = assessmentPayload(c, state.createdQuestions);
    // No modo de atualização, os UUIDs já criados ficam pendentes antes de
    // reconsultar a prova. Uma falha de rede não exigirá recriar as questões.
    await persistPendingAssessment();
    setProgress(state.parsed.length, state.parsed.length,
      c.existingMode ? 'Atualizando prova...' : 'Criando prova...');
    try {
      await submitAssessmentOperation(c);
    } catch (e) {
      await persistPendingAssessment();
      await saveRunHistory(c.existingMode ? 'update_failed' : 'assessment_failed', c, e);
      log('Falha na aplicação: ' + e.message, 'error');
      log('As ' + state.createdQuestions.length + ' questões já existem. Use “Reenviar só a prova” para não duplicá-las.', 'warn');
      throw e;
    }
  } catch (e) {
    if (!state.pendingOperation) await saveRunHistory('question_failed', c, e);
    throw e;
  }
}

async function inspectPendingAssessment() {
  const operation = state.pendingOperation;
  if (operation?.type !== 'update' || !state.createdQuestions.length) {
    throw new Error('Não há questões pendentes de vinculação a uma prova existente.');
  }
  const detail = await fetchExistingAssessment(operation.id);
  const identifiers = new Set(detail.questoes.map(q => EClassFeatures.questionId(q)));
  const pending = [...new Set(expectedQuestionIds())];
  const linked = pending.filter(uuid => identifiers.has(uuid));
  const missing = pending.filter(uuid => !identifiers.has(uuid));
  const subjects = new Map();
  for (const question of state.createdQuestions) {
    const key = String(question.padrao_disciplina?.descricao || question.padrao_disciplina_id || 'desconhecida');
    subjects.set(key, (subjects.get(key) || 0) + 1);
  }
  const stateLabel = linked.length + '/' + pending.length +
    ' questão(ões) pendente(s) vinculada(s) à avaliação.';
  const text = stateLabel +
    (missing.length ? ' Restam ' + missing.length +
      ' já criada(s), mas ainda não vinculada(s). NÃO use “Adicionar questões” para recriá-las.' :
      ' Todas aparecem na avaliação; não é necessário repetir a vinculação.') +
    ' Distribuição das questões criadas: ' +
    [...subjects].map(([subject, count]) => subject + ': ' + count).join(', ') + '.';
  $('pendingInspectionStatus').textContent = text;
  log('Diagnóstico sem gravação: ' + text, missing.length ? 'warn' : 'ok');
  return { linked: linked.length, total: pending.length, missing: missing.length };
}

async function retryAssessment() {
  if (!state.createdQuestions.length) throw new Error('Não há questões pendentes.');
  if (!state.lastAssessmentPayload && state.pendingOperation?.type !== 'update') {
    throw new Error('Não há payload de prova pendente nesta sessão.');
  }
  if (!tokenForRequest()) await detectSession();
  if (!tokenForRequest()) throw new Error('Sessão indisponível.');
  const c = formConfig();
  const operation = state.pendingOperation || { type: 'create', method: 'POST', url: API.assessment };
  if (operation.context && ['entityId', 'profileId', 'academicYear'].some(key =>
    Number(operation.context[key]) !== Number(c[key]))) {
    throw new Error('O contexto do portal mudou desde a pendência. Volte à mesma entidade, perfil e ano antes de reenviar.');
  }
  const title = state.lastAssessmentPayload?.avaliacao?.titulo || operation.id || c.title;
  const ok = confirm('Reenviar a operação de ' + (operation.type === 'update' ? 'atualização' : 'criação') +
    ' da prova “' + title + '”, reutilizando ' + state.createdQuestions.length + ' questões já criadas?');
  if (!ok) return;
  log('Reenviando ' + operation.method + ' ' + operation.url + '...');
  try {
    await submitAssessmentOperation(c);
  } catch (e) {
    await persistPendingAssessment();
    await saveRunHistory('retry_failed', c, e);
    throw e;
  }
}
