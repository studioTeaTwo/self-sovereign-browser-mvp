/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 84:
/***/ (() => {

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
        scriptEl.src = url;
        container.insertBefore(scriptEl, container.children[0]);
        container.removeChild(scriptEl);
    }
    catch (err) {
        console.error("injection failed", err);
    }
}
loadInpageScript(browser.runtime.getURL("inpages/inpages.bundle.js"));
console.log("wallet! contentscript", window.TEST10, browser.runtime.getURL("inpages/inpages.bundle.js"));
browser.runtime.onMessage.addListener((request) => {
    console.log("Message from the background script:");
    console.log(request.credentials);
    return Promise.resolve({ response: "Hi from content script" });
});


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
__webpack_require__(84);
console.log("contents");

})();

/******/ })()
;