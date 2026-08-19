"use strict";
(() => {
  const originalFetch = window.fetch.bind(window);
  function isWorkerRequest(input) {
    try {
      const url = new URL(typeof input === "string" ? input : input.url, location.href);
      return url.origin === location.origin && /\/api\/(?:public\/)?workers(?:[/?#]|$)/.test(url.pathname + url.search);
    } catch { return false; }
  }
  function showFailure() {
    const grid = document.getElementById("workerGrid") || document.getElementById("workersGrid") || document.querySelector("[data-worker-grid]") || document.querySelector(".workers-grid");
    if (!grid) return;
    grid.replaceChildren();
    const state = document.createElement("div"); state.className = "empty-state worker-load-error"; state.setAttribute("role", "status");
    const heading = document.createElement("h3"); heading.textContent = "Worker profiles could not be loaded";
    const message = document.createElement("p"); message.textContent = "Please try again. No demonstration profiles are being shown as live results.";
    const retry = document.createElement("button"); retry.type = "button"; retry.className = "btn btn-secondary"; retry.textContent = "Try again"; retry.addEventListener("click", () => location.reload());
    state.append(heading, message, retry); grid.append(state);
  }
  window.fetch = async function bookitFetch(input, init) {
    const workerRequest = isWorkerRequest(input);
    try {
      const response = await originalFetch(input, init);
      if (workerRequest && !response.ok) queueMicrotask(showFailure);
      return response;
    } catch (error) {
      if (workerRequest) queueMicrotask(showFailure);
      throw error;
    }
  };
})();
