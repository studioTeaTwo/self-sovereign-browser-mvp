// ref: https://github.com/getAlby/lightning-browser-extension/blob/master/src/types.ts
export interface MetaData {
  title?: string
  description?: string
  icon?: string
  image?: string
  keywords?: string[]
  language?: string
  type?: string
  url?: string
  provider?: string
  [x: string]: string | string[] | undefined
}
export interface OriginData {
  location: string
  domain: string
  host: string
  pathname: string
  name: string
  description: string
  icon: string
  metaData: MetaData
  external: boolean
}
export interface OriginDataInternal {
  internal: boolean
}
export interface MessageDefault {
  origin: OriginData | OriginDataInternal
  application?: string
  prompt?: boolean
}
export interface MessageGetInfo extends MessageDefault {
  action: "getInfo"
}
export interface DeferredPromise {
  promise: Promise<unknown>
  resolve?: () => void
  reject?: () => void
}
