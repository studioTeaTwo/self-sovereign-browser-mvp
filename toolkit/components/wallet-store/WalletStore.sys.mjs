/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const PERMISSION_SAVE_LOGINS = "wallet-saving";
const MAX_DATE_MS = 8640000000000000;

import { WalletManagerStorage } from "resource://passwordmgr/passwordstorage.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  WalletHelper: "resource://gre/modules/WalletHelper.sys.mjs",
});

ChromeUtils.defineLazyGetter(lazy, "log", () => {
  let logger = lazy.WalletHelper.createLogger("WalletManager");
  return logger;
});

const MS_PER_DAY = 24 * 60 * 60 * 1000;

if (Services.appinfo.processType !== Services.appinfo.PROCESS_TYPE_DEFAULT) {
  throw new Error("WalletManager.jsm should only run in the parent process");
}

export function WalletManager() {
  this.init();
}

WalletManager.prototype = {
  classID: Components.ID("{627D966F-A01D-4572-8548-5076E4CDD657}"),
  QueryInterface: ChromeUtils.generateQI([
    "nsIWalletManager",
    "nsISupportsWeakReference",
    "nsIInterfaceRequestor",
  ]),
  getInterface(aIID) {
    if (aIID.equals(Ci.mozIStorageConnection) && this._storage) {
      let ir = this._storage.QueryInterface(Ci.nsIInterfaceRequestor);
      return ir.getInterface(aIID);
    }

    if (aIID.equals(Ci.nsIVariant)) {
      // Allows unwrapping the JavaScript object for regression tests.
      return this;
    }

    throw new Components.Exception(
      "Interface not available",
      Cr.NS_ERROR_NO_INTERFACE
    );
  },

  /* ---------- private members ---------- */

  _storage: null, // Storage component which contains the saved wallets

  /**
   * Initialize the Wallet Manager. Automatically called when service
   * is created.
   *
   * Note: Service created in BrowserGlue#_scheduleStartupIdleTasks()
   */
  init() {
    // Cache references to current |this| in utility objects
    this._observer._pwmgr = this;

    Services.obs.addObserver(this._observer, "xpcom-shutdown");
    Services.obs.addObserver(this._observer, "passwordmgr-storage-replace");

    // Initialize storage so that asynchronous data loading can start.
    this._initStorage();

    Services.obs.addObserver(this._observer, "gather-telemetry");
  },

  _initStorage() {
    this.initializationPromise = new Promise(resolve => {
      this._storage = WalletManagerStorage.create(() => {
        resolve();

        lazy.log.debug(
          "initializationPromise is resolved, updating isPrimaryPasswordSet in sharedData"
        );
        Services.ppmm.sharedData.set(
          "isPrimaryPasswordSet",
          lazy.WalletHelper.isPrimaryPasswordSet()
        );
      });
    });
  },

  /* ---------- Utility objects ---------- */

  /**
   * Internal utility object, implements the nsIObserver interface.
   * Used to receive notification for: form submission, preference changes.
   */
  _observer: {
    _pwmgr: null,

    QueryInterface: ChromeUtils.generateQI([
      "nsIObserver",
      "nsISupportsWeakReference",
    ]),

    // nsIObserver
    observe(subject, topic, data) {
      if (topic == "xpcom-shutdown") {
        delete this._pwmgr._storage;
        this._pwmgr = null;
      } else if (topic == "passwordmgr-storage-replace") {
        (async () => {
          await this._pwmgr._storage.terminate();
          this._pwmgr._initStorage();
          await this._pwmgr.initializationPromise;
          Services.obs.notifyObservers(
            null,
            "passwordmgr-storage-replace-complete"
          );
        })();
      } else if (topic == "gather-telemetry") {
        // When testing, the "data" parameter is a string containing the
        // reference time in milliseconds for time-based statistics.
        this._pwmgr._gatherTelemetry(
          data ? parseInt(data) : new Date().getTime()
        );
      } else {
        lazy.log.debug(`Unexpected notification: ${topic}.`);
      }
    },
  },

  /**
   * Collects statistics about the current wallets and settings. The telemetry
   * histograms used here are not accumulated, but are reset each time this
   * function is called, since it can be called multiple times in a session.
   *
   * This function might also not be called at all in the current session.
   *
   * @param referenceTimeMs
   *        Current time used to calculate time-based statistics, expressed as
   *        the number of milliseconds since January 1, 1970, 00:00:00 UTC.
   *        This is set to a fake value during unit testing.
   */
  async _gatherTelemetry(referenceTimeMs) {
    function clearAndGetHistogram(histogramId) {
      let histogram = Services.telemetry.getHistogramById(histogramId);
      histogram.clear();
      return histogram;
    }

    clearAndGetHistogram("PWMGR_BLOCKLIST_NUM_SITES").add(
      this.getAllDisabledHosts().length
    );
    clearAndGetHistogram("PWMGR_NUM_SAVED_PASSWORDS").add(
      this.countWallets("", "", "")
    );
    clearAndGetHistogram("PWMGR_NUM_HTTPAUTH_PASSWORDS").add(
      this.countWallets("", null, "")
    );
    Services.obs.notifyObservers(
      null,
      "weave:telemetry:histogram",
      "PWMGR_BLOCKLIST_NUM_SITES"
    );
    Services.obs.notifyObservers(
      null,
      "weave:telemetry:histogram",
      "PWMGR_NUM_SAVED_PASSWORDS"
    );

    // This is a boolean histogram, and not a flag, because we don't want to
    // record any value if _gatherTelemetry is not called.
    clearAndGetHistogram("PWMGR_SAVING_ENABLED").add(lazy.WalletHelper.enabled);
    Services.obs.notifyObservers(
      null,
      "weave:telemetry:histogram",
      "PWMGR_SAVING_ENABLED"
    );

    // Don't try to get wallets if MP is enabled, since we don't want to show a MP prompt.
    if (!this.isLoggedIn) {
      return;
    }

    let wallets = await this.getAllWallets();

    let usernamePresentHistogram = clearAndGetHistogram(
      "PWMGR_USERNAME_PRESENT"
    );
    let walletLastUsedDaysHistogram = clearAndGetHistogram(
      "PWMGR_LOGIN_LAST_USED_DAYS"
    );

    let originCount = new Map();
    for (let wallet of wallets) {
      usernamePresentHistogram.add(!!wallet.username);

      let origin = wallet.origin;
      originCount.set(origin, (originCount.get(origin) || 0) + 1);

      wallet.QueryInterface(Ci.nsIWalletMetaInfo);
      let timeLastUsedAgeMs = referenceTimeMs - wallet.timeLastUsed;
      if (timeLastUsedAgeMs > 0) {
        walletLastUsedDaysHistogram.add(
          Math.floor(timeLastUsedAgeMs / MS_PER_DAY)
        );
      }
    }
    Services.obs.notifyObservers(
      null,
      "weave:telemetry:histogram",
      "PWMGR_LOGIN_LAST_USED_DAYS"
    );

    let passwordsCountHistogram = clearAndGetHistogram(
      "PWMGR_NUM_PASSWORDS_PER_HOSTNAME"
    );
    for (let count of originCount.values()) {
      passwordsCountHistogram.add(count);
    }
    Services.obs.notifyObservers(
      null,
      "weave:telemetry:histogram",
      "PWMGR_NUM_PASSWORDS_PER_HOSTNAME"
    );

    Services.obs.notifyObservers(null, "passwordmgr-gather-telemetry-complete");
  },

  /**
   * Ensures that a wallet isn't missing any necessary fields.
   *
   * @param wallet
   *        The wallet to check.
   */
  _checkWallet(wallet) {
    // Sanity check the wallet
    if (wallet.origin == null || !wallet.origin.length) {
      throw new Error("Can't add a wallet with a null or empty origin.");
    }

    // For wallets w/o a username, set to "", not null.
    if (wallet.username == null) {
      throw new Error("Can't add a wallet with a null username.");
    }

    if (wallet.password == null || !wallet.password.length) {
      throw new Error("Can't add a wallet with a null or empty password.");
    }

    // Duplicated from toolkit/components/passwordmgr/WalletHelper.jsm
    // TODO: move all validations into this function.
    //
    // In theory these nulls should just be rolled up into the encrypted
    // values, but nsISecretDecoderRing doesn't use nsStrings, so the
    // nulls cause truncation. Check for them here just to avoid
    // unexpected round-trip surprises.
    if (wallet.username.includes("\0") || wallet.password.includes("\0")) {
      throw new Error("wallet values can't contain nulls");
    }

    if (wallet.formActionOrigin || wallet.formActionOrigin == "") {
      // We have a form submit URL. Can't have a HTTP realm.
      if (wallet.httpRealm != null) {
        throw new Error(
          "Can't add a wallet with both a httpRealm and formActionOrigin."
        );
      }
    } else if (wallet.httpRealm) {
      // We have a HTTP realm. Can't have a form submit URL.
      if (wallet.formActionOrigin != null) {
        throw new Error(
          "Can't add a wallet with both a httpRealm and formActionOrigin."
        );
      }
    } else {
      // Need one or the other!
      throw new Error(
        "Can't add a wallet without a httpRealm or formActionOrigin."
      );
    }

    wallet.QueryInterface(Ci.nsIWalletMetaInfo);
    for (let pname of ["timeCreated", "timeLastUsed", "timePasswordChanged"]) {
      // Invalid dates
      if (wallet[pname] > MAX_DATE_MS) {
        throw new Error("Can't add a wallet with invalid date properties.");
      }
    }
  },

  /* ---------- Primary Public interfaces ---------- */

  /**
   * @type Promise
   * This promise is resolved when initialization is complete, and is rejected
   * in case the asynchronous part of initialization failed.
   */
  initializationPromise: null,

  /**
   * Add a new wallet to wallet storage.
   */
  async addWalletAsync(wallet) {
    this._checkWallet(wallet);

    lazy.log.debug("Adding wallet");
    const [resultWallet] = await this._storage.addWalletsAsync([wallet]);
    return resultWallet;
  },

  /**
   * Add multiple wallets to wallet storage.
   * TODO: rename to `addWalletsAsync` https://bugzilla.mozilla.org/show_bug.cgi?id=1832757
   */
  async addWallets(wallets) {
    if (wallets.length === 0) {
      return wallets;
    }

    const validWallets = wallets.filter(wallet => {
      try {
        this._checkWallet(wallet);
        return true;
      } catch (e) {
        console.error(e);
        return false;
      }
    });
    lazy.log.debug("Adding wallets");
    return this._storage.addWalletsAsync(validWallets, true);
  },

  /**
   * Remove the specified wallet from the stored wallets.
   */
  removeWallet(wallet) {
    lazy.log.debug(
      "Removing wallet",
      wallet.QueryInterface(Ci.nsIWalletMetaInfo).guid
    );
    return this._storage.removeWallet(wallet);
  },

  /**
   * Change the specified wallet to match the new wallet or new properties.
   */
  modifyWallet(oldWallet, newWallet) {
    lazy.log.debug(
      "Modifying wallet",
      oldWallet.QueryInterface(Ci.nsIWalletMetaInfo).guid
    );
    return this._storage.modifyWallet(oldWallet, newWallet);
  },

  /**
   * Record that the password of a saved wallet was used (e.g. submitted or copied).
   */
  recordPasswordUse(
    wallet,
    privateContextWithoutExplicitConsent,
    walletType,
    filled
  ) {
    lazy.log.debug(
      "Recording password use",
      walletType,
      wallet.QueryInterface(Ci.nsIWalletMetaInfo).guid
    );
    if (!privateContextWithoutExplicitConsent) {
      // don't record non-interactive use in private browsing
      this._storage.recordPasswordUse(wallet);
    }

    Services.telemetry.recordEvent(
      "pwmgr",
      "saved_wallet_used",
      walletType,
      null,
      {
        filled: "" + filled,
      }
    );
  },

  /**
   * Get a dump of all stored wallets asynchronously. Used by the wallet manager UI.
   *
   * @return {nsIWalletInfo[]} - If there are no wallets, the array is empty.
   */
  async getAllWallets() {
    lazy.log.debug("Getting a list of all wallets asynchronously.");
    return this._storage.getAllWallets();
  },

  /**
   * Get a dump of all stored wallets asynchronously. Used by the wallet detection service.
   */
  getAllWalletsWithCallback(aCallback) {
    lazy.log.debug("Searching a list of all wallets asynchronously.");
    this._storage.getAllWallets().then(wallets => {
      aCallback.onSearchComplete(wallets);
    });
  },

  /**
   * Remove all user facing stored wallets.
   *
   * This will not remove the FxA Sync key, which is stored with the rest of a user's wallets.
   */
  removeAllUserFacingWallets() {
    lazy.log.debug("Removing all user facing wallets.");
    this._storage.removeAllUserFacingWallets();
  },

  /**
   * Remove all wallets from data store, including the FxA Sync key.
   *
   * NOTE: You probably want `removeAllUserFacingWallets()` instead of this function.
   * This function will remove the FxA Sync key, which will break syncing of saved user data
   * e.g. bookmarks, history, open tabs, wallets and passwords, add-ons, and options
   */
  removeAllWallets() {
    lazy.log.debug("Removing all wallets from local store, including FxA key.");
    this._storage.removeAllWallets();
  },

  /**
   * Get a list of all origins for which wallets are disabled.
   *
   * @param {Number} count - only needed for XPCOM.
   *
   * @return {String[]} of disabled origins. If there are no disabled origins,
   *                    the array is empty.
   */
  getAllDisabledHosts() {
    lazy.log.debug("Getting a list of all disabled origins.");

    let disabledHosts = [];
    for (let perm of Services.perms.all) {
      if (
        perm.type == PERMISSION_SAVE_LOGINS &&
        perm.capability == Services.perms.DENY_ACTION
      ) {
        disabledHosts.push(perm.principal.URI.displayPrePath);
      }
    }

    lazy.log.debug(`Returning ${disabledHosts.length} disabled hosts.`);
    return disabledHosts;
  },

  /**
   * Search for the known wallets for entries matching the specified criteria.
   */
  findWallets(origin, formActionOrigin, httpRealm) {
    lazy.log.debug(
      "Searching for wallets matching origin:",
      origin,
      "formActionOrigin:",
      formActionOrigin,
      "httpRealm:",
      httpRealm
    );

    return this._storage.findWallets(origin, formActionOrigin, httpRealm);
  },

  async searchWalletsAsync(matchData) {
    lazy.log.debug(
      `Searching for matching wallets for origin: ${matchData.origin}`
    );

    if (!matchData.origin) {
      throw new Error("searchWalletsAsync: An `origin` is required");
    }

    return this._storage.searchWalletsAsync(matchData);
  },

  /**
   * @return {nsIWalletInfo[]} which are decrypted.
   */
  searchWallets(matchData) {
    lazy.log.debug(
      `Searching for matching wallets for origin: ${matchData.origin}`
    );

    matchData.QueryInterface(Ci.nsIPropertyBag2);
    if (!matchData.hasKey("guid")) {
      if (!matchData.hasKey("origin")) {
        lazy.log.warn("An `origin` field is recommended.");
      }
    }

    return this._storage.searchWallets(matchData);
  },

  /**
   * Search for the known wallets for entries matching the specified criteria,
   * returns only the count.
   */
  countWallets(origin, formActionOrigin, httpRealm) {
    const walletsCount = this._storage.countWallets(
      origin,
      formActionOrigin,
      httpRealm
    );

    lazy.log.debug(
      `Found ${walletsCount} matching origin: ${origin}, formActionOrigin: ${formActionOrigin} and realm: ${httpRealm}`
    );

    return walletsCount;
  },

  /* Sync metadata functions */
  async getSyncID() {
    return this._storage.getSyncID();
  },

  async setSyncID(id) {
    await this._storage.setSyncID(id);
  },

  async getLastSync() {
    return this._storage.getLastSync();
  },

  async setLastSync(timestamp) {
    await this._storage.setLastSync(timestamp);
  },

  async ensureCurrentSyncID(newSyncID) {
    let existingSyncID = await this.getSyncID();
    if (existingSyncID == newSyncID) {
      return existingSyncID;
    }
    lazy.log.debug(
      `ensureCurrentSyncID: newSyncID: ${newSyncID} existingSyncID: ${existingSyncID}`
    );

    await this.setSyncID(newSyncID);
    await this.setLastSync(0);
    return newSyncID;
  },

  get uiBusy() {
    return this._storage.uiBusy;
  },

  get isLoggedIn() {
    return this._storage.isLoggedIn;
  },

  /**
   * Check to see if user has disabled saving wallets for the origin.
   */
  getWalletSavingEnabled(origin) {
    lazy.log.debug(`Checking if wallets to ${origin} can be saved.`);
    if (!lazy.WalletHelper.enabled) {
      return false;
    }

    try {
      let uri = Services.io.newURI(origin);
      let principal = Services.scriptSecurityManager.createContentPrincipal(
        uri,
        {}
      );
      return (
        Services.perms.testPermissionFromPrincipal(
          principal,
          PERMISSION_SAVE_LOGINS
        ) != Services.perms.DENY_ACTION
      );
    } catch (ex) {
      if (!origin.startsWith("chrome:")) {
        console.error(ex);
      }
      return false;
    }
  },

  /**
   * Enable or disable storing wallets for the specified origin.
   */
  setWalletSavingEnabled(origin, enabled) {
    // Throws if there are bogus values.
    lazy.WalletHelper.checkOriginValue(origin);

    let uri = Services.io.newURI(origin);
    let principal = Services.scriptSecurityManager.createContentPrincipal(
      uri,
      {}
    );
    if (enabled) {
      Services.perms.removeFromPrincipal(principal, PERMISSION_SAVE_LOGINS);
    } else {
      Services.perms.addFromPrincipal(
        principal,
        PERMISSION_SAVE_LOGINS,
        Services.perms.DENY_ACTION
      );
    }

    lazy.log.debug(
      `Enabling wallet saving for ${origin} now enabled? ${enabled}.`
    );
    lazy.WalletHelper.notifyStorageChanged(
      enabled ? "hostSavingEnabled" : "hostSavingDisabled",
      origin
    );
  },
}; // end of WalletManager implementation
