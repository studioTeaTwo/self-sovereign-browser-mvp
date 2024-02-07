/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Contains functions shared by different Wallet Store components.
 *
 * This JavaScript module exists in order to share code between the different
 * XPCOM components that constitute the Wallet Store, including implementations
 * of nsIWalletStore and nsICredentialStorage.
 */

import { Logic } from "resource://gre/modules/WalletStore.shared.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  OSKeyStore: "resource://gre/modules/OSKeyStore.sys.mjs",
});

/**
 * Contains functions shared by different Wallet Store components.
 */
export const WalletHelper = {
  debug: null,

  init() {
    Services.telemetry.setEventRecordingEnabled("walletstore", true);
  },

  createLogger(aLogPrefix) {
    let getMaxLogLevel = () => {
      return this.debug ? "Debug" : "Warn";
    };

    // Create a new instance of the ConsoleAPI so we can control the maxLogLevel with a pref.
    let consoleOptions = {
      maxLogLevel: getMaxLogLevel(),
      prefix: aLogPrefix,
    };
    let logger = console.createInstance(consoleOptions);

    // Watch for pref changes and update this.debug and the maxLogLevel for created loggers
    Services.prefs.addObserver("signon.debug", () => {
      this.debug = Services.prefs.getBoolPref("signon.debug");
      if (logger) {
        logger.maxLogLevel = getMaxLogLevel();
      }
    });

    return logger;
  },

  /**
   * Due to the way the signons2.txt file was formatted, we needed to make
   * sure certain field values or characters do not cause the file to
   * be parsed incorrectly. These characters can cause problems in other
   * formats/languages too so reject credentials that may not be stored correctly.
   *
   * @throws String with English message in case validation failed.
   */
  checkCredentialValues(aCredential) {
    function badCharacterPresent(l, c) {
      return (
        l.identifier.includes(c) ||
        l.password.includes(c) ||
        l.properties.includes(c)
      );
    }

    // Nulls are invalid, as they don't round-trip well.
    // Mostly not a formatting problem, although ".\0" can be quirky.
    if (badCharacterPresent(aCredential, "\0")) {
      throw new Error("credential values can't contain nulls");
    }

    if (
      !aCredential.protocolName ||
      typeof aCredential.protocolName != "string"
    ) {
      throw new Error("protocolName must be non-empty strings");
    }
    if (
      !aCredential.credentialName ||
      typeof aCredential.credentialName != "string"
    ) {
      throw new Error("credentialName must be non-empty strings");
    }
    if (!aCredential.secret || typeof aCredential.secret != "string") {
      throw new Error("secret must be non-empty strings");
    }

    // In theory these nulls should just be rolled up into the encrypted
    // values, but nsISecretDecoderRing doesn't use nsStrings, so the
    // nulls cause truncation. Check for them here just to avoid
    // unexpected round-trip surprises.
    if (
      aCredential.protocolName.includes("\0") ||
      aCredential.credentialName.includes("\0") ||
      aCredential.secret.includes("\0")
    ) {
      throw new Error("credential values can't contain nulls");
    }

    // Newlines are invalid for any field stored as plaintext.
    if (
      badCharacterPresent(aCredential, "\r") ||
      badCharacterPresent(aCredential, "\n")
    ) {
      throw new Error("credential values can't contain newlines");
    }
  },

  /**
   * Returns a new XPCOM property bag with the provided properties.
   *
   * @param {object} aProperties
   *        Each property of this object is copied to the property bag.  This
   *        parameter can be omitted to return an empty property bag.
   *
   * @returns A new property bag, that is an instance of nsIWritablePropertyBag,
   *         nsIWritablePropertyBag2, nsIPropertyBag, and nsIPropertyBag2.
   */
  newPropertyBag(aProperties) {
    let propertyBag = Cc["@mozilla.org/hash-property-bag;1"].createInstance(
      Ci.nsIWritablePropertyBag
    );
    if (aProperties) {
      for (let [name, value] of Object.entries(aProperties)) {
        propertyBag.setProperty(name, value);
      }
    }
    return propertyBag
      .QueryInterface(Ci.nsIPropertyBag)
      .QueryInterface(Ci.nsIPropertyBag2)
      .QueryInterface(Ci.nsIWritablePropertyBag2);
  },

  doCredentialsMatch(aCredential1, aCredential2) {
    if (
      aCredential1.protocolName != aCredential2.protocolName ||
      aCredential1.credentialName != aCredential2.credentialName ||
      aCredential1.secret != aCredential2.secret
    ) {
      return false;
    }

    return true;
  },

  /**
   * Creates a new credential object that results by modifying the given object with
   * the provided data.
   *
   * @param {nsICredentialInfo} aOldStoredCredential
   *        Existing credential object to modify.
   * @param {nsICredentialInfo|nsIProperyBag} aNewCredentialData
   *        The new credential values, either as an nsICredentialInfo or nsIProperyBag.
   *
   * @returns {nsICredentialInfo} The newly created nsICredentialInfo object.
   *
   * @throws {Error} With English message in case validation failed.
   */
  buildModifiedCredential(aOldStoredCredential, aNewCredentialData) {
    function bagHasProperty(aPropName) {
      try {
        aNewCredentialData.getProperty(aPropName);
        return true;
      } catch (ex) {}
      return false;
    }

    aOldStoredCredential.QueryInterface(Ci.nsICredentialMetaInfo);

    let newCredential;
    if (aNewCredentialData instanceof Ci.nsICredentialInfo) {
      // Clone the existing credential to get its nsICredentialMetaInfo, then init it
      // with the replacement nsICredentialInfo data from the new credential.
      newCredential = aOldStoredCredential.clone();
      newCredential.init(
        aNewCredentialData.protocolName,
        aNewCredentialData.credentialName,
        aNewCredentialData.primary,
        aNewCredentialData.secret,
        aNewCredentialData.identifier,
        aNewCredentialData.password,
        aNewCredentialData.properties
      );
      newCredential.unknownFields = aNewCredentialData.unknownFields;
      newCredential.QueryInterface(Ci.nsICredentialMetaInfo);

      // Automatically update metainfo when password is changed.
      if (newCredential.secret != aOldStoredCredential.secret) {
        newCredential.timeSecretChanged = Date.now();
      }
    } else if (aNewCredentialData instanceof Ci.nsIPropertyBag) {
      // Clone the existing credential, along with all its properties.
      newCredential = aOldStoredCredential.clone();
      newCredential.QueryInterface(Ci.nsICredentialMetaInfo);

      // Automatically update metainfo when secret is changed.
      // (Done before the main property updates, lest the caller be
      // explicitly updating both .secret and .timeSecretChanged)
      if (bagHasProperty("secret")) {
        let newSecret = aNewCredentialData.getProperty("secret");
        if (newSecret != aOldStoredCredential.secret) {
          newCredential.timeSecretChanged = Date.now();
        }
      }

      for (let prop of aNewCredentialData.enumerator) {
        switch (prop.name) {
          // nsICredentialInfo (fall through)
          case "protocolName":
          case "credentialName":
          case "primary":
          case "secret":
          case "identifier":
          case "password":
          case "properties":
          case "unknownFields":
          // nsICredentialMetaInfo (fall through)
          case "guid":
          case "timeCreated":
          case "timeLastUsed":
          case "timeSecretChanged":
          case "timesUsed":
            newCredential[prop.name] = prop.value;
            break;

          // Fake property, allows easy incrementing.
          case "timesUsedIncrement":
            newCredential.timesUsed += prop.value;
            break;

          // Fail if caller requests setting an unknown property.
          default:
            throw new Error("Unexpected propertybag item: " + prop.name);
        }
      }
    } else {
      throw new Error("newCredentialData needs an expected interface!");
    }

    // Sanity check the credential
    if (
      newCredential.protocolName == null ||
      !newCredential.protocolName.length
    ) {
      throw new Error(
        "Can't add a credential with a null or empty protocolName."
      );
    }
    if (
      newCredential.credentialName == null ||
      !newCredential.credentialName.length
    ) {
      throw new Error(
        "Can't add a credential with a null or empty credentialName."
      );
    }
    if (newCredential.secret == null || !newCredential.secret.length) {
      throw new Error("Can't add a credential with a null or empty secret.");
    }

    // For credentials w/o a optional property, set to "", not null.
    if (newCredential.identifier == null) {
      throw new Error("Can't add a credential with a null identifier.");
    }
    if (newCredential.password == null) {
      throw new Error("Can't add a credential with a null password.");
    }
    if (newCredential.properties == null) {
      throw new Error("Can't add a credential with a null properties.");
    }

    // Throws if there are bogus values.
    this.checkCredentialValues(newCredential);

    return newCredential;
  },

  /**
   * Generate a unique key string from a credential.
   *
   * @param {nsICredentialInfo} credential
   * @param {string[]} uniqueKeys
   * @returns {string} to use as a key in a Map
   */
  getUniqueKeyForCredential(credential, uniqueKeys) {
    const KEY_DELIMITER = ":";
    return uniqueKeys.reduce((prev, key) => {
      const val = credential[key];

      return prev + KEY_DELIMITER + val;
    }, "");
  },

  /**
   * Removes duplicates from a list of credentials while preserving the sort order.
   *
   * @param {nsICredentialInfo[]} credentials
   *        A list of credentials we want to deduplicate.
   * @param {string[]} [uniqueKeys = ["encryptedSecret"]]
   *        A list of credential attributes to use as unique keys for the deduplication.
   * @param {string[]} [resolveBy = ["timeLastUsed"]]
   *        Ordered array of keyword strings used to decide which of the
   *        duplicates should be used. "scheme" would prefer the credential that has
   *        a scheme matching `preferredOrigin`'s if there are two credentials with
   *        the same `uniqueKeys`. The default preference to distinguish two
   *        credentials is `timeLastUsed`. If there is no preference between two
   *        credentials, the first one found wins.
   *
   * @returns {nsICredentialInfo[]} list of unique credentials.
   */
  dedupeCredentials(
    credentials,
    uniqueKeys = ["encryptedSecret"],
    resolveBy = ["timeLastUsed"]
  ) {
    // We use a Map to easily lookup credentials by their unique keys.
    let credentialsByKeys = new Map();

    /**
     * @returns {bool} whether `credential` is preferred over its duplicate (considering `uniqueKeys`)
     *                `existingCredential`.
     *
     * `resolveBy` is a sorted array so we can return true the first time `credential` is preferred
     * over the existingCredential.
     */
    function isCredentialPreferred(existingCredential, credential) {
      if (!resolveBy || !resolveBy.length) {
        // If there is no preference, prefer the existing credential.
        return false;
      }

      for (let preference of resolveBy) {
        switch (preference) {
          case "timeLastUsed":
          case "timeSecretChanged": {
            // If we find a more recent credential for the same key, replace the existing one.
            let credentialDate = credential.QueryInterface(
              Ci.nsICredentialMetaInfo
            )[preference];
            let storedCredentialDate = existingCredential.QueryInterface(
              Ci.nsICredentialMetaInfo
            )[preference];
            if (credentialDate == storedCredentialDate) {
              break;
            }

            return credentialDate > storedCredentialDate;
          }
        }
      }

      return false;
    }

    for (let credential of credentials) {
      let key = this.getUniqueKeyForCredential(credential, uniqueKeys);

      if (credentialsByKeys.has(key)) {
        if (!isCredentialPreferred(credentialsByKeys.get(key), credential)) {
          // If there is no preference for the new credential, use the existing one.
          continue;
        }
      }
      credentialsByKeys.set(key, credential);
    }

    // Return the map values in the form of an array.
    return [...credentialsByKeys.values()];
  },

  /**
   * Convert an array of nsICredentialInfo to vanilla JS objects suitable for
   * sending over IPC. Avoid using this in other cases.
   *
   * NB: All members of nsICredentialInfo (not nsICredentialMetaInfo) are strings.
   */
  credentialsToVanillaObjects(credentials) {
    return credentials.map(this.credentialToVanillaObject);
  },

  /**
   * Same as above, but for a single credential.
   */
  credentialToVanillaObject(credential) {
    let obj = {};
    for (let i in credential.QueryInterface(Ci.nsICredentialMetaInfo)) {
      if (typeof credential[i] !== "function") {
        obj[i] = credential[i];
      }
    }
    return obj;
  },

  /**
   * Convert an object received from IPC into an nsICredentialInfo (with guid).
   */
  vanillaObjectToCredential(credential) {
    let formCredential = Cc[
      "@mozilla.org/wallet-store/credentialInfo;1"
    ].createInstance(Ci.nsICredentialInfo);
    formCredential.init(
      credential.protocolName,
      credential.credentialName,
      credential.primary,
      credential.secret,
      credential.identifier,
      credential.password,
      credential.properties
    );

    formCredential.QueryInterface(Ci.nsICredentialMetaInfo);
    for (let prop of [
      "guid",
      "timeCreated",
      "timeLastUsed",
      "timeSecretChanged",
      "timesUsed",
    ]) {
      formCredential[prop] = credential[prop];
    }
    return formCredential;
  },

  /**
   * As above, but for an array of objects.
   */
  vanillaObjectsToCredentials(vanillaObjects) {
    const credentials = [];
    for (const vanillaObject of vanillaObjects) {
      credentials.push(this.vanillaObjectToCredential(vanillaObject));
    }
    return credentials;
  },

  /**
   * Returns true if the user has a primary password set and false otherwise.
   */
  isPrimaryPasswordSet() {
    let tokenDB = Cc["@mozilla.org/security/pk11tokendb;1"].getService(
      Ci.nsIPK11TokenDB
    );
    let token = tokenDB.getInternalKeyToken();
    return token.hasPassword;
  },

  /**
   * Shows the Primary Password prompt if enabled, or the
   * OS auth dialog otherwise.
   *
   * @param {Element} browser
   *        The <browser> that the prompt should be shown on
   * @param OSReauthEnabled Boolean indicating if OS reauth should be tried
   * @param expirationTime Optional timestamp indicating next required re-authentication
   * @param messageText Formatted and localized string to be displayed when the OS auth dialog is used.
   * @param captionText Formatted and localized string to be displayed when the OS auth dialog is used.
   */
  async requestReauth(
    browser,
    OSReauthEnabled,
    expirationTime,
    messageText,
    captionText
  ) {
    let isAuthorized = false;
    let telemetryEvent;

    // This does no harm if primary password isn't set.
    let tokendb = Cc["@mozilla.org/security/pk11tokendb;1"].createInstance(
      Ci.nsIPK11TokenDB
    );
    let token = tokendb.getInternalKeyToken();

    // Do we have a recent authorization?
    if (expirationTime && Date.now() < expirationTime) {
      isAuthorized = true;
      telemetryEvent = {
        object: token.hasPassword ? "master_password" : "os_auth",
        method: "reauthenticate",
        value: "success_no_prompt",
      };
      return {
        isAuthorized,
        telemetryEvent,
      };
    }

    // Default to true if there is no primary password and OS reauth is not available
    if (!token.hasPassword && !OSReauthEnabled) {
      isAuthorized = true;
      telemetryEvent = {
        object: "os_auth",
        method: "reauthenticate",
        value: "success_disabled",
      };
      return {
        isAuthorized,
        telemetryEvent,
      };
    }
    // Use the OS auth dialog if there is no primary password
    if (!token.hasPassword && OSReauthEnabled) {
      let result = await lazy.OSKeyStore.ensureLoggedIn(
        messageText,
        captionText,
        browser.ownerGlobal,
        false
      );
      isAuthorized = result.authenticated;
      telemetryEvent = {
        object: "os_auth",
        method: "reauthenticate",
        value: result.auth_details,
        extra: result.auth_details_extra,
      };
      return {
        isAuthorized,
        telemetryEvent,
      };
    }
    // We'll attempt to re-auth via Primary Password, force a log-out
    token.checkPassword("");

    // If a primary password prompt is already open, just exit early and return false.
    // The user can re-trigger it after responding to the already open dialog.
    if (Services.wallet.uiBusy) {
      isAuthorized = false;
      return {
        isAuthorized,
        telemetryEvent,
      };
    }

    // So there's a primary password. But since checkPassword didn't succeed, we're logged out (per nsIPK11Token.idl).
    try {
      // Rewallet and ask for the primary password.
      token.wallet(true); // 'true' means always prompt for token password. User will be prompted until
      // clicking 'Cancel' or entering the correct password.
    } catch (e) {
      // An exception will be thrown if the user cancels the wallet prompt dialog.
      // User is also logged out of Software Security Device.
    }
    isAuthorized = token.isLoggedIn();
    telemetryEvent = {
      object: "master_password",
      method: "reauthenticate",
      value: isAuthorized ? "success" : "fail",
    };
    return {
      isAuthorized,
      telemetryEvent,
    };
  },

  /**
   * Send a notification when stored data is changed.
   */
  notifyStorageChanged(changeType, data) {
    let dataObject = data;
    // Can't pass a raw JS string or array though notifyObservers(). :-(
    if (Array.isArray(data)) {
      dataObject = Cc["@mozilla.org/array;1"].createInstance(
        Ci.nsIMutableArray
      );
      for (let i = 0; i < data.length; i++) {
        dataObject.appendElement(data[i]);
      }
    } else if (typeof data == "string") {
      dataObject = Cc["@mozilla.org/supports-string;1"].createInstance(
        Ci.nsISupportsString
      );
      dataObject.data = data;
    }
    Services.obs.notifyObservers(
      dataObject,
      "walletstore-storage-changed",
      changeType
    );
  },

  getAllCredentials() {
    try {
      return Services.wallet.getAllCredentials();
    } catch (e) {
      if (e.result == Cr.NS_ERROR_ABORT) {
        // If the user cancels the MP prompt then return no wallets.
        return [];
      }
      throw e;
    }
  },

  createCredentialAlreadyExistsError(guid) {
    // The GUID is stored in an nsISupportsString here because we cannot pass
    // raw JS objects within Components.Exception due to bug 743121.
    let guidSupportsString = Cc[
      "@mozilla.org/supports-string;1"
    ].createInstance(Ci.nsISupportsString);
    guidSupportsString.data = guid;
    return Components.Exception("This credential already exists.", {
      data: guidSupportsString,
    });
  },
};

ChromeUtils.defineLazyGetter(lazy, "log", () => {
  let processName =
    Services.appinfo.processType === Services.appinfo.PROCESS_TYPE_DEFAULT
      ? "Main"
      : "Content";
  return WalletHelper.createLogger(`WalletHelper(${processName})`);
});

WalletHelper.init();
