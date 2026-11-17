export {};
const status = document.querySelector<HTMLElement>("#status")!;
const retry = document.querySelector<HTMLButtonElement>("#retry")!;
const url = location.hash.slice(1);

async function route() {
  retry.hidden = true;
  status.textContent = "Opening link…";
  try {
    const result = await chrome.runtime.sendMessage({ type: "route", url });
    if (result?.error) throw new Error(result.error);
    if (result?.opened) {
      status.textContent = "Opened in your default browser.";
      if (history.length > 1) history.back();
      else await chrome.runtime.sendMessage({ type: "close" });
    }
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    retry.hidden = false;
  }
}
retry.addEventListener("click", () => {
  void route();
});
void route();
