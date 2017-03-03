/*
 * Copyright (c) 2017, Mert Bora ALPER <bora@boramalper.org>
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
 * ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
**/

"use strict";


/* =====================================================================================================================
 *                                            P U B L I C    I N T E R F A C E
 *                                          (which may be called from popup.js)
 * =====================================================================================================================
 */

/**
 * Goes forward or backward to a specific page in the history of a tab.
 * @param {Number} tabId - Must be an integer.
 * @param {Number} pageId - Must be an integer.
 * @return {undefined}
**/
function goInHistory(tabId, pageId) {
    console.debug("goInHistory is invoked! (tabId: %d, pageId: %d)", tabId, pageId);

    let theTab = tabs_e.querySelector("tab[id='{0}']".format(tabId));
    assert(theTab);
    let thePage = theTab.querySelector("page[id='{0}']".format(pageId));
    assert(thePage);

    theTab.setAttribute("currentPageId", pageId);
    chrome.tabs.update(tabId, {url: thePage.getAttribute("url")});
}

/* =====================================================================================================================
 *                                          P R I V A T E    F U N C T I O N S
 * =====================================================================================================================
 */

/**
 * tabId -> idGenerator for pages
**/
var tabs_e = undefined, pageIdGenerators = {};


/**
 * Initializes `background.html` and registers all currently open tabs when `background.html` is ready.
 * @return {undefined}
 */
function initialize() {
    console.debug("Initializing background...");

    tabs_e = document.querySelector("tabs");
    assert(tabs_e);

    // Register all the tabs
    chrome.tabs.query({}, function(tabs_t) {
        for (let tab_t of tabs_t) {
            if (tab_t.id && tab_t.url) {
                registerTab(tab_t);
            }
            else {
                console.debug("Skipping registration of tab as it lacks at least an ID or an URL! ( tab:", tab_t, ")");
            }
        }
    });

    console.debug("Background initialized.");
};
window.onload = initialize;


/*
 * Listens to register the newly created tab.
**/
chrome.tabs.onCreated.addListener(function(tab_t) {
    if (tab_t.id && tab_t.url) {
        registerTab(tab_t);
    }
    else {
        console.debug("Skipping registration of tab as it lacks at least an ID or an URL! ( tab:", tab_t, ")");
    }
});


/**
 * Registers the new tab @param tab_t to the background.html
 * @param {Object} tab_t - Tab object (see https://developer.chrome.com/extensions/tabs#type-Tab).
 * @param {Number} tab_t.id - Must be an integer.
 * @param {String} tab_t.url
 * @param {String} tab_t.title - Optional.
 * @param {String} tab_t.favIconUrl - Optional.
 * @return {Element} The tab element.
**/
function registerTab(tab_t) {
    console.debug("Registering new Tab... ( tab:", tab_t, ")");

    assert(tab_t.id && tab_t.url);

    let tab_e = document.createElement("tab");
    tab_e.id = tab_t.id;
    pageIdGenerators[tab_t.id] = idGenerator();

    let initialPage = document.createElement("page");
    initialPage.id = pageIdGenerators[tab_t.id].next().value;
    initialPage.setAttribute("url", tab_t.url);
    initialPage.setAttribute("title", tab_t.title ? tab_t.title : "");
    initialPage.setAttribute("favIconUrl", tab_t.favIconUrl ? tab_t.favIconUrl : "");

    tab_e.setAttribute("currentPageId", initialPage.id);

    tab_e.appendChild(initialPage);
    tabs_e.appendChild(tab_e);

    return tab_e;
}

/*
 * Listens to print debug messages when a tab is replaced.
**/
chrome.webNavigation.onTabReplaced.addListener(function(details) {
    console.debug("Tab #%d is replaced with tab #%d!", details.replacedTabId, details.tabId);
});

/*
 * Listens to commit a new page, when the new page is registered using History API.
 *
 * This is often the case with websites such as YouTube where the content is dynamically loaded by the client-side
 * queries and then the result page is registered using the History API.
**/
chrome.webNavigation.onHistoryStateUpdated.addListener(function(details) {
    console.debug("History state is updated: ( details:", details, ")");

    // TODO: explain why there is timeout?
    window.setTimeout(function() {
        commit(details);
    }, 1500);
});


