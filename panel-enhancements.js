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

function assessmentErrorBrief(error) {
  const status = Number(error?.status) || 0;
  const firstLine = String(error?.message || error || '').split('\n')[0];
  if (status === 401 || status === 403) return 'HTTP ' + status + ' (sessão/permissão)';
  if (status === 429) return 'HTTP 429 (limite de requisições)';
  if (status) return 'HTTP ' + status;
  return firstLine.replace(/https?:\/\/[^\s]+/g, '[endereço da API]').slice(0, 160);
}

function renderExistingAssessmentChoices(records, selectedId) {
  const list = [...records.values()].sort((a, b) => {
    // Datas de criação confirmadas primeiro, depois itens sem data confirmada.
    if (Boolean(a.date) !== Boolean(b.date)) return a.date ? -1 : 1;
    return String(b.date || b.scheduledDate || '').localeCompare(String(a.date || a.scheduledDate || ''));
  });
  $('existingAssessments').replaceChildren(new Option('Selecione uma prova', ''));
  for (const rec of list) {
    const date = rec.date ? new Date(rec.date.replace(' ', 'T')) : null;
    const humanDate = date && !Number.isNaN(date.getTime()) ?
      date.toLocaleDateString('pt-BR') : (rec.date ? rec.date.slice(0, 10) : '');
    const note = rec.date ? 'criada em ' + humanDate :
      'criação não verificada' + (rec.scheduledDate ? ' · aplicação ' + rec.scheduledDate.slice(0, 10) : '');
    const title = rec.title + ' · ' + note +
      (rec.active ? ' · ATIVA/ENCERRADA (edição bloqueada)' : '') +
      (rec.historyOnly ? ' · histórico local' : '');
    const option = new Option(title, rec.id);
    option.dataset.title = rec.title;
    option.disabled = Boolean(rec.active);
    $('existingAssessments').add(option);
    if (rec.id === selectedId && !rec.active) option.selected = true;
  }
  return list.length;
}

