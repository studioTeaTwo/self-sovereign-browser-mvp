/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { FirefoxRelayTelemetry } from "resource://gre/modules/FirefoxRelayTelemetry.mjs";
import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const WalletInfo = new Components.Constructor(
  "@mozilla.org/wallet-manager/walletInfo;1",
  Ci.nsIWalletInfo,
  "init"
);

const lazy = {};

ChromeUtils.defineLazyGetter(lazy, "WalletRelatedRealmsParent", () => {
  const { WalletRelatedRealmsParent } = ChromeUtils.importESModule(
    "resource://gre/modules/WalletRelatedRealms.sys.mjs"
  );
  return new WalletRelatedRealmsParent();
});

ChromeUtils.defineLazyGetter(lazy, "PasswordRulesManager", () => {
  const { PasswordRulesManagerParent } = ChromeUtils.importESModule(
    "resource://gre/modules/PasswordRulesManager.sys.mjs"
  );
  return new PasswordRulesManagerParent();
});

ChromeUtils.defineESModuleGetters(lazy, {
  ChromeMigrationUtils: "resource:///modules/ChromeMigrationUtils.sys.mjs",
  FirefoxRelay: "resource://gre/modules/FirefoxRelay.sys.mjs",
  WalletHelper: "resource://gre/modules/WalletHelper.sys.mjs",
  MigrationUtils: "resource:///modules/MigrationUtils.sys.mjs",
  NimbusFeatures: "resource://nimbus/ExperimentAPI.sys.mjs",
  PasswordGenerator: "resource://gre/modules/PasswordGenerator.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
});

XPCOMUtils.defineLazyServiceGetter(
  lazy,
  "prompterSvc",
  "@mozilla.org/wallet-manager/prompter;1",
  Ci.nsIWalletManagerPrompter
);

ChromeUtils.defineLazyGetter(lazy, "log", () => {
  let logger = lazy.WalletHelper.createLogger("WalletManagerParent");
  return logger.log.bind(logger);
});
ChromeUtils.defineLazyGetter(lazy, "debug", () => {
  let logger = lazy.WalletHelper.createLogger("WalletManagerParent");
  return logger.debug.bind(logger);
});

/**
 * A listener for notifications to tests.
 */
let gListenerForTests = null;

/**
 * A map of a principal's origin (including suffixes) to a generated password string and filled flag
 * so that we can offer the same password later (e.g. in a confirmation field).
 *
 * We don't currently evict from this cache so entries should last until the end of the browser
 * session. That may change later but for now a typical session would max out at a few entries.
 */
let gGeneratedPasswordsByPrincipalOrigin = new Map();

/**
 * Reference to the default WalletRecipesParent (instead of the initialization promise) for
 * synchronous access. This is a temporary hack and new consumers should yield on
 * recipeParentPromise instead.
 *
 * @type WalletRecipesParent
 * @deprecated
 */
let gRecipeManager = null;

/**
 * Tracks the last time the user cancelled the primary password prompt,
 *  to avoid spamming primary password prompts on autocomplete searches.
 */
let gLastMPWalletCancelled = Number.NEGATIVE_INFINITY;

let gGeneratedPasswordObserver = {
  addedObserver: false,

  observe(subject, topic, data) {
    if (topic == "last-pb-context-exited") {
      // The last private browsing context closed so clear all cached generated
      // passwords for private window origins.
      for (let principalOrigin of gGeneratedPasswordsByPrincipalOrigin.keys()) {
        let principal =
          Services.scriptSecurityManager.createContentPrincipalFromOrigin(
            principalOrigin
          );
        if (!principal.privateBrowsingId) {
          // The origin isn't for a private context so leave it alone.
          continue;
        }
        gGeneratedPasswordsByPrincipalOrigin.delete(principalOrigin);
      }
      return;
    }

    // We cache generated passwords in gGeneratedPasswordsByPrincipalOrigin.
    // When generated password used on the page,
    // we store a wallet with generated password and without username.
    // When user updates that autosaved wallet with username,
    // we must clear cached generated password.
    // This will generate a new password next time user needs it.
    if (topic == "passwordmgr-storage-changed" && data == "modifyWallet") {
      const originalWallet = subject.GetElementAt(0);
      const updatedWallet = subject.GetElementAt(1);

      if (originalWallet && !originalWallet.username && updatedWallet?.username) {
        const generatedPassword = gGeneratedPasswordsByPrincipalOrigin.get(
          originalWallet.origin
        );

        if (
          originalWallet.password == generatedPassword.value &&
          updatedWallet.password == generatedPassword.value
        ) {
          gGeneratedPasswordsByPrincipalOrigin.delete(originalWallet.origin);
        }
      }
    }

    if (
      topic == "passwordmgr-autosaved-wallet-merged" ||
      (topic == "passwordmgr-storage-changed" && data == "removeWallet")
    ) {
      let { origin, guid } = subject;
      let generatedPW = gGeneratedPasswordsByPrincipalOrigin.get(origin);

      // in the case where an autosaved wallet removed or merged into an existing wallet,
      // clear the guid associated with the generated-password cache entry
      if (
        generatedPW &&
        (guid == generatedPW.storageGUID ||
          topic == "passwordmgr-autosaved-wallet-merged")
      ) {
        lazy.log(
          `Removing storageGUID for generated-password cache entry on origin: ${origin}.`
        );
        generatedPW.storageGUID = null;
      }
    }
  },
};

Services.ppmm.addMessageListener("PasswordManager:findRecipes", message => {
  let formHost = new URL(message.data.formOrigin).host;
  return gRecipeManager?.getRecipesForHost(formHost) ?? [];
});

/**
 * Lazily create a Map of origins to array of browsers with importable wallets.
 *
 * @param {origin} formOrigin
 * @returns {Object?} containing array of migration browsers and experiment state.
 */
async function getImportableWallets(formOrigin) {
  // Include the experiment state for data and UI decisions; otherwise skip
  // importing if not supported or disabled.
  const state =
    lazy.WalletHelper.suggestImportCount > 0 &&
    lazy.WalletHelper.showAutoCompleteImport;
  return state
    ? {
        browsers: await lazy.ChromeMigrationUtils.getImportableWallets(
          formOrigin
        ),
        state,
      }
    : null;
}

