'use strict';

// Compatibilidade com schema eclass-omr-exam/1 do Corretor de Gabaritos.
// Funciona inteiramente no navegador, sem enviar questões nem modificar provas.
async function stableOmrExternalId(c) {
  // Mesma prova/turma/ano/arquivo -> mesmo ID em exportações repetidas,
  // evitando múltiplos registros acidentais no corretor.
  const bytes = new TextEncoder().encode(JSON.stringify({
    entityId: c.entityId,
    year: c.academicYear,
    source: state.latex,
    section: c.section,
    questionCount: state.parsed.length
  }));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, '0')).join('');
  return 'eclass-injector:' + hex.slice(0, 32);
}

function currentOmrTitle(c) {
  const override = $('omrTitle').value.trim();
  if (override) return override;
  if (c.existingMode) {
    const option = $('existingAssessments').selectedOptions?.[0];
    if (option?.dataset?.title) return option.dataset.title;
  }
  const regular = String(c.title || '').trim();
  if (regular && regular !== 'TESTE INJECTOR - APAGAR') return regular;
  return (state.fileName || 'Prova').replace(/\.tex$/i, '').replace(/[_-]+/g, ' ');
}

function currentOmrSubject() {
  const label = $('subject').selectedOptions?.[0]?.textContent;
  return (label || 'Geral').replace(/\s*\(\d+\)\s*$/, '').trim() || 'Geral';
}

function downloadOmrPackage(packageData, filename) {
  const blob = new Blob([JSON.stringify(packageData, null, 2)], {
    type: 'application/json;charset=utf-8'
  });
  const temporaryUrl = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = temporaryUrl;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // revoke somente após o evento de clique ter sido processado.
    setTimeout(() => URL.revokeObjectURL(temporaryUrl), 1500);
  }
}

async function exportOmr() {
  if (!state.parsed.length) await analyzeLatex();
  const c = formConfig();
  const chosenStudents = c.specificStudents ? c.students : [];
  const pkg = EClassOmrExport.buildPackage({
    questions: state.parsed,
    title: currentOmrTitle(c),
    subject: currentOmrSubject(),
    classIds: c.classes,
    classes: state.remote.classes || KNOWN_CLASSES,
    students: state.remote.students || [],
    selectedStudents: chosenStudents,
    specificStudents: c.specificStudents,
    externalId: await stableOmrExternalId(c)
  });
  const filename = EClassOmrExport.fileNameForExam(pkg.exam.title);
  downloadOmrPackage(pkg, filename);
  const total = pkg.exam.omr.answerKey.length;
  const classes = pkg.exam.classes.length;
  const students = pkg.exam.classes.reduce((n, cls) => n + cls.students.length, 0);
  const description = 'Gabarito exportado: ' + total + ' questão(ões) objetivas' +
    (classes ? ', ' + classes + ' turma(s) e ' + students + ' aluno(s)' : ', modo geral (sem lista de alunos)') +
    '. Arquivo: ' + filename + '. Nenhuma prova foi criada/alterada.';
  $('omrExportStatus').textContent = description;
  log(description, 'ok');
}

function omrExportBind() {
  $('exportOmr').addEventListener('click', () => safe(exportOmr));
}
