/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { WalletHelper } from "resource://gre/modules/WalletHelper.sys.mjs"

const TELEMETRY_EVENT_CATEGORY = "walletstore"
const TELEMETRY_MIN_MS_BETWEEN_OPEN_MANAGEMENT = 5000

let gLastOpenManagementBrowserId = null
let gLastOpenManagementEventTime = Number.NEGATIVE_INFINITY
let gPrimaryPasswordPromise

function recordTelemetryEvent(event) {
  try {
    let { method, object, extra = {}, value = null } = event
    Services.telemetry.recordEvent(
      TELEMETRY_EVENT_CATEGORY,
      method,
      object,
      value,
      extra
    )
  } catch (ex) {
    console.error("AboutWalletChild: error recording telemetry event:", ex)
  }
}

export class AboutWalletChild extends JSWindowActorChild {
  handleEvent(event) {
    switch (event.type) {
      case "AboutWalletInit": {
        this.#aboutWalletInit()
        break
      }
      case "AboutWalletCreateCredential": {
        this.#aboutWalletCreateCredential(event.detail)
        break
      }
      case "AboutWalletDeleteCredential": {
        this.#aboutWalletDeleteCredential(event.detail)
        break
      }
      case "AboutWalletRecordTelemetryEvent": {
        this.#aboutWalletRecordTelemetryEvent(event)
        break
      }
      case "AboutWalletRemoveAllCredentials": {
        this.#aboutWalletRemoveAllCredentials()
        break
      }
      case "AboutWalletUpdateCredential": {
        this.#aboutWalletUpdateCredential(event.detail)
        break
      }
    }
  }

  #aboutWalletInit() {
    this.sendAsyncMessage("AboutWallet:Subscribe")

    let win = this.browsingContext.window
    let waivedContent = Cu.waiveXrays(win)
    let that = this
    let AboutWalletUtils = {
      // List things to share with app through `window`
      doCredentialMatch(credentialA, credentialB) {
        return WalletHelper.doCredentialMatch(credentialA, credentialB, {})
      },
      /**
       * Shows the Primary Password prompt if enabled, or the
       * OS auth dialog otherwise.
       * @param resolve Callback that is called with result of authentication.
       * @param messageId The string ID that corresponds to a string stored in aboutWallet.ftl.
       *                  This string will be displayed only when the OS auth dialog is used.
       */
      async promptForPrimaryPassword(resolve, messageId) {
        gPrimaryPasswordPromise = {
          resolve,
        }

        that.sendAsyncMessage("AboutWallet:PrimaryPasswordRequest", messageId)

        return gPrimaryPasswordPromise
      },
      // Default to enabled just in case a search is attempted before we get a response.
      primaryPasswordEnabled: true,
      passwordRevealVisible: true,
    }
    waivedContent.AboutWalletUtils = Cu.cloneInto(
      AboutWalletUtils,
      waivedContent,
      {
        cloneFunctions: true,
      }
    )
  }

  #aboutWalletCreateCredential(credential) {
    this.sendAsyncMessage("AboutWallet:CreateCredential", {
      credential,
    })
  }

  #aboutWalletDeleteCredential(credential) {
    this.sendAsyncMessage("AboutWallet:DeleteCredential", {
      credential,
    })
  }

  #aboutWalletRecordTelemetryEvent(event) {
    let { method } = event.detail

    if (method == "open_management") {
      let { docShell } = this.browsingContext
      // Compare to the last time open_management was recorded for the same
      // outerWindowID to not double-count them due to a redirect to remove
      // the entryPoint query param (since replaceState isn't allowed for
      // about:). Don't use performance.now for the tab since you can't
      // compare that number between different tabs and this JSM is shared.
      let now = docShell.now()
      if (
        this.browsingContext.browserId == gLastOpenManagementBrowserId &&
        now - gLastOpenManagementEventTime <
          TELEMETRY_MIN_MS_BETWEEN_OPEN_MANAGEMENT
      ) {
        return
      }
      gLastOpenManagementEventTime = now
      gLastOpenManagementBrowserId = this.browsingContext.browserId
    }
    recordTelemetryEvent(event.detail)
  }

  #aboutWalletRemoveAllCredentials() {
    this.sendAsyncMessage("AboutWallet:RemoveAllCredentials")
  }

  #aboutWalletUpdateCredential(credential) {
    this.sendAsyncMessage("AboutWallet:UpdateCredential", {
      credential,
    })
  }

  receiveMessage(message) {
    switch (message.name) {
      case "AboutWallet:PrimaryPasswordResponse":
        this.#primaryPasswordResponse(message.data)
        break
      case "AboutWallet:RemaskPassword":
        this.#remaskPassword(message.data)
        break
      case "AboutWallet:Setup":
        this.#setup(message.data)
        break
      default:
        this.#passMessageDataToContent(message)
    }
  }

  #primaryPasswordResponse(data) {
    if (gPrimaryPasswordPromise) {
      gPrimaryPasswordPromise.resolve(data.result)
      recordTelemetryEvent(data.telemetryEvent)
    }
  }

  #remaskPassword(data) {
    this.sendToContent("RemaskPassword", data)
  }

  #setup(data) {
    let utils = Cu.waiveXrays(this.browsingContext.window).AboutWalletUtils
    utils.primaryPasswordEnabled = data.primaryPasswordEnabled
    utils.passwordRevealVisible = data.passwordRevealVisible
    this.sendToContent("Setup", data)
  }

  #passMessageDataToContent(message) {
    this.sendToContent(message.name.replace("AboutWallet:", ""), message.data)
  }

  sendToContent(messageType, detail) {
    let win = this.document.defaultView
    let message = Object.assign({ messageType }, { value: detail })
    let event = new win.CustomEvent("AboutWalletChromeToContent", {
      detail: Cu.cloneInto(message, win),
    })
    win.dispatchEvent(event)
  }
}
