
/*
================================================
PLUTO BROWSER — RENDERER PROCESS
================================================

This file controls the browser's user interface.

Responsibilities:
- Tab rendering and switching
- Navigation controls
- Address bar and homepage search
- Bookmark management
- Keyboard shortcuts

Communication with Electron's main process
happens through the secure window.pluto API
exposed by preload.js.
================================================
*/


// ================================================
// DOM ELEMENT REFERENCES
// ================================================

const tabsContainer = document.getElementById("tabs");
const addressInput = document.getElementById("addressInput");
const homePage = document.getElementById("homePage");
const errorPage = document.getElementById("errorPage");
const errorMessage = document.getElementById("errorMessage");

const bookmarksPanel = document.getElementById("bookmarksPanel");
const bookmarksList = document.getElementById("bookmarksList");
const bookmarkSearchInput = document.getElementById("bookmarkSearchInput");
const bookmarkCount = document.getElementById("bookmarkCount");
const bookmarkMessage = document.getElementById("bookmarkMessage");
const historyPanel = document.getElementById("historyPanel");
const historyList = document.getElementById("historyList");
const historySearchInput = document.getElementById("historySearchInput");
const historyCount = document.getElementById("historyCount");


// ================================================
// BROWSER STATE
// ================================================

let browserState = {
    tabs: [],
    activeTabId: null
};

function keepActiveTabVisible() {
    const activeTab = tabsContainer.querySelector(".tab.active");

    if (!activeTab) return;

    const tabStart = activeTab.offsetLeft;
    const tabEnd = tabStart + activeTab.offsetWidth;
    const visibleStart = tabsContainer.scrollLeft;
    const visibleEnd = visibleStart + tabsContainer.clientWidth;

    if (tabStart < visibleStart || tabEnd > visibleEnd) {
        activeTab.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
            inline: "nearest"
        });
    }
}


// ================================================
// RENDER TAB STRIP
// ================================================

function renderTabs() {

    tabsContainer.innerHTML = "";

    browserState.tabs.forEach(tab => {

        const tabElement = document.createElement("div");

        tabElement.className =
            "tab" + (
                tab.id === browserState.activeTabId
                    ? " active"
                    : ""
            );

        tabElement.setAttribute("role", "tab");
        tabElement.setAttribute(
            "aria-selected",
            String(tab.id === browserState.activeTabId)
        );
        tabElement.setAttribute("aria-label", tab.title || "New Tab");
        tabElement.title = tab.title;

        const favicon = document.createElement("img");
        favicon.className = "tab-favicon";
        favicon.src = "assets/pluto-logo.png";
        favicon.alt = "";
        favicon.setAttribute("aria-hidden", "true");

        const title = document.createElement("span");
        title.className = "tab-title";
        title.textContent = tab.title || "New Tab";

        const closeButton = document.createElement("button");
        closeButton.className = "close-tab";
        closeButton.type = "button";
        closeButton.textContent = "×";
        closeButton.title = "Close tab";
        closeButton.setAttribute(
            "aria-label",
            `Close ${tab.title || "New Tab"}`
        );

        closeButton.addEventListener("click", async event => {

            event.stopPropagation();

            await window.pluto.closeTab(tab.id);

        });

        tabElement.addEventListener("click", async () => {

            await window.pluto.switchTab(tab.id);

        });

        tabElement.append(favicon, title, closeButton);

        tabsContainer.appendChild(tabElement);

    });

    requestAnimationFrame(keepActiveTabVisible);

}

tabsContainer.addEventListener("wheel", event => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

    tabsContainer.scrollLeft += event.deltaY;
    event.preventDefault();
}, { passive: false });


// ================================================
// UPDATE BROWSER INTERFACE
// ================================================

