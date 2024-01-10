/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/* import-globals-from preferences.js */

var gWalletPane = {
  initialized: false,

  onLncRegistClick(event) {
    const phrase = document
      .getElementById("lnc-pairphrase");
    const value = phrase.value;

    console.log("lnc pairphrase",value);
    window.lnAdapter = value;
  },

  init() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    window.lnAdapter = {};

    document
      .getElementById("walletCategory")
      .removeAttribute("data-hidden-from-search");
    document
      .getElementById("walletCategory-header")
      .removeAttribute("data-hidden-from-search");
    document
      .getElementById("walletCategory-body")
      .removeAttribute("data-hidden-from-search");

    document
      .getElementById("lnc-register")
      .addEventListener("click", this.onLncRegistClick.bind(this));
  },
};
