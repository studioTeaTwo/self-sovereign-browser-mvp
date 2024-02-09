// experiment api
// TODO: (ssb)
declare namespace browser.addonsWallet {
  type getAllCredentials = Function
}

// Window incompatible types
interface Window {
  TEST10: string
  emit: (action: string) => void
}
// eslint-disable-next-line no-var
declare var window: Window

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare type FixMe = any
