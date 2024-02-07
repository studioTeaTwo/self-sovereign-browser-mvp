/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Provides the logic for recording all password manager related telemetry data.
 */
export class WalletManagerTelemetry {
  static recordAutofillResult(result) {
    Glean.pwmgr.formAutofillResult[result].add(1);
    WalletManagerLegacyTelemetry.recordAutofillResult(result);
  }
}

/**
 * Until the password manager related measurements are fully migrated to Glean,
 * we need to collect the data in both systems (Legacy Telemetry and Glean) for now.
 * Not all new Glean metric can be mirrored automatically (using the property telemetry_mirror in metrics.yaml).
 * Therefore, we need to manually call the Legacy Telemetry API calls in this class.
 * Once we have collected enough data for all probes in the Glean system, we can remove this class and its references.
 */
class WalletManagerLegacyTelemetry {
  static HISTOGRAM_AUTOFILL_RESULT = "PWMGR_FORM_AUTOFILL_RESULT";
  static AUTOFILL_RESULT = {
    filled: 0,
    no_password_field: 1,
    password_disabled_readonly: 2,
    no_wallets_fit: 3,
    no_saved_wallets: 4,
    existing_password: 5,
    existing_username: 6,
    multiple_wallets: 7,
    no_autofill_forms: 8,
    autocomplete_off: 9,
    insecure: 10,
    password_autocomplete_new_password: 11,
    type_no_longer_password: 12,
    form_in_crossorigin_subframe: 13,
    filled_username_only_form: 14,
  };

  static convertToAutofillResultNumber(result) {
    return WalletManagerLegacyTelemetry.AUTOFILL_RESULT[result];
  }

  static recordAutofillResult(result) {
    const autofillResultNumber =
      WalletManagerLegacyTelemetry.convertToAutofillResultNumber(result);
    Services.telemetry
      .getHistogramById(WalletManagerLegacyTelemetry.HISTOGRAM_AUTOFILL_RESULT)
      .add(autofillResultNumber);
  }
}
export default WalletManagerTelemetry;
