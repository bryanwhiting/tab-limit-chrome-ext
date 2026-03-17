const DEFAULT_LIMIT = 5;
const MIN_LIMIT = 1;
const MAX_LIMIT = 200;

const STORAGE_KEYS = {
  limit: "limit",
  tabState: "tabState"
};

const MESSAGE_TYPES = {
  getState: "get-state",
  setLimit: "set-limit"
};

const cache = {
  initialized: false,
  limit: DEFAULT_LIMIT,
  tabState: createEmptyTabState()
};

let initPromise = null;
let operationQueue = Promise.resolve();

function createEmptyTabState() {
  return {
    touchCounter: 0,
    tabs: {}
  };
}

function normalizeLimit(rawLimit) {
  const parsed = Number(rawLimit);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(parsed)));
}

function normalizeTabState(rawState) {
  if (!rawState || typeof rawState !== "object") {
    return createEmptyTabState();
  }

  const normalized = createEmptyTabState();
  let maxLastTouched = 0;

  normalized.touchCounter = Number.isFinite(rawState.touchCounter)
    ? Math.max(0, Math.floor(rawState.touchCounter))
    : 0;

  const sourceTabs = rawState.tabs && typeof rawState.tabs === "object" ? rawState.tabs : {};

  for (const [tabId, entry] of Object.entries(sourceTabs)) {
    const numericTabId = Number(tabId);

    if (!Number.isInteger(numericTabId) || !entry || typeof entry !== "object") {
      continue;
    }

    normalized.tabs[numericTabId] = {
      createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : Date.now(),
      lastTouched: Number.isFinite(entry.lastTouched)
        ? Math.max(0, Math.floor(entry.lastTouched))
        : 0,
      windowId: Number.isInteger(entry.windowId) ? entry.windowId : null
    };

    maxLastTouched = Math.max(maxLastTouched, normalized.tabs[numericTabId].lastTouched);
  }

  normalized.touchCounter = Math.max(normalized.touchCounter, maxLastTouched);

  return normalized;
}

async function persistCache() {
  await chrome.storage.local.set({
    [STORAGE_KEYS.limit]: cache.limit,
    [STORAGE_KEYS.tabState]: cache.tabState
  });
}

async function ensureInitialized() {
  if (cache.initialized) {
    return;
  }

  if (!initPromise) {
    initPromise = (async () => {
      const stored = await chrome.storage.local.get({
        [STORAGE_KEYS.limit]: DEFAULT_LIMIT,
        [STORAGE_KEYS.tabState]: createEmptyTabState()
      });

      cache.limit = normalizeLimit(stored[STORAGE_KEYS.limit]);
      cache.tabState = normalizeTabState(stored[STORAGE_KEYS.tabState]);

      await syncTrackedTabsWithChrome();
      cache.initialized = true;
      await persistCache();
    })().catch((error) => {
      initPromise = null;
      throw error;
    });
  }

  await initPromise;
}

function enqueueOperation(operation) {
  const nextOperation = operationQueue.then(operation, operation);

  operationQueue = nextOperation.catch((error) => {
    console.error("Tab Limit operation failed:", error);
  });

  return nextOperation;
}

function touchTab(tabId, windowId) {
  if (!Number.isInteger(tabId)) {
    return;
  }

  const existingEntry = cache.tabState.tabs[tabId];
  cache.tabState.touchCounter += 1;

  cache.tabState.tabs[tabId] = {
    createdAt: existingEntry?.createdAt ?? Date.now(),
    lastTouched: cache.tabState.touchCounter,
    windowId: Number.isInteger(windowId) ? windowId : existingEntry?.windowId ?? null
  };
}

function forgetTab(tabId) {
  delete cache.tabState.tabs[tabId];
}

async function syncTrackedTabsWithChrome() {
  const openTabs = await chrome.tabs.query({});
  const openTabIds = new Set();
  const missingTabs = [];

  for (const tab of openTabs) {
    if (!Number.isInteger(tab.id)) {
      continue;
    }

    openTabIds.add(tab.id);

    if (cache.tabState.tabs[tab.id]) {
      if (Number.isInteger(tab.windowId)) {
        cache.tabState.tabs[tab.id].windowId = tab.windowId;
      }
      continue;
    }

    missingTabs.push(tab);
  }

  missingTabs.sort((left, right) => (left.lastAccessed ?? 0) - (right.lastAccessed ?? 0));

  for (const tab of missingTabs) {
    touchTab(tab.id, tab.windowId);
  }

  for (const trackedTabId of Object.keys(cache.tabState.tabs)) {
    if (!openTabIds.has(Number(trackedTabId))) {
      delete cache.tabState.tabs[trackedTabId];
    }
  }
}

async function closeLeastRecentlyTouchedTabs(protectedTabId = null) {
  const openTabs = await chrome.tabs.query({});
  const openTabIds = new Set(
    openTabs.filter((tab) => Number.isInteger(tab.id)).map((tab) => tab.id)
  );

  const trackedEntries = Object.entries(cache.tabState.tabs)
    .map(([tabId, entry]) => ({
      tabId: Number(tabId),
      lastTouched: entry.lastTouched
    }))
    .filter((entry) => openTabIds.has(entry.tabId));

  const tabsToClose = [];

  if (trackedEntries.length <= cache.limit) {
    return tabsToClose;
  }

  trackedEntries.sort((left, right) => left.lastTouched - right.lastTouched);

  for (const entry of trackedEntries) {
    if (trackedEntries.length - tabsToClose.length <= cache.limit) {
      break;
    }

    if (entry.tabId === protectedTabId && trackedEntries.length - tabsToClose.length > 1) {
      continue;
    }

    tabsToClose.push(entry.tabId);
  }

  for (const tabId of tabsToClose) {
    try {
      await chrome.tabs.remove(tabId);
    } catch (error) {
      console.warn(`Unable to close tab ${tabId}:`, error);
    }

    forgetTab(tabId);
  }

  if (tabsToClose.length > 0) {
    await persistCache();
  }

  return tabsToClose;
}

async function handleTabCreated(tab) {
  if (!Number.isInteger(tab.id)) {
    return;
  }

  touchTab(tab.id, tab.windowId);
  await persistCache();
  await closeLeastRecentlyTouchedTabs(tab.id);
}

async function handleTabActivated({ tabId, windowId }) {
  touchTab(tabId, windowId);
  await persistCache();
}

async function handleTabRemoved(tabId) {
  forgetTab(tabId);
  await persistCache();
}

async function handleTabAttached(tabId, { newWindowId }) {
  if (!cache.tabState.tabs[tabId]) {
    touchTab(tabId, newWindowId);
  } else {
    cache.tabState.tabs[tabId].windowId = newWindowId;
  }

  await persistCache();
}

async function handleTabReplaced(addedTabId, removedTabId) {
  const previousEntry = cache.tabState.tabs[removedTabId];

  if (previousEntry) {
    delete cache.tabState.tabs[removedTabId];
    cache.tabState.tabs[addedTabId] = {
      ...previousEntry,
      lastTouched: cache.tabState.touchCounter + 1
    };
    cache.tabState.touchCounter += 1;
  } else {
    touchTab(addedTabId, null);
  }

  await persistCache();
}

async function getPopupState() {
  await syncTrackedTabsWithChrome();
  await persistCache();

  const openTabs = await chrome.tabs.query({});
  const openTabMap = new Map(
    openTabs
      .filter((tab) => Number.isInteger(tab.id))
      .map((tab) => [
        tab.id,
        {
          active: Boolean(tab.active),
          pinned: Boolean(tab.pinned),
          windowId: tab.windowId
        }
      ])
  );

  const trackedTabs = Object.entries(cache.tabState.tabs)
    .map(([tabId, entry]) => {
      const numericTabId = Number(tabId);
      const liveTab = openTabMap.get(numericTabId);

      if (!liveTab) {
        return null;
      }

      return {
        tabId: numericTabId,
        createdAt: entry.createdAt,
        lastTouched: entry.lastTouched,
        active: liveTab.active,
        pinned: liveTab.pinned,
        windowId: liveTab.windowId
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.lastTouched - left.lastTouched);

  return {
    limit: cache.limit,
    totalOpenTabs: openTabs.length,
    trackedTabs
  };
}

async function setLimit(rawLimit) {
  cache.limit = normalizeLimit(rawLimit);
  await persistCache();
  await closeLeastRecentlyTouchedTabs(null);
  return getPopupState();
}

chrome.runtime.onInstalled.addListener(() => {
  enqueueOperation(async () => {
    await ensureInitialized();
  });
});

chrome.runtime.onStartup.addListener(() => {
  enqueueOperation(async () => {
    await ensureInitialized();
  });
});

chrome.tabs.onCreated.addListener((tab) => {
  enqueueOperation(async () => {
    await ensureInitialized();
    await handleTabCreated(tab);
  });
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  enqueueOperation(async () => {
    await ensureInitialized();
    await handleTabActivated(activeInfo);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueueOperation(async () => {
    await ensureInitialized();
    await handleTabRemoved(tabId);
  });
});

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  enqueueOperation(async () => {
    await ensureInitialized();
    await handleTabAttached(tabId, attachInfo);
  });
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  enqueueOperation(async () => {
    await ensureInitialized();
    await handleTabReplaced(addedTabId, removedTabId);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return undefined;
  }

  enqueueOperation(async () => {
    await ensureInitialized();

    if (message.type === MESSAGE_TYPES.getState) {
      sendResponse({ ok: true, payload: await getPopupState() });
      return;
    }

    if (message.type === MESSAGE_TYPES.setLimit) {
      sendResponse({ ok: true, payload: await setLimit(message.limit) });
      return;
    }

    sendResponse({ ok: false, error: "Unsupported message type." });
  }).catch((error) => {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  });

  return true;
});

enqueueOperation(async () => {
  await ensureInitialized();
});
