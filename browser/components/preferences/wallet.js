/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/* import-globals-from preferences.js */

var gWalletPane = {
  initialized: false,

  init() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    document
      .getElementById("walletCategory")
      .removeAttribute("data-hidden-from-search");
    document
      .getElementById("walletCategory-header")
      .removeAttribute("data-hidden-from-search");
    document
      .getElementById("walletCategory-body")
      .removeAttribute("data-hidden-from-search");
  },
};
