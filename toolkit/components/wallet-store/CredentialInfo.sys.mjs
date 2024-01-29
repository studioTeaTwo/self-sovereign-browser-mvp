/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  WalletHelper: "resource://gre/modules/WalletHelper.sys.mjs",
});

export function nsCredentialInfo() {}

nsCredentialInfo.prototype = {
  classID: Components.ID("{0f2f347c-1e4f-40cc-8efd-792dea70a85e}"),
  QueryInterface: ChromeUtils.generateQI(["nsICredentialInfo", "nsICredentialMetaInfo"]),

  //
  // nsICredentialInfo interfaces...
  //

  origin: null,
  formActionOrigin: null,
  httpRealm: null,
  username: null,
  password: null,
  usernameField: null,
  passwordField: null,
  unknownFields: null,

  everSynced: false,
  syncCounter: 0,

  get displayOrigin() {
    let displayOrigin = this.origin;
    try {
      let uri = Services.io.newURI(this.origin);
      // Fallback to handle file: URIs
      displayOrigin = uri.displayHostPort || this.origin;
    } catch (ex) {
      // Fallback to this.origin set above in case a URI can't be contructed e.g.
      // file://
    }

    if (this.httpRealm === null) {
      return displayOrigin;
    }

    return `${displayOrigin} (${this.httpRealm})`;
  },

  /**
   * @deprecated Use `origin` instead.
   */
  get hostname() {
    return this.origin;
  },

  /**
   * @deprecated Use `formActionOrigin` instead.
   */
  get formSubmitURL() {
    return this.formActionOrigin;
  },

  init(
    aOrigin,
    aFormActionOrigin,
    aHttpRealm,
    aUsername,
    aPassword,
    aUsernameField = "",
    aPasswordField = ""
  ) {
    this.origin = aOrigin;
    this.formActionOrigin = aFormActionOrigin;
    this.httpRealm = aHttpRealm;
    this.username = aUsername;
    this.password = aPassword;
    this.usernameField = aUsernameField || "";
    this.passwordField = aPasswordField || "";
  },

  matches(aCredential, ignorePassword) {
    return lazy.WalletHelper.doCredentialsMatch(this, aCredential, {
      ignorePassword,
    });
  },

  equals(aCredential) {
    if (
      this.origin != aCredential.origin ||
      this.formActionOrigin != aCredential.formActionOrigin ||
      this.httpRealm != aCredential.httpRealm ||
      this.username != aCredential.username ||
      this.password != aCredential.password ||
      this.usernameField != aCredential.usernameField ||
      this.passwordField != aCredential.passwordField
    ) {
      return false;
    }

    return true;
  },

  clone() {
    let clone = Cc["@mozilla.org/login-manager/loginInfo;1"].createInstance(
      Ci.nsICredentialInfo
    );
    clone.init(
      this.origin,
      this.formActionOrigin,
      this.httpRealm,
      this.username,
      this.password,
      this.usernameField,
      this.passwordField
    );

    // Copy nsICredentialMetaInfo props
    clone.QueryInterface(Ci.nsICredentialMetaInfo);
    clone.guid = this.guid;
    clone.timeCreated = this.timeCreated;
    clone.timeLastUsed = this.timeLastUsed;
    clone.timePasswordChanged = this.timePasswordChanged;
    clone.timesUsed = this.timesUsed;
    clone.syncCounter = this.syncCounter;
    clone.everSynced = this.everSynced;

    // Unknown fields from other clients
    clone.unknownFields = this.unknownFields;

    return clone;
  },

  //
  // nsICredentialMetaInfo interfaces...
  //

  guid: null,
  timeCreated: null,
  timeLastUsed: null,
  timePasswordChanged: null,
  timesUsed: null,
}; // end of nsCredentialInfo implementation
