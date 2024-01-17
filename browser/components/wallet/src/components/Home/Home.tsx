/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import React, { useState, useEffect, useCallback } from "react"

// import panelMessaging from "../../messages";

function Home(props) {
  useEffect(() => {
    // tell back end we're ready
    // panelMessaging.sendMessage("WALLET_show_home");
  }, [])

  return <div className="wallet_home_container">YO!</div>
}

export default Home
