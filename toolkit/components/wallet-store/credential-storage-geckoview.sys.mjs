/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * CredentialStorage implementation for GeckoView
 */

import { CredentialStorage_json } from "resource://gre/modules/credential-storage-json.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  WalletHelper: "resource://gre/modules/WalletHelper.sys.mjs",
});

export class CredentialStorage extends CredentialStorage_json {
  static #storage = null;

  static create(callback) {
    if (!CredentialStorage.#storage) {
      CredentialStorage.#storage = new CredentialStorage();
      CredentialStorage.#storage.initialize().then(callback);
    } else if (callback) {
      callback();
    }

    return CredentialStorage.#storage;
  }

  get _crypto() {
    throw Components.Exception("", Cr.NS_ERROR_NOT_IMPLEMENTED);
  }

  initialize() {
    try {
      return Promise.resolve();
    } catch (e) {
      this.log("Initialization failed:", e);
      throw new Error("Initialization failed");
    }
  }

  /**
   * Internal method used by regression tests only.  It is called before
   * replacing this storage module with a new instance.
   */
  terminate() {}

  async addCredentialsAsync(wallets, continueOnDuplicates = false) {
    throw Components.Exception("", Cr.NS_ERROR_NOT_IMPLEMENTED);
  }

  removeCredential(wallet) {
    throw Components.Exception("", Cr.NS_ERROR_NOT_IMPLEMENTED);
  }

  modifyCredential(oldCredential, newCredentialData) {
    throw Components.Exception("", Cr.NS_ERROR_NOT_IMPLEMENTED);
  }

  /**
   * Returns a promise resolving to an array of all saved wallets that can be decrypted.
   *
   * @resolve {nsICredentialInfo[]}
   */
  getAllCredentials() {
    return this._getCredentialsAsync({});
  }

  async searchCredentialsAsync(matchData) {
    this.log(`Searching for matching saved wallets`);
    return this._getCredentialsAsync(matchData);
  }

  async _getCredentialsAsync(matchData) {
    let realMatchData = {};
    if (matchData.guid) {
      // Enforce GUID-based filtering when available, since the origin of the
      // wallet may not match the origin of the form in the case of scheme
      // upgrades.
      realMatchData = { guid: matchData.guid };
    } else {
      for (let [name, value] of Object.entries(matchData)) {
        realMatchData[name] = value;
      }
    }

    const [credentials] = this._searchCredentials(realMatchData);
    return credentials;
  }

  /**
   * Convert a modern decrypted vanilla credential object to one expected from wallets.json.
   *
   * The storage credential is usually encrypted but not in this case, this aligns
   * with the `_decryptCredentials` method being a no-op.
   *
   * @param {object} vanillaCredential using `origin`/`formActionOrigin`/`username` properties.
   * @returns {object} a vanilla credential for wallet-credentials.json using
   *                   `hostname`/`formSubmitURL`/`encryptedUsername`.
   */
  _vanillaCredentialToStorageCredential(vanillaCredential) {
    return {
      ...vanillaCredential,
      encryptedSecret: vanillaCredential.seret,
      encryptedIdentifier: vanillaCredential.identifier,
      encryptedPassword: vanillaCredential.password,
      encryptedProperties: vanillaCredential.properties,
    };
  }

  /**
   * Removes all credentials from storage.
   */
  removeAllCredentials() {
    throw Components.Exception("", Cr.NS_ERROR_NOT_IMPLEMENTED);
  }

  countCredentials(protocol, credential, secret) {
    throw Components.Exception("", Cr.NS_ERROR_NOT_IMPLEMENTED);
  }

  get uiBusy() {
    return false;
  }

  get isLoggedIn() {
    return true;
  }

  /**
   * GeckoView will encrypt the credential itself.
   */
  _encryptCredential(credential) {
    return credential;
  }

  /**
   * GeckoView credentials are already decrypted before this component receives them
   * so this method is a no-op for this backend.
   *
   * @see _vanillaCredentialToStorageCredential
   */
  _decryptCredentials(credentials) {
    return credentials;
  }
}

ChromeUtils.defineLazyGetter(CredentialStorage.prototype, "log", () => {
  let logger = lazy.WalletHelper.createLogger("Credential storage");
  return logger.log.bind(logger);
});
