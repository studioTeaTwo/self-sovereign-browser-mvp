/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/* eslint-env webextensions */

"use strict";

browser.webNavigation.onCompleted.addListener(
  () => {
    console.log("This is my favorite website!");
    browser.tabs
      .query({
        currentWindow: true,
        active: true,
        highlighted: true,
      })
      .then(sendMessageToTab)
      .catch(onError);
  }
);

function onError(error) {
  console.error(`Error: ${error}`);
}

async function sendMessageToTab(tabs) {
  const credentials = await browser.addonsWallet.getAllCredentials()
  console.log("credentials", tabs.length, credentials)
  for (const tab of tabs) {
    browser.tabs
      .sendMessage(tab.id, { credentials })
      .then((response) => {
        console.log("Message from the content script:");
        console.log(response.response);
      })
      .catch(onError);
  }
}
