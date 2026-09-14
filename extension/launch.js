/* Helper tab for the jetro:// handoff: manual retry + self-close.
 * The background worker navigates a tab to jetro:// first (that is what shows
 * the OS "Open Jetro?" prompt), then repurposes the leftover tab into this
 * page. The retry button re-fires the protocol navigation behind a real user
 * gesture, which browsers always allow to prompt. */
(function () {
  const q = new URLSearchParams(location.search);
  const target = String(q.get('url') || '');
  const source = String(q.get('source') || 'page');
  const targetEl = document.getElementById('target');
  if (targetEl) targetEl.textContent = target || '(unknown link)';
  const jetroUrl =
    'jetro://add?url=' + encodeURIComponent(target) + '&source=' + encodeURIComponent(source);

  document.getElementById('open').addEventListener('click', () => {
    try {
      location.href = jetroUrl;
    } catch {}
  });

  function closeTab() {
    try {
      window.close();
    } catch {}
    // window.close() is ignored for some tabs — fall back to the tabs API.
    try {
      if (chrome && chrome.tabs && chrome.tabs.getCurrent) {
        chrome.tabs.getCurrent((tab) => {
          try {
            if (tab && tab.id != null) chrome.tabs.remove(tab.id, () => {});
          } catch {}
        });
      }
    } catch {}
  }
  document.getElementById('close').addEventListener('click', closeTab);
  // Backup self-close (the background worker normally closes this tab first).
  setTimeout(closeTab, 60000);
})();
