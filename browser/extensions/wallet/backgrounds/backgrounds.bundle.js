/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 952:
/***/ (() => {

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
/* eslint-env webextensions */
browser.webNavigation.onCompleted.addListener(() => {
    console.log("This is my favorite website!");
    browser.tabs
        .query({
        currentWindow: true,
        active: true,
        highlighted: true,
    })
        .then(sendMessageToTab)
        .catch(onError);
});
function onError(error) {
    console.error(`Error: ${error}`);
}
async function sendMessageToTab(tabs) {
    const credentials = await browser.addonsWallet.getAllCredentials();
    console.log("credentials", tabs.length, credentials);
    for (const tab of tabs) {
        browser.tabs
            .sendMessage(tab.id, { credentials })
            .then((response) => {
            console.log("Message from the content script:");
            console.log(response.response);
        })
            .catch(onError);
    }
}


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
// This entry need to be wrapped in an IIFE because it need to be in strict mode.
(() => {
"use strict";
var exports = __webpack_exports__;
var __webpack_unused_export__;

__webpack_unused_export__ = ({ value: true });
__webpack_require__(952);
console.log("backgrounds");

})();

/******/ })()
;