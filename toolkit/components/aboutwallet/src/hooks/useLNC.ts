import { lnc } from "."

// This is a copy of https://github.com/lightninglabs/lnc-web/blob/main/demos/connect-demo/src/hooks/useLNC.ts

/**
 * A hook that exposes a single LNC instance of LNC to all component that need it.
 * It also returns a couple helper functions to simplify the usage of LNC
 */
const useLNC = () => {
  /** Connects to LNC using the provided pairing phrase and password */
  const connect = async (pairingPhrase: string) => {
    lnc.credentials.pairingPhrase = pairingPhrase

    try {
      await lnc.connect()
    } catch (error) {
      // (ssb) now, disconnect doen't work
      // ref: https://github.com/lightninglabs/lnc-web/issues/83
      lnc.disconnect()
      throw error
    }

    // verify we can fetch data
    try {
      const info = await lnc.lnd.lightning.getInfo()
      return info
    } catch (error) {
      lnc.disconnect()
      throw error
    }
  }

  /** Connects to LNC */
  const login = async () => {
    await lnc.connect()
  }

  const preload = () => {
    lnc.preload()
  }

  return { preload, connect, login }
}

export default useLNC
