import { type lnrpc } from "@lightninglabs/lnc-core"

/**
 * credential info base
 * ref: toolkit/components/wallet-store/nsICredentialInfo.idl
 */
export type ProtocolName = "bitcoin" | "lightning" | "nostr" | "did:dht"
export type CredentialName = "bip39" | "lnc" | "nsec"
export interface CredentialInfo {
  protocolName: ProtocolName
  credentialName: CredentialName
  primary: boolean
  secret: string
  identifier: string
  password: string
  properties: object
  guid?: string
}
// Pass object type through JSON.stringify for IPC & JSONstorage
export type CredentialInfoPayload = Omit<CredentialInfo, "properties"> & {
  properties: string
}

/**
 * Lingtning protocol credential info
 */
export type LncProperties = {
  nodeInfo: Partial<lnrpc.GetInfoResponse>
  connection: {
    serverHost: string
    localKey: string
    remoteKey: string
  }
}
export interface LightningCredentialInfo extends CredentialInfo {
  protocolName: "lightning"
  properties: LncProperties
}
