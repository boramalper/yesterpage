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

window.onload = function() {
    document.querySelector("#footer a").onclick = function() {
        chrome.tabs.create({url: "http://boramalper.org"});
    }

    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (tabs.length !== 1) {
            console.assert(tabs.length === 1);
            throw new Error("cannot get the current tab!");
        }

        console.assert(tabs[0].id);

        main(tabs[0]);
    });
};


function main(currentTab) {
    let backgroundPage = chrome.extension.getBackgroundPage();
    if (backgroundPage === null) {
        console.assert(backgroundPage !== null);
        throw new Error("background page cannot found!");
    }

    let theTabTree = backgroundPage.document.querySelector("tab[id='" + currentTab.id + "']");
    let allResources = theTabTree.querySelectorAll("page");

    console.log(">>> Total %d resources found", allResources.length, allResources);

    var nodes = [], edges = [];
    for (let i=0; i < allResources.length; ++i) {
        let currentPage = allResources[i];

        console.log(">>> Iterating resource#%s...", currentPage.id);

        nodes.push({
            id: "" + currentPage.id,
            title: currentPage.getAttribute("url"),
            label: truncateString(currentPage.getAttribute("title"), 20),
            shape: "image",
            shapeProperties: {
                useBorderWithImage: true
            },
            image: currentPage.getAttribute("favIconUrl"),
            brokenImage: detectBrowser() === "chrome" ? "chrome://favicon/" + currentPage.getAttribute("url")  : "../assets/default-favicon.png",
            size: 16,
            color: {
                border: "#F2F2F2",
                background: "#F2F2F2"
            },
            font: {
                face: "Helvetica"
            }
        });

        if (currentPage.parentNode.nodeName.toLowerCase() !== "page") {
            continue;
        }

        let parentResource = currentPage.parentNode;
        console.log("PPP found parent resource id: %s", parentResource.id);

        edges.push({
            from: "" + parentResource.id,
            to: "" + currentPage.id,
            color: {
                color: "#000000"
            }
        });

        console.log("FROM " + parentResource.id + " TO " + currentPage.id);
    }

    let historyGraphDiv = document.querySelector("#history-graph");
    let graphOptions = {
        interaction: {
            tooltipDelay: 0,
            dragNodes: false
        },
        layout: {
            hierarchical: {
                direction: "LR",
                sortMethod: "directed"
            }
        },
        physics: {
            enabled: false
        }
    };

    let visNetwork = new vis.Network(historyGraphDiv, {nodes: nodes, edges: edges}, graphOptions);

    visNetwork.on("click", function (params) {  // params.nodes
        console.assert(params.nodes.length === 1);
        let selectedNodeId = parseInt(params.nodes[0]);

        console.log("selected node", params.nodes, selectedNodeId);
        backgroundPage.goInHistory(currentTab.id, selectedNodeId);
    });
}


function truncateString(str, maxLength) {
    if (str.length <= maxLength) {
        return str;
    }

    return str.slice(0, maxLength - 3) + "...";
}


function detectBrowser() {
     if (typeof InstallTrigger !== 'undefined') {
         return "firefox";
     }
     else if (!!window.chrome && !!window.chrome.webstore) {
         return "chrome";
     }
     else {
         return "undefined";
     }
}