const DEFAULT_URL = "http://localhost:3000";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "save-to-resurface",
    title: "Save to Resurface",
    contexts: ["selection", "page"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const text = info.selectionText || "";
  if (text.length >= 10) {
    openResurface(text);
  } else if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { action: "extractPage" }, (response) => {
      if (response?.text) openResurface(response.text);
      else chrome.action.openPopup();
    });
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "saveText") {
    openResurface(msg.text);
    sendResponse({ ok: true });
  }
});

function openResurface(text) {
  chrome.storage.sync.get(["resurfaceUrl"], (data) => {
    const base = data.resurfaceUrl || DEFAULT_URL;
    const url = `${base}/?text=${encodeURIComponent(text)}`;
    chrome.tabs.create({ url });
  });
}
