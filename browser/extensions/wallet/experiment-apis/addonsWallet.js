/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* globals ExtensionAPI, Services, XPCOMUtils */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  WalletHelper: "resource://gre/modules/WalletHelper.sys.mjs",
});

this.addonsWallet = class extends ExtensionAPI {

  getAPI(context) {
    let EventManager = ExtensionCommon.EventManager;

    return {
      addonsWallet: {
        // If you are checking for 'nightly', also check for 'nightly-try'.
        //
        // Otherwise, just use the standard builds, but be aware of the many
        // non-standard options that also exist (as of August 2018).
        //
        // Standard builds:
        //   'esr' - ESR channel
        //   'release' - release channel
        //   'beta' - beta channel
        //   'nightly' - nightly channel
        // Non-standard / deprecated builds:
        //   'aurora' - deprecated aurora channel (still observed in dxr)
        //   'default' - local builds from source
        //   'nightly-try' - nightly Try builds (QA may occasionally need to test with these)
        async getUpdateChannel() {
          return AppConstants.MOZ_UPDATE_CHANNEL;
        },
        async getAllCredentials() {
          let credentials = await lazy.WalletHelper.getAllCredentials()
          return credentials.map(lazy.WalletHelper.credentialToVanillaObject).map(credential => {
            const newVal = {...credential}
            newVal.properties = JSON.parse(credential.properties)
            return newVal
          })
        },
      },
    };
  }
};
