/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
/* global RPMGetStringPref:false */

interface Window {
  WALLET_PANEL: any
}
declare let window: Window

import HomeOverlay from "./home/overlay"
// import walletPanelMessaging from "./messages.js";

// eslint-disable-next-line no-var
var WALLET_PANEL = function () {}

WALLET_PANEL.prototype = {
  initHome() {
    this.overlay = new HomeOverlay()
    this.init()
  },

  setupObservers() {
    this.setupMutationObserver()
    // Mutation observer isn't always enough for fast loading, static pages.
    // Sometimes the mutation observer fires before the page is totally visible.
    // In this case, the resize tries to fire with 0 height,
    // and because it's a static page, it only does one mutation.
    // So in this case, we have a backup intersection observer that fires when
    // the page is first visible, and thus, the page is going to guarantee a height.
    this.setupIntersectionObserver()
  },

  init() {
    if (this.inited) {
      return
    }
    this.setupObservers()
    this.inited = true
  },

  resizeParent() {
    let clientHeight = document.body.clientHeight
    if (this.overlay.tagsDropdownOpen) {
      clientHeight = Math.max(clientHeight, 252)
    }

    // We can ignore 0 height here.
    // We rely on intersection observer to do the
    // resize for 0 height loads.
    if (clientHeight) {
      // walletPanelMessaging.sendMessage("WALLET_resizePanel", {
      //   width: document.body.clientWidth,
      //   height: clientHeight,
      // });
    }
  },

  setupIntersectionObserver() {
    const observer = new IntersectionObserver((entries) => {
      if (entries.find((e) => e.isIntersecting)) {
        this.resizeParent()
        observer.unobserve(document.body)
      }
    })
    observer.observe(document.body)
  },

  setupMutationObserver() {
    // Select the node that will be observed for mutations
    const targetNode = document.body

    // Options for the observer (which mutations to observe)
    const config = { attributes: false, childList: true, subtree: true }

    // Callback function to execute when mutations are observed
    const callback = (mutationList, observer) => {
      mutationList.forEach((mutation) => {
        switch (mutation.type) {
          case "childList": {
            /* One or more children have been added to and/or removed
               from the tree.
               (See mutation.addedNodes and mutation.removedNodes.) */
            this.resizeParent()
            break
          }
        }
      })
    }

    // Create an observer instance linked to the callback function
    const observer = new MutationObserver(callback)

    // Start observing the target node for configured mutations
    observer.observe(targetNode, config)
  },

  create() {
    this.overlay.create()
  },
}

window.WALLET_PANEL = WALLET_PANEL
// window.walletPanelMessaging = walletPanelMessaging;