function updateInterface(state) {

    const activeTabChanged = browserState.activeTabId !== state.activeTabId;
    browserState = state;

    renderTabs();

    const activeTab = state.tabs.find(
        tab => tab.id === state.activeTabId
    );

    if (!activeTab) return;

    homePage.hidden = !activeTab.isHome || Boolean(activeTab.errorMessage);
    errorPage.hidden = !activeTab.errorMessage;
    errorMessage.textContent = activeTab.errorMessage || "";

    addressInput.value = activeTab.url || "";
    addressInput.setAttribute("aria-busy", String(activeTab.isLoading));
    document.getElementById("reload").classList.toggle(
        "loading",
        activeTab.isLoading
    );

    document.getElementById("back").disabled =
        !activeTab.canGoBack;

    document.getElementById("forward").disabled =
        !activeTab.canGoForward;

    document.getElementById("reload").disabled =
        activeTab.isHome;

    document.getElementById("saveBookmark").disabled =
        activeTab.isHome;
    document.getElementById("saveBookmark").setAttribute(
        "aria-label",
        activeTab.isHome
            ? "Save bookmark unavailable on the Pluto home page"
            : "Save current webpage as a bookmark"
    );

    if (activeTabChanged && activeTab.isHome && !activeTab.errorMessage) {
        requestAnimationFrame(focusAddressBar);
    }

}

function focusAddressBar() {
    addressInput.focus();
    addressInput.select();
}


// ================================================
// NAVIGATION
// ================================================

async function navigate(input) {

    const value = input.trim();

    if (!value) return;

    try {

        const result = await window.pluto.navigate(value);

        if (result && !result.success) {
            errorMessage.textContent = result.message;
        }

    } catch (error) {

        console.error("Navigation failed:", error);

    }

}


// ================================================
// ADDRESS BAR SEARCH
// ================================================

document.getElementById("addressForm").addEventListener(
    "submit",
    event => {

        event.preventDefault();

        navigate(addressInput.value);

    }
);

addressInput.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        navigate(addressInput.value);
    }
});


// ================================================
// HOMEPAGE SEARCH
// ================================================

document.getElementById("homeSearchForm").addEventListener(
    "submit",
    event => {

        event.preventDefault();

        const input =
            document.getElementById("homeSearchInput");

        navigate(input.value);

        input.value = "";

    }
);


// ================================================
// NEW TAB
// ================================================

document.getElementById("newTab").addEventListener(
    "click",
    () => window.pluto.newTab()
);


// ================================================
// NAVIGATION BUTTONS
// ================================================

document.getElementById("back").onclick =
    () => window.pluto.back();

document.getElementById("forward").onclick =
    () => window.pluto.forward();

document.getElementById("reload").onclick =
    () => window.pluto.reload();

document.getElementById("home").onclick =
    () => window.pluto.home();

document.getElementById("errorHome").addEventListener(
    "click",
    () => window.pluto.home()
);


// ================================================
// PLUTO BRAND — GO TO HOMEPAGE
// ================================================

document.getElementById("brandHome").addEventListener(
    "click",
    () => window.pluto.home()
);


// ================================================
// SAVE BOOKMARK
// ================================================

document.getElementById("saveBookmark").addEventListener(
    "click",
    async () => {

        try {

            const result = await window.pluto.addBookmark();

            showBookmarkMessage(result.message);

            if (result.success && !bookmarksPanel.hidden) {
                await renderBookmarks();
            }

        } catch (error) {

            console.error("Bookmark error:", error);

            showBookmarkMessage("Could not save bookmark.");

        }

    }
);


// ================================================
// SHOW BOOKMARK MESSAGE
// ================================================

function showBookmarkMessage(message) {

    bookmarkMessage.textContent = message || "";

}

function createBookmarkIcon() {
    const fallback = document.createElement("span");
    fallback.className = "bookmark-item-icon fallback";
    fallback.textContent = "★";
    fallback.setAttribute("aria-hidden", "true");
    return fallback;
}


// ================================================
// RENDER BOOKMARKS
// ================================================

