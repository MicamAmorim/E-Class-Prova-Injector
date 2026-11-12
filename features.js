(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EClassFeatures = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FIGURE_RE = /\bTAGFIGURAAQUI(?:[_-]?\d+)?\b/g;
  const SAFE_IMAGE_RE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/i;

  function figureTags(q) {
    const text = [q.stem, ...(q.choices || [])].join('\n');
    return [...new Set(text.match(FIGURE_RE) || [])];
  }

  function replaceFigureTags(html, images, questionNumber) {
    return String(html).replace(FIGURE_RE, tag => {
      const src = images && images[tag];
      if (!src) throw new Error('Q' + questionNumber + ': associe uma figura à tag ' + tag + '.');
      if (!(SAFE_IMAGE_RE.test(src) || /^https:\/\//i.test(src))) {
        throw new Error('Q' + questionNumber + ': URL de figura inválida para ' + tag + '.');
      }
      const safeSrc = src.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      return '<img src="' + safeSrc + '" alt="Figura da questão ' + Number(questionNumber) + '" style="max-width:100%;height:auto;display:block;margin:12px auto">';
    });
  }

  function extractRows(response) {
    const seen = new Set();
    const queue = [response];
    while (queue.length) {
      const value = queue.shift();
      if (Array.isArray(value)) return value;
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      for (const key of ['data', 'items', 'results', 'rows', 'avaliacoes', 'aplicacoes', 'assessments']) {
        if (value[key] != null) queue.push(value[key]);
      }
    }
    return [];
  }

  function assessmentRecord(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const item = raw.data && !Array.isArray(raw.data) && typeof raw.data === 'object' ? raw.data : raw;
    const app = item.aplicacao || item;
    const exam = item.avaliacao || item;
    const id = app.uuid || exam.uuid || item.uuid || item.id;
    if (!id) return null;
    const date = app.created_at || exam.created_at || item.created_at ||
      app.data_criacao || exam.data_criacao || item.data_criacao ||
      app.createdAt || exam.createdAt || item.createdAt || '';
    const title = exam.titulo || item.titulo || item.title || 'Prova ' + id;
    return { id: String(id), title: String(title), date: String(date), raw: item };
  }

  function withinDays(record, days, now = new Date()) {
    if (!record.date) return false;
    let parsed;
    const br = String(record.date).match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
    if (br) {
      parsed = new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]), Number(br[4] || 0), Number(br[5] || 0));
    } else {
      parsed = new Date(record.date.replace(' ', 'T'));
    }
    if (Number.isNaN(parsed.getTime())) return false;
    const delta = now.getTime() - parsed.getTime();
    return delta >= 0 && delta <= days * 86400000;
  }

  // GET /api/v1/avaliacao retorna {ret, data: {data: [...], last_page, ...}}.
  // Cada avaliação pode ter mais de uma aplicação. O UUID usado em
  // /api/v1/aplicacao-avaliacao/{uuid} pertence à aplicação, não à avaliação.
  function assessmentListPage(response) {
    const envelope = response && response.data && !Array.isArray(response.data) ? response.data : response;
    if (!envelope || !Array.isArray(envelope.data)) {
      throw new Error('Formato inesperado da listagem de avaliações.');
    }
    return {
      rows: envelope.data,
      currentPage: Number(envelope.current_page || 1),
      lastPage: Number(envelope.last_page || 1),
      total: Number(envelope.total || envelope.data.length)
    };
  }

  function applicationCandidates(rows) {
    const options = [];
    for (const exam of rows || []) {
      if (!exam || !Array.isArray(exam.aplicacoes)) continue;
      for (const app of exam.aplicacoes) {
        if (!app || !app.uuid) continue;
        options.push({
          id: String(app.uuid),
          evaluationId: String(exam.uuid || ''),
          title: String(exam.titulo || 'Prova sem título'),
          scheduledDate: String(app.data_inicio || exam.aplicacoes_min_data_inicio || ''),
          status: app.status,
          ended: app.encerrada,
          attempts: app.tentativa_count,
          raw: app
        });
      }
    }
    return options;
  }

  function detailPayload(response) {
    const value = response && response.data ? response.data : response;
    if (!value || typeof value !== 'object') return null;
    if (value.aplicacao && value.avaliacao && Array.isArray(value.questoes)) return value;

    // Forma comprovada pelo HAR: data = { uuid, created_at, publico_alvo,
    // avaliacao: { uuid, questoes: [...] }, ...dadosDaAplicacao }.
    if (value.avaliacao && typeof value.avaliacao === 'object' &&
        Array.isArray(value.avaliacao.questoes) && value.uuid) {
      const { avaliacao, ...aplicacao } = value;
      return { aplicacao, avaliacao, questoes: avaliacao.questoes };
    }
    return null;
  }

  // Os destinatários pertencem à APLICAÇÃO já criada, não à seleção
  // local de turmas do professor. O HAR comprova publico_alvo com turma_id
  // e metadados para cada turma; preserve os objetos completos sem reescrever.
  function assessmentAudience(detail) {
    const app = detail?.aplicacao || detail;
    if (!app || !Array.isArray(app.publico_alvo)) {
      return { verified: false, classes: [], classIds: [], entries: [], hasIndividuals: false };
    }
    const classes = [];
    const seen = new Set();
    let hasIndividuals = false;
    for (const entry of app.publico_alvo) {
      if (!entry || typeof entry !== 'object') continue;
      const id = Number(entry.turma_id ?? entry.turma?.id);
      if (entry.user_id != null || entry.aluno_id != null) hasIndividuals = true;
      if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) continue;
      seen.add(id);
      classes.push({
        id,
        name: String(entry.turma?.descricao || entry.turma?.cod_turma || id),
        count: Number.isFinite(Number(entry.total_publico_alvo)) ?
          Number(entry.total_publico_alvo) : null
      });
    }
    return {
      verified: true,
      classes,
      classIds: classes.map(item => item.id),
      entries: app.publico_alvo,
      hasIndividuals
    };
  }

  function coauthorGrant(detail, userId, now = new Date()) {
    const app = detail?.aplicacao || detail || {};
    const exam = detail?.avaliacao || app.avaliacao || {};
    const uid = Number(userId);
    const matched = Number.isSafeInteger(uid) && uid > 0 ?
      (app.coautores || []).filter(x => Number(x?.user_id) === uid) : [];
    const eligible = matched.filter(x => {
      if (!x.data_limite) return true;
      const end = new Date(String(x.data_limite).replace(' ', 'T'));
      return !Number.isNaN(end.getTime()) && end >= now;
    });
    // O portal soma a quantidade por disciplina para o limite do coautor.
    // As disciplinas continuam explícitas para não confundir 15+5 com
    // autorização para inserir 20 questões de uma única disciplina.
    const total = eligible.some(x => x.qtd_questoes == null) ? null :
      eligible.reduce((sum, x) => sum + Math.max(0, Number(x.qtd_questoes) || 0), 0);
    const existing = (exam.questoes || []).filter(q => Number(q?.criado_por) === uid).length;
    return {
      matched: matched.length > 0,
      valid: eligible.length > 0,
      expired: matched.length > 0 && eligible.length === 0,
      assignments: eligible.map(x => ({
        subjectId: x.padrao_disciplina_id == null ? null : Number(x.padrao_disciplina_id),
        subjectName: String(x.padrao_disciplina?.descricao || x.padrao_disciplina_id || 'Geral'),
        limit: x.qtd_questoes == null ? null : Number(x.qtd_questoes),
        deadline: String(x.data_limite || '')
      })),
      totalLimit: total,
      alreadyIncluded: existing,
      remaining: total == null ? null : Math.max(0, total - existing)
    };
  }

  function assessmentCalendar(detail) {
    const app = detail?.aplicacao || detail || {};
    const asDate = value => {
      if (!value) return '';
      const candidate = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
      return candidate && !Number.isNaN(new Date(candidate[1] + 'T12:00:00').getTime()) ?
        candidate[1] : '';
    };
    const termId = app.bimestre_id ?? app.bimestre?.id ?? detail?.avaliacao?.bimestre_id ?? null;
    return {
      startDate: asDate(app.data_inicio),
      resultDate: asDate(app.data_resultado),
      termId: termId == null || termId === '' ? null : Number(termId),
      termNumber: app.bimestre_n ?? app.bimestre?.numero ?? null,
      termName: String(app.bimestre?.descricao || app.bimestre?.nome || ''),
      fromPortal: true
    };
  }

  function coauthorSubjectPlan(detail, userId, questions, now = new Date()) {
    const grant = coauthorGrant(detail, userId, now);
    if (!grant.valid) {
      return { valid: false, reason: grant.expired ?
        'A atribuição de coautoria está vencida.' :
        'Não há atribuição de coautoria ativa para esta conta.', entries: [], assignments: [] };
    }
    const existing = Array.isArray(detail?.questoes) ? detail.questoes :
      Array.isArray(detail?.avaliacao?.questoes) ? detail.avaliacao.questoes : [];
    const uid = Number(userId);
    const grouped = new Map();
    for (const assignment of grant.assignments) {
      const subjectId = Number(assignment.subjectId);
      if (!Number.isSafeInteger(subjectId) || subjectId <= 0) {
        return { valid: false, reason: 'Coautoria sem identificador de disciplina. Distribuição automática indisponível.',
          entries: [], assignments: [] };
      }
      if (!grouped.has(subjectId)) {
        grouped.set(subjectId, {
          subjectId,
          subjectName: assignment.subjectName,
          limit: 0,
          unlimited: false,
          alreadyLinked: 0
        });
      }
      const group = grouped.get(subjectId);
      if (assignment.limit == null) group.unlimited = true;
      else group.limit += Math.max(0, assignment.limit);
    }
    const assignments = [...grouped.values()];
    for (const group of assignments) {
      group.alreadyLinked = existing.filter(q => {
        const author = q.criado_por ?? q.dadosGerais?.criado_por ?? q.user_id;
        const discipline = q.padrao_disciplina_id ?? q.dadosGerais?.padrao_disciplina_id;
        return Number(author) === uid && Number(discipline) === group.subjectId;
      }).length;
      group.remaining = group.unlimited ? null : Math.max(0, group.limit - group.alreadyLinked);
      if (group.unlimited) group.limit = null;
      delete group.unlimited;
    }
    const source = Array.isArray(questions) ? questions : [];
    const entries = [];
    for (const group of assignments) {
      const available = group.remaining == null ? source.length - entries.length :
        Math.min(source.length - entries.length, group.remaining);
      for (let i = 0; i < available; i++) {
        const question = source[entries.length];
        entries.push({
          number: question.number,
          subjectId: group.subjectId,
          subjectName: group.subjectName
        });
      }
      if (entries.length === source.length) break;
    }
    if (entries.length < source.length) {
      return {
        valid: false, assignments, entries,
        reason: 'A prova contém ' + source.length + ' questões, mas a soma das cotas disponíveis ' +
          'por disciplina é insuficiente. Restam ' + (source.length - entries.length) +
          ' questão(ões) sem disciplina autorizada.'
      };
    }
    return { valid: true, assignments, entries,
      mapping: Object.fromEntries(entries.map(q => [String(q.number), q.subjectId])) };
  }

  function existingSubjectPlan(detail, userId, questions, now = new Date()) {
    const grant = coauthorGrant(detail, userId, now);
    if (grant.valid) return coauthorSubjectPlan(detail, userId, questions, now);
    const app = detail?.aplicacao || detail || {};
    if (app.is_owner !== true) return coauthorSubjectPlan(detail, userId, questions, now);
    const exam = detail?.avaliacao || app.avaliacao || {};
    const source = exam.avaliacao_disciplinas || [];
    const raw = Array.isArray(source) && source.length ?
      source.map(x => x && typeof x === 'object' ? x.padrao_disciplina_id : x) :
      [exam.padrao_disciplina_id].filter(x => x != null);
    const ids = [...new Set(raw.map(Number).filter(x => Number.isSafeInteger(x) && x > 0))];
    if (ids.length !== 1) {
      return { valid: false, entries: [], assignments: [],
        reason: ids.length > 1 ?
          'A prova do proprietário tem várias disciplinas, mas nenhuma cota por questão; não é seguro escolher automaticamente.' :
          'A disciplina original da prova não foi identificada.' };
    }
    const id = ids[0];
    const name = String(exam.avaliacao_disciplinas?.find(x =>
      Number(x?.padrao_disciplina_id) === id)?.padrao_disciplina?.descricao || id);
    const entries = (questions || []).map(q => ({ number: q.number, subjectId: id, subjectName: name }));
    return {
      valid: true,
      assignments: [{ subjectId: id, subjectName: name, limit: null, remaining: null, alreadyLinked: null }],
      entries,
      mapping: Object.fromEntries(entries.map(q => [String(q.number), id]))
    };
  }

  function assessmentPermissions(detail, userId, now = new Date()) {
    const app = detail?.aplicacao || detail || {};
    const exam = detail?.avaliacao || app.avaliacao || {};
    const active = isAssessmentActive(detail?.aplicacao ? detail : {
      aplicacao: app, avaliacao: exam
    });
    const explicitAudience = app.can_edit_publico_alvo === true ||
      app.pode_editar_publico_alvo === true ||
      app.permissions?.can_edit_publico_alvo === true;
    const explicitQuestions = app.can_edit_questoes === true ||
      app.pode_editar_questoes === true ||
      app.permissions?.can_edit_questoes === true;
    const coauthor = coauthorGrant(detail, userId, now);
    return {
      active,
      isOwner: app.is_owner === true,
      isOwnerKnown: typeof app.is_owner === 'boolean',
      isCoauthor: !active && coauthor.valid,
      coauthor,
      canChangeClasses: !active && explicitAudience,
      canEditQuestions: !active &&
        (app.is_owner === true || explicitQuestions || coauthor.valid),
      audiencePermissionVerified: explicitAudience,
      questionPermissionVerified: explicitQuestions || coauthor.valid
    };
  }

  // Esta é a forma observada no JavaScript do editor oficial salvo no HAR:
  // {aplicacao, avaliacao, questoes, entidade, questoesIncluidas, questoesRemovidas}.
  // O público-alvo é projetado para os mesmos campos que o editor envia.
  function portalUpdatePayload(detail, incoming, config, weightFn) {
    if (!detail?.aplicacao || !detail?.avaliacao ||
        !Array.isArray(detail.questoes) || !Array.isArray(detail.aplicacao.publico_alvo)) {
      throw new Error('Não foi possível reconstruir os dados oficiais da aplicação.');
    }
    const merged = mergeAssessment(detail, incoming, weightFn);
    assertUnchangedAudience(detail, merged);
    const original = detail.aplicacao.publico_alvo;
    const publico_alvo = original.map(rec => {
      const entityId = rec.entidade_id ?? rec.turma?.entidade?.id ??
        rec.user?.entidade?.id ?? config.entityId;
      if ((rec.turma_id == null && rec.user_id == null && rec.padrao_serie_id == null) ||
          !Number.isSafeInteger(Number(entityId)) || Number(entityId) <= 0) {
        throw new Error('Destinatário inválido; não é seguro alterar esta aplicação.');
      }
      return {
        turma_id: rec.turma_id ?? null,
        user_id: rec.user_id ?? null,
        padrao_serie_id: rec.padrao_serie_id ?? null,
        entidade_id: Number(entityId)
      };
    });
    if (publico_alvo.length !== original.length ||
        publico_alvo.some((x, i) =>
          String(x.turma_id) !== String(original[i].turma_id ?? null) ||
          String(x.user_id) !== String(original[i].user_id ?? null) ||
          String(x.padrao_serie_id) !== String(original[i].padrao_serie_id ?? null))) {
      throw new Error('A atualização mudou a identidade dos destinatários.');
    }
    const app = { ...merged.aplicacao, publico_alvo };
    if (Array.isArray(app.disciplina_opcionais)) {
      app.disciplina_opcionais = app.disciplina_opcionais.map(x =>
        x && typeof x === 'object' ? x.padrao_disciplina_id : x).filter(x => x != null);
    }
    delete app.entidades;
    delete app.avaliacao;
    const avaliacao = { ...merged.avaliacao };
    delete avaliacao.questoes;
    if (Array.isArray(avaliacao.avaliacao_disciplinas)) {
      avaliacao.avaliacao_disciplinas = avaliacao.avaliacao_disciplinas
        .map(x => x && typeof x === 'object' ? x.padrao_disciplina_id : x)
        .filter(x => x != null);
    }
    const includedIds = new Set(incoming.map(questionId));
    const questoesIncluidas = merged.questoes.filter(q => includedIds.has(questionId(q)) &&
      !detail.questoes.some(old => questionId(old) === questionId(q)));
    return {
      aplicacao: app,
      avaliacao,
      questoes: merged.questoes,
      entidade: {
        id: Number(config.entityId),
        nome: String(config.entityName),
        tipo: Number(config.entityType),
        externo: false
      },
      questoesIncluidas,
      questoesRemovidas: []
    };
  }

  function assertUnchangedAudience(before, after) {
    const original = before?.aplicacao?.publico_alvo;
    const updated = after?.aplicacao?.publico_alvo;
    if (!Array.isArray(original) || JSON.stringify(original) !== JSON.stringify(updated)) {
      throw new Error('A atualização tentou alterar o público-alvo da aplicação; operação bloqueada.');
    }
  }

  function isAssessmentActive(detail) {
    const app = detail.aplicacao || {};
    const exam = detail.avaliacao || {};
    const responseCounts = [
      app.total_respostas, app.qtd_respostas, app.quantidade_respostas,
      app.tentativa_count,
      exam.total_respostas, detail.total_respostas
    ];
    return app.status === true || app.status === 1 || app.encerrada === true || app.encerrada === 1 ||
      responseCounts.some(n => Number(n) > 0) ||
      (Array.isArray(detail.respostas) && detail.respostas.length > 0);
  }

  function questionId(q) {
    return String(q.uuid || q.id || q.code || '').trim();
  }

  function mergeAssessment(detail, incoming, weightFn) {
    if (!detailPayload(detail)) throw new Error('O detalhe da prova não tem aplicação, avaliação e lista de questões completas.');
    if (isAssessmentActive(detail)) throw new Error('A prova está ativa ou possui respostas. Não é seguro alterar as questões.');
    if (!Array.isArray(incoming) || !incoming.length) throw new Error('Não há novas questões para adicionar.');
    const existing = detail.questoes;
    if (existing.some(q => !questionId(q))) throw new Error('O retorno da prova possui questões sem identificador; atualização bloqueada.');
    if (incoming.some(q => !questionId(q))) throw new Error('As novas questões possuem IDs inválidos.');
    const ids = new Set(existing.map(questionId));
    const combined = [...existing];
    for (const q of incoming) {
      const id = questionId(q);
      if (!ids.has(id)) { ids.add(id); combined.push(q); }
    }
    const weights = weightFn(combined.length);
    const result = JSON.parse(JSON.stringify(detail));
    result.questoes = combined.map((q, i) => ({ ...q, peso: weights[i] }));
    if (detail.aplicacao?.publico_alvo != null) assertUnchangedAudience(detail, result);
    return result;
  }

  function studentsFromClasses(classes) {
    const result = [];
    for (const group of classes || []) {
      const classId = Number(group.id || group.turma_id);
      const collection = group.alunos || group.students || group.estudantes || group.matriculas || [];
      for (const s of Array.isArray(collection) ? collection : []) {
        const id = s.aluno_id || s.student_id || s.id || s.aluno?.id || s.student?.id;
        const name = s.nome || s.name || s.aluno?.nome || s.student?.name || '';
        if (classId && id) result.push({ classId, id: String(id), name: String(name || id) });
      }
    }
    return result;
  }

  function makeIndividualAudience(config, students, template) {
    if (!Array.isArray(students) || !students.length) throw new Error('Escolha pelo menos um aluno.');
    if (!template || typeof template !== 'object' || Array.isArray(template)) {
      throw new Error('É necessário informar o modelo de público individual validado no E-Class.');
    }
    const chosen = new Set(config.classes.map(Number));
    const byClass = new Map();
    for (const item of students) {
      const classId = Number(item.classId);
      const studentId = Number(item.id);
      if (!chosen.has(classId) || !Number.isSafeInteger(studentId) || studentId <= 0) {
        throw new Error('Aluno inválido ou pertencente a uma turma não selecionada.');
      }
      if (!byClass.has(classId)) byClass.set(classId, new Set());
      byClass.get(classId).add(studentId);
    }
    const stringified = JSON.stringify(template);
    if (!stringified.includes('{{alunos_ids}}') && !stringified.includes('{{alunos_objetos}}')) {
      throw new Error('O modelo deve conter {{alunos_ids}} ou {{alunos_objetos}} para restringir os destinatários.');
    }
    function substitute(node, vars) {
      if (Array.isArray(node)) return node.map(x => substitute(x, vars));
      if (node && typeof node === 'object') {
        return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, substitute(v, vars)]));
      }
      if (typeof node === 'string' && Object.prototype.hasOwnProperty.call(vars, node)) return vars[node];
      return node;
    }
    return [...byClass].map(([classId, ids]) => substitute(template, {
      '{{turma_id}}': classId,
      '{{entidade_id}}': config.entityId,
      '{{alunos_ids}}': [...ids],
      '{{alunos_objetos}}': [...ids].map(aluno_id => ({ aluno_id }))
    }));
  }

  return {
    figureTags, replaceFigureTags, extractRows, assessmentRecord,
    withinDays, detailPayload, isAssessmentActive, mergeAssessment,
    studentsFromClasses, makeIndividualAudience, questionId,
    assessmentListPage, applicationCandidates,
    assessmentAudience, assessmentPermissions, assessmentCalendar,
    coauthorGrant, coauthorSubjectPlan, existingSubjectPlan, portalUpdatePayload, assertUnchangedAudience
  };
});