async function loadPersistedConfig() {
  const { eciConfig } = await chrome.storage.local.get('eciConfig');
  if (!eciConfig) return;
  for (const id of ['academicYear','association','division','entityId','profileId','publisher','union','entityName','levelId','countryId','sectionName']) {
    if (eciConfig[id] != null && $(id)) $(id).value = eciConfig[id];
  }
  if (typeof eciConfig.studentAudienceTemplate === 'string') $('studentAudienceTemplate').value = eciConfig.studentAudienceTemplate;
}

async function persistConfig() {
  const o = {};
  for (const id of ['academicYear','association','division','entityId','profileId','publisher','union','entityName','levelId','countryId','sectionName']) o[id] = $(id)?.value;
  o.studentAudienceTemplate = $('studentAudienceTemplate').value.trim();
  await chrome.storage.local.set({ eciConfig: o });
}

function bind() {
  $('texFile').addEventListener('change', e => safe(async () => {
    clearFolderSelection();
    await fileChanged(e.target.files?.[0]);
    if (state.latex) await analyzeLatex();
  }));
  $('analyze').addEventListener('click', () => safe(analyzeLatex));
  $('simulate').addEventListener('click', () => safe(simulate));
  $('inject').addEventListener('click', () => safe(inject));
  $('retryAssessment').addEventListener('click', () => safe(retryAssessment));
  $('clearPending').addEventListener('click', () => safe(clearPendingAssessment));
  $('detectSession').addEventListener('click', () => safe(detectSession));
  $('loadPortalData').addEventListener('click', () => safe(loadPortalData));
  $('clearFile').addEventListener('click', () => {
    state.latex = ''; state.fileName = null; state.parsed = []; state.figureBindings = {}; state.macroMap = new Map(); $('texFile').value = ''; $('preview').innerHTML = 'Analise um arquivo .tex para visualizar as questões.'; $('preview').className = 'preview empty'; $('analysisSummary').textContent = 'Nenhum arquivo analisado.'; $('questionCount').textContent = '0 questões';
  });
  enhancementsBind();
  bindFolderImport();
  $('copyLog').addEventListener('click', async () => { await navigator.clipboard.writeText($('log').textContent); log('Log copiado.', 'ok'); });
  document.querySelectorAll('.advanced input, #sectionName').forEach(el => el.addEventListener('change', persistConfig));
}

async function safe(fn) {
  try { await fn(); }
  catch (e) { console.error(e); log(e.message || String(e), 'error'); }
}

(async function init() {
  populateDefaults();
  await loadPersistedConfig();
  rebuildSelectors();
  bind();
  log('Injector carregado. Para começar: abra o E-Class, detecte a sessão e selecione um .tex.');
  await restorePendingAssessment();
  await detectSession();
})();
