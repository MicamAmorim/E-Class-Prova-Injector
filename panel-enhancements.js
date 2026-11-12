'use strict';

// Complementos da interface: figuras por marcador, público individual e provas existentes.
// Nenhum nome de aluno ou arquivo de imagem é salvo no armazenamento da extensão.
state.figureBindings = {};
state.remote.students = [];
state.pendingOperation = null;

function questionImages(q) {
  return state.figureBindings[q.number] || (state.figureBindings[q.number] = {});
}

function renderFigurePreview(q, card) {
  const images = questionImages(q);
  function renderFragment(el, input) {
    const refs = EClassImageImport.imageReferences(input);
    el.replaceChildren();
    let start = 0;
    for (const ref of refs) {
      el.appendChild(document.createTextNode(String(input).slice(start, ref.start)));
      const src = images[ref.key];
      if (src) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = 'Figura ' + ref.label + ' da questão ' + q.number;
        img.className = 'inline-figure';
        el.appendChild(img);
      } else {
        const mark = document.createElement('strong');
        mark.className = 'missing-figure';
        mark.textContent = '[' + ref.label + ': figura pendente]';
        el.appendChild(mark);
      }
      start = ref.end;
    }
    el.appendChild(document.createTextNode(String(input).slice(start)));
  }

  function refresh() {
    renderFragment(card.querySelector('.qraw'), q.stem);
    card.querySelectorAll('ol li').forEach((li, i) => renderFragment(li, q.choices[i]));
  }

  const references = EClassImageImport.allImageReferences(q);
  if (references.length) {
    const box = document.createElement('div');
    box.className = 'figures-box';
    const caption = document.createElement('p');
    caption.className = 'hint';
    caption.textContent = 'Imagens encontradas na pasta são carregadas automaticamente. Você pode substituir qualquer uma por arquivo manual ou URL HTTPS.';
    box.appendChild(caption);
    for (const ref of references) {
      const tag = ref.key;
      const row = document.createElement('div');
      row.className = 'figure-row';
      const heading = document.createElement('strong');
      heading.textContent = ref.label;
      const status = document.createElement('span');
      status.className = 'hint';
      const file = document.createElement('input');
      file.type = 'file';
      file.accept = 'image/png,image/jpeg,image/webp,image/gif';
      file.setAttribute('aria-label', 'Enviar figura para ' + ref.label + ' da questão ' + q.number);
      const url = document.createElement('input');
      url.type = 'url';
      url.placeholder = 'ou URL HTTPS da figura';
      url.setAttribute('aria-label', 'URL para ' + ref.label + ' da questão ' + q.number);
      if (images[tag]?.startsWith('https://')) url.value = images[tag];

      function updateStatus() {
        status.textContent = images[tag] ? 'Imagem vinculada (pode substituir)' : 'Aguardando imagem';
      }

      file.addEventListener('change', async () => {
        const selected = file.files && file.files[0];
        if (!selected) return;
        try {
          const source = await localImageData({
            file: selected,
            relativePath: 'manual/' + crypto.randomUUID() + '/' + selected.name
          });
          images[tag] = source;
          url.value = '';
          updateStatus();
          refresh();
          log('Q' + q.number + ': imagem manual associada a ' + ref.label + '.', 'ok');
        } catch (error) {
          log('Q' + q.number + ': ' + error.message, 'error');
          file.value = '';
        }
      });
      url.addEventListener('change', () => {
        const value = url.value.trim();
        if (value && !/^https:\/\//i.test(value)) {
          log('A URL da figura deve começar com https://.', 'error');
          return;
        }
        if (value) images[tag] = value;
        else delete images[tag];
        updateStatus();
        refresh();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ghost small';
      remove.textContent = 'Remover';
      remove.addEventListener('click', () => {
        delete images[tag];
        file.value = '';
        url.value = '';
        updateStatus();
        refresh();
      });
      updateStatus();
      row.append(heading, status, file, url, remove);
      box.appendChild(row);
    }
    card.appendChild(box);
  }
  refresh();
}

function collectSelectedStudents() {
  const picked = [...document.querySelectorAll('.studentCheck:checked')].map(el => {
    const [classId, id] = el.value.split(':');
    return { classId: Number(classId), id: String(id) };
  });
  const manual = $('studentIds').value.trim();
  if (manual) {
    const selectedClasses = [...document.querySelectorAll('.classCheck:checked')].map(el => Number(el.value));
    for (const line of manual.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)) {
      const fields = line.split(/[;:]/).map(s => s.trim());
      let classId, id;
      if (fields.length === 1 && selectedClasses.length === 1) {
        classId = selectedClasses[0];
        id = fields[0];
      } else if (fields.length >= 2) {
        [classId, id] = fields;
      } else {
        throw new Error('Informe turma_id;aluno_id em cada linha ou escolha uma única turma.');
      }
      if (!/^\d+$/.test(String(classId)) || !/^\d+$/.test(String(id))) {
        throw new Error('Os identificadores de turmas e alunos devem ser numéricos.');
      }
      picked.push({ classId: Number(classId), id: String(id) });
    }
  }
  const unique = new Map();
  for (const p of picked) unique.set(p.classId + ':' + p.id, p);
  return [...unique.values()];
}