async function renderBookmarks() {

    bookmarksList.innerHTML = "";

    try {

        const bookmarks = await window.pluto.getBookmarks();
        const searchTerm = bookmarkSearchInput.value.trim().toLowerCase();
        const filtered = bookmarks.filter(bookmark =>
            !searchTerm ||
            (bookmark.title || "").toLowerCase().includes(searchTerm) ||
            (bookmark.url || "").toLowerCase().includes(searchTerm)
        );

        bookmarkCount.textContent =
            `${filtered.length} ${filtered.length === 1 ? "bookmark" : "bookmarks"}`;

        if (!filtered.length) {

            const emptyMessage = document.createElement("p");

            emptyMessage.className = "empty-bookmarks";
            emptyMessage.textContent = bookmarks.length
                ? "No bookmarks match your search."
                : "Save a page to find it here later.";

            bookmarksList.appendChild(emptyMessage);

            return;
        }

        filtered.forEach(bookmark => {

            const item = document.createElement("div");
            item.className = "bookmark-item";

            const details = document.createElement("div");
            details.className = "bookmark-details";

            const title = document.createElement("div");
            title.className = "bookmark-title";
            title.textContent = bookmark.title || bookmark.url;

            const url = document.createElement("div");
            url.className = "bookmark-url";
            url.textContent = bookmark.url;

            details.append(title, url);

            const actions = document.createElement("div");
            actions.className = "bookmark-actions";

            // OPEN BOOKMARK

            const openButton = document.createElement("button");

            openButton.type = "button";
            openButton.textContent = "Open";
            openButton.title = "Open bookmark";

            openButton.addEventListener("click", async () => {

                bookmarksPanel.hidden = true;

                await window.pluto.setBookmarksPanel(false);

                await window.pluto.openBookmark(bookmark.url);

            });

            // DELETE BOOKMARK

            const deleteButton = document.createElement("button");

            deleteButton.type = "button";
            deleteButton.textContent = "×";
            deleteButton.title = "Delete bookmark";
            deleteButton.className = "delete-bookmark";

            deleteButton.addEventListener("click", async () => {

                await window.pluto.removeBookmark(bookmark.url);

                showBookmarkMessage("Bookmark removed.");

                await renderBookmarks();

            });

            actions.append(openButton, deleteButton);

            item.append(createBookmarkIcon(), details, actions);

            bookmarksList.appendChild(item);

        });

    } catch (error) {

        console.error("Could not display bookmarks:", error);

        showBookmarkMessage("Could not load bookmarks.");

    }

}


// ================================================
// TOGGLE BOOKMARKS PANEL
// ================================================

document.getElementById("bookmarksButton").addEventListener(
    "click",
    async () => {

        bookmarksPanel.hidden = !bookmarksPanel.hidden;

        if (!bookmarksPanel.hidden && !historyPanel.hidden) {
            historyPanel.hidden = true;
            await window.pluto.setHistoryPanel(false);
        }

        await window.pluto.setBookmarksPanel(
            !bookmarksPanel.hidden
        );

        if (!bookmarksPanel.hidden) {

            showBookmarkMessage("");
            bookmarkSearchInput.value = "";

            await renderBookmarks();

        }

    }
);


// ================================================
// CLOSE BOOKMARKS PANEL
// ================================================

document.getElementById("closeBookmarks").addEventListener(
    "click",
    async () => {

        bookmarksPanel.hidden = true;

        await window.pluto.setBookmarksPanel(false);

    }
);

bookmarkSearchInput.addEventListener("input", renderBookmarks);


// ================================================
// BROWSING HISTORY SIDE PANEL
// ================================================