/*
 * Listens to commit a new page, when the page is "committed" by the webNavigation.
**/
chrome.webNavigation.onCommitted.addListener(function(details) {
    console.debug("webNavigation committed a new page: ( details:", details, ")");

    /* Filter uninteresting changes:
     *     * `details_frameId === 0` indicates that "the navigation happens in the tab content window; a positive value
     *       indicates navigation in a subframe."[0] We are always interested in any changes in the tab content window
     *       [0]: https://developer.chrome.com/extensions/webNavigation#event-onCommitted
     *
     *     * `details.transitionType === "manual_subframe"` indicates that the change was "explicitly requested by the
     *        user and generate(s) new navigation entries in the back/forward list."[1] We should be interested in this
     *        as well, and also as it generates new navigation entries in the back/forward list, we should adhere the
     *        conventions.
     *        [1]: https://developer.chrome.com/extensions/history#transition_types
     */
    if (details.frameId !== 0 && details.transitionType !== "manual_subframe") {
        console.debug("Event ignored!");
        return;
    }

    /* `webNavigation.onCommitted` event does not guarantee that the document (and the resources it refers to, such as
     * images and subframes) are completely downloaded but merely means "part of the document has been received from the
     * server and the browser has decided to switch to the new document."[0] Hence, hoping that 1 second is enough for
     * the details that we are interested in to be loaded.
     * [0]: https://developer.chrome.com/extensions/webNavigation#event-onCommitted
     */
    window.setTimeout(function() {
        commitPage(details);
    }, 1500);
});


function commitPage(details)
{
    console.debug("Will commit a page... ( details:", details, ")");

    /* This is the reason why `commitPage()`s execution is delayed; the `tab.title` and `tab.favIconUrl` might not be
     * loaded/present at the time when `webNavigation.onCommitted` event is fired so we hope that they will be ready
     * after the delay. Clearly, this is a hack to be fixed with a correct solution. #TODO
     */
    chrome.tabs.get(details.tabId, function(tab_t) {
        __commitPage(details, tab_t);
    });

function __commitPage(details, theTab_t) {
    console.debug("Committing a page ( details:", details, ", tab:", theTab_t, ")");

    let theTab_e = tabs_e.querySelector("tab[id='{0}']".format(details.tabId));
    if (!theTab_e) {
        console.debug("Record for tab #%d could not be found in `background.html` (either the URL starts with " +
            "'chrome*://' or it must be a background [pre-loading] tab). ( details:", details.tabId, ")"
        );
        return;
    }

    let currentPage = theTab_e.querySelector("page[id='{0}']".format(theTab_e.getAttribute("currentPageId")));

    let currentUrl = parseUrl(currentPage.getAttribute("url"));
    let newUrl = parseUrl(details.url);

    /* There are two pre-conditions where the condition below will hold true:
     *     1. The page is refreshed.
     *     2. `goInHistory()` is invoked to go back/forward in history. As `goInHistory()` sets the currentPage to the
     *        page that is being travelled, here in `commitPage()` the URLs of the "new" page and the "current" page
     *        will be the same.
     *
     * In *any* case, it can be safely ignored.
     */
    if (currentUrl.source === newUrl.source) {
        console.debug("URLs are same, skipping!");
        return;
    }

    /* Checks if the transition was caused by back/forward buttons:
     *     If it is the case, `findUrlinBranch()` is called to find the URL in the history branch of the currentPage:
     *         If found, the `currentPageId` of `theTab_e` is set to the `foundPage` and return from the function.
     *         Else, a warning message is printed and we treat the transition as if it was not caused by back/forward
     *           buttons. This is the case if there was/were open tab(s) at the when the plugin started running. Might
     *           be problematic with pinned tabs. #TODO.
     */
    if (details.transitionQualifiers.indexOf("forward_back") !== -1) {
        let foundPage = findUrlinBranch(currentPage, newUrl.source);
        if (foundPage) {
            theTab_e.setAttribute("currentPageId", foundPage.id);
            return;
        }

        console.warn("The new URL (", newUrl, ") could not be found in the history branch of the current page (",
            currentPage, "); treating the transition as a regular one. Inconsistency between browser and the " +
            "extension is expected!"
        );
    }


    /* Checks if the current and the new URL are significantly different.
     * `webNavigation.onCommitted` is fired even if the change in the URL of the tab is insignificant, such as the
     * change in hash (which might be significant in some exceptional cases on specific websites, see the documentation
     * of `areUrlsDifferent()`).
     *
     * If the difference between the two URLs are deemed to be not significant enough, the transition will be ignored.
     */
    if (!areUrlsDifferent(currentUrl, newUrl)) {
        console.info("The difference between the two URLs ( current:", currentUrl, " new: ", newUrl, ") are deemed " +
        "to be not significant enough, skipping!"
        );
        return;
    }

    let newPage = document.createElement("page");
    newPage.id = pageIdGenerators[details.tabId].next().value;
    newPage.setAttribute("url", newUrl.source);
    newPage.setAttribute("title", theTab_t.title);
    newPage.setAttribute("favIconUrl", theTab_t.favIconUrl ? theTab_t.favIconUrl : "");
    currentPage.appendChild(newPage);
    theTab_e.setAttribute("currentPageId", newPage.id);
}  // END OF __commitPage
}  // END OF commitPage