function renderStudentRoster() {
  const classes = new Set([...document.querySelectorAll('.classCheck:checked')].map(el => Number(el.value)));
  const selected = new Set([...document.querySelectorAll('.studentCheck:checked')].map(el => el.value));
  const available = (state.remote.students || []).filter(s => classes.has(s.classId));
  $('studentRoster').replaceChildren();
  for (const s of available) {
    const label = document.createElement('label');
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'studentCheck';
    check.value = s.classId + ':' + s.id;
    check.checked = selected.has(check.value);
    label.append(check, document.createTextNode(' ' + s.name + ' (' + s.classId + ')'));
    $('studentRoster').appendChild(label);
  }
  $('studentRosterStatus').textContent = available.length ?
    available.length + ' alunos encontrados nos dados das turmas.' :
    'O retorno de turmas não trouxe matrículas individuais. Informe os IDs abaixo.';
}

function toggleModes() {
  $('studentsArea').classList.toggle('hidden', !$('specificStudents').checked);
  const existing = $('useExistingAssessment').checked;
  $('existingArea').classList.toggle('hidden', !existing);
  $('newAssessmentFields').classList.toggle('hidden', existing);
  $('specificStudents').disabled = existing;
  $('onlyQuestions').disabled = existing;
  if (existing) {
    $('specificStudents').checked = false;
    $('studentsArea').classList.add('hidden');
    $('onlyQuestions').checked = false;
  }
  $('inject').textContent = existing ? 'Adicionar questões à prova' : 'Criar no E-Class';
}

function studentAudienceTemplate() {
  const raw = $('studentAudienceTemplate').value.trim();
  if (!raw) return null;
  try { return JSON.parse(raw); }
  catch (_) { throw new Error('O modelo JSON do público individual é inválido.'); }
}

function composeAudience(config) {
  if (!config.specificStudents) {
    return config.classes.map(id => ({ turma_id: id, entidade_id: config.entityId }));
  }
  return EClassFeatures.makeIndividualAudience(config, config.students, studentAudienceTemplate());
}

function normalizeAssessmentDetail(response) {
  return EClassFeatures.detailPayload(response);
}

function targetAssessmentUrl(id) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(String(id))) throw new Error('ID de prova inválido.');
  return API.assessment + '/' + encodeURIComponent(id);
}

function targetAssessmentId() {
  return $('existingAssessmentId').value.trim() || $('existingAssessments').value;
}