function historyDateLabel(dateValue) {
    const date = new Date(dateValue);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const sameDay = (a, b) =>
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();

    if (sameDay(date, today)) return "Today";
    if (sameDay(date, yesterday)) return "Yesterday";
    return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function formatHistoryTime(dateValue) {
    return new Date(dateValue).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

async function renderHistory() {
    historyList.replaceChildren();

    try {
        const entries = await window.pluto.getHistory();
        const searchTerm = historySearchInput.value.trim().toLowerCase();
        const filtered = entries.filter(entry =>
            !searchTerm ||
            (entry.title || "").toLowerCase().includes(searchTerm) ||
            (entry.url || "").toLowerCase().includes(searchTerm) ||
            (entry.query || "").toLowerCase().includes(searchTerm)
        );

        historyCount.textContent = `${filtered.length} ${filtered.length === 1 ? "entry" : "entries"}`;

        if (filtered.length === 0) {
            const empty = document.createElement("p");
            empty.className = "empty-history";
            empty.textContent = entries.length ? "No history matches your search." : "Websites you visit will appear here.";
            historyList.appendChild(empty);
            return;
        }

        const groups = new Map();
        filtered.forEach(entry => {
            const label = historyDateLabel(entry.visitedAt);
            if (!groups.has(label)) groups.set(label, []);
            groups.get(label).push(entry);
        });

        for (const [label, groupEntries] of groups) {
            const section = document.createElement("section");
            section.className = "history-day-group";
            const heading = document.createElement("h3");
            heading.textContent = label;
            section.appendChild(heading);

            groupEntries.forEach(entry => {
                const item = document.createElement("article");
                item.className = "history-item";

                const open = document.createElement("button");
                open.className = "history-entry-open";
                open.type = "button";
                open.title = "Open this page";

                const marker = document.createElement("span");
                marker.className = "history-entry-icon";
                marker.textContent = entry.kind === "search" ? "⌕" : "↗";

                const details = document.createElement("span");
                details.className = "history-entry-details";
                const title = document.createElement("span");
                title.className = "history-entry-title";
                title.textContent = entry.title || entry.url;
                const url = document.createElement("span");
                url.className = "history-entry-url";
                url.textContent = entry.kind === "search" ? `Search · ${entry.query || ""}` : entry.url;
                details.append(title, url);
                open.append(marker, details);
                open.addEventListener("click", async () => {
                    await window.pluto.openHistoryEntry(entry.url);
                    historyPanel.hidden = true;
                    await window.pluto.setHistoryPanel(false);
                });

                const time = document.createElement("span");
                time.className = "history-entry-time";
                time.textContent = formatHistoryTime(entry.visitedAt);

                const remove = document.createElement("button");
                remove.className = "history-entry-delete";
                remove.type = "button";
                remove.title = "Remove from history";
                remove.setAttribute("aria-label", "Remove history entry");
                remove.textContent = "×";
                remove.addEventListener("click", async () => {
                    await window.pluto.removeHistoryEntry(entry.id);
                    await renderHistory();
                });

                item.append(open, time, remove);
                section.appendChild(item);
            });

            historyList.appendChild(section);
        }
    } catch (error) {
        console.error("Could not load browsing history:", error);
        historyList.textContent = "Could not load browsing history.";
    }
}

async function closeHistoryPanel() {
    historyPanel.hidden = true;
    await window.pluto.setHistoryPanel(false);
}

document.getElementById("historyButton").addEventListener("click", async () => {
    const shouldOpen = historyPanel.hidden;
    if (shouldOpen) {
        bookmarksPanel.hidden = true;
        await window.pluto.setBookmarksPanel(false);
        historyPanel.hidden = false;
        await window.pluto.setHistoryPanel(true);
        historySearchInput.value = "";
        await renderHistory();
        historySearchInput.focus();
    } else {
        await closeHistoryPanel();
    }
});

document.getElementById("closeHistory").addEventListener("click", closeHistoryPanel);
historySearchInput.addEventListener("input", renderHistory);
document.getElementById("clearHistory").addEventListener("click", async () => {
    const entries = await window.pluto.getHistory();
    if (!entries.length) return;

    const confirmed = window.confirm(
        "Clear all browsing history and search history?"
    );

    if (!confirmed) return;

    await window.pluto.clearHistory();
    await renderHistory();
});

// ================================================
// RECEIVE STATE FROM ELECTRON
// ================================================

window.pluto.onState(updateInterface);
window.pluto.onFocusAddress(focusAddressBar);

// Load initial browser state

window.pluto.getState().then(updateInterface);



// ================================================
// KEYBOARD SHORTCUTS
// ================================================

window.addEventListener("keydown", event => {

    if (
        event.defaultPrevented ||
        event.isComposing ||
        !event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
    ) {
        return;
    }

    const key = event.key.toLowerCase();

    // Command + T → New tab
    if (key === "t") {
        event.preventDefault();
        window.pluto.newTab();
    }

    // Command + W → Close active tab
    if (key === "w") {
        event.preventDefault();

        if (browserState.activeTabId) {
            window.pluto.closeTab(browserState.activeTabId);
        }
    }

    // Command + L → Focus address bar
    if (key === "l") {
        event.preventDefault();
        focusAddressBar();
    }

    // Escape closes whichever side panel is open.
    if (event.key === "Escape" && !historyPanel.hidden) {
        event.preventDefault();
        event.stopPropagation();
        closeHistoryPanel();
    } else if (event.key === "Escape" && !bookmarksPanel.hidden) {
        event.preventDefault();
        event.stopPropagation();
        bookmarksPanel.hidden = true;
        window.pluto.setBookmarksPanel(false);
    }

}, true);
