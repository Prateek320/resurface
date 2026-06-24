const input = document.getElementById("url");
const status = document.getElementById("status");

chrome.storage.sync.get(["resurfaceUrl"], (data) => {
  input.value = data.resurfaceUrl || "http://localhost:3000";
});

document.getElementById("save-url").addEventListener("click", () => {
  const url = input.value.trim().replace(/\/$/, "");
  chrome.storage.sync.set({ resurfaceUrl: url }, () => {
    status.textContent = "Saved!";
    setTimeout(() => { status.textContent = ""; }, 2000);
  });
});