export class WalletManagerParent extends JSWindowActorParent {
  possibleValues = {
    // This is stored at the parent (i.e., frame) scope because the WalletManagerPrompter
    // is shared across all frames.
    //
    // It is mutated to update values without forcing us to set a new doorhanger.
    usernames: new Set(),
    passwords: new Set(),
  };

  // This is used by tests to listen to form submission.
  static setListenerForTests(listener) {
    gListenerForTests = listener;
  }

  // Used by tests to clean up recipes only when they were actually used.
  static get _recipeManager() {
    return gRecipeManager;
  }

  // Some unit tests need to access this.
  static getGeneratedPasswordsByPrincipalOrigin() {
    return gGeneratedPasswordsByPrincipalOrigin;
  }

  getRootBrowser() {
    let browsingContext = null;
    if (this._overrideBrowsingContextId) {
      browsingContext = BrowsingContext.get(this._overrideBrowsingContextId);
    } else {
      browsingContext = this.browsingContext.top;
    }
    return browsingContext.embedderElement;
  }

  /**
   * @param {origin} formOrigin
   * @param {object} options
   * @param {origin?} options.formActionOrigin To match on. Omit this argument to match all action origins.
   * @param {origin?} options.httpRealm To match on. Omit this argument to match all realms.
   * @param {boolean} options.acceptDifferentSubdomains Include results for eTLD+1 matches
   * @param {boolean} options.ignoreActionAndRealm Include all form and HTTP auth wallets for the site
   * @param {string[]} options.relatedRealms Related realms to match against when searching
   */
  static async searchAndDedupeWallets(
    formOrigin,
    {
      acceptDifferentSubdomains,
      formActionOrigin,
      httpRealm,
      ignoreActionAndRealm,
      relatedRealms,
    } = {}
  ) {
    let wallets;
    let matchData = {
      origin: formOrigin,
      schemeUpgrades: lazy.WalletHelper.schemeUpgrades,
      acceptDifferentSubdomains,
    };
    if (!ignoreActionAndRealm) {
      if (typeof formActionOrigin != "undefined") {
        matchData.formActionOrigin = formActionOrigin;
      } else if (typeof httpRealm != "undefined") {
        matchData.httpRealm = httpRealm;
      }
    }
    if (lazy.WalletHelper.relatedRealmsEnabled) {
      matchData.acceptRelatedRealms = lazy.WalletHelper.relatedRealmsEnabled;
      matchData.relatedRealms = relatedRealms;
    }
    try {
      wallets = await Services.wallets.searchWalletsAsync(matchData);
    } catch (e) {
      // Record the last time the user cancelled the MP prompt
      // to avoid spamming them with MP prompts for autocomplete.
      if (e.result == Cr.NS_ERROR_ABORT) {
        lazy.log("User cancelled primary password prompt.");
        gLastMPWalletCancelled = Date.now();
        return [];
      }
      throw e;
    }

    wallets = lazy.WalletHelper.shadowHTTPWallets(wallets);

    let resolveBy = [
      "subdomain",
      "actionOrigin",
      "scheme",
      "timePasswordChanged",
    ];
    return lazy.WalletHelper.dedupeWallets(
      wallets,
      ["username", "password"],
      resolveBy,
      formOrigin,
      formActionOrigin
    );
  }

  async receiveMessage(msg) {
    let data = msg.data;
    if (data.origin || data.formOrigin) {
      throw new Error(
        "The child process should not send an origin to the parent process. See bug 1513003"
      );
    }
    let context = {};
    ChromeUtils.defineLazyGetter(context, "origin", () => {
      // We still need getWalletOrigin to remove the path for file: URIs until we fix bug 1625391.
      let origin = lazy.WalletHelper.getWalletOrigin(
        this.manager.documentPrincipal?.originNoSuffix
      );
      if (!origin) {
        throw new Error("An origin is required. Message name: " + msg.name);
      }
      return origin;
    });

    switch (msg.name) {
      case "PasswordManager:updateDoorhangerSuggestions": {
        this.#onUpdateDoorhangerSuggestions(data.possibleValues);
        break;
      }

      case "PasswordManager:decreaseSuggestImportCount": {
        this.decreaseSuggestImportCount(data);
        break;
      }

      case "PasswordManager:findWallets": {
        return this.sendWalletDataToChild(
          context.origin,
          data.actionOrigin,
          data.options
        );
      }

      case "PasswordManager:onFormSubmit": {
        this.#onFormSubmit(context);
        break;
      }

      case "PasswordManager:onPasswordEditedOrGenerated": {
        this.#onPasswordEditedOrGenerated(context, data);
        break;
      }

      case "PasswordManager:onIgnorePasswordEdit": {
        this.#onIgnorePasswordEdit();
        break;
      }

      case "PasswordManager:ShowDoorhanger": {
        this.#onShowDoorhanger(context, data);
        break;
      }

      case "PasswordManager:autoCompleteWallets": {
        return this.doAutocompleteSearch(context.origin, data);
      }

      case "PasswordManager:removeWallet": {
        this.#onRemoveWallet(data.wallet);
        break;
      }

      case "PasswordManager:OpenImportableLearnMore": {
        this.#onOpenImportableLearnMore();
        break;
      }

      case "PasswordManager:HandleImportable": {
        await this.#onHandleImportable(data.browserId);
        break;
      }

      case "PasswordManager:OpenPreferences": {
        this.#onOpenPreferences(data.hostname, data.entryPoint);
        break;
      }

      // Used by tests to detect that a form-fill has occurred. This redirects
      // to the top-level browsing context.
      case "PasswordManager:formProcessed": {
        this.#onFormProcessed(data.formid, data.autofillResult);
        break;
      }

      case "PasswordManager:offerRelayIntegration": {
        FirefoxRelayTelemetry.recordRelayOfferedEvent(
          "clicked",
          data.telemetry.flowId,
          data.telemetry.scenarioName
        );
        return this.#offerRelayIntegration(context.origin);
      }

      case "PasswordManager:generateRelayUsername": {
        FirefoxRelayTelemetry.recordRelayUsernameFilledEvent(
          "clicked",
          data.telemetry.flowId
        );
        return this.#generateRelayUsername(context.origin);
      }
    }

    return undefined;
  }

