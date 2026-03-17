const form = document.getElementById("limit-form");
const limitInput = document.getElementById("limit-input");
const statusElement = document.getElementById("status");
const openCountElement = document.getElementById("open-count");
const trackedCountElement = document.getElementById("tracked-count");
const tabListElement = document.getElementById("tab-list");

const MESSAGE_TYPES = {
  getState: "get-state",
  setLimit: "set-limit"
};

function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.style.color = isError ? "#b91c1c" : "#b45309";
}

function renderTabList(trackedTabs) {
  tabListElement.textContent = "";

  if (!trackedTabs.length) {
    const emptyState = document.createElement("li");
    emptyState.className = "empty-state";
    emptyState.textContent = "No tracked tabs yet.";
    tabListElement.append(emptyState);
    return;
  }

  for (const tab of trackedTabs) {
    const item = document.createElement("li");
    item.className = "tab-item";

    const details = document.createElement("div");

    const title = document.createElement("p");
    title.className = "tab-id";
    title.textContent = `Tab #${tab.tabId}`;

    const meta = document.createElement("p");
    meta.className = "tab-meta";
    meta.textContent = `Touch ${tab.lastTouched} in window ${tab.windowId}`;

    details.append(title, meta);

    const badges = document.createElement("div");
    badges.className = "tab-badges";

    if (tab.active) {
      const activeBadge = document.createElement("span");
      activeBadge.className = "tab-badge";
      activeBadge.textContent = "Active";
      badges.append(activeBadge);
    }

    if (tab.pinned) {
      const pinnedBadge = document.createElement("span");
      pinnedBadge.className = "tab-badge";
      pinnedBadge.textContent = "Pinned";
      badges.append(pinnedBadge);
    }

    item.append(details, badges);
    tabListElement.append(item);
  }
}

function renderState(state) {
  limitInput.value = String(state.limit);
  openCountElement.textContent = String(state.totalOpenTabs);
  trackedCountElement.textContent = `${state.trackedTabs.length} tabs`;
  renderTabList(state.trackedTabs);
}

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

async function loadState() {
  setStatus("Loading...");

  try {
    const response = await sendMessage({ type: MESSAGE_TYPES.getState });

    if (!response?.ok) {
      throw new Error(response?.error || "Unable to load state.");
    }

    renderState(response.payload);
    setStatus("Tracking tab IDs only. No page content is read.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  setStatus("Saving...");

  try {
    const response = await sendMessage({
      type: MESSAGE_TYPES.setLimit,
      limit: limitInput.value
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Unable to save limit.");
    }

    renderState(response.payload);
    setStatus("Limit saved.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
});

loadState();
