/* Popup: send current tab to Jetro + download-capture toggle. */
const statusEl = document.getElementById('status');
const box = document.getElementById('intercept');

function say(msg) {
  if (statusEl) statusEl.textContent = msg || '';
}

chrome.storage.sync.get({ interceptDownloads: true }, (cur) => {
  if (box) box.checked = cur.interceptDownloads !== false;
});

if (box) {
  box.addEventListener('change', () => {
    chrome.storage.sync.set({ interceptDownloads: !!box.checked }, () => {
      say(box.checked ? 'Download capture on.' : 'Download capture off.');
      setTimeout(() => say(''), 1500);
    });
  });
}

document.getElementById('sendTab').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab && tab.url ? String(tab.url) : '';
    if (!/^https?:/i.test(url)) {
      say('This page cannot be sent to Jetro.');
      return;
    }
    chrome.runtime.sendMessage({ type: 'jetro:send-tab', url }, (res) => {
      if (chrome.runtime.lastError) {
        say('Could not reach Jetro — is the app installed?');
        return;
      }
      say(res && res.ok ? 'Sent to Jetro.' : 'Could not send.');
      setTimeout(() => say(''), 1500);
    });
  } catch {
    say('Could not read the current tab.');
  }
});