async function loadExistingAssessments() {
  if (!tokenForRequest()) await detectSession();
  if (!tokenForRequest()) throw new Error('Detecte sua sessão para consultar as provas.');
  const days = Number($('assessmentDays').value);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('Use um período de 1 a 365 dias.');

  const button = $('loadAssessments');
  button.disabled = true;
  const status = $('assessmentListStatus');
  const previousId = targetAssessmentId();
  const c = formConfig();
  const records = new Map();
  let pagesLoaded = 0, totalReturned = 0, detailErrors = 0, withoutDate = 0;
  let listError = null, truncated = false;

  try {
    const collected = [];
    try {
      // O HAR confirma GET /api/v1/avaliacao, com {data: {data: [], last_page}}.
      for (let page = 1; page <= 30; page++) {
        status.textContent = 'Consultando página ' + page + ' de avaliações...';
        const response = await apiFetch(API.assessmentList(c, page, 25), { headers: portalHeaders(false) });
        const result = EClassFeatures.assessmentListPage(response);
        if (result.currentPage !== page) throw new Error('O servidor retornou uma página diferente da solicitada.');
        pagesLoaded++;
        totalReturned = result.total;
        collected.push(...EClassFeatures.applicationCandidates(result.rows));
        if (page >= result.lastPage) break;
        if (page === 30) truncated = true;
      }
    } catch (e) {
      listError = e;
      log('Não foi possível concluir a consulta das avaliações: ' + e.message, 'warn');
    }

    const candidates = [...new Map(collected.map(a => [a.id, a])).values()];
    status.textContent = candidates.length + ' aplicações encontradas. Verificando datas de criação...';

    // A resposta da lista não tem created_at. GET da aplicação retorna a
    // data de criação e permite aplicar corretamente o filtro de N dias.
    const batchSize = 4;
    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize);
      await Promise.all(batch.map(async candidate => {
        try {
          const response = await apiFetch(targetAssessmentUrl(candidate.id), { headers: portalHeaders(false) });
          const raw = response && response.data ? response.data : response;
          if (String(raw?.uuid || '') !== candidate.id) throw new Error('O detalhe não corresponde à aplicação.');
          const date = raw.created_at || raw.data_criacao || '';
          if (!date) { withoutDate++; return; }
          const rec = {
            id: candidate.id, title: candidate.title,
            date: String(date), scheduledDate: candidate.scheduledDate,
            active: EClassFeatures.isAssessmentActive(
              EClassFeatures.detailPayload(response) || { aplicacao: raw, avaliacao: {} }
            )
          };
          if (EClassFeatures.withinDays(rec, days)) records.set(rec.id, rec);
        } catch (_) { detailErrors++; }
      }));
      status.textContent = 'Verificando criação: ' + Math.min(i + batchSize, candidates.length) +
        '/' + candidates.length + ' aplicações...';
    }

    // Fallback histórico: os dados salvos podem ser de uma versão anterior
    // da extensão. A consulta real, quando disponível, tem precedência.
    const { eciHistory = [] } = await chrome.storage.local.get({ eciHistory: [] });
    for (const run of eciHistory) {
      const rec = EClassFeatures.assessmentRecord(run.assessmentResponse);
      if (rec && !records.has(rec.id) &&
          EClassFeatures.withinDays({ ...rec, date: run.at || rec.date }, days)) {
        records.set(rec.id, { ...rec, date: run.at || rec.date, historyOnly: true });
      }
    }

    const list = [...records.values()].sort((a, b) => b.date.localeCompare(a.date));
    $('existingAssessments').replaceChildren(new Option('Selecione uma prova', ''));
    for (const rec of list) {
      const dateValue = new Date(rec.date.replace(' ', 'T'));
      const humanDate = Number.isNaN(dateValue.getTime()) ? rec.date.slice(0, 10) :
        dateValue.toLocaleDateString('pt-BR');
      const label = rec.title + ' · criada em ' + humanDate +
        (rec.active ? ' · ATIVA (edição bloqueada)' : '') +
        (rec.historyOnly ? ' · histórico local' : '');
      const option = new Option(label, rec.id);
      option.disabled = Boolean(rec.active);
      $('existingAssessments').add(option);
      if (rec.id === previousId && !rec.active) option.selected = true;
    }

    const warnings = [];
    if (truncated) warnings.push('resultado limitado às primeiras 30 páginas');
    if (listError) warnings.push('falha parcial/total na consulta de páginas');
    if (detailErrors) warnings.push(detailErrors + ' detalhe(s) não acessíveis');
    if (withoutDate) warnings.push(withoutDate + ' aplicação(ões) sem data de criação');
    status.textContent = list.length + ' prova(s) criada(s) nos últimos ' + days +
      ' dias · ' + pagesLoaded + ' página(s), ' + totalReturned + ' avaliação(ões) no portal' +
      (warnings.length ? ' · ' + warnings.join('; ') : '') + '.';
    log(status.textContent, warnings.length ? 'warn' : 'ok');
  } finally {
    button.disabled = false;
  }
}

function validateEnhancements(c) {
  for (const q of state.parsed) {
    const bindings = questionImages(q);
    for (const ref of EClassImageImport.allImageReferences(q)) {
      if (!bindings[ref.key]) throw new Error('Q' + q.number + ': imagem pendente em ' + ref.label + '.');
      EClassImageImport.replaceImageTokens('@@ECIIMAGE0@@', [ref], bindings, q.number);
    }
  }
  const totalInline = Object.values(state.figureBindings).flatMap(group => Object.values(group))
    .filter(src => src.startsWith('data:')).reduce((sum, src) => sum + src.length, 0);
  if (totalInline > 3500000) {
    throw new Error('As figuras embutidas ultrapassam 3,5 MB em base64. Reduza ou use URLs HTTPS.');
  }
  if (c.existingMode) {
    if (c.onlyQuestions || c.specificStudents) throw new Error('Modo de atualização é incompatível com os outros modos.');
    if (!c.targetAssessmentId) throw new Error('Selecione uma prova existente ou informe seu UUID.');
  } else if (c.specificStudents) {
    composeAudience(c); // valida que o modelo impede direcionamento a toda a turma
  }
}

function enhancementsBind() {
  $('specificStudents').addEventListener('change', toggleModes);
  $('useExistingAssessment').addEventListener('change', toggleModes);
  $('classes').addEventListener('change', renderStudentRoster);
  $('loadAssessments').addEventListener('click', () => safe(loadExistingAssessments));
  $('existingAssessments').addEventListener('change', () => {
    $('existingAssessmentId').value = $('existingAssessments').value;
  });
  $('studentAudienceTemplate').addEventListener('change', persistConfig);
  toggleModes();
  renderStudentRoster();
}

function enhancementsFormConfig() {
  return {
    specificStudents: $('specificStudents').checked,
    students: $('specificStudents').checked ? collectSelectedStudents() : [],
    existingMode: $('useExistingAssessment').checked,
    targetAssessmentId: $('useExistingAssessment').checked ? targetAssessmentId() : ''
  };
}