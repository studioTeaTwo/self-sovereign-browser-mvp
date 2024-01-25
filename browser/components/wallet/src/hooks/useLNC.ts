import { useCallback, useMemo } from "react"
import LNC from "../lib/lnc"

// This is a copy of https://github.com/lightninglabs/lnc-web/blob/main/demos/connect-demo/src/hooks/useLNC.ts

// create a singleton instance of LNC that will live for the lifetime of the app
const lnc = new LNC({})

/**
 * A hook that exposes a single LNC instance of LNC to all component that need it.
 * It also returns a couple helper functions to simplify the usage of LNC
 */
const useLNC = () => {
  /** Connects to LNC using the provided pairing phrase and password */
  const connect = useCallback(
    async (pairingPhrase: string, password: string) => {
      lnc.credentials.pairingPhrase = pairingPhrase

      try {
        await lnc.connect()
      } catch (error) {
        // (ssb) now, disconnect doen't work
        // ref: https://github.com/lightninglabs/lnc-web/issues/83
        lnc.disconnect()
        throw error
      }

      // set the password after confirming the connection works
      lnc.credentials.password = password

      // verify we can fetch data
      try {
        const info = await lnc.lnd.lightning.getInfo()
        return info
      } catch (error) {
        lnc.disconnect()
        throw error
      }
    },
    []
  )

  /** Connects to LNC using the password to decrypt the stored keys */
  const login = useCallback(async (password: string) => {
    lnc.credentials.password = password
    await lnc.connect()
  }, [])

  const load = () => ({
    password: lnc.credentials.password,
    pairingPhrase: lnc.credentials.pairingPhrase,
  })

  return { lnc, connect, login, load }
}

export default useLNC
