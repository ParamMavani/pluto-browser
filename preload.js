
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pluto", {
    // Browser state
    getState: () => ipcRenderer.invoke("pluto:get-state"),

    // Tabs
    newTab: () => ipcRenderer.invoke("pluto:new-tab"),
    switchTab: (id) => ipcRenderer.invoke("pluto:switch-tab", id),
    closeTab: (id) => ipcRenderer.invoke("pluto:close-tab", id),

    // Navigation
    navigate: (input) => ipcRenderer.invoke("pluto:navigate", input),
    back: () => ipcRenderer.invoke("pluto:back"),
    forward: () => ipcRenderer.invoke("pluto:forward"),
    reload: () => ipcRenderer.invoke("pluto:reload"),
    home: () => ipcRenderer.invoke("pluto:home"),

    // Bookmarks
    getBookmarks: () => ipcRenderer.invoke("pluto:get-bookmarks"),
    addBookmark: () => ipcRenderer.invoke("pluto:add-bookmark"),
    removeBookmark: (url) =>
        ipcRenderer.invoke("pluto:remove-bookmark", url),
    openBookmark: (url) =>
        ipcRenderer.invoke("pluto:open-bookmark", url),

    // Show or hide bookmarks panel
    setBookmarksPanel: (isOpen) =>
        ipcRenderer.invoke("pluto:toggle-bookmarks-panel", isOpen),

    // Browsing history
    getHistory: () => ipcRenderer.invoke("pluto:get-history"),
    removeHistoryEntry: (id) => ipcRenderer.invoke("pluto:remove-history-entry", id),
    clearHistory: () => ipcRenderer.invoke("pluto:clear-history"),
    openHistoryEntry: (url) => ipcRenderer.invoke("pluto:open-history-entry", url),
    setHistoryPanel: (isOpen) => ipcRenderer.invoke("pluto:toggle-history-panel", isOpen),

    // Receive browser state updates
    onState: (callback) => {
        if (typeof callback !== "function") {
            throw new TypeError("Callback must be a function");
        }

        const listener = (_event, state) => {
            callback(state);
        };

        ipcRenderer.on("pluto:state", listener);

        // Return a function to remove this listener
        return () => {
            ipcRenderer.removeListener("pluto:state", listener);
        };
    }
});
