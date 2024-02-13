/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/* eslint-env webextensions */

import { shouldInject } from "../shared/shouldInject"
import WebLNProvider from "./webln"

console.info("inpage-script working!")

function init() {
  if (!shouldInject() || window.webln !== undefined) {
    return
  }
  window.webln = new WebLNProvider()
  console.info("inages webln injected!", window.webln)
  const readyEvent = new Event("webln:ready")
  window.dispatchEvent(readyEvent)

  // Listen for webln events from the extension
  // emit events to the websites
  window.addEventListener("message", (event) => {
    if (event.source === window && event.data.action === "accountChanged") {
      eventEmitter(event.data.action, event.data.scope)
    }
  })
}

function eventEmitter(action, scope) {
  if (window[scope] && window[scope].emit) {
    window[scope].emit(action)
  }
}
init()

// The demo of webln.getInfo
window.webln
  .enable()
  .then(() => {
    console.log("webln enabled!")
    return window.webln.getInfo()
  })
  .then((res) => {
    if (res) {
      console.log("Good! You've achieved `webln.getInfo`", res)
    } else {
      console.log("Sad...You've not achieved `webln.getInfo`", res)
    }
  })