async function loadExistingAssessments() {
  const status = $('assessmentListStatus');
  const button = $('loadAssessments');
  const days = Number($('assessmentDays').value);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    status.textContent = 'Período inválido: informe de 1 a 365 dias.';
    throw new Error(status.textContent);
  }

  button.disabled = true;
  status.textContent = 'Iniciando consulta das avaliações...';
  const selectedId = targetAssessmentId();
  const records = new Map();
  let pagesLoaded = 0, evaluationsFound = 0, detailErrors = 0;
  let filteredOld = 0, unknownDates = 0, listError = null, stoppedForRateLimit = false;
  let noApplicationCount = 0, truncated = false, stopDetailsStatus = 0;
  try {
    if (!tokenForRequest()) {
      await detectSession();
      if (!tokenForRequest()) {
        log('O token não foi encontrado. Tentando consulta SOMENTE DE LEITURA usando o contexto do portal; se houver HTTP 401/403, será necessário autenticar.', 'warn');
      }
    }
    const config = formConfig();
    const candidates = new Map();

    // A listagem é GET /api/v1/avaliacao. Usamos apenas acesso de leitura:
    // no HAR o cabeçalho Bearer pode não estar presente. Escrita continua
    // exigindo autenticação e confirmação separadas.
    try {
      for (let page = 1; page <= 30; page++) {
        status.textContent = 'Buscando avaliações no E-Class · página ' + page + '...';
        const response = await apiFetch(API.assessmentList(config, page, 25), {
          headers: portalHeaders(false, false)
        });
        const result = EClassFeatures.assessmentListPage(response);
        if (result.currentPage !== page) {
          throw new Error('A API retornou a página ' + result.currentPage + ' em vez da ' + page + '.');
        }
        pagesLoaded++;
        evaluationsFound = result.total;
        noApplicationCount += result.rows.filter(x => !Array.isArray(x.aplicacoes) || !x.aplicacoes.length).length;
        for (const item of EClassFeatures.applicationCandidates(result.rows)) {
          candidates.set(item.id, item);
        }
        if (page >= result.lastPage) break;
        if (page === 30) truncated = true;
      }
    } catch (error) {
      listError = assessmentErrorBrief(error);
      log('Listagem E-Class: ' + listError + '. Verifique a sessão, o ano e a entidade.', 'error');
    }

    // Primeiro renderizamos os itens que a API confirmou na LISTAGEM,
    // independentemente da resposta do GET individual de cada aplicação.
    for (const item of candidates.values()) {
      const active = EClassFeatures.isAssessmentActive({
        aplicacao: { status: item.status, encerrada: item.ended, tentativa_count: item.attempts },
        avaliacao: {}
      });
      records.set(item.id, {
        id: item.id, title: item.title,
        scheduledDate: item.scheduledDate, date: '', active
      });
    }
    renderExistingAssessmentChoices(records, selectedId);

    if (!listError && records.size) {
      status.textContent = 'Encontrei ' + records.size + ' aplicações. Conferindo as datas de criação...';
    }

    // A lista não possui created_at. Conferimos as datas em lotes, mas uma
    // falha de GET individual NÃO deve fazer a prova desaparecer do seletor.
    // Sem created_at ela permanece identificada como "não verificada".
    const ids = [...records.keys()];
    const batchSize = 4;
    for (let i = 0; i < ids.length; i += batchSize) {
      if (stoppedForRateLimit || stopDetailsStatus) break;
      const batch = ids.slice(i, i + batchSize);
      await Promise.all(batch.map(async id => {
        const rec = records.get(id);
        if (!rec) return;
        try {
          const response = await apiFetch(targetAssessmentUrl(id), {
            headers: portalHeaders(false, false)
          });
          const raw = response && response.data ? response.data : response;
          if (String(raw?.uuid || '') !== id) throw new Error('UUID incompatível com a aplicação solicitada.');
          const date = raw.created_at || raw.data_criacao || '';
          if (date && EClassFeatures.withinDays({ date: String(date) }, days)) {
            rec.date = String(date);
          } else if (date) {
            records.delete(id);
            filteredOld++;
            return;
          } else {
            unknownDates++;
          }
          rec.active = EClassFeatures.isAssessmentActive(
            EClassFeatures.detailPayload(response) || { aplicacao: raw, avaliacao: {} }
          );
        } catch (error) {
          detailErrors++;
          if (error?.status === 429) stoppedForRateLimit = true;
          if (error?.status === 401 || error?.status === 403) stopDetailsStatus = error.status;
          if (detailErrors <= 4) {
            log('Detalhes de aplicação indisponíveis (' + assessmentErrorBrief(error) +
              '). A prova continua visível, mas não foi verificada.', 'warn');
          }
        }
      }));
      renderExistingAssessmentChoices(records, selectedId);
      status.textContent = 'Conferindo datas: ' + Math.min(i + batchSize, ids.length) +
        '/' + ids.length + ' · ' + records.size + ' prova(s) visível(is)...';
    }

    const { eciHistory = [] } = await chrome.storage.local.get({ eciHistory: [] });
    for (const run of eciHistory) {
      const rec = EClassFeatures.assessmentRecord(run.assessmentResponse);
      if (rec && !records.has(rec.id) &&
          EClassFeatures.withinDays({ ...rec, date: run.at || rec.date }, days)) {
        records.set(rec.id, {
          ...rec, date: run.at || rec.date, historyOnly: true
        });
      }
    }
    const visibleCount = renderExistingAssessmentChoices(records, selectedId);
    const parts = [
      visibleCount + ' aplicação(ões) listada(s)',
      pagesLoaded + ' página(s) consultada(s)',
      evaluationsFound + ' avaliação(ões) no portal'
    ];
    if (filteredOld) parts.push(filteredOld + ' fora dos últimos ' + days + ' dias');
    if (detailErrors) parts.push(detailErrors + ' detalhe(s) não acessível(is), mantidos na lista');
    if (unknownDates) parts.push(unknownDates + ' sem data de criação');
    if (noApplicationCount) parts.push(noApplicationCount + ' avaliação(ões) sem aplicação');
    if (truncated) parts.push('limite de 30 páginas atingido');
    if (stoppedForRateLimit) parts.push('limite HTTP 429, interrompi a verificação');
    if (stopDetailsStatus) parts.push('HTTP ' + stopDetailsStatus + ' nos detalhes; interrompi novas consultas, sem ocultar provas');
    if (listError) parts.push('ERRO NA LISTAGEM: ' + listError);
    if (!visibleCount) parts.push(listError ?
      'confira sessão, entidade, ano e o log' :
      'amplie o período para 365 dias ou confira a entidade e o ano');
    status.textContent = parts.join(' · ') + '.';
    log(status.textContent,
      listError || detailErrors || stoppedForRateLimit ? 'warn' : 'ok');
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