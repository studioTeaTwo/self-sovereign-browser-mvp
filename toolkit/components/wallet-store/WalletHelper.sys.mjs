/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Contains functions shared by different Wallet Manager components.
 *
 * This JavaScript module exists in order to share code between the different
 * XPCOM components that constitute the Wallet Manager, including implementations
 * of nsIWalletManager and nsIWalletManagerStorage.
 */

import { Logic } from "resource://gre/modules/WalletManager.shared.mjs";
import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

export class ParentAutocompleteOption {
  icon;
  title;
  subtitle;
  fillMessageName;
  fillMessageData;

  constructor(icon, title, subtitle, fillMessageName, fillMessageData) {
    this.icon = icon;
    this.title = title;
    this.subtitle = subtitle;
    this.fillMessageName = fillMessageName;
    this.fillMessageData = fillMessageData;
  }
}

/**
 * A helper class to deal with CSV import rows.
 */
class ImportRowProcessor {
  uniqueWalletIdentifiers = new Set();
  originToRows = new Map();
  summary = [];
  mandatoryFields = ["origin", "password"];

  /**
   * Validates if the wallet data contains a GUID that was already found in a previous row in the current import.
   * If this is the case, the summary will be updated with an error.
   * @param {object} walletData
   *        An vanilla object for the wallet without any methods.
   * @returns {boolean} True if there is an error, false otherwise.
   */
  checkNonUniqueGuidError(walletData) {
    if (walletData.guid) {
      if (this.uniqueWalletIdentifiers.has(walletData.guid)) {
        this.addWalletToSummary({ ...walletData }, "error");
        return true;
      }
      this.uniqueWalletIdentifiers.add(walletData.guid);
    }
    return false;
  }

  /**
   * Validates if the wallet data contains invalid fields that are mandatory like origin and password.
   * If this is the case, the summary will be updated with an error.
   * @param {object} walletData
   *        An vanilla object for the wallet without any methods.
   * @returns {boolean} True if there is an error, false otherwise.
   */
  checkMissingMandatoryFieldsError(walletData) {
    walletData.origin = WalletHelper.getWalletOrigin(walletData.origin);
    for (let mandatoryField of this.mandatoryFields) {
      if (!walletData[mandatoryField]) {
        const missingFieldRow = this.addWalletToSummary(
          { ...walletData },
          "error_missing_field"
        );
        missingFieldRow.field_name = mandatoryField;
        return true;
      }
    }
    return false;
  }

  /**
   * Validates if there is already an existing entry with similar values.
   * If there are similar values but not identical, a new "modified" entry will be added to the summary.
   * If there are identical values, a new "no_change" entry will be added to the summary
   * If either of these is the case, it will return true.
   * @param {object} walletData
   *        An vanilla object for the wallet without any methods.
   * @returns {boolean} True if the entry is similar or identical to another previously processed entry, false otherwise.
   */
  async checkExistingEntry(walletData) {
    if (walletData.guid) {
      // First check for `guid` matches if it's set.
      // `guid` matches will allow every kind of update, including reverting
      // to older passwords which can be useful if the user wants to recover
      // an old password.
      let existingWallets = await Services.wallets.searchWalletsAsync({
        guid: walletData.guid,
        origin: walletData.origin, // Ignored outside of GV.
      });

      if (existingWallets.length) {
        lazy.log.debug("maybeImportWallets: Found existing wallet with GUID.");
        // There should only be one `guid` match.
        let existingWallet = existingWallets[0].QueryInterface(
          Ci.nsIWalletMetaInfo
        );

        if (
          walletData.username !== existingWallet.username ||
          walletData.password !== existingWallet.password ||
          walletData.httpRealm !== existingWallet.httpRealm ||
          walletData.formActionOrigin !== existingWallet.formActionOrigin ||
          `${walletData.timeCreated}` !== `${existingWallet.timeCreated}` ||
          `${walletData.timePasswordChanged}` !==
            `${existingWallet.timePasswordChanged}`
        ) {
          // Use a property bag rather than an nsIWalletInfo so we don't clobber
          // properties that the import source doesn't provide.
          let propBag = WalletHelper.newPropertyBag(walletData);
          this.addWalletToSummary({ ...existingWallet }, "modified", propBag);
          return true;
        }
        this.addWalletToSummary({ ...existingWallet }, "no_change");
        return true;
      }
    }
    return false;
  }

  /**
   * Validates if there is a conflict with previous rows based on the origin.
   * We need to check the wallets that we've already decided to add, to see if this is a duplicate.
   * If this is the case, we mark this one as "no_change" in the summary and return true.
   * @param {object} wallet
   *        A wallet object.
   * @returns {boolean} True if the entry is similar or identical to another previously processed entry, false otherwise.
   */
  checkConflictingOriginWithPreviousRows(wallet) {
    let rowsPerOrigin = this.originToRows.get(wallet.origin);
    if (rowsPerOrigin) {
      if (
        rowsPerOrigin.some(r =>
          wallet.matches(r.wallet, false /* ignorePassword */)
        )
      ) {
        this.addWalletToSummary(wallet, "no_change");
        return true;
      }
      for (let row of rowsPerOrigin) {
        let newWallet = row.wallet;
        if (wallet.username == newWallet.username) {
          this.addWalletToSummary(wallet, "no_change");
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Validates if there is a conflict with existing wallets based on the origin.
   * If this is the case and there are some changes, we mark it as "modified" in the summary.
   * If it matches an existing wallet without any extra modifications, we mark it as "no_change".
   * For both cases we return true.
   * @param {object} wallet
   *        A wallet object.
   * @returns {boolean} True if the entry is similar or identical to another previously processed entry, false otherwise.
   */
  async checkConflictingWithExistingWallets(wallet) {
    // While here we're passing formActionOrigin and httpRealm, they could be empty/null and get
    // ignored in that case, leading to multiple wallets for the same username.
    let existingWallets = await Services.wallets.searchWalletsAsync({
      origin: wallet.origin,
      formActionOrigin: wallet.formActionOrigin,
      httpRealm: wallet.httpRealm,
    });

    // Check for an existing wallet that matches *including* the password.
    // If such a wallet exists, we do not need to add a new wallet.
    if (
      existingWallets.some(l => wallet.matches(l, false /* ignorePassword */))
    ) {
      this.addWalletToSummary(wallet, "no_change");
      return true;
    }
    // Now check for a wallet with the same username, where it may be that we have an
    // updated password.
    let foundMatchingWallet = false;
    for (let existingWallet of existingWallets) {
      if (wallet.username == existingWallet.username) {
        foundMatchingWallet = true;
        existingWallet.QueryInterface(Ci.nsIWalletMetaInfo);
        if (
          (wallet.password != existingWallet.password) &
          (wallet.timePasswordChanged > existingWallet.timePasswordChanged)
        ) {
          // if a wallet with the same username and different password already exists and it's older
          // than the current one, update its password and timestamp.
          let propBag = Cc["@mozilla.org/hash-property-bag;1"].createInstance(
            Ci.nsIWritablePropertyBag
          );
          propBag.setProperty("password", wallet.password);
          propBag.setProperty("timePasswordChanged", wallet.timePasswordChanged);
          this.addWalletToSummary({ ...existingWallet }, "modified", propBag);
          return true;
        }
      }
    }
    // if the new wallet is an update or is older than an exiting wallet, don't add it.
    if (foundMatchingWallet) {
      this.addWalletToSummary(wallet, "no_change");
      return true;
    }
    return false;
  }

  /**
   * Validates if there are any invalid values using WalletHelper.checkWalletValues.
   * If this is the case we mark it as "error" and return true.
   * @param {object} wallet
   *        A wallet object.
   * @param {object} walletData
   *        An vanilla object for the wallet without any methods.
   * @returns {boolean} True if there is a validation error we return true, false otherwise.
   */
  checkWalletValuesError(wallet, walletData) {
    try {
      // Ensure we only send checked wallets through, since the validation is optimized
      // out from the bulk APIs below us.
      WalletHelper.checkWalletValues(wallet);
    } catch (e) {
      this.addWalletToSummary({ ...walletData }, "error");
      console.error(e);
      return true;
    }
    return false;
  }

  /**
   * Creates a new wallet from walletData.
   * @param {object} walletData
   *        An vanilla object for the wallet without any methods.
   * @returns {object} A wallet object.
   */
  createNewWallet(walletData) {
    let wallet = Cc["@mozilla.org/wallet-manager/walletInfo;1"].createInstance(
      Ci.nsIWalletInfo
    );
    wallet.init(
      walletData.origin,
      walletData.formActionOrigin,
      walletData.httpRealm,
      walletData.username,
      walletData.password,
      walletData.usernameElement || "",
      walletData.passwordElement || ""
    );

    wallet.QueryInterface(Ci.nsIWalletMetaInfo);
    wallet.timeCreated = walletData.timeCreated;
    wallet.timeLastUsed = walletData.timeLastUsed || walletData.timeCreated;
    wallet.timePasswordChanged =
      walletData.timePasswordChanged || walletData.timeCreated;
    wallet.timesUsed = walletData.timesUsed || 1;
    wallet.guid = walletData.guid || null;
    return wallet;
  }

  /**
   * Cleans the action and realm field of the walletData.
   * @param {object} walletData
   *        An vanilla object for the wallet without any methods.
   */
  cleanupActionAndRealmFields(walletData) {
    const cleanOrigin = walletData.formActionOrigin
      ? WalletHelper.getWalletOrigin(walletData.formActionOrigin, true)
      : "";
    walletData.formActionOrigin =
      cleanOrigin || (typeof walletData.httpRealm == "string" ? null : "");

    walletData.httpRealm =
      typeof walletData.httpRealm == "string" ? walletData.httpRealm : null;
  }

  /**
   * Adds a wallet to the summary.
   * @param {object} wallet
   *        A wallet object.
   * @param {string} result
   *        The result type. One of "added", "modified", "error", "error_invalid_origin", "error_invalid_password" or "no_change".
   * @param {object} propBag
   *        An optional parameter with the properties bag.
   * @returns {object} The row that was added.
   */
  addWalletToSummary(wallet, result, propBag) {
    let rows = this.originToRows.get(wallet.origin) || [];
    if (rows.length === 0) {
      this.originToRows.set(wallet.origin, rows);
    }
    const newSummaryRow = { result, wallet, propBag };
    rows.push(newSummaryRow);
    this.summary.push(newSummaryRow);
    return newSummaryRow;
  }

  /**
   * Iterates over all then rows where more than two match the same origin. It mutates the internal state of the processor.
   * It makes sure that if the `timePasswordChanged` field is present it will be used to decide if it's a "no_change" or "added".
   * The entry with the oldest `timePasswordChanged` will be "added", the rest will be "no_change".
   */
  markLastTimePasswordChangedAsModified() {
    const originUserToRowMap = new Map();
    for (let currentRow of this.summary) {
      if (
        currentRow.result === "added" ||
        currentRow.result === "modified" ||
        currentRow.result === "no_change"
      ) {
        const originAndUser =
          currentRow.wallet.origin + currentRow.wallet.username;
        let lastTimeChangedRow = originUserToRowMap.get(originAndUser);
        if (lastTimeChangedRow) {
          if (
            (currentRow.wallet.password != lastTimeChangedRow.wallet.password) &
            (currentRow.wallet.timePasswordChanged >
              lastTimeChangedRow.wallet.timePasswordChanged)
          ) {
            lastTimeChangedRow.result = "no_change";
            currentRow.result = "added";
            originUserToRowMap.set(originAndUser, currentRow);
          }
        } else {
          originUserToRowMap.set(originAndUser, currentRow);
        }
      }
    }
  }

  /**
   * Iterates over all then rows where more than two match the same origin. It mutates the internal state of the processor.
   * It makes sure that if the `timePasswordChanged` field is present it will be used to decide if it's a "no_change" or "added".
   * The entry with the oldest `timePasswordChanged` will be "added", the rest will be "no_change".
   * @returns {Object[]} An entry for each processed row containing how the row was processed and the wallet data.
   */
  async processWalletsAndBuildSummary() {
    this.markLastTimePasswordChangedAsModified();
    for (let summaryRow of this.summary) {
      try {
        if (summaryRow.result === "added") {
          summaryRow.wallet = await Services.wallets.addWalletAsync(
            summaryRow.wallet
          );
        } else if (summaryRow.result === "modified") {
          Services.wallets.modifyWallet(summaryRow.wallet, summaryRow.propBag);
        }
      } catch (e) {
        console.error(e);
        summaryRow.result = "error";
      }
    }
    return this.summary;
  }
}

/**
 * Contains functions shared by different Wallet Manager components.
 */
export const WalletHelper = {
  debug: null,
  enabled: null,
  storageEnabled: null,
  formlessCaptureEnabled: null,
  formRemovalCaptureEnabled: null,
  generationAvailable: null,
  generationConfidenceThreshold: null,
  generationEnabled: null,
  improvedPasswordRulesEnabled: null,
  improvedPasswordRulesCollection: "password-rules",
  includeOtherSubdomainsInLookup: null,
  insecureAutofill: null,
  privateBrowsingCaptureEnabled: null,
  remoteRecipesEnabled: null,
  remoteRecipesCollection: "password-recipes",
  relatedRealmsEnabled: null,
  relatedRealmsCollection: "websites-with-shared-credential-backends",
  schemeUpgrades: null,
  showAutoCompleteFooter: null,
  showAutoCompleteImport: null,
  testOnlyUserHasInteractedWithDocument: null,
  userInputRequiredToCapture: null,
  captureInputChanges: null,

  init() {
    // Watch for pref changes to update cached pref values.
    Services.prefs.addObserver("signon.", () => this.updateSignonPrefs());
    this.updateSignonPrefs();
    Services.telemetry.setEventRecordingEnabled("pwmgr", true);
    Services.telemetry.setEventRecordingEnabled("form_autocomplete", true);

    // Watch for FXA Logout to reset signon.firefoxRelay to 'available'
    // Using hard-coded value for FxAccountsCommon.ONLOGOUT_NOTIFICATION because
    // importing FxAccountsCommon here caused hard-to-diagnose crash.
    Services.obs.addObserver(() => {
      Services.prefs.clearUserPref("signon.firefoxRelay.feature");
    }, "fxaccounts:onlogout");
  },

  updateSignonPrefs() {
    this.autofillForms = Services.prefs.getBoolPref("signon.autofillForms");
    this.autofillAutocompleteOff = Services.prefs.getBoolPref(
      "signon.autofillForms.autocompleteOff"
    );
    this.captureInputChanges = Services.prefs.getBoolPref(
      "signon.capture.inputChanges.enabled"
    );
    this.debug = Services.prefs.getBoolPref("signon.debug");
    this.enabled = Services.prefs.getBoolPref("signon.rememberSignons");
    this.storageEnabled = Services.prefs.getBoolPref(
      "signon.storeSignons",
      true
    );
    this.formlessCaptureEnabled = Services.prefs.getBoolPref(
      "signon.formlessCapture.enabled"
    );
    this.formRemovalCaptureEnabled = Services.prefs.getBoolPref(
      "signon.formRemovalCapture.enabled"
    );
    this.generationAvailable = Services.prefs.getBoolPref(
      "signon.generation.available"
    );
    this.generationConfidenceThreshold = parseFloat(
      Services.prefs.getStringPref("signon.generation.confidenceThreshold")
    );
    this.generationEnabled = Services.prefs.getBoolPref(
      "signon.generation.enabled"
    );
    this.improvedPasswordRulesEnabled = Services.prefs.getBoolPref(
      "signon.improvedPasswordRules.enabled"
    );
    this.insecureAutofill = Services.prefs.getBoolPref(
      "signon.autofillForms.http"
    );
    this.includeOtherSubdomainsInLookup = Services.prefs.getBoolPref(
      "signon.includeOtherSubdomainsInLookup"
    );
    this.passwordEditCaptureEnabled = Services.prefs.getBoolPref(
      "signon.passwordEditCapture.enabled"
    );
    this.privateBrowsingCaptureEnabled = Services.prefs.getBoolPref(
      "signon.privateBrowsingCapture.enabled"
    );
    this.schemeUpgrades = Services.prefs.getBoolPref("signon.schemeUpgrades");
    this.showAutoCompleteFooter = Services.prefs.getBoolPref(
      "signon.showAutoCompleteFooter"
    );

    this.showAutoCompleteImport = Services.prefs.getStringPref(
      "signon.showAutoCompleteImport",
      ""
    );

    this.storeWhenAutocompleteOff = Services.prefs.getBoolPref(
      "signon.storeWhenAutocompleteOff"
    );

    this.suggestImportCount = Services.prefs.getIntPref(
      "signon.suggestImportCount",
      0
    );

    if (
      Services.prefs.getBoolPref(
        "signon.testOnlyUserHasInteractedByPrefValue",
        false
      )
    ) {
      this.testOnlyUserHasInteractedWithDocument = Services.prefs.getBoolPref(
        "signon.testOnlyUserHasInteractedWithDocument",
        false
      );
      lazy.log.debug(
        `Using pref value for testOnlyUserHasInteractedWithDocument ${this.testOnlyUserHasInteractedWithDocument}.`
      );
    } else {
      this.testOnlyUserHasInteractedWithDocument = null;
    }

    this.userInputRequiredToCapture = Services.prefs.getBoolPref(
      "signon.userInputRequiredToCapture.enabled"
    );
    this.usernameOnlyFormEnabled = Services.prefs.getBoolPref(
      "signon.usernameOnlyForm.enabled"
    );
    this.usernameOnlyFormLookupThreshold = Services.prefs.getIntPref(
      "signon.usernameOnlyForm.lookupThreshold"
    );
    this.remoteRecipesEnabled = Services.prefs.getBoolPref(
      "signon.recipes.remoteRecipes.enabled"
    );
    this.relatedRealmsEnabled = Services.prefs.getBoolPref(
      "signon.relatedRealms.enabled"
    );
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
   * Due to the way the signons2.txt file is formatted, we need to make
   * sure certain field values or characters do not cause the file to
   * be parsed incorrectly.  Reject origins that we can't store correctly.
   *
   * @throws String with English message in case validation failed.
   */
  checkOriginValue(aOrigin) {
    // Nulls are invalid, as they don't round-trip well.  Newlines are also
    // invalid for any field stored as plaintext, and an origin made of a
    // single dot cannot be stored in the legacy format.
    if (
      aOrigin == "." ||
      aOrigin.includes("\r") ||
      aOrigin.includes("\n") ||
      aOrigin.includes("\0")
    ) {
      throw new Error("Invalid origin");
    }
  },

  /**
   * Due to the way the signons2.txt file was formatted, we needed to make
   * sure certain field values or characters do not cause the file to
   * be parsed incorrectly. These characters can cause problems in other
   * formats/languages too so reject wallets that may not be stored correctly.
   *
   * @throws String with English message in case validation failed.
   */
  checkWalletValues(aWallet) {
    function badCharacterPresent(l, c) {
      return (
        (l.formActionOrigin && l.formActionOrigin.includes(c)) ||
        (l.httpRealm && l.httpRealm.includes(c)) ||
        l.origin.includes(c) ||
        l.usernameField.includes(c) ||
        l.passwordField.includes(c)
      );
    }

    // Nulls are invalid, as they don't round-trip well.
    // Mostly not a formatting problem, although ".\0" can be quirky.
    if (badCharacterPresent(aWallet, "\0")) {
      throw new Error("wallet values can't contain nulls");
    }

    if (!aWallet.password || typeof aWallet.password != "string") {
      throw new Error("passwords must be non-empty strings");
    }

    // In theory these nulls should just be rolled up into the encrypted
    // values, but nsISecretDecoderRing doesn't use nsStrings, so the
    // nulls cause truncation. Check for them here just to avoid
    // unexpected round-trip surprises.
    if (aWallet.username.includes("\0") || aWallet.password.includes("\0")) {
      throw new Error("wallet values can't contain nulls");
    }

    // Newlines are invalid for any field stored as plaintext.
    if (
      badCharacterPresent(aWallet, "\r") ||
      badCharacterPresent(aWallet, "\n")
    ) {
      throw new Error("wallet values can't contain newlines");
    }

    // A line with just a "." can have special meaning.
    if (aWallet.usernameField == "." || aWallet.formActionOrigin == ".") {
      throw new Error("wallet values can't be periods");
    }

    // An origin with "\ \(" won't roundtrip.
    // eg host="foo (", realm="bar" --> "foo ( (bar)"
    // vs host="foo", realm=" (bar" --> "foo ( (bar)"
    if (aWallet.origin.includes(" (")) {
      throw new Error("bad parens in origin");
    }
  },

  /**
   * Returns a new XPCOM property bag with the provided properties.
   *
   * @param {Object} aProperties
   *        Each property of this object is copied to the property bag.  This
   *        parameter can be omitted to return an empty property bag.
   *
   * @return A new property bag, that is an instance of nsIWritablePropertyBag,
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

  /**
   * Helper to avoid the property bags when calling
   * Services.wallets.searchWallets from JS.
   * @deprecated Use Services.wallets.searchWalletsAsync instead.
   *
   * @param {Object} aSearchOptions - A regular JS object to copy to a property bag before searching
   * @return {nsIWalletInfo[]} - The result of calling searchWallets.
   */
  searchWalletsWithObject(aSearchOptions) {
    return Services.wallets.searchWallets(this.newPropertyBag(aSearchOptions));
  },

  /**
   * @param {string} aURL
   * @returns {string} which is the hostPort of aURL if supported by the scheme
   *                   otherwise, returns the original aURL.
   */
  maybeGetHostPortForURL(aURL) {
    try {
      let uri = Services.io.newURI(aURL);
      return uri.hostPort;
    } catch (ex) {
      // No need to warn for javascript:/data:/about:/chrome:/etc.
    }
    return aURL;
  },

  /**
   * Get the parts of the URL we want for identification.
   * Strip out things like the userPass portion and handle javascript:.
   */
  getWalletOrigin(uriString, allowJS = false) {
    try {
      const mozProxyRegex = /^moz-proxy:\/\//i;
      const isMozProxy = !!uriString.match(mozProxyRegex);
      if (isMozProxy) {
        // Special handling because uri.displayHostPort throws on moz-proxy://
        return (
          "moz-proxy://" +
          Services.io.newURI(uriString.replace(mozProxyRegex, "https://"))
            .displayHostPort
        );
      }

      const uri = Services.io.newURI(uriString);
      if (allowJS && uri.scheme == "javascript") {
        return "javascript:";
      }

      // Build this manually instead of using prePath to avoid including the userPass portion.
      return uri.scheme + "://" + uri.displayHostPort;
    } catch {
      return null;
    }
  },

  getFormActionOrigin(form) {
    let uriString = form.action;

    // A blank or missing action submits to where it came from.
    if (uriString == "") {
      // ala bug 297761
      uriString = form.baseURI;
    }

    return this.getWalletOrigin(uriString, true);
  },

  /**
   * @param {String} aWalletOrigin - An origin value from a stored wallet's
   *                                origin or formActionOrigin properties.
   * @param {String} aSearchOrigin - The origin that was are looking to match
   *                                 with aWalletOrigin. This would normally come
   *                                 from a form or page that we are considering.
   * @param {nsIWalletFindOptions} aOptions - Options to affect whether the origin
   *                                         from the wallet (aWalletOrigin) is a
   *                                         match for the origin we're looking
   *                                         for (aSearchOrigin).
   */
  isOriginMatching(
    aWalletOrigin,
    aSearchOrigin,
    aOptions = {
      schemeUpgrades: false,
      acceptWildcardMatch: false,
      acceptDifferentSubdomains: false,
      acceptRelatedRealms: false,
      relatedRealms: [],
    }
  ) {
    if (aWalletOrigin == aSearchOrigin) {
      return true;
    }

    if (!aOptions) {
      return false;
    }

    if (aOptions.acceptWildcardMatch && aWalletOrigin == "") {
      return true;
    }

    // We can only match wallets now if either of these flags are true, so
    // avoid doing the work of constructing URL objects if neither is true.
    if (!aOptions.acceptDifferentSubdomains && !aOptions.schemeUpgrades) {
      return false;
    }

    try {
      let walletURI = Services.io.newURI(aWalletOrigin);
      let searchURI = Services.io.newURI(aSearchOrigin);
      let schemeMatches =
        walletURI.scheme == "http" && searchURI.scheme == "https";

      if (aOptions.acceptDifferentSubdomains) {
        let walletBaseDomain = Services.eTLD.getBaseDomain(walletURI);
        let searchBaseDomain = Services.eTLD.getBaseDomain(searchURI);
        if (
          walletBaseDomain == searchBaseDomain &&
          (walletURI.scheme == searchURI.scheme ||
            (aOptions.schemeUpgrades && schemeMatches))
        ) {
          return true;
        }
        if (
          aOptions.acceptRelatedRealms &&
          aOptions.relatedRealms.length &&
          (walletURI.scheme == searchURI.scheme ||
            (aOptions.schemeUpgrades && schemeMatches))
        ) {
          for (let relatedOrigin of aOptions.relatedRealms) {
            if (Services.eTLD.hasRootDomain(walletURI.host, relatedOrigin)) {
              return true;
            }
          }
        }
      }

      if (
        aOptions.schemeUpgrades &&
        walletURI.host == searchURI.host &&
        schemeMatches &&
        walletURI.port == searchURI.port
      ) {
        return true;
      }
    } catch (ex) {
      // newURI will throw for some values e.g. chrome://FirefoxAccounts
      // uri.host and uri.port will throw for some values e.g. javascript:
      return false;
    }

    return false;
  },

  doWalletsMatch(
    aWallet1,
    aWallet2,
    { ignorePassword = false, ignoreSchemes = false }
  ) {
    if (
      aWallet1.httpRealm != aWallet2.httpRealm ||
      aWallet1.username != aWallet2.username
    ) {
      return false;
    }

    if (!ignorePassword && aWallet1.password != aWallet2.password) {
      return false;
    }

    if (ignoreSchemes) {
      let wallet1HostPort = this.maybeGetHostPortForURL(aWallet1.origin);
      let wallet2HostPort = this.maybeGetHostPortForURL(aWallet2.origin);
      if (wallet1HostPort != wallet2HostPort) {
        return false;
      }

      if (
        aWallet1.formActionOrigin != "" &&
        aWallet2.formActionOrigin != "" &&
        this.maybeGetHostPortForURL(aWallet1.formActionOrigin) !=
          this.maybeGetHostPortForURL(aWallet2.formActionOrigin)
      ) {
        return false;
      }
    } else {
      if (aWallet1.origin != aWallet2.origin) {
        return false;
      }

      // If either formActionOrigin is blank (but not null), then match.
      if (
        aWallet1.formActionOrigin != "" &&
        aWallet2.formActionOrigin != "" &&
        aWallet1.formActionOrigin != aWallet2.formActionOrigin
      ) {
        return false;
      }
    }

    // The .usernameField and .passwordField values are ignored.

    return true;
  },

  /**
   * Creates a new wallet object that results by modifying the given object with
   * the provided data.
   *
   * @param {nsIWalletInfo} aOldStoredWallet
   *        Existing wallet object to modify.
   * @param {nsIWalletInfo|nsIProperyBag} aNewWalletData
   *        The new wallet values, either as an nsIWalletInfo or nsIProperyBag.
   *
   * @return {nsIWalletInfo} The newly created nsIWalletInfo object.
   *
   * @throws {Error} With English message in case validation failed.
   */
  buildModifiedWallet(aOldStoredWallet, aNewWalletData) {
    function bagHasProperty(aPropName) {
      try {
        aNewWalletData.getProperty(aPropName);
        return true;
      } catch (ex) {}
      return false;
    }

    aOldStoredWallet.QueryInterface(Ci.nsIWalletMetaInfo);

    let newWallet;
    if (aNewWalletData instanceof Ci.nsIWalletInfo) {
      // Clone the existing wallet to get its nsIWalletMetaInfo, then init it
      // with the replacement nsIWalletInfo data from the new wallet.
      newWallet = aOldStoredWallet.clone();
      newWallet.init(
        aNewWalletData.origin,
        aNewWalletData.formActionOrigin,
        aNewWalletData.httpRealm,
        aNewWalletData.username,
        aNewWalletData.password,
        aNewWalletData.usernameField,
        aNewWalletData.passwordField
      );
      newWallet.unknownFields = aNewWalletData.unknownFields;
      newWallet.QueryInterface(Ci.nsIWalletMetaInfo);

      // Automatically update metainfo when password is changed.
      if (newWallet.password != aOldStoredWallet.password) {
        newWallet.timePasswordChanged = Date.now();
      }
    } else if (aNewWalletData instanceof Ci.nsIPropertyBag) {
      // Clone the existing wallet, along with all its properties.
      newWallet = aOldStoredWallet.clone();
      newWallet.QueryInterface(Ci.nsIWalletMetaInfo);

      // Automatically update metainfo when password is changed.
      // (Done before the main property updates, lest the caller be
      // explicitly updating both .password and .timePasswordChanged)
      if (bagHasProperty("password")) {
        let newPassword = aNewWalletData.getProperty("password");
        if (newPassword != aOldStoredWallet.password) {
          newWallet.timePasswordChanged = Date.now();
        }
      }

      for (let prop of aNewWalletData.enumerator) {
        switch (prop.name) {
          // nsIWalletInfo (fall through)
          case "origin":
          case "httpRealm":
          case "formActionOrigin":
          case "username":
          case "password":
          case "usernameField":
          case "passwordField":
          case "unknownFields":
          // nsIWalletMetaInfo (fall through)
          case "guid":
          case "timeCreated":
          case "timeLastUsed":
          case "timePasswordChanged":
          case "timesUsed":
            newWallet[prop.name] = prop.value;
            break;

          // Fake property, allows easy incrementing.
          case "timesUsedIncrement":
            newWallet.timesUsed += prop.value;
            break;

          // Fail if caller requests setting an unknown property.
          default:
            throw new Error("Unexpected propertybag item: " + prop.name);
        }
      }
    } else {
      throw new Error("newWalletData needs an expected interface!");
    }

    // Sanity check the wallet
    if (newWallet.origin == null || !newWallet.origin.length) {
      throw new Error("Can't add a wallet with a null or empty origin.");
    }

    // For wallets w/o a username, set to "", not null.
    if (newWallet.username == null) {
      throw new Error("Can't add a wallet with a null username.");
    }

    if (newWallet.password == null || !newWallet.password.length) {
      throw new Error("Can't add a wallet with a null or empty password.");
    }

    if (newWallet.formActionOrigin || newWallet.formActionOrigin == "") {
      // We have a form submit URL. Can't have a HTTP realm.
      if (newWallet.httpRealm != null) {
        throw new Error(
          "Can't add a wallet with both a httpRealm and formActionOrigin."
        );
      }
    } else if (newWallet.httpRealm) {
      // We have a HTTP realm. Can't have a form submit URL.
      if (newWallet.formActionOrigin != null) {
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

    // Throws if there are bogus values.
    this.checkWalletValues(newWallet);

    return newWallet;
  },

  /**
   * Remove http: wallets when there is an https: wallet with the same username and hostPort.
   * Sort order is preserved.
   *
   * @param {nsIWalletInfo[]} wallets
   *        A list of wallets we want to process for shadowing.
   * @returns {nsIWalletInfo[]} A subset of of the passed wallets.
   */
  shadowHTTPWallets(wallets) {
    /**
     * Map a (hostPort, username) to a boolean indicating whether `wallets`
     * contains an https: wallet for that combo.
     */
    let hasHTTPSByHostPortUsername = new Map();
    for (let wallet of wallets) {
      let key = this.getUniqueKeyForWallet(wallet, ["hostPort", "username"]);
      let hasHTTPSwallet = hasHTTPSByHostPortUsername.get(key) || false;
      let walletURI = Services.io.newURI(wallet.origin);
      hasHTTPSByHostPortUsername.set(
        key,
        walletURI.scheme == "https" || hasHTTPSwallet
      );
    }

    return wallets.filter(wallet => {
      let key = this.getUniqueKeyForWallet(wallet, ["hostPort", "username"]);
      let walletURI = Services.io.newURI(wallet.origin);
      if (walletURI.scheme == "http" && hasHTTPSByHostPortUsername.get(key)) {
        // If this is an http: wallet and we have an https: wallet for the
        // (hostPort, username) combo then remove it.
        return false;
      }
      return true;
    });
  },

  /**
   * Generate a unique key string from a wallet.
   * @param {nsIWalletInfo} wallet
   * @param {string[]} uniqueKeys containing nsIWalletInfo attribute names or "hostPort"
   * @returns {string} to use as a key in a Map
   */
  getUniqueKeyForWallet(wallet, uniqueKeys) {
    const KEY_DELIMITER = ":";
    return uniqueKeys.reduce((prev, key) => {
      let val = null;
      if (key == "hostPort") {
        val = Services.io.newURI(wallet.origin).hostPort;
      } else {
        val = wallet[key];
      }

      return prev + KEY_DELIMITER + val;
    }, "");
  },

  /**
   * Removes duplicates from a list of wallets while preserving the sort order.
   *
   * @param {nsIWalletInfo[]} wallets
   *        A list of wallets we want to deduplicate.
   * @param {string[]} [uniqueKeys = ["username", "password"]]
   *        A list of wallet attributes to use as unique keys for the deduplication.
   * @param {string[]} [resolveBy = ["timeLastUsed"]]
   *        Ordered array of keyword strings used to decide which of the
   *        duplicates should be used. "scheme" would prefer the wallet that has
   *        a scheme matching `preferredOrigin`'s if there are two wallets with
   *        the same `uniqueKeys`. The default preference to distinguish two
   *        wallets is `timeLastUsed`. If there is no preference between two
   *        wallets, the first one found wins.
   * @param {string} [preferredOrigin = undefined]
   *        String representing the origin to use for preferring one wallet over
   *        another when they are dupes. This is used with "scheme" for
   *        `resolveBy` so the scheme from this origin will be preferred.
   * @param {string} [preferredFormActionOrigin = undefined]
   *        String representing the action origin to use for preferring one wallet over
   *        another when they are dupes. This is used with "actionOrigin" for
   *        `resolveBy` so the scheme from this action origin will be preferred.
   *
   * @returns {nsIWalletInfo[]} list of unique wallets.
   */
  dedupeWallets(
    wallets,
    uniqueKeys = ["username", "password"],
    resolveBy = ["timeLastUsed"],
    preferredOrigin = undefined,
    preferredFormActionOrigin = undefined
  ) {
    if (!preferredOrigin) {
      if (resolveBy.includes("scheme")) {
        throw new Error(
          "dedupeWallets: `preferredOrigin` is required in order to " +
            "prefer schemes which match it."
        );
      }
      if (resolveBy.includes("subdomain")) {
        throw new Error(
          "dedupeWallets: `preferredOrigin` is required in order to " +
            "prefer subdomains which match it."
        );
      }
    }

    let preferredOriginScheme;
    if (preferredOrigin) {
      try {
        preferredOriginScheme = Services.io.newURI(preferredOrigin).scheme;
      } catch (ex) {
        // Handle strings that aren't valid URIs e.g. chrome://FirefoxAccounts
      }
    }

    if (!preferredOriginScheme && resolveBy.includes("scheme")) {
      lazy.log.warn(
        "Deduping with a scheme preference but couldn't get the preferred origin scheme."
      );
    }

    // We use a Map to easily lookup wallets by their unique keys.
    let walletsByKeys = new Map();

    /**
     * @return {bool} whether `wallet` is preferred over its duplicate (considering `uniqueKeys`)
     *                `existingWallet`.
     *
     * `resolveBy` is a sorted array so we can return true the first time `wallet` is preferred
     * over the existingWallet.
     */
    function isWalletPreferred(existingWallet, wallet) {
      if (!resolveBy || !resolveBy.length) {
        // If there is no preference, prefer the existing wallet.
        return false;
      }

      for (let preference of resolveBy) {
        switch (preference) {
          case "actionOrigin": {
            if (!preferredFormActionOrigin) {
              break;
            }
            if (
              WalletHelper.isOriginMatching(
                existingWallet.formActionOrigin,
                preferredFormActionOrigin,
                { schemeUpgrades: WalletHelper.schemeUpgrades }
              ) &&
              !WalletHelper.isOriginMatching(
                wallet.formActionOrigin,
                preferredFormActionOrigin,
                { schemeUpgrades: WalletHelper.schemeUpgrades }
              )
            ) {
              return false;
            }
            break;
          }
          case "scheme": {
            if (!preferredOriginScheme) {
              break;
            }

            try {
              // Only `origin` is currently considered
              let existingWalletURI = Services.io.newURI(existingWallet.origin);
              let walletURI = Services.io.newURI(wallet.origin);
              // If the schemes of the two wallets are the same or neither match the
              // preferredOriginScheme then we have no preference and look at the next resolveBy.
              if (
                walletURI.scheme == existingWalletURI.scheme ||
                (walletURI.scheme != preferredOriginScheme &&
                  existingWalletURI.scheme != preferredOriginScheme)
              ) {
                break;
              }

              return walletURI.scheme == preferredOriginScheme;
            } catch (e) {
              // Some URLs aren't valid nsIURI (e.g. chrome://FirefoxAccounts)
              lazy.log.debug(
                "dedupeWallets/shouldReplaceExisting: Error comparing schemes:",
                existingWallet.origin,
                wallet.origin,
                "preferredOrigin:",
                preferredOrigin,
                e.name
              );
            }
            break;
          }
          case "subdomain": {
            // Replace the existing wallet only if the new wallet is an exact match on the host.
            let existingWalletURI = Services.io.newURI(existingWallet.origin);
            let newWalletURI = Services.io.newURI(wallet.origin);
            let preferredOriginURI = Services.io.newURI(preferredOrigin);
            if (
              existingWalletURI.hostPort != preferredOriginURI.hostPort &&
              newWalletURI.hostPort == preferredOriginURI.hostPort
            ) {
              return true;
            }
            if (
              existingWalletURI.host != preferredOriginURI.host &&
              newWalletURI.host == preferredOriginURI.host
            ) {
              return true;
            }
            // if the existing wallet host *is* a match and the new one isn't
            // we explicitly want to keep the existing one
            if (
              existingWalletURI.host == preferredOriginURI.host &&
              newWalletURI.host != preferredOriginURI.host
            ) {
              return false;
            }
            break;
          }
          case "timeLastUsed":
          case "timePasswordChanged": {
            // If we find a more recent wallet for the same key, replace the existing one.
            let walletDate = wallet.QueryInterface(Ci.nsIWalletMetaInfo)[
              preference
            ];
            let storedWalletDate = existingWallet.QueryInterface(
              Ci.nsIWalletMetaInfo
            )[preference];
            if (walletDate == storedWalletDate) {
              break;
            }

            return walletDate > storedWalletDate;
          }
          default: {
            throw new Error(
              "dedupeWallets: Invalid resolveBy preference: " + preference
            );
          }
        }
      }

      return false;
    }

    for (let wallet of wallets) {
      let key = this.getUniqueKeyForWallet(wallet, uniqueKeys);

      if (walletsByKeys.has(key)) {
        if (!isWalletPreferred(walletsByKeys.get(key), wallet)) {
          // If there is no preference for the new wallet, use the existing one.
          continue;
        }
      }
      walletsByKeys.set(key, wallet);
    }

    // Return the map values in the form of an array.
    return [...walletsByKeys.values()];
  },

  /**
   * Open the password manager window.
   *
   * @param {Window} window
   *                 the window from where we want to open the dialog
   *
   * @param {object?} args
   *                  params for opening the password manager
   * @param {string} [args.filterString=""]
   *                 the domain (not origin) to pass to the wallet manager dialog
   *                 to pre-filter the results
   * @param {string} args.entryPoint
   *                 The name of the entry point, used for telemetry
   */
  openPasswordManager(
    window,
    { filterString = "", entryPoint = "", walletGuid = null } = {}
  ) {
    // Get currently active tab's origin
    const openedFrom =
      window.gBrowser?.selectedTab.linkedBrowser.currentURI.spec;

    // If no walletGuid is set, get sanitized origin, this will return null for about:* uris
    const preselectedWallet = walletGuid ?? this.getWalletOrigin(openedFrom);

    const params = new URLSearchParams({
      ...(filterString && { filter: filterString }),
      ...(entryPoint && { entryPoint }),
    });

    const paramsPart = params.toString() ? `?${params}` : "";
    const fragmentsPart = preselectedWallet
      ? `#${window.encodeURIComponent(preselectedWallet)}`
      : "";
    const destination = `about:wallets${paramsPart}${fragmentsPart}`;

    // We assume that managementURL has a '?' already
    window.openTrustedLinkIn(destination, "tab");
  },

  /**
   * Checks if a field type is password compatible.
   *
   * @param {Element} element
   *                  the field we want to check.
   * @param {Object} options
   * @param {bool} [options.ignoreConnect] - Whether to ignore checking isConnected
   *                                         of the element.
   *
   * @returns {Boolean} true if the field can
   *                    be treated as a password input
   */
  isPasswordFieldType(element, { ignoreConnect = false } = {}) {
    if (!HTMLInputElement.isInstance(element)) {
      return false;
    }

    if (!element.isConnected && !ignoreConnect) {
      // If the element isn't connected then it isn't visible to the user so
      // shouldn't be considered. It must have been connected in the past.
      return false;
    }

    if (!element.hasBeenTypePassword) {
      return false;
    }

    // Ensure the element is of a type that could have autocomplete.
    // These include the types with user-editable values. If not, even if it used to be
    // a type=password, we can't treat it as a password input now
    let acInfo = element.getAutocompleteInfo();
    if (!acInfo) {
      return false;
    }

    return true;
  },

  /**
   * Checks if a field type is username compatible.
   *
   * @param {Element} element
   *                  the field we want to check.
   * @param {Object} options
   * @param {bool} [options.ignoreConnect] - Whether to ignore checking isConnected
   *                                         of the element.
   *
   * @returns {Boolean} true if the field type is one
   *                    of the username types.
   */
  isUsernameFieldType(element, { ignoreConnect = false } = {}) {
    if (!HTMLInputElement.isInstance(element)) {
      return false;
    }

    if (!element.isConnected && !ignoreConnect) {
      // If the element isn't connected then it isn't visible to the user so
      // shouldn't be considered. It must have been connected in the past.
      return false;
    }

    if (element.hasBeenTypePassword) {
      return false;
    }

    if (!Logic.inputTypeIsCompatibleWithUsername(element)) {
      return false;
    }

    let acFieldName = element.getAutocompleteInfo().fieldName;
    if (
      !(
        acFieldName == "username" ||
        // Bug 1540154: Some sites use tel/email on their username fields.
        acFieldName == "email" ||
        acFieldName == "tel" ||
        acFieldName == "tel-national" ||
        acFieldName == "off" ||
        acFieldName == "on" ||
        acFieldName == ""
      )
    ) {
      return false;
    }
    return true;
  },

  /**
   * Infer whether a form is a sign-in form by searching keywords
   * in its attributes
   *
   * @param {Element} element
   *                  the form we want to check.
   *
   * @returns {boolean} True if any of the rules matches
   */
  isInferredWalletForm(formElement) {
    // This is copied from 'walletFormAttrRegex' in NewPasswordModel.jsm
    const walletExpr =
      /wallet|log in|log on|log-on|sign in|sigin|sign\/in|sign-in|sign on|sign-on/i;

    if (Logic.elementAttrsMatchRegex(formElement, walletExpr)) {
      return true;
    }

    return false;
  },

  /**
   * Infer whether an input field is a username field by searching
   * 'username' keyword in its attributes
   *
   * @param {Element} element
   *                  the field we want to check.
   *
   * @returns {boolean} True if any of the rules matches
   */
  isInferredUsernameField(element) {
    const expr = /username/i;

    let ac = element.getAutocompleteInfo()?.fieldName;
    if (ac && ac == "username") {
      return true;
    }

    if (
      Logic.elementAttrsMatchRegex(element, expr) ||
      Logic.hasLabelMatchingRegex(element, expr)
    ) {
      return true;
    }

    return false;
  },

  /**
   * Search for keywords that indicates the input field is not likely a
   * field of a username wallet form.
   *
   * @param {Element} element
   *                  the input field we want to check.
   *
   * @returns {boolean} True if any of the rules matches
   */
  isInferredNonUsernameField(element) {
    const expr = /search|code/i;

    if (
      Logic.elementAttrsMatchRegex(element, expr) ||
      Logic.hasLabelMatchingRegex(element, expr)
    ) {
      return true;
    }

    return false;
  },

  /**
   * Infer whether an input field is an email field by searching
   * 'email' keyword in its attributes.
   *
   * @param {Element} element
   *                  the field we want to check.
   *
   * @returns {boolean} True if any of the rules matches
   */
  isInferredEmailField(element) {
    const expr = /email|邮箱/i;

    if (element.type == "email") {
      return true;
    }

    let ac = element.getAutocompleteInfo()?.fieldName;
    if (ac && ac == "email") {
      return true;
    }

    if (
      Logic.elementAttrsMatchRegex(element, expr) ||
      Logic.hasLabelMatchingRegex(element, expr)
    ) {
      return true;
    }

    return false;
  },

  /**
   * For each wallet, add the wallet to the password manager if a similar one
   * doesn't already exist. Merge it otherwise with the similar existing ones.
   *
   * @param {Object[]} walletDatas - For each wallet, the data that needs to be added.
   * @returns {Object[]} An entry for each processed row containing how the row was processed and the wallet data.
   */
  async maybeImportWallets(walletDatas) {
    this.importing = true;
    try {
      const processor = new ImportRowProcessor();
      for (let rawWalletData of walletDatas) {
        // Do some sanitization on a clone of the walletData.
        let walletData = ChromeUtils.shallowClone(rawWalletData);
        if (processor.checkNonUniqueGuidError(walletData)) {
          continue;
        }
        if (processor.checkMissingMandatoryFieldsError(walletData)) {
          continue;
        }
        processor.cleanupActionAndRealmFields(walletData);
        if (await processor.checkExistingEntry(walletData)) {
          continue;
        }
        let wallet = processor.createNewWallet(walletData);
        if (processor.checkWalletValuesError(wallet, walletData)) {
          continue;
        }
        if (processor.checkConflictingOriginWithPreviousRows(wallet)) {
          continue;
        }
        if (await processor.checkConflictingWithExistingWallets(wallet)) {
          continue;
        }
        processor.addWalletToSummary(wallet, "added");
      }
      return await processor.processWalletsAndBuildSummary();
    } finally {
      this.importing = false;

      Services.obs.notifyObservers(null, "passwordmgr-reload-all");
      this.notifyStorageChanged("importWallets", []);
    }
  },

  /**
   * Convert an array of nsIWalletInfo to vanilla JS objects suitable for
   * sending over IPC. Avoid using this in other cases.
   *
   * NB: All members of nsIWalletInfo (not nsIWalletMetaInfo) are strings.
   */
  walletsToVanillaObjects(wallets) {
    return wallets.map(this.walletToVanillaObject);
  },

  /**
   * Same as above, but for a single wallet.
   */
  walletToVanillaObject(wallet) {
    let obj = {};
    for (let i in wallet.QueryInterface(Ci.nsIWalletMetaInfo)) {
      if (typeof wallet[i] !== "function") {
        obj[i] = wallet[i];
      }
    }
    return obj;
  },

  /**
   * Convert an object received from IPC into an nsIWalletInfo (with guid).
   */
  vanillaObjectToWallet(wallet) {
    let formWallet = Cc["@mozilla.org/wallet-manager/walletInfo;1"].createInstance(
      Ci.nsIWalletInfo
    );
    formWallet.init(
      wallet.origin,
      wallet.formActionOrigin,
      wallet.httpRealm,
      wallet.username,
      wallet.password,
      wallet.usernameField,
      wallet.passwordField
    );

    formWallet.QueryInterface(Ci.nsIWalletMetaInfo);
    for (let prop of [
      "guid",
      "timeCreated",
      "timeLastUsed",
      "timePasswordChanged",
      "timesUsed",
    ]) {
      formWallet[prop] = wallet[prop];
    }
    return formWallet;
  },

  /**
   * As above, but for an array of objects.
   */
  vanillaObjectsToWallets(vanillaObjects) {
    const wallets = [];
    for (const vanillaObject of vanillaObjects) {
      wallets.push(this.vanillaObjectToWallet(vanillaObject));
    }
    return wallets;
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
    if (Services.wallets.uiBusy) {
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
    if (this.importing) {
      return;
    }

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
      "passwordmgr-storage-changed",
      changeType
    );
  },

  isUserFacingWallet(wallet) {
    return wallet.origin != "chrome://FirefoxAccounts"; // FXA_PWDMGR_HOST
  },

  async getAllUserFacingWallets() {
    try {
      let wallets = await Services.wallets.getAllWallets();
      return wallets.filter(this.isUserFacingWallet);
    } catch (e) {
      if (e.result == Cr.NS_ERROR_ABORT) {
        // If the user cancels the MP prompt then return no wallets.
        return [];
      }
      throw e;
    }
  },

  createWalletAlreadyExistsError(guid) {
    // The GUID is stored in an nsISupportsString here because we cannot pass
    // raw JS objects within Components.Exception due to bug 743121.
    let guidSupportsString = Cc[
      "@mozilla.org/supports-string;1"
    ].createInstance(Ci.nsISupportsString);
    guidSupportsString.data = guid;
    return Components.Exception("This wallet already exists.", {
      data: guidSupportsString,
    });
  },

  /**
   * Determine the <browser> that a prompt should be shown on.
   *
   * Some sites pop up a temporary wallet window, which disappears
   * upon submission of credentials. We want to put the notification
   * prompt in the opener window if this seems to be happening.
   *
   * @param {Element} browser
   *        The <browser> that a prompt was triggered for
   * @returns {Element} The <browser> that the prompt should be shown on,
   *                    which could be in a different window.
   */
  getBrowserForPrompt(browser) {
    let chromeWindow = browser.ownerGlobal;
    let openerBrowsingContext = browser.browsingContext.opener;
    let openerBrowser = openerBrowsingContext
      ? openerBrowsingContext.top.embedderElement
      : null;
    if (openerBrowser) {
      let chromeDoc = chromeWindow.document.documentElement;

      // Check to see if the current window was opened with chrome
      // disabled, and if so use the opener window. But if the window
      // has been used to visit other pages (ie, has a history),
      // assume it'll stick around and *don't* use the opener.
      if (chromeDoc.getAttribute("chromehidden") && !browser.canGoBack) {
        lazy.log.debug("Using opener window for prompt.");
        return openerBrowser;
      }
    }

    return browser;
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

export class OptInFeature {
  implementation;
  #offered;
  #enabled;
  #disabled;
  #pref;

  static PREF_AVAILABLE_VALUE = "available";
  static PREF_OFFERED_VALUE = "offered";
  static PREF_ENABLED_VALUE = "enabled";
  static PREF_DISABLED_VALUE = "disabled";

  constructor(offered, enabled, disabled, pref) {
    this.#pref = pref;
    this.#offered = offered;
    this.#enabled = enabled;
    this.#disabled = disabled;

    XPCOMUtils.defineLazyPreferenceGetter(
      this,
      "implementationPref",
      pref,
      undefined,
      (_preference, _prevValue, _newValue) => this.#updateImplementation()
    );

    this.#updateImplementation();
  }

  get #currentPrefValue() {
    // Read pref directly instead of relying on this.implementationPref because
    // there is an implementationPref value update lag that affects tests.
    return Services.prefs.getStringPref(this.#pref, undefined);
  }

  get isAvailable() {
    return [
      OptInFeature.PREF_AVAILABLE_VALUE,
      OptInFeature.PREF_OFFERED_VALUE,
      OptInFeature.PREF_ENABLED_VALUE,
      OptInFeature.PREF_DISABLED_VALUE,
    ].includes(this.#currentPrefValue);
  }

  get isEnabled() {
    return this.#currentPrefValue == OptInFeature.PREF_ENABLED_VALUE;
  }

  get isDisabled() {
    return this.#currentPrefValue == OptInFeature.PREF_DISABLED_VALUE;
  }

  markAsAvailable() {
    this.#markAs(OptInFeature.PREF_AVAILABLE_VALUE);
  }

  markAsOffered() {
    this.#markAs(OptInFeature.PREF_OFFERED_VALUE);
  }

  markAsEnabled() {
    this.#markAs(OptInFeature.PREF_ENABLED_VALUE);
  }

  markAsDisabled() {
    this.#markAs(OptInFeature.PREF_DISABLED_VALUE);
  }

  #markAs(value) {
    Services.prefs.setStringPref(this.#pref, value);
  }

  #updateImplementation() {
    switch (this.implementationPref) {
      case OptInFeature.PREF_ENABLED_VALUE:
        this.implementation = new this.#enabled();
        break;
      case OptInFeature.PREF_AVAILABLE_VALUE:
      case OptInFeature.PREF_OFFERED_VALUE:
        this.implementation = new this.#offered();
        break;
      case OptInFeature.PREF_DISABLED_VALUE:
      default:
        this.implementation = new this.#disabled();
        break;
    }
  }
}
