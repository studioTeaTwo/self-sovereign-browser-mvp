/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/* eslint-env webextensions */

import { DeferredPromise } from "../custom.type"
import { router } from "./router"

console.info("background-script working!")

browser.webNavigation.onCompleted.addListener(() => {
  // initial action to enable ssb
})

const deferredPromise = (): DeferredPromise => {
  let resolve: DeferredPromise["resolve"]
  let reject: DeferredPromise["reject"]
  const promise = new Promise<void>(
    (innerResolve: () => void, innerReject: () => void) => {
      resolve = innerResolve
      reject = innerReject
    }
  )
  return { promise, resolve, reject }
}
const {
  promise: isInitialized,
  resolve: resolveInit,
  reject: rejectInit,
} = deferredPromise()

// listen to calls from the content script and calls the actions through the router
// returns a promise to be handled in the content script
const routeCalls = async (
  message: {
    application: string
    prompt: boolean
    type: string
    action: string
  },
  sender: FixMe
) => {
  console.info(`Routing call:`, message)
  // if the application does not match or if it is not a prompt we ignore the call
  if (message.application !== "SSB" || !message.prompt) {
    return
  }
  if (message.type) {
    console.error("Invalid message, using type: ", message)
  }

  // TODO: (ssb) what's this?
  // await isInitialized;

  const action = message.action || message.type
  // Potentially check for internal vs. public calls
  const call = router(action)(message, sender)

  const result = await call
  console.info(`Routing result:`, result)
  return result
}
// this is the only handler that may and must return a Promise which resolve with the response to the content script
browser.runtime.onMessage.addListener(routeCalls)
