import { MessageGetInfo } from "../../../custom.type"

import state from "../../state"

const getInfo = async (message: MessageGetInfo) => {
  console.log("Action: getInfo", message)

  // TODO: (ssb) replace subscribing the storage-data-changed event by expeiment-apis
  const credentials = await (browser as FixMe).addonsWallet.getAllCredentials()
  console.info(
    "Core: getAllCredentials",
    credentials,
    !!state.getState().connector
  )
  if (!credentials.length) {
    await state.setState({ connector: null })
    return { data: null }
  }

  const connector = await state.getState().getConnector()
  if (!connector) {
    return { data: null }
  }

  const info = await connector.getInfo()
  return {
    data: {
      version: "SSB",
      supports: ["lightning"],
      methods: connector.supportedMethods,
      node: {
        alias: info.data.alias,
        pubkey: info.data.pubkey,
        color: info.data.color,
      },
    },
  }
}

export default getInfo