/**
 * Finds a URL in the history branch of a page; prioritizing ancestors(parents) before descendants(children).
 * @param {Element} thePage
 * @param {String} url
 * @return {Element} If found, else returns `null`.
**/
function findUrlinBranch(thePage, url) {
    // First, search the parents of `thePage` upwards to prioritize ancestors (parents) before descendants.
    for (let curPage = thePage.parentElement;
         curPage.nodeName.toLowerCase() === "page";
         curPage = curPage.parentElement)
    {
        if (curPage.getAttribute("url") === url) {
            return curPage;
        }
    }

    // Second, search the children of `thePage` downwards.
    return thePage.querySelector("page[url='{0}']".format(url));
}


/*
 * Listens to remove the history tree and (page) idGenerator of a removed tab.
**/
chrome.tabs.onRemoved.addListener(function(tabId) {
    let theTab_e = tabs_e.querySelector("tab[id='{0}']".format(tabId));
    theTab_e.parentNode.removeChild(theTab_e);
    delete pageIdGenerators[tabId];
});


/* ---------------------------------------------------------------------------------------------------------------------
 *                                         U T I L I T Y    F U N C T I O N S
 * ---------------------------------------------------------------------------------------------------------------------
 */


 /**
  * Compares two URLs to decide whether the difference between them is significant enough or not.
  * @param {String} url1
  * @param {String} url2
  * @return {Boolean} `true` if the URLs are significantly different and `false` if not.
  */
function areUrlsDifferent(url1, url2) {
    /* If both URLs has no hashes, it means that the change must be in any other component of the URL (host, file,
     * query etc.) which is definitely significant.
     */
    if (url1.hash === "" && url2.hash === "") {
        return true;
    }
    else {
        /* The hashes have changed but we do not know yet if other components of the URL has changed as well or not so
         * let us check.
         */

        console.log("DDDDD", url1, url2);
        if ((url1.protocol !== url2.protocol && !(url1.protocol === "http" && url2.protocol === "https"))
            || url1.host !== url2.host || url1.port !== url2.port || url1.query !== url2.query)
        {
            return true;
        }

        /* E X C E P T I O N S
         *
         * Google:
         *     Google uses hashes to query results through JavaScript instead of sending a request each time.
         */

        // Google
        /* TODO: It is not guaranteed that it belongs to Google (it may be www.google.boramalper.org as well) but
         *       this should suffice for the time being.
         */
        if (url1.host.startsWith("www.google.") && url2.host.startsWith("www.google.")) {
            return true;
        }

        return false;
    }
}


/**
  * Serial integer ID generator.
  * @return {Generator} Generator that generates serial integer IDs.
  *
  * Source: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/function*
***/
function* idGenerator() {
    var index = 0;
    for (;;) {
        yield index++;
    }
}

/**
 * Assert function that raises a new `Error` on failure.
 * @param {Boolean} statement - Statement to be checked if it is true.
 * @param arguments - Variadic arguments to be passed to `console.assert()`.
**/
function assert() {
    if (arguments.length < 1) {
        throw new Error("assert is supplied with insufficient number of arguments!");
    }

    console.assert.apply(this, arguments);
    if (!arguments[0]) {
        throw new Error("assertion failed!");
    }
}

/**
 * Parses a URL into `source`, `protocol`, `host`, `port`, `query`, and `hash` using DOM.
 * @return {Object}
 *
 * Source: https://j11y.io/javascript/parsing-urls-with-the-dom/
**/
function parseUrl(url) {
    var a =  document.createElement('a');
    a.href = url;
    return {
        source: url,
        protocol: a.protocol.replace(':',''),
        host: a.hostname,
        port: a.port,
        query: a.search,
        hash: a.hash.replace('#','')
    };
}


/**
 * Substitutes `{\d}`s in Strings all at once.
 * Source: http://stackoverflow.com/a/4673436/4466589
**/
if (!String.prototype.format) {
    String.prototype.format = function() {
        var args = arguments;
        return this.replace(/{(\d+)}/g, function(match, number) {
            return typeof args[number] != 'undefined' ? args[number] : match;
        });
    };
}
