'use strict';
const msg = document.getElementById('msg');
document.getElementById('openSide').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('Nenhuma aba ativa.');
    if (!chrome.sidePanel?.open) throw new Error('Seu Edge não expôs a API de painel lateral. Use “Abrir em nova aba”.');
    await chrome.sidePanel.open({ tabId: tab.id });
    window.close();
  } catch (e) { msg.textContent = e.message || String(e); }
});
document.getElementById('openTab').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('panel.html') });
  window.close();
});
