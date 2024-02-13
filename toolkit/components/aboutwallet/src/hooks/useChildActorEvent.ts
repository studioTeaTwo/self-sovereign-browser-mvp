import { useEffect, useMemo, useState, useCallback } from "react"
import {
  CredentialInfo,
  CredentialInfoPayload,
  LightningCredentialInfo,
  LncProperties,
} from "src/custom.type"
import { lnc } from "."

const useChildActorEvent = () => {
  const [credentials, setCredentials] = useState<CredentialInfo[]>([])

  const lightningCredentials = useMemo(
    () =>
      (credentials as LightningCredentialInfo[])
        .filter((credential) => credential.protocolName === "lightning")
        .map((value) => {
          if (value.credentialName === "lnc") {
            lnc.credentials.serverHost = value.properties.connection.serverHost
            lnc.credentials.localKey = value.properties.connection.localKey
            lnc.credentials.remoteKey = value.properties.connection.remoteKey
            lnc.credentials.pairingPhrase = value.secret
          }
          return value
        }),
    [credentials]
  )

  useEffect(() => {
    window.addEventListener("AboutWalletChromeToContent", receiveFromChildActor)
    return () =>
      window.removeEventListener(
        "AboutWalletChromeToContent",
        receiveFromChildActor
      )
  }, [credentials])

  const receiveFromChildActor = useCallback(
    (event) => {
      switch (event.detail.messageType) {
        case "Setup":
        case "AllCredentials": {
          setCredentialsFromStore(event.detail.value.credentials)
          break
        }
        case "CredentialAdded": {
          setCredentialsFromStore([...credentials, event.detail.value])
          break
        }
        case "CredentialModified": {
          const newCredentials = credentials.map((credential) =>
            credential.guid === event.detail.value.guid
              ? event.detail.value
              : credential
          )
          setCredentialsFromStore(newCredentials)
          break
        }
        case "CredentialRemoved": {
          const newCredentials = credentials.filter(
            (credential) => credential.guid !== event.detail.value.guid
          )
          setCredentials(newCredentials)
          break
        }
        case "RemoveAllCredentials": {
          setCredentials([])
          break
        }
      }
    },
    [credentials]
  )

  /**
   * Send to child actor
   *
   */

  function initStore() {
    window.dispatchEvent(
      new CustomEvent("AboutWalletInit", {
        bubbles: true,
      })
    )
  }

  const addCredentialToStore = useCallback(
    async (
      secret: string,
      identifier: string,
      nodeInfo: LncProperties["nodeInfo"]
    ) => {
      const properties: LncProperties = {
        nodeInfo,
        connection: {
          serverHost: lnc.credentials.serverHost,
          localKey: lnc.credentials.localKey,
          remoteKey: lnc.credentials.remoteKey,
        },
      }
      const credentialInfo = {
        protocolName: "lightning",
        credentialName: "lnc",
        primary: lightningCredentials.length === 0,
        secret,
        identifier,
        password: "",
        properties,
      } as const
      window.dispatchEvent(
        new CustomEvent("AboutWalletCreateCredential", {
          bubbles: true,
          detail: transformToPayload(credentialInfo),
        })
      )
    },
    [lightningCredentials]
  )

  function modifyCredentialToStore(credential: LightningCredentialInfo) {
    window.dispatchEvent(
      new CustomEvent("AboutWalletUpdateCredential", {
        bubbles: true,
        detail: transformToPayload(credential),
      })
    )
  }

  function deleteCredentialToStore(credential: LightningCredentialInfo) {
    window.dispatchEvent(
      new CustomEvent("AboutWalletDeleteCredential", {
        bubbles: true,
        detail: transformToPayload(credential),
      })
    )
  }

  function removeAllCredentialsToStore() {
    window.dispatchEvent(
      new CustomEvent("AboutWalletRemoveAllCredentials", {
        bubbles: true,
      })
    )
  }

  /**
   * private field
   *
   */

  const setCredentialsFromStore = (credentials: CredentialInfoPayload[]) => {
    setCredentials(
      credentials.map((credential) => ({
        ...credential,
        properties: JSON.parse(credential.properties),
      }))
    )
  }

  function transformToPayload(credential: LightningCredentialInfo) {
    const newVal = { ...credential } as unknown as CredentialInfoPayload
    newVal.properties = JSON.stringify(credential.properties)
    return newVal
  }

  return {
    credentials,
    lightningCredentials,
    initStore,
    addCredentialToStore,
    modifyCredentialToStore,
    deleteCredentialToStore,
    removeAllCredentialsToStore,
  }
}

export default useChildActorEvent