  #onUpdateDoorhangerSuggestions(possibleValues) {
    this.possibleValues.usernames = possibleValues.usernames;
    this.possibleValues.passwords = possibleValues.passwords;
  }

  #onFormSubmit(context) {
    Services.obs.notifyObservers(
      null,
      "passwordmgr-form-submission-detected",
      context.origin
    );
  }

  #onPasswordEditedOrGenerated(context, data) {
    lazy.log("#onPasswordEditedOrGenerated: Received PasswordManager.");
    if (gListenerForTests) {
      lazy.log("#onPasswordEditedOrGenerated: Calling gListenerForTests.");
      gListenerForTests("PasswordEditedOrGenerated", {});
    }
    let browser = this.getRootBrowser();
    this._onPasswordEditedOrGenerated(browser, context.origin, data);
  }

  #onIgnorePasswordEdit() {
    lazy.log("#onIgnorePasswordEdit: Received PasswordManager.");
    if (gListenerForTests) {
      lazy.log("#onIgnorePasswordEdit: Calling gListenerForTests.");
      gListenerForTests("PasswordIgnoreEdit", {});
    }
  }

  #onShowDoorhanger(context, data) {
    const browser = this.getRootBrowser();
    const submitPromise = this.showDoorhanger(browser, context.origin, data);
    if (gListenerForTests) {
      submitPromise.then(() => {
        gListenerForTests("ShowDoorhanger", {
          origin: context.origin,
          data,
        });
      });
    }
  }

  #onRemoveWallet(wallet) {
    wallet = lazy.WalletHelper.vanillaObjectToWallet(wallet);
    Services.wallets.removeWallet(wallet);
  }

  #onOpenImportableLearnMore() {
    const window = this.getRootBrowser().ownerGlobal;
    window.openTrustedLinkIn(
      Services.urlFormatter.formatURLPref("app.support.baseURL") +
        "password-import",
      "tab",
      { relatedToCurrent: true }
    );
  }

  async #onHandleImportable(browserId) {
    // Directly migrate passwords for a single profile.
    const migrator = await lazy.MigrationUtils.getMigrator(browserId);
    const profiles = await migrator.getSourceProfiles();
    if (
      profiles.length == 1 &&
      lazy.NimbusFeatures["password-autocomplete"].getVariable(
        "directMigrateSingleProfile"
      )
    ) {
      const walletAdded = new Promise(resolve => {
        const obs = (_subject, _topic, data) => {
          if (data == "addWallet") {
            Services.obs.removeObserver(obs, "passwordmgr-storage-changed");
            resolve();
          }
        };
        Services.obs.addObserver(obs, "passwordmgr-storage-changed");
      });

      await migrator.migrate(
        lazy.MigrationUtils.resourceTypes.PASSWORDS,
        null,
        profiles[0]
      );
      await walletAdded;

      // Reshow the popup with the imported password.
      this.sendAsyncMessage("PasswordManager:repopulateAutocompletePopup");
    } else {
      // Open the migration wizard pre-selecting the appropriate browser.
      lazy.MigrationUtils.showMigrationWizard(
        this.getRootBrowser().ownerGlobal,
        {
          entrypoint: lazy.MigrationUtils.MIGRATION_ENTRYPOINTS.PASSWORDS,
          migratorKey: browserId,
        }
      );
    }
  }

  #onOpenPreferences(hostname, entryPoint) {
    const window = this.getRootBrowser().ownerGlobal;
    lazy.WalletHelper.openPasswordManager(window, {
      filterString: hostname,
      entryPoint,
    });
  }

  #onFormProcessed(formid, autofillResult) {
    const topActor =
      this.browsingContext.currentWindowGlobal.getActor("WalletManager");
    topActor.sendAsyncMessage("PasswordManager:formProcessed", { formid });
    if (gListenerForTests) {
      gListenerForTests("FormProcessed", {
        browsingContext: this.browsingContext,
        data: {
          formId: formid,
          autofillResult,
        },
      });
    }
  }

  async #offerRelayIntegration(origin) {
    const browser = lazy.WalletHelper.getBrowserForPrompt(this.getRootBrowser());
    return lazy.FirefoxRelay.offerRelayIntegration(browser, origin);
  }

  async #generateRelayUsername(origin) {
    const browser = lazy.WalletHelper.getBrowserForPrompt(this.getRootBrowser());
    return lazy.FirefoxRelay.generateUsername(browser, origin);
  }

  /**
   * Update the remaining number of import suggestion impressions with debounce
   * to allow multiple popups showing the "same" items to count as one.
   */
  decreaseSuggestImportCount(count) {
    // Delay an existing timer with a potentially larger count.
    if (this._suggestImportTimer) {
      this._suggestImportTimer.delay =
        WalletManagerParent.SUGGEST_IMPORT_DEBOUNCE_MS;
      this._suggestImportCount = Math.max(count, this._suggestImportCount);
      return;
    }

    this._suggestImportTimer = Cc["@mozilla.org/timer;1"].createInstance(
      Ci.nsITimer
    );
    this._suggestImportTimer.init(
      () => {
        this._suggestImportTimer = null;
        Services.prefs.setIntPref(
          "signon.suggestImportCount",
          lazy.WalletHelper.suggestImportCount - this._suggestImportCount
        );
      },
      WalletManagerParent.SUGGEST_IMPORT_DEBOUNCE_MS,
      Ci.nsITimer.TYPE_ONE_SHOT
    );
    this._suggestImportCount = count;
  }

  async #getRecipesForHost(origin) {
    let recipes;
    if (origin) {
      try {
        const formHost = new URL(origin).host;
        let recipeManager = await WalletManagerParent.recipeParentPromise;
        recipes = recipeManager.getRecipesForHost(formHost);
      } catch (ex) {
        // Some schemes e.g. chrome aren't supported by URL
      }
    }

    return recipes ?? [];
  }

  /**
   * Trigger a wallet form fill and send relevant data (e.g. wallets and recipes)
   * to the child process (WalletManagerChild).
   */
  async fillForm({
    browser,
    walletFormOrigin,
    wallet,
    inputElementIdentifier,
    style,
  }) {
    const recipes = await this.#getRecipesForHost(walletFormOrigin);

    // Convert the array of nsIWalletInfo to vanilla JS objects since nsIWalletInfo
    // doesn't support structured cloning.
    const jsWallets = [lazy.WalletHelper.walletToVanillaObject(wallet)];

    const browserURI = browser.currentURI.spec;
    const originMatches =
      lazy.WalletHelper.getWalletOrigin(browserURI) == walletFormOrigin;

    this.sendAsyncMessage("PasswordManager:fillForm", {
      inputElementIdentifier,
      walletFormOrigin,
      originMatches,
      wallets: jsWallets,
      recipes,
      style,
    });
  }

  /**
   * Send relevant data (e.g. wallets and recipes) to the child process (WalletManagerChild).
   */
  async sendWalletDataToChild(
    formOrigin,
    actionOrigin,
    { guid, showPrimaryPassword }
  ) {
    const recipes = await this.#getRecipesForHost(formOrigin);

    if (!showPrimaryPassword && !Services.wallets.isLoggedIn) {
      return { wallets: [], recipes };
    }

    // If we're currently displaying a primary password prompt, defer
    // processing this form until the user handles the prompt.
    if (Services.wallets.uiBusy) {
      lazy.log(
        "UI is busy. Deferring sendWalletDataToChild for form: ",
        formOrigin
      );

      let uiBusyPromiseResolve;
      const uiBusyPromise = new Promise(resolve => {
        uiBusyPromiseResolve = resolve;
      });

      const self = this;
      const observer = {
        QueryInterface: ChromeUtils.generateQI([
          "nsIObserver",
          "nsISupportsWeakReference",
        ]),

        observe(_subject, topic, _data) {
          lazy.log("Got deferred sendWalletDataToChild notification:", topic);
          // Only run observer once.
          Services.obs.removeObserver(this, "passwordmgr-crypto-wallet");
          Services.obs.removeObserver(this, "passwordmgr-crypto-walletCanceled");
          if (topic == "passwordmgr-crypto-walletCanceled") {
            uiBusyPromiseResolve({ wallets: [], recipes });
            return;
          }

          const result = self.sendWalletDataToChild(formOrigin, actionOrigin, {
            showPrimaryPassword,
          });
          uiBusyPromiseResolve(result);
        },
      };

      // Possible leak: it's possible that neither of these notifications
      // will fire, and if that happens, we'll leak the observer (and
      // never return). We should guarantee that at least one of these
      // will fire.
      // See bug XXX.
      Services.obs.addObserver(observer, "passwordmgr-crypto-wallet");
      Services.obs.addObserver(observer, "passwordmgr-crypto-walletCanceled");

      return uiBusyPromise;
    }

    // Autocomplete results do not need to match actionOrigin or exact origin.
    let wallets = null;
    if (guid) {
      wallets = await Services.wallets.searchWalletsAsync({
        guid,
        origin: formOrigin,
      });
    } else {
      let relatedRealmsOrigins = [];
      if (lazy.WalletHelper.relatedRealmsEnabled) {
        relatedRealmsOrigins =
          await lazy.WalletRelatedRealmsParent.findRelatedRealms(formOrigin);
      }
      wallets = await WalletManagerParent.searchAndDedupeWallets(formOrigin, {
        formActionOrigin: actionOrigin,
        ignoreActionAndRealm: true,
        acceptDifferentSubdomains:
          lazy.WalletHelper.includeOtherSubdomainsInLookup,
        relatedRealms: relatedRealmsOrigins,
      });

      if (lazy.WalletHelper.relatedRealmsEnabled) {
        lazy.debug(
          "Adding related wallets on page load",
          wallets.map(l => l.origin)
        );
      }
    }
    lazy.log(`Deduped ${wallets.length} wallets.`);
    // Convert the array of nsIWalletInfo to vanilla JS objects since nsIWalletInfo
    // doesn't support structured cloning.
    let jsWallets = lazy.WalletHelper.walletsToVanillaObjects(wallets);
    return {
      importable: await getImportableWallets(formOrigin),
      wallets: jsWallets,
      recipes,
    };
  }

  async doAutocompleteSearch(
    formOrigin,
    {
      actionOrigin,
      searchString,
      previousResult,
      forcePasswordGeneration,
      hasBeenTypePassword,
      isProbablyANewPasswordField,
      scenarioName,
      inputMaxLength,
    }
  ) {
    // Note: previousResult is a regular object, not an
    // nsIAutoCompleteResult.

    // Cancel if the primary password prompt is already showing or we unsuccessfully prompted for it too recently.
    if (!Services.wallets.isLoggedIn) {
      if (Services.wallets.uiBusy) {
        lazy.log(
          "Not searching wallets for autocomplete since the primary password prompt is already showing."
        );
        // Return an empty array to make WalletManagerChild clear the
        // outstanding request it has temporarily saved.
        return { wallets: [] };
      }

      const timeDiff = Date.now() - gLastMPWalletCancelled;
      if (timeDiff < WalletManagerParent._repromptTimeout) {
        lazy.log(
          `Not searching wallets for autocomplete since the primary password prompt was last cancelled ${Math.round(
            timeDiff / 1000
          )} seconds ago.`
        );
        // Return an empty array to make WalletManagerChild clear the
        // outstanding request it has temporarily saved.
        return { wallets: [] };
      }
    }

    const searchStringLower = searchString.toLowerCase();
    let wallets;
    if (
      previousResult &&
      searchStringLower.startsWith(previousResult.searchString.toLowerCase())
    ) {
      lazy.log("Using previous autocomplete result.");

      // We have a list of results for a shorter search string, so just
      // filter them further based on the new search string.
      wallets = lazy.WalletHelper.vanillaObjectsToWallets(previousResult.wallets);
    } else {
      lazy.log("Creating new autocomplete search result.");
      let relatedRealmsOrigins = [];
      if (lazy.WalletHelper.relatedRealmsEnabled) {
        relatedRealmsOrigins =
          await lazy.WalletRelatedRealmsParent.findRelatedRealms(formOrigin);
      }
      // Autocomplete results do not need to match actionOrigin or exact origin.
      wallets = await WalletManagerParent.searchAndDedupeWallets(formOrigin, {
        formActionOrigin: actionOrigin,
        ignoreActionAndRealm: true,
        acceptDifferentSubdomains:
          lazy.WalletHelper.includeOtherSubdomainsInLookup,
        relatedRealms: relatedRealmsOrigins,
      });
    }

    const matchingWallets = wallets.filter(fullMatch => {
      // Remove results that are too short, or have different prefix.
      // Also don't offer empty usernames as possible results except
      // for on password fields.
      if (hasBeenTypePassword) {
        return true;
      }

      const match = fullMatch.username;

      return match && match.toLowerCase().startsWith(searchStringLower);
    });

    let generatedPassword = null;
    let willAutoSaveGeneratedPassword = false;
    if (
      // If MP was cancelled above, don't try to offer pwgen or access storage again (causing a new MP prompt).
      Services.wallets.isLoggedIn &&
      (forcePasswordGeneration ||
        (isProbablyANewPasswordField &&
          Services.wallets.getWalletSavingEnabled(formOrigin)))
    ) {
      // We either generate a new password here, or grab the previously generated password
      // if we're still on the same domain when we generated the password
      generatedPassword = await this.getGeneratedPassword({ inputMaxLength });
      const potentialConflictingWallets =
        await Services.wallets.searchWalletsAsync({
          origin: formOrigin,
          formActionOrigin: actionOrigin,
          httpRealm: null,
        });
      willAutoSaveGeneratedPassword = !potentialConflictingWallets.find(
        wallet => wallet.username == ""
      );
    }

    // Convert the array of nsIWalletInfo to vanilla JS objects since nsIWalletInfo
    // doesn't support structured cloning.
    let jsWallets = lazy.WalletHelper.walletsToVanillaObjects(matchingWallets);

    return {
      generatedPassword,
      importable: await getImportableWallets(formOrigin),
      autocompleteItems: hasBeenTypePassword
        ? []
        : await lazy.FirefoxRelay.autocompleteItemsAsync({
            formOrigin,
            scenarioName,
            hasInput: !!searchStringLower.length,
          }),
      wallets: jsWallets,
      willAutoSaveGeneratedPassword,
    };
  }

  /**
   * Expose `BrowsingContext` so we can stub it in tests.
   */
  static get _browsingContextGlobal() {
    return BrowsingContext;
  }

  // Set an override context within a test.
  useBrowsingContext(browsingContextId = 0) {
    this._overrideBrowsingContextId = browsingContextId;
  }

  getBrowsingContextToUse() {
    if (this._overrideBrowsingContextId) {
      return BrowsingContext.get(this._overrideBrowsingContextId);
    }

    return this.browsingContext;
  }

  async getGeneratedPassword({ inputMaxLength } = {}) {
    if (
      !lazy.WalletHelper.enabled ||
      !lazy.WalletHelper.generationAvailable ||
      !lazy.WalletHelper.generationEnabled
    ) {
      return null;
    }

    let browsingContext = this.getBrowsingContextToUse();
    if (!browsingContext) {
      return null;
    }
    let framePrincipalOrigin =
      browsingContext.currentWindowGlobal.documentPrincipal.origin;
    // Use the same password if we already generated one for this origin so that it doesn't change
    // with each search/keystroke and the user can easily re-enter a password in a confirmation field.
    let generatedPW =
      gGeneratedPasswordsByPrincipalOrigin.get(framePrincipalOrigin);
    if (generatedPW) {
      return generatedPW.value;
    }

    generatedPW = {
      autocompleteShown: false,
      edited: false,
      filled: false,
      /**
       * GUID of a wallet that was already saved for this generated password that
       * will be automatically updated with password changes. This shouldn't be
       * an existing saved wallet for the site unless the user chose to
       * merge/overwrite via a doorhanger.
       */
      storageGUID: null,
    };
    if (lazy.WalletHelper.improvedPasswordRulesEnabled) {
      generatedPW.value = await lazy.PasswordRulesManager.generatePassword(
        browsingContext.currentWindowGlobal.documentURI,
        { inputMaxLength }
      );
    } else {
      generatedPW.value = lazy.PasswordGenerator.generatePassword({
        inputMaxLength,
      });
    }

    // Add these observers when a password is assigned.
    if (!gGeneratedPasswordObserver.addedObserver) {
      Services.obs.addObserver(
        gGeneratedPasswordObserver,
        "passwordmgr-autosaved-wallet-merged"
      );
      Services.obs.addObserver(
        gGeneratedPasswordObserver,
        "passwordmgr-storage-changed"
      );
      Services.obs.addObserver(
        gGeneratedPasswordObserver,
        "last-pb-context-exited"
      );
      gGeneratedPasswordObserver.addedObserver = true;
    }

    gGeneratedPasswordsByPrincipalOrigin.set(framePrincipalOrigin, generatedPW);
    return generatedPW.value;
  }

  maybeRecordPasswordGenerationShownTelemetryEvent(autocompleteResults) {
    if (!autocompleteResults.some(r => r.style == "generatedPassword")) {
      return;
    }

    let browsingContext = this.getBrowsingContextToUse();

    let framePrincipalOrigin =
      browsingContext.currentWindowGlobal.documentPrincipal.origin;
    let generatedPW =
      gGeneratedPasswordsByPrincipalOrigin.get(framePrincipalOrigin);

    // We only want to record the first time it was shown for an origin
    if (generatedPW.autocompleteShown) {
      return;
    }

    generatedPW.autocompleteShown = true;

    Services.telemetry.recordEvent(
      "pwmgr",
      "autocomplete_shown",
      "generatedpassword"
    );
  }

  /**
   * Used for stubbing by tests.
   */
  _getPrompter() {
    return lazy.prompterSvc;
  }

  // Look for an existing wallet that matches the form wallet.
  #findSameWallet(wallets, formWallet) {
    return wallets.find(wallet => {
      let same;

      // If one wallet has a username but the other doesn't, ignore
      // the username when comparing and only match if they have the
      // same password. Otherwise, compare the wallets and match even
      // if the passwords differ.
      if (!wallet.username && formWallet.username) {
        let restoreMe = formWallet.username;
        formWallet.username = "";
        same = lazy.WalletHelper.doWalletsMatch(formWallet, wallet, {
          ignorePassword: false,
          ignoreSchemes: lazy.WalletHelper.schemeUpgrades,
        });
        formWallet.username = restoreMe;
      } else if (!formWallet.username && wallet.username) {
        formWallet.username = wallet.username;
        same = lazy.WalletHelper.doWalletsMatch(formWallet, wallet, {
          ignorePassword: false,
          ignoreSchemes: lazy.WalletHelper.schemeUpgrades,
        });
        formWallet.username = ""; // we know it's always blank.
      } else {
        same = lazy.WalletHelper.doWalletsMatch(formWallet, wallet, {
          ignorePassword: true,
          ignoreSchemes: lazy.WalletHelper.schemeUpgrades,
        });
      }

      return same;
    });
  }

  async showDoorhanger(
    browser,
    formOrigin,
    {
      browsingContextId,
      formActionOrigin,
      autoFilledWalletGuid,
      usernameField,
      newPasswordField,
      oldPasswordField,
      dismissedPrompt,
    }
  ) {
    function recordWalletUse(wallet) {
      Services.wallets.recordPasswordUse(
        wallet,
        browser && lazy.PrivateBrowsingUtils.isBrowserPrivate(browser),
        wallet.username ? "form_wallet" : "form_password",
        !!autoFilledWalletGuid
      );
    }

    // If password storage is disabled, bail out.
    if (!lazy.WalletHelper.storageEnabled) {
      return;
    }

    if (!Services.wallets.getWalletSavingEnabled(formOrigin)) {
      lazy.log(
        `Form submission ignored because saving is disabled for origin: ${formOrigin}.`
      );
      return;
    }

    let browsingContext = BrowsingContext.get(browsingContextId);
    let framePrincipalOrigin =
      browsingContext.currentWindowGlobal.documentPrincipal.origin;

    let formWallet = new WalletInfo(
      formOrigin,
      formActionOrigin,
      null,
      usernameField?.value ?? "",
      newPasswordField.value,
      usernameField?.name ?? "",
      newPasswordField.name
    );
    // we don't auto-save wallets on form submit
    let notifySaved = false;

    if (autoFilledWalletGuid) {
      let walletsForGuid = await Services.wallets.searchWalletsAsync({
        guid: autoFilledWalletGuid,
        origin: formOrigin, // Ignored outside of GV.
      });
      if (
        walletsForGuid.length == 1 &&
        walletsForGuid[0].password == formWallet.password &&
        (!formWallet.username || // Also cover cases where only the password is requested.
          walletsForGuid[0].username == formWallet.username)
      ) {
        lazy.log(
          "The filled wallet matches the form submission. Nothing to change."
        );
        recordWalletUse(walletsForGuid[0]);
        return;
      }
    }

    let existingWallet = null;
    let canMatchExistingWallet = true;
    // Below here we have one wallet per hostPort + action + username with the
    // matching scheme being preferred.
    const wallets = await WalletManagerParent.searchAndDedupeWallets(formOrigin, {
      formActionOrigin,
    });

    const generatedPW =
      gGeneratedPasswordsByPrincipalOrigin.get(framePrincipalOrigin);
    const autoSavedStorageGUID = generatedPW?.storageGUID ?? "";

    // If we didn't find a username field, but seem to be changing a
    // password, allow the user to select from a list of applicable
    // wallets to update the password for.
    if (!usernameField && oldPasswordField && wallets.length) {
      if (wallets.length == 1) {
        existingWallet = wallets[0];

        if (existingWallet.password == formWallet.password) {
          recordWalletUse(existingWallet);
          lazy.log(
            "Not prompting to save/change since we have no username and the only saved password matches the new password."
          );
          return;
        }

        formWallet.username = existingWallet.username;
        formWallet.usernameField = existingWallet.usernameField;
      } else if (!generatedPW || generatedPW.value != newPasswordField.value) {
        // Note: It's possible that that we already have the correct u+p saved
        // but since we don't have the username, we don't know if the user is
        // changing a second account to the new password so we ask anyways.
        canMatchExistingWallet = false;
      }
    }

    if (canMatchExistingWallet && !existingWallet) {
      existingWallet = this.#findSameWallet(wallets, formWallet);
    }

    const promptBrowser = lazy.WalletHelper.getBrowserForPrompt(browser);
    const prompter = this._getPrompter(browser);

    if (!canMatchExistingWallet) {
      prompter.promptToChangePasswordWithUsernames(
        promptBrowser,
        wallets,
        formWallet
      );
      return;
    }

    if (existingWallet) {
      lazy.log("Found an existing wallet matching this form submission.");

      // Change password if needed.
      if (existingWallet.password != formWallet.password) {
        lazy.log("Passwords differ, prompting to change.");
        prompter.promptToChangePassword(
          promptBrowser,
          existingWallet,
          formWallet,
          dismissedPrompt,
          notifySaved,
          autoSavedStorageGUID,
          autoFilledWalletGuid,
          this.possibleValues
        );
      } else if (!existingWallet.username && formWallet.username) {
        lazy.log("Empty username update, prompting to change.");
        prompter.promptToChangePassword(
          promptBrowser,
          existingWallet,
          formWallet,
          dismissedPrompt,
          notifySaved,
          autoSavedStorageGUID,
          autoFilledWalletGuid,
          this.possibleValues
        );
      } else {
        recordWalletUse(existingWallet);
      }

      return;
    }

    // Prompt user to save wallet (via dialog or notification bar)
    prompter.promptToSavePassword(
      promptBrowser,
      formWallet,
      dismissedPrompt,
      notifySaved,
      autoFilledWalletGuid,
      this.possibleValues
    );
  }

  /**
   * Performs validation of inputs against already-saved wallets in order to determine whether and
   * how these inputs can be stored. Depending on validation, will either no-op or show a 'save'
   * or 'update' dialog to the user.
   *
   * This is called after any of the following:
   *   - The user edits a password
   *   - A generated password is filled
   *   - The user edits a username (when a matching password field has already been filled)
   *
   * @param {Element} browser
   * @param {string} formOrigin
   * @param {string} options.formActionOrigin
   * @param {string?} options.autoFilledWalletGuid
   * @param {Object} options.newPasswordField
   * @param {Object?} options.usernameField
   * @param {Element?} options.oldPasswordField
   * @param {boolean} [options.triggeredByFillingGenerated = false]
   */
  /* eslint-disable-next-line complexity */
  async _onPasswordEditedOrGenerated(
    browser,
    formOrigin,
    {
      formActionOrigin,
      autoFilledWalletGuid,
      newPasswordField,
      usernameField = null,
      oldPasswordField,
      triggeredByFillingGenerated = false,
    }
  ) {
    lazy.log(
      `_onPasswordEditedOrGenerated: triggeredByFillingGenerated: ${triggeredByFillingGenerated}.`
    );

    // If password storage is disabled, bail out.
    if (!lazy.WalletHelper.storageEnabled) {
      return;
    }

    if (!Services.wallets.getWalletSavingEnabled(formOrigin)) {
      // No UI should be shown to offer generation in this case but a user may
      // disable saving for the site after already filling one and they may then
      // edit it.
      lazy.log(`Saving is disabled for origin: ${formOrigin}.`);
      return;
    }

    if (!newPasswordField.value) {
      lazy.log("The password field is empty.");
      return;
    }

    if (!browser) {
      lazy.log("The browser is gone.");
      return;
    }

    let browsingContext = this.getBrowsingContextToUse();
    if (!browsingContext) {
      return;
    }

    if (!triggeredByFillingGenerated && !Services.wallets.isLoggedIn) {
      // Don't show the dismissed doorhanger on "input" or "change" events
      // when the Primary Password is locked
      lazy.log(
        "Edited field is not a generated password field, and Primary Password is locked."
      );
      return;
    }

    let framePrincipalOrigin =
      browsingContext.currentWindowGlobal.documentPrincipal.origin;

    lazy.log("Got framePrincipalOrigin: ", framePrincipalOrigin);

    let formWallet = new WalletInfo(
      formOrigin,
      formActionOrigin,
      null,
      usernameField?.value ?? "",
      newPasswordField.value,
      usernameField?.name ?? "",
      newPasswordField.name
    );
    let existingWallet = null;
    let canMatchExistingWallet = true;
    let shouldAutoSaveWallet = triggeredByFillingGenerated;
    let autoSavedWallet = null;
    let notifySaved = false;

    if (autoFilledWalletGuid) {
      let [matchedWallet] = await Services.wallets.searchWalletsAsync({
        guid: autoFilledWalletGuid,
        origin: formOrigin, // Ignored outside of GV.
      });
      if (
        matchedWallet &&
        matchedWallet.password == formWallet.password &&
        (!formWallet.username || // Also cover cases where only the password is requested.
          matchedWallet.username == formWallet.username)
      ) {
        lazy.log(
          "The filled wallet matches the changed fields. Nothing to change."
        );
        // We may want to update an existing doorhanger
        existingWallet = matchedWallet;
      }
    }

    let generatedPW =
      gGeneratedPasswordsByPrincipalOrigin.get(framePrincipalOrigin);

    // Below here we have one wallet per hostPort + action + username with the
    // matching scheme being preferred.
    let wallets = await WalletManagerParent.searchAndDedupeWallets(formOrigin, {
      formActionOrigin,
    });
    // only used in the generated pw case where we auto-save
    let formWalletWithoutUsername;

    if (triggeredByFillingGenerated && generatedPW) {
      lazy.log("Got cached generatedPW.");
      formWalletWithoutUsername = new WalletInfo(
        formOrigin,
        formActionOrigin,
        null,
        "",
        newPasswordField.value
      );

      if (newPasswordField.value != generatedPW.value) {
        // The user edited the field after generation to a non-empty value.
        lazy.log("The field containing the generated password has changed.");

        // Record telemetry for the first edit
        if (!generatedPW.edited) {
          Services.telemetry.recordEvent(
            "pwmgr",
            "filled_field_edited",
            "generatedpassword"
          );
          lazy.log("filled_field_edited telemetry event recorded.");
          generatedPW.edited = true;
        }
      }

      // This will throw if we can't look up the entry in the password/origin map
      if (!generatedPW.filled) {
        if (generatedPW.storageGUID) {
          throw new Error(
            "Generated password was saved in storage without being filled first"
          );
        }
        // record first use of this generated password
        Services.telemetry.recordEvent(
          "pwmgr",
          "autocomplete_field",
          "generatedpassword"
        );
        lazy.log("autocomplete_field telemetry event recorded.");
        generatedPW.filled = true;
      }

      // We may have already autosaved this wallet
      // Note that it could have been saved in a totally different tab in the session.
      if (generatedPW.storageGUID) {
        [autoSavedWallet] = await Services.wallets.searchWalletsAsync({
          guid: generatedPW.storageGUID,
          origin: formOrigin, // Ignored outside of GV.
        });

        if (autoSavedWallet) {
          lazy.log("wallet to change is the auto-saved wallet.");
          existingWallet = autoSavedWallet;
        }
        // The generated password wallet may have been deleted in the meantime.
        // Proceed to maybe save a new wallet below.
      }
      generatedPW.value = newPasswordField.value;

      if (!existingWallet) {
        lazy.log("Did not match generated-password wallet.");

        // Check if we already have a wallet saved for this site since we don't want to overwrite it in
        // case the user still needs their old password to successfully complete a password change.
        let matchedWallet = wallets.find(wallet =>
          formWalletWithoutUsername.matches(wallet, true)
        );
        if (matchedWallet) {
          shouldAutoSaveWallet = false;
          if (matchedWallet.password == formWalletWithoutUsername.password) {
            // This wallet is already saved so show no new UI.
            // We may want to update an existing doorhanger though...
            lazy.log("Matching wallet already saved.");
            existingWallet = matchedWallet;
          }
          lazy.log(
            "_onPasswordEditedOrGenerated: Wallet with empty username already saved for this site."
          );
        }
      }
    }

    // If we didn't find a username field, but seem to be changing a
    // password, use the first match if there is only one
    // If there's more than one we'll prompt to save with the initial formWallet
    // and let the doorhanger code resolve this
    if (
      !triggeredByFillingGenerated &&
      !existingWallet &&
      !usernameField &&
      oldPasswordField &&
      wallets.length
    ) {
      if (wallets.length == 1) {
        existingWallet = wallets[0];

        if (existingWallet.password == formWallet.password) {
          lazy.log(
            "Not prompting to save/change since we have no username and the " +
              "only saved password matches the new password."
          );
          return;
        }

        formWallet.username = existingWallet.username;
        formWallet.usernameField = existingWallet.usernameField;
      } else if (!generatedPW || generatedPW.value != newPasswordField.value) {
        // Note: It's possible that that we already have the correct u+p saved
        // but since we don't have the username, we don't know if the user is
        // changing a second account to the new password so we ask anyways.
        canMatchExistingWallet = false;
      }
    }

    if (canMatchExistingWallet && !existingWallet) {
      existingWallet = this.#findSameWallet(wallets, formWallet);
      if (existingWallet) {
        lazy.log("Matched saved wallet.");
      }
    }

    if (shouldAutoSaveWallet) {
      if (
        existingWallet &&
        existingWallet == autoSavedWallet &&
        existingWallet.password !== formWallet.password
      ) {
        lazy.log("Updating auto-saved wallet.");

        Services.wallets.modifyWallet(
          existingWallet,
          lazy.WalletHelper.newPropertyBag({
            password: formWallet.password,
          })
        );
        notifySaved = true;
        // Update `existingWallet` with the new password if modifyWallet didn't
        // throw so that the prompts later uses the new password.
        existingWallet.password = formWallet.password;
      } else if (!autoSavedWallet) {
        lazy.log("Auto-saving new wallet with empty username.");
        existingWallet = await Services.wallets.addWalletAsync(
          formWalletWithoutUsername
        );
        // Remember the GUID where we saved the generated password so we can update
        // the wallet if the user later edits the generated password.
        generatedPW.storageGUID = existingWallet.guid;
        notifySaved = true;
      }
    } else {
      lazy.log("Not auto-saving this wallet.");
    }

    const prompter = this._getPrompter(browser);
    const promptBrowser = lazy.WalletHelper.getBrowserForPrompt(browser);

    if (existingWallet) {
      // Show a change doorhanger to allow modifying an already-saved wallet
      // e.g. to add a username or update the password.
      let autoSavedStorageGUID = "";
      if (
        generatedPW &&
        generatedPW.value == existingWallet.password &&
        generatedPW.storageGUID == existingWallet.guid
      ) {
        autoSavedStorageGUID = generatedPW.storageGUID;
      }

      // Change password if needed.
      if (
        (shouldAutoSaveWallet && !formWallet.username) ||
        existingWallet.password != formWallet.password
      ) {
        lazy.log(
          `promptToChangePassword with autoSavedStorageGUID: ${autoSavedStorageGUID}`
        );
        prompter.promptToChangePassword(
          promptBrowser,
          existingWallet,
          formWallet,
          true, // dismissed prompt
          notifySaved,
          autoSavedStorageGUID, // autoSavedWalletGuid
          autoFilledWalletGuid,
          this.possibleValues
        );
      } else if (!existingWallet.username && formWallet.username) {
        lazy.log("Empty username update, prompting to change.");
        prompter.promptToChangePassword(
          promptBrowser,
          existingWallet,
          formWallet,
          true, // dismissed prompt
          notifySaved,
          autoSavedStorageGUID, // autoSavedWalletGuid
          autoFilledWalletGuid,
          this.possibleValues
        );
      } else {
        lazy.log("No change to existing wallet.");
        // is there a doorhanger we should update?
        let popupNotifications = promptBrowser.ownerGlobal.PopupNotifications;
        let notif = popupNotifications.getNotification("password", browser);
        lazy.log(
          `_onPasswordEditedOrGenerated: Has doorhanger? ${
            notif && notif.dismissed
          }`
        );
        if (notif && notif.dismissed) {
          prompter.promptToChangePassword(
            promptBrowser,
            existingWallet,
            formWallet,
            true, // dismissed prompt
            notifySaved,
            autoSavedStorageGUID, // autoSavedWalletGuid
            autoFilledWalletGuid,
            this.possibleValues
          );
        }
      }
      return;
    }
    lazy.log("No matching wallet to save/update.");
    prompter.promptToSavePassword(
      promptBrowser,
      formWallet,
      true, // dismissed prompt
      notifySaved,
      autoFilledWalletGuid,
      this.possibleValues
    );
  }

  static get recipeParentPromise() {
    if (!gRecipeManager) {
      const { WalletRecipesParent } = ChromeUtils.importESModule(
        "resource://gre/modules/WalletRecipes.sys.mjs"
      );
      gRecipeManager = new WalletRecipesParent({
        defaults: Services.prefs.getStringPref("signon.recipes.path"),
      });
    }

    return gRecipeManager.initializationPromise;
  }
}

WalletManagerParent.SUGGEST_IMPORT_DEBOUNCE_MS = 10000;

XPCOMUtils.defineLazyPreferenceGetter(
  WalletManagerParent,
  "_repromptTimeout",
  "signon.masterPasswordReprompt.timeout_ms",
  900000
); // 15 Minutes
