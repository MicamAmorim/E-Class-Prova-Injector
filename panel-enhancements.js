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
    const matches = [...String(input).matchAll(/\bTAGFIGURAAQUI(?:[_-]?\d+)?\b/g)];
    el.replaceChildren();
    let start = 0;
    for (const match of matches) {
      el.appendChild(document.createTextNode(input.slice(start, match.index)));
      const src = images[match[0]];
      if (src) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = 'Figura ' + match[0] + ' da questão ' + q.number;
        img.className = 'inline-figure';
        el.appendChild(img);
      } else {
        const mark = document.createElement('strong');
        mark.className = 'missing-figure';
        mark.textContent = '[' + match[0] + ': figura pendente]';
        el.appendChild(mark);
      }
      start = match.index + match[0].length;
    }
    el.appendChild(document.createTextNode(input.slice(start)));
  }

  function refresh() {
    renderFragment(card.querySelector('.qraw'), q.stem);
    card.querySelectorAll('ol li').forEach((li, i) => renderFragment(li, q.choices[i]));
  }

  const tags = EClassFeatures.figureTags(q);
  if (tags.length) {
    const box = document.createElement('div');
    box.className = 'figures-box';
    const caption = document.createElement('p');
    caption.className = 'hint';
    caption.textContent = 'Associe cada marcador a uma imagem PNG, JPG, WEBP ou GIF. Você também pode usar uma URL HTTPS hospedada.';
    box.appendChild(caption);
    for (const tag of tags) {
      const row = document.createElement('div');
      row.className = 'figure-row';
      const heading = document.createElement('strong');
      heading.textContent = tag;
      const file = document.createElement('input');
      file.type = 'file';
      file.accept = 'image/png,image/jpeg,image/webp,image/gif';
      file.setAttribute('aria-label', 'Enviar figura para ' + tag + ' da questão ' + q.number);
      const url = document.createElement('input');
      url.type = 'url';
      url.placeholder = 'ou URL HTTPS da figura';
      url.setAttribute('aria-label', 'URL para ' + tag + ' da questão ' + q.number);
      if (images[tag]?.startsWith('https://')) url.value = images[tag];
      file.addEventListener('change', async () => {
        const selected = file.files && file.files[0];
        if (!selected) return;
        const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
        if (!allowed.includes(selected.type)) {
          file.value = '';
          log('Q' + q.number + ': formato de imagem não permitido.', 'error');
          return;
        }
        if (selected.size > 1500000) {
          file.value = '';
          log('Q' + q.number + ': imagem maior que 1,5 MB; reduza o tamanho antes do envio.', 'error');
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            images[tag] = reader.result;
            url.value = '';
            refresh();
            log('Q' + q.number + ': figura associada a ' + tag + '.', 'ok');
          }
        };
        reader.onerror = () => log('Falha na leitura da imagem.', 'error');
        reader.readAsDataURL(selected);
      });
      url.addEventListener('change', () => {
        const value = url.value.trim();
        if (value && !/^https:\/\//i.test(value)) {
          log('A URL da figura deve começar com https://.', 'error');
          return;
        }
        if (value) images[tag] = value;
        else delete images[tag];
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
        refresh();
      });
      row.append(heading, file, url, remove);
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
  const records = new Map();
  try {
    const response = await apiFetch(API.assessment, { headers: portalHeaders(false) });
    for (const raw of EClassFeatures.extractRows(response)) {
      const rec = EClassFeatures.assessmentRecord(raw);
      if (rec && EClassFeatures.withinDays(rec, days)) records.set(rec.id, rec);
    }
  } catch (e) {
    log('A lista remota de provas não foi disponibilizada por esta rota: ' + e.message, 'warn');
  }
  const { eciHistory = [] } = await chrome.storage.local.get({ eciHistory: [] });
  for (const run of eciHistory) {
    const rec = EClassFeatures.assessmentRecord(run.assessmentResponse);
    if (rec && EClassFeatures.withinDays({ ...rec, date: run.at }, days) && !records.has(rec.id)) {
      records.set(rec.id, { ...rec, date: run.at });
    }
  }
  const list = [...records.values()].sort((a, b) => b.date.localeCompare(a.date));
  $('existingAssessments').replaceChildren(new Option('Selecione uma prova', ''));
  for (const rec of list) {
    $('existingAssessments').add(new Option(rec.title + ' · ' + rec.date.slice(0, 10), rec.id));
  }
  $('assessmentListStatus').textContent = list.length + ' prova(s) encontradas no período. Se necessário, informe o UUID manualmente.';
  log('Consulta de avaliações concluída: ' + list.length + ' resultado(s).', 'ok');
}

function validateEnhancements(c) {
  for (const q of state.parsed) {
    for (const tag of EClassFeatures.figureTags(q)) {
      EClassFeatures.replaceFigureTags(tag, questionImages(q), q.number);
    }
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