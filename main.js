const { app, BrowserWindow, WebContentsView, ipcMain, session } = require("electron");

const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

const SEARCH_ENGINE_URL = "http://localhost:8080";
const TOOLBAR_HEIGHT = 154;
const HISTORY_PANEL_WIDTH = 360;
const MAX_HISTORY_ITEMS = 1000;

let mainWindow = null;
let tabs = [];
let activeTabId = null;
let nextTabId = 1;
let bookmarksPanelOpen = false;
let historyPanelOpen = false;

let bookmarks = [];
let browsingHistory = [];

const bookmarksFile = () =>
    path.join(app.getPath("userData"), "bookmarks.json");

const historyFile = () =>
    path.join(app.getPath("userData"), "history.json");

// ------------------------------------------
// IPC SECURITY
// ------------------------------------------

const PLUTO_UI_URL = pathToFileURL(
    path.join(__dirname, "index.html")
).href;

function isTrustedIPC(event) {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return false;
    }

    return (
        event.sender === mainWindow.webContents &&
        event.senderFrame === mainWindow.webContents.mainFrame &&
        event.senderFrame.url === PLUTO_UI_URL
    );
}

function handleTrustedIPC(channel, handler) {
    ipcMain.handle(channel, (event, ...args) => {
        if (!isTrustedIPC(event)) {
            throw new Error(`Unauthorized IPC request: ${channel}`);
        }

        return handler(...args);
    });
}

function isValidTabId(id) {
    return Number.isInteger(id) && id > 0;
}

function isValidWebURL(value) {
    if (typeof value !== "string" || value.length > 4096) {
        return false;
    }

    try {
        const url = new URL(value);

        return (
            (url.protocol === "http:" || url.protocol === "https:") &&
            Boolean(url.hostname)
        );
    } catch {
        return false;
    }
}

// ------------------------------------------
// BOOKMARK STORAGE
// ------------------------------------------

function loadBookmarks() {
    try {
        const file = bookmarksFile();

        if (fs.existsSync(file)) {
            const data = fs.readFileSync(file, "utf8");
            const parsed = JSON.parse(data);
            bookmarks = Array.isArray(parsed) ? parsed : [];
        }
    } catch (error) {
        console.error("Could not load bookmarks:", error);
        bookmarks = [];
    }
}

function saveBookmarks() {
    try {
        fs.writeFileSync(
            bookmarksFile(),
            JSON.stringify(bookmarks, null, 2),
            "utf8"
        );
    } catch (error) {
        console.error("Could not save bookmarks:", error);
    }
}

function addBookmark() {
    const tab = getActiveTab();

    if (!tab || tab.isHome) {
        return {
            success: false,
            message: "There is no webpage to bookmark."
        };
    }

    const webContents = tab.view.webContents;
    const url = webContents.getURL();

    if (!url || !/^https?:\/\//i.test(url)) {
        return {
            success: false,
            message: "This page cannot be bookmarked."
        };
    }

    const existing = bookmarks.find(item => item.url === url);

    if (existing) {
        return {
            success: false,
            message: "This page is already bookmarked."
        };
    }

    bookmarks.push({
        title: webContents.getTitle() || url,
        url,
        createdAt: new Date().toISOString()
    });

    saveBookmarks();

    return {
        success: true,
        message: "Bookmark saved successfully."
    };
}

function removeBookmark(url) {
    const previousLength = bookmarks.length;

    bookmarks = bookmarks.filter(item => item.url !== url);

    if (bookmarks.length !== previousLength) {
        saveBookmarks();
    }

    return bookmarks;
}

// ------------------------------------------
// BROWSING HISTORY STORAGE
// ------------------------------------------

function loadHistory() {
    try {
        const file = historyFile();
        if (!fs.existsSync(file)) {
            browsingHistory = [];
            return;
        }

        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        browsingHistory = Array.isArray(parsed)
            ? parsed.filter(item => item && typeof item.url === "string" && isValidWebURL(item.url))
                .slice(0, MAX_HISTORY_ITEMS)
            : [];
    } catch (error) {
        console.error("Could not load browsing history:", error);
        browsingHistory = [];
    }
}

function saveHistory() {
    try {
        fs.writeFileSync(historyFile(), JSON.stringify(browsingHistory, null, 2), "utf8");
    } catch (error) {
        console.error("Could not save browsing history:", error);
    }
}

function recordVisit(tab) {
    if (!tab || tab.isHome || !tab.view || tab.view.webContents.isDestroyed()) return;

    const webContents = tab.view.webContents;
    const url = webContents.getURL();
    if (!isValidWebURL(url)) return;

    let kind = "website";
    let query = "";
    try {
        const parsed = new URL(url);
        if (
            parsed.hostname === "localhost" &&
            parsed.port === "8080" &&
            parsed.pathname === "/search"
        ) {
            query = parsed.searchParams.get("q") || "";
            if (query) kind = "search";
        }
    } catch { /* URL was validated above. */ }

    const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: kind === "search" ? `Search: ${query}` : (webContents.getTitle() || url),
        url,
        visitedAt: new Date().toISOString(),
        kind,
        query
    };

    browsingHistory.unshift(entry);
    browsingHistory = browsingHistory.slice(0, MAX_HISTORY_ITEMS);
    saveHistory();
}

function removeHistoryEntry(id) {
    if (typeof id !== "string" || id.length > 100) return browsingHistory;
    const previousLength = browsingHistory.length;
    browsingHistory = browsingHistory.filter(item => item.id !== id);
    if (browsingHistory.length !== previousLength) saveHistory();
    return browsingHistory;
}

function clearHistory() {
    browsingHistory = [];
    saveHistory();
    return browsingHistory;
}

// ------------------------------------------
// CREATE MAIN WINDOW
// ------------------------------------------

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 900,
        minHeight: 600,
        backgroundColor: "#10111b",
        title: "Pluto Browser",

        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    mainWindow.loadFile("index.html").then(() => {
        createTab();
    });

    mainWindow.on("resize", () => {
        updateActiveTabBounds();
    });

    mainWindow.on("closed", () => {
        mainWindow = null;
        tabs = [];
        activeTabId = null;
        bookmarksPanelOpen = false;
        historyPanelOpen = false;
    });
}

// ------------------------------------------
// TAB HELPERS
// ------------------------------------------

function getActiveTab() {
    return tabs.find(tab => tab.id === activeTabId);
}

function getTab(id) {
    return tabs.find(tab => tab.id === id);
}

function getTabState(tab) {
    const history = tab.view.webContents.navigationHistory;

    return {
        id: tab.id,
        title: tab.title,
        url: tab.url,
        isHome: tab.isHome,
        isLoading: tab.isLoading,
        canGoBack: history.canGoBack(),
        canGoForward: history.canGoForward()
    };
}

// ------------------------------------------
// SEND STATE TO PLUTO UI
// ------------------------------------------

function sendBrowserState() {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const activeTab = getActiveTab();

    const state = {
        tabs: tabs.map(getTabState),
        activeTabId,
        activeTab: activeTab ? getTabState(activeTab) : null,
        isLoading: activeTab ? activeTab.isLoading : false
    };

    mainWindow.webContents.send("pluto:state", state);
}

// ------------------------------------------
// UPDATE TAB INFORMATION
// ------------------------------------------

function updateTabInfo(tab) {
    if (!tab || tab.view.webContents.isDestroyed()) return;

    const webContents = tab.view.webContents;

    tab.title = webContents.getTitle() || "New Tab";

    if (!tab.isHome) {
        tab.url = webContents.getURL();
    }

    sendBrowserState();
}

// ------------------------------------------
// UPDATE WEBPAGE VIEW BOUNDS
// ------------------------------------------

function updateActiveTabBounds() {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const { width, height } = mainWindow.getContentBounds();

    // Hide all webpage views first.
    for (const tab of tabs) {
        if (tab.view.webContents.isDestroyed()) continue;

        tab.view.setBounds({
            x: 0,
            y: TOOLBAR_HEIGHT,
            width: 0,
            height: 0
        });
    }

    const activeTab = getActiveTab();

    // The bookmarks panel retains its existing overlay behavior.
    // The History side panel reserves space beside the webpage.
    if (!activeTab || activeTab.isHome || bookmarksPanelOpen) return;

    const sidePanelWidth = historyPanelOpen
        ? Math.min(HISTORY_PANEL_WIDTH, Math.max(280, width - 500))
        : 0;

    activeTab.view.setBounds({
        x: 0,
        y: TOOLBAR_HEIGHT,
        width: Math.max(0, width - sidePanelWidth),
        height: Math.max(0, height - TOOLBAR_HEIGHT)
    });
}

// ------------------------------------------
// CREATE NEW TAB
// ------------------------------------------

function createTab() {
    if (!mainWindow) return;

    const id = nextTabId++;

    const view = new WebContentsView({
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    const tab = {
        id,
        view,
        title: "New Tab",
        url: "",
        isHome: true,
        isLoading: false
    };

    mainWindow.contentView.addChildView(view);

    view.setBounds({
        x: 0,
        y: TOOLBAR_HEIGHT,
        width: 0,
        height: 0
    });

    tabs.push(tab);

    const webContents = view.webContents;

    // Handle links that try to open a new window.
    webContents.setWindowOpenHandler(({ url }) => {
    if (isValidWebURL(url)) {
        navigateTab(id, url);
    }

    return { action: "deny" };
    });

    // Block unsupported navigation protocols.
    webContents.on("will-navigate", (event, navigationURL) => {
    if (!isValidWebURL(navigationURL)) {
        event.preventDefault();
    }
    });

    // Block redirects to unsupported protocols.
    webContents.on("will-redirect", (event, navigationURL) => {
    if (!isValidWebURL(navigationURL)) {
        event.preventDefault();
    }
    });

    webContents.on("did-navigate", () => {
        tab.isHome = false;
        updateTabInfo(tab);
        recordVisit(tab);
        updateActiveTabBounds();
    });

    webContents.on("did-navigate-in-page", () => {
        tab.isHome = false;
        updateTabInfo(tab);
        updateActiveTabBounds();
    });

    webContents.on("page-title-updated", () => {
        updateTabInfo(tab);
    });

    webContents.on("did-start-loading", () => {
        tab.isLoading = true;
        sendBrowserState();
    });

    webContents.on("did-stop-loading", () => {
        tab.isLoading = false;
        updateTabInfo(tab);
        sendBrowserState();
    });

    webContents.on(
        "did-fail-load",
        (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
            if (!isMainFrame || errorCode === -3) return;

            tab.isLoading = false;

            console.error(
                "Page load failed:",
                errorDescription,
                validatedURL
            );

            sendBrowserState();
        }
    );

    webContents.on("render-process-gone", () => {
        tab.title = "Page crashed";
        tab.isLoading = false;
        sendBrowserState();
    });

    switchTab(id);

    return id;
}

// ------------------------------------------
// SWITCH TAB
// ------------------------------------------

function switchTab(id) {
    const tab = getTab(id);

    if (!tab) return;

    activeTabId = id;

    updateActiveTabBounds();
    sendBrowserState();
}

// ------------------------------------------
// CLOSE TAB
// ------------------------------------------

function closeTab(id) {
    const index = tabs.findIndex(tab => tab.id === id);

    if (index === -1) return;

    const tab = tabs[index];
    const wasActive = activeTabId === id;

    tabs.splice(index, 1);

    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.contentView.removeChildView(tab.view);
    }

    if (!tab.view.webContents.isDestroyed()) {
        tab.view.webContents.destroy();
    }

    if (wasActive) {
        if (tabs.length === 0) {
            createTab();
            return;
        }

        const nextIndex = Math.min(index, tabs.length - 1);
        activeTabId = tabs[nextIndex].id;
    }

    updateActiveTabBounds();
    sendBrowserState();
}

// ------------------------------------------
// URL / SEARCH HANDLING
// ------------------------------------------

function getNavigationURL(input) {
    const value = String(input || "").trim();

    if (!value) return SEARCH_ENGINE_URL;

    if (/^https?:\/\//i.test(value)) {
        return value;
    }

    if (
        /^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(value) ||
        /^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/.test(value)
    ) {
        return `http://${value}`;
    }

    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i.test(value)) {
        return `https://${value}`;
    }

    return `${SEARCH_ENGINE_URL}/search?q=${encodeURIComponent(value)}`;
}

// ------------------------------------------
// NAVIGATE TAB
// ------------------------------------------

async function navigateTab(id, input) {
    const tab = getTab(id);

    if (!tab) return;

    const url = getNavigationURL(input);

    tab.isHome = false;
    tab.url = url;
    tab.isLoading = true;

    switchTab(id);

    try {
        await tab.view.webContents.loadURL(url);
    } catch (error) {
        tab.isLoading = false;
        console.error("Navigation error:", error.message);
        sendBrowserState();
    }
}

// ------------------------------------------
// NAVIGATION CONTROLS
// ------------------------------------------

function goBack() {
    const tab = getActiveTab();
    if (!tab) return;

    const history = tab.view.webContents.navigationHistory;

    if (history.canGoBack()) {
        history.goBack();
    }
}

function goForward() {
    const tab = getActiveTab();
    if (!tab) return;

    const history = tab.view.webContents.navigationHistory;

    if (history.canGoForward()) {
        history.goForward();
    }
}

function reloadTab() {
    const tab = getActiveTab();
    if (!tab) return;

    if (tab.isHome) {
        sendBrowserState();
        return;
    }

    tab.view.webContents.reload();
}

function goHome() {
    const tab = getActiveTab();
    if (!tab) return;

    tab.isHome = true;
    tab.url = "";
    tab.title = "New Tab";
    tab.isLoading = false;

    updateActiveTabBounds();
    sendBrowserState();
}

// ------------------------------------------
// IPC HANDLERS: BROWSER
// ------------------------------------------

handleTrustedIPC("pluto:get-state", () => {
    const activeTab = getActiveTab();

    return {
        tabs: tabs.map(getTabState),
        activeTabId,
        activeTab: activeTab ? getTabState(activeTab) : null,
        isLoading: activeTab ? activeTab.isLoading : false
    };
});

handleTrustedIPC("pluto:new-tab", () => createTab());

handleTrustedIPC("pluto:switch-tab", id => {
    if (!isValidTabId(id)) return;
    switchTab(id);
});

handleTrustedIPC("pluto:close-tab", id => {
    if (!isValidTabId(id)) return;
    closeTab(id);
});

handleTrustedIPC("pluto:navigate", input => {
    if (typeof input !== "string" || input.length > 2048) {
        return;
    }

    const tab = getActiveTab();

    if (tab) {
        return navigateTab(tab.id, input);
    }
});

handleTrustedIPC("pluto:back", () => goBack());
handleTrustedIPC("pluto:forward", () => goForward());
handleTrustedIPC("pluto:reload", () => reloadTab());
handleTrustedIPC("pluto:home", () => goHome());

// ------------------------------------------
// IPC HANDLERS: BOOKMARKS
// ------------------------------------------

handleTrustedIPC("pluto:get-bookmarks", () => {
    return bookmarks;
});

handleTrustedIPC("pluto:add-bookmark", () => {
    return addBookmark();
});

handleTrustedIPC("pluto:remove-bookmark", url => {
    if (!isValidWebURL(url)) return bookmarks;
    return removeBookmark(url);
});

handleTrustedIPC("pluto:open-bookmark", url => {
    if (!isValidWebURL(url)) return;

    const tab = getActiveTab();

    if (tab) {
        return navigateTab(tab.id, url);
    }
});

handleTrustedIPC("pluto:toggle-bookmarks-panel", isOpen => {
    if (typeof isOpen !== "boolean") return;

    bookmarksPanelOpen = isOpen;
    if (isOpen) historyPanelOpen = false;
    updateActiveTabBounds();
});

// ------------------------------------------
// IPC HANDLERS: BROWSING HISTORY
// ------------------------------------------

handleTrustedIPC("pluto:get-history", () => browsingHistory);

handleTrustedIPC("pluto:remove-history-entry", id => removeHistoryEntry(id));

handleTrustedIPC("pluto:clear-history", () => clearHistory());

handleTrustedIPC("pluto:open-history-entry", url => {
    if (!isValidWebURL(url)) return;
    const tab = getActiveTab();
    if (tab) return navigateTab(tab.id, url);
});

handleTrustedIPC("pluto:toggle-history-panel", isOpen => {
    if (typeof isOpen !== "boolean") return;
    historyPanelOpen = isOpen;
    if (isOpen) bookmarksPanelOpen = false;
    updateActiveTabBounds();
});

// ------------------------------------------
// APP LIFECYCLE
// ------------------------------------------

app.whenReady().then(() => {

    session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback) => {
        // Deny website permissions by default.
        callback(false);
    }
);
    loadBookmarks();
    loadHistory();
    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
