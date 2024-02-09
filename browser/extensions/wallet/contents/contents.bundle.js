/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ 8012:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


// ref: https://github.com/getAlby/lightning-browser-extension/blob/master/src/extension/content-script/webln.js
Object.defineProperty(exports, "__esModule", ({ value: true }));
const shouldInject_1 = __webpack_require__(628);
// WebLN calls that can be executed from the WebLNProvider.
// Update when new calls are added
const weblnCalls = [
    "webln/enable",
    "webln/getInfo",
    "webln/lnurl",
    "webln/sendPaymentOrPrompt",
    "webln/sendPaymentAsyncWithPrompt",
    "webln/keysendOrPrompt",
    "webln/makeInvoice",
    "webln/signMessageOrPrompt",
    "webln/getBalanceOrPrompt",
    "webln/request",
    "webln/on",
    "webln/emit",
    "webln/off",
    "webln/isEnabled",
];
// calls that can be executed when webln is not enabled for the current content page
const disabledCalls = ["webln/enable", "webln/isEnabled"];
let isEnabled = false; // store if webln is enabled for this content page
let isRejected = false; // store if the webln enable call failed. if so we do not prompt again
async function init() {
    if (!(0, shouldInject_1.shouldInject)()) {
        return;
    }
    browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
        console.log("content-script onMessage", request);
        // forward account changed messaged to inpage script
        if (request.action === "accountChanged" && isEnabled) {
            window.postMessage({ action: "accountChanged", scope: "webln" }, window.location.origin);
        }
    });
    // message listener to listen to inpage webln/webbtc calls
    // those calls get passed on to the background script
    // (the inpage script can not do that directly, but only the inpage script can make webln available to the page)
    window.addEventListener("message", async (ev) => {
        console.log("content-script eventListener message", ev);
        // Only accept messages from the current window
        if (ev.source !== window ||
            ev.data.application !== "SSB" ||
            ev.data.scope !== "webln") {
            return;
        }
        if (ev.data && !ev.data.response) {
            // if an enable call railed we ignore the request to prevent spamming the user with prompts
            if (isRejected) {
                postMessage(ev, {
                    error: "webln.enable() failed (rejecting further window.webln calls until the next reload)",
                });
                return;
            }
            // limit the calls that can be made from webln
            // only listed calls can be executed
            // if not enabled only enable can be called.
            const availableCalls = isEnabled ? weblnCalls : disabledCalls;
            if (!availableCalls.includes(ev.data.action)) {
                console.error("Function not available. Is the provider enabled?");
                return;
            }
            const message = {
                // every call call is scoped in `public`
                // this prevents websites from accessing internal actions
                action: `public/${ev.data.action}`,
                args: ev.data.args,
                application: "SSB",
                public: true, // indicate that this is a public call from the content script
                prompt: true,
            };
            const replyFunction = (response) => {
                // if it is the enable call we store if webln is enabled for this content script
                if (ev.data.action === "webln/enable") {
                    isEnabled = response.data?.enabled;
                    const enabledEvent = new Event("webln:enabled");
                    window.dispatchEvent(enabledEvent);
                    if (response.error) {
                        console.error(response.error);
                        console.info("Enable was rejected ignoring further webln calls");
                        isRejected = true;
                    }
                }
                if (ev.data.action === "webln/isEnabled") {
                    isEnabled = response.data?.isEnabled;
                }
                postMessage(ev, response);
            };
            console.log("content-script sendMessage", message);
            return browser.runtime
                .sendMessage(message)
                .then(replyFunction)
                .catch(replyFunction);
        }
    });
}
init();
function postMessage(ev, response) {
    window.postMessage({
        id: ev.data.id,
        application: "SSB",
        response: true,
        data: response,
        scope: "webln",
    }, window.location.origin);
}


/***/ }),

/***/ 628:
/***/ ((__unused_webpack_module, exports) => {


// ref: https://github.com/joule-labs/joule-extension/blob/develop/src/content_script/shouldInject.ts
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.shouldInject = void 0;
// Checks the doctype of the current document if it exists
function doctypeCheck() {
    if (window && window.document && window.document.doctype) {
        return window.document.doctype.name === "html";
    }
    return true;
}
// Returns whether or not the extension (suffix) of the current document is prohibited
function suffixCheck() {
    const prohibitedTypes = [/\.xml$/, /\.pdf$/];
    const currentUrl = window.location.pathname;
    for (const type of prohibitedTypes) {
        if (type.test(currentUrl)) {
            return false;
        }
    }
    return true;
}
// Checks the documentElement of the current document
function documentElementCheck() {
    // todo: correct?
    if (!document || !document.documentElement) {
        return false;
    }
    const docNode = document.documentElement.nodeName;
    if (docNode) {
        return docNode.toLowerCase() === "html";
    }
    return true;
}
function shouldInject() {
    const isHTML = doctypeCheck();
    const noProhibitedType = suffixCheck();
    const hasDocumentElement = documentElementCheck();
    return isHTML && noProhibitedType && hasDocumentElement;
}
exports.shouldInject = shouldInject;


/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry need to be wrapped in an IIFE because it need to be isolated against other modules in the chunk.
(() => {
var exports = __webpack_exports__;
var __webpack_unused_export__;

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
__webpack_unused_export__ = ({ value: true });
/* eslint-env webextensions */
__webpack_require__(8012);
console.info("content-script working!", browser.runtime.getURL("inpages/inpages.bundle.js"));
function loadInpageScript(url) {
    try {
        if (!document)
            throw new Error("No document");
        const container = document.head || document.documentElement;
        if (!container)
            throw new Error("No container element");
        const scriptEl = document.createElement("script");
        scriptEl.setAttribute("async", "false");
        scriptEl.setAttribute("type", "text/javascript");
        scriptEl.setAttribute("src", url);
        container.appendChild(scriptEl);
    }
    catch (err) {
        console.error("WebLN injection failed", err);
    }
}
loadInpageScript(browser.runtime.getURL("inpages/inpages.bundle.js"));

})();

/******/ })()
;