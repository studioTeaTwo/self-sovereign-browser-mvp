/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Handles serialization of the data and persistence into a file.
 *
 * The file is stored in JSON format, without indentation, using UTF-8 encoding.
 * With indentation applied, the file would look like this:
 *
 * {
 *   "credentials": [
 *     {
 *       "id": 2,
 *       "hostname": "http://www.example.com",
 *       "httpRealm": null,
 *       "formSubmitURL": "http://www.example.com",
 *       "usernameField": "username_field",
 *       "passwordField": "password_field",
 *       "encryptedUsername": "...",
 *       "encryptedPassword": "...",
 *       "guid": "...",
 *       "encType": 1,
 *       "timeCreated": 1262304000000,
 *       "timeLastUsed": 1262304000000,
 *       "timePasswordChanged": 1262476800000,
 *       "timesUsed": 1
 *        // only present if other clients had fields we didn't know about
 *       "encryptedUnknownFields: "...",
 *     },
 *     {
 *       "id": 4,
 *       (...)
 *     }
 *   ],
 *   "nextId": 10,
 *   "version": 1
 * }
 */

// Globals

import { JSONFile } from "resource://gre/modules/JSONFile.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  FXA_PWDMGR_HOST: "resource://gre/modules/FxAccountsCommon.sys.mjs",
  FXA_PWDMGR_REALM: "resource://gre/modules/FxAccountsCommon.sys.mjs",
});

/**
 * Current data version assigned by the code that last touched the data.
 *
 * This number should be updated only when it is important to understand whether
 * an old version of the code has touched the data, for example to execute an
 * update logic.  In most cases, this number should not be changed, in
 * particular when no special one-time update logic is needed.
 *
 * For example, this number should NOT be changed when a new optional field is
 * added to a credential entry.
 */
const kDataVersion = 3;

const MAX_DATE_MS = 8640000000000000;

// CredentialStore

/**
 * Inherits from JSONFile and handles serialization of credential-related data and
 * persistence into a file.
 *
 * @param aPath
 *        String containing the file path where data should be saved.
 */
export function CredentialStore(aPath, aBackupPath = "") {
  JSONFile.call(this, {
    path: aPath,
    dataPostProcessor: this._dataPostProcessor.bind(this),
    backupTo: aBackupPath,
  });
}

CredentialStore.prototype = Object.create(JSONFile.prototype);
CredentialStore.prototype.constructor = CredentialStore;

CredentialStore.prototype._save = async function () {
  await JSONFile.prototype._save.call(this);
  // Notify tests that writes to the credential store is complete.
  Services.obs.notifyObservers(null, "password-storage-updated");

  if (this._options.backupTo) {
    await this._backupHandler();
  }
};

/**
 * Delete credentials backup file if the last saved credential was removed using
 * removeCredential() or if all credentials were removed at once using removeAllUserFacingCredentials().
 * Note that if the user has a fxa key stored as a credential, we just update the
 * backup to only store the key when the last saved user facing credential is removed.
 */
CredentialStore.prototype._backupHandler = async function () {
  const credentials = this._data.credentials;
  // Return early if more than one credential is stored because the backup won't need
  // updating in this case.
  if (credentials.length > 1) {
    return;
  }

  // If one credential is stored and it's a fxa sync key, we update the backup to store the
  // key only.
  if (
    credentials.length &&
    credentials[0].hostname == lazy.FXA_PWDMGR_HOST &&
    credentials[0].httpRealm == lazy.FXA_PWDMGR_REALM
  ) {
    try {
      await IOUtils.copy(this.path, this._options.backupTo);

      // This notification is specifically sent out for a test.
      Services.obs.notifyObservers(null, "credentials-backup-updated");
    } catch (ex) {
      console.error(ex);
    }
  } else if (!credentials.length) {
    // If no credentials are stored anymore, delete backup.
    await IOUtils.remove(this._options.backupTo, {
      ignoreAbsent: true,
    });
  }
};

/**
 * Synchronously work on the data just loaded into memory.
 */
CredentialStore.prototype._dataPostProcessor = function (data) {
  if (data.nextId === undefined) {
    data.nextId = 1;
  }

  // Create any arrays that are not present in the saved file.
  if (!data.credentials) {
    data.credentials = [];
  }

  if (!data.potentiallyVulnerablePasswords) {
    data.potentiallyVulnerablePasswords = [];
  }

  if (!data.dismissedBreachAlertsByCredentialGUID) {
    data.dismissedBreachAlertsByCredentialGUID = {};
  }

  // sanitize dates in credentials
  if (!("version" in data) || data.version < 3) {
    let dateProperties = ["timeCreated", "timeLastUsed", "timePasswordChanged"];
    let now = Date.now();
    function getEarliestDate(credential, defaultDate) {
      let earliestDate = dateProperties.reduce((earliest, pname) => {
        let ts = credential[pname];
        return !ts ? earliest : Math.min(ts, earliest);
      }, defaultDate);
      return earliestDate;
    }
    for (let credential of data.credentials) {
      for (let pname of dateProperties) {
        let earliestDate;
        if (!credential[pname] || credential[pname] > MAX_DATE_MS) {
          credential[pname] =
            earliestDate || (earliestDate = getEarliestDate(credential, now));
        }
      }
    }
  }

  // Indicate that the current version of the code has touched the file.
  data.version = kDataVersion;

  return data;
};
