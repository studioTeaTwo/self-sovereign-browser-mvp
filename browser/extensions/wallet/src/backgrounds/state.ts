// ref: https://github.com/getAlby/lightning-browser-extension/blob/master/src/extension/background-script/state.ts#L116

import { create } from "zustand"
import connectors from "./connectors"
import type Connector from "./connectors/connector.interface"

interface State {
  connector: Promise<Connector> | null
  getConnector: () => Promise<Connector>
}

const getFreshState = () => ({
  connector: null,
})

const state = create<State>((set, get) => ({
  ...getFreshState(),
  getConnector: async () => {
    console.log("state: getConnector", !!get().connector, get().connector)
    if (get().connector) {
      const connector = (await get().connector) as Connector
      return connector
    }
    // use a Promise to initialize the connector
    // this makes sure we can immediatelly set the state and use the same promise for future calls
    // we must make sure not two connections are initialized
    const connectorPromise = (async () => {
      const credentials = await (
        browser as FixMe
      ).addonsWallet.getAllCredentials()
      if (!credentials.length) {
        return null
      }

      const properties = credentials[0].properties
      const config = {
        pairingPhrase: credentials[0].secret,
        localKey: properties.connection.localKey,
        remoteKey: properties.connection.remoteKey,
        serverHost: properties.connection.serverHost,
      }
      console.info(`lnc start: `, config)
      const connector = new connectors.lnc(config)

      await connector.init()
      if (!connector.lnc) {
        return null
      }

      return connector
    })()
    set({ connector: connectorPromise })

    const connector = await connectorPromise
    console.log("LNC connect result:", connector)
    if (!connector) {
      set({ connector: null })
      return null
    }

    return connector
  },
}))

export default state
