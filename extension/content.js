function getPageText() {
  const selectors = [
    ".jobs-description__content",
    ".job-view-layout",
    ".feed-shared-update-v2__description",
    ".msg-s-event-listitem__body",
    "article",
    "main"
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el?.innerText?.length > 50) return el.innerText.trim().slice(0, 8000);
  }
  return document.body.innerText.trim().slice(0, 8000);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "extractPage") {
    sendResponse({ text: getPageText() });
  }
});

function injectButton() {
  if (document.getElementById("resurface-save-btn")) return;
  const btn = document.createElement("button");
  btn.id = "resurface-save-btn";
  btn.textContent = "Save to Resurface";
  btn.addEventListener("click", () => {
    const text = window.getSelection()?.toString()?.trim() || getPageText();
    if (text.length < 10) {
      alert("Select some text or open a job/post to save.");
      return;
    }
    chrome.runtime.sendMessage({ action: "saveText", text });
  });
  document.body.appendChild(btn);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", injectButton);
} else {
  injectButton();
}
