import { CredentialStore } from "../types/lnc"

/**
 * A wrapper around `window.localStorage` used to store sensitive data required
 * by LNC to reconnect after the initial pairing process has been completed. The
 * data is encrypted at rest using the provided `password`.
 */
export default class LncCredentialStore implements CredentialStore {
  private _serverHost: string = ""
  private _localKey: string = ""
  private _remoteKey: string = ""
  private _pairingPhrase: string = ""
  /** The password used to encrypt and decrypt the stored data */
  private _password?: string
  /** The namespace to use in the localStorage key */
  private namespace: string = "default"

  /**
   * Constructs a new `LncCredentialStore` instance
   */
  constructor(namespace?: string, password?: string) {
    if (namespace) this.namespace = namespace
  }

  //
  // Public fields which implement the `CredentialStore` interface
  //

  /** Stores the host:port of the Lightning Node Connect proxy server to connect to */
  get serverHost() {
    return this._serverHost
  }

  /** Stores the host:port of the Lightning Node Connect proxy server to connect to */
  set serverHost(host: string) {
    this._serverHost = host
  }

  /** Stores the LNC pairing phrase used to initialize the connection to the LNC proxy */
  get pairingPhrase() {
    return this._pairingPhrase
  }

  /** Stores the LNC pairing phrase used to initialize the connection to the LNC proxy */
  set pairingPhrase(phrase: string) {
    this._pairingPhrase = phrase
  }

  /** Stores the local private key which LNC uses to reestablish a connection */
  get localKey() {
    return this._localKey
  }

  /** Stores the local private key which LNC uses to reestablish a connection */
  set localKey(key: string) {
    this._localKey = key
  }

  /** Stores the remote static key which LNC uses to reestablish a connection */
  get remoteKey() {
    return this._remoteKey
  }

  /** Stores the remote static key which LNC uses to reestablish a connection */
  set remoteKey(key: string) {
    this._remoteKey = key
  }

  /**
   * Read-only field which should return `true` if the client app has prior
   * credentials persisted in teh store
   */
  get isPaired() {
    return !!this.remoteKey || !!this.pairingPhrase
  }

  /** Clears any persisted data in the store */
  clear() {
    this._localKey = ""
    this._remoteKey = ""
    this._pairingPhrase = ""
  }
}
