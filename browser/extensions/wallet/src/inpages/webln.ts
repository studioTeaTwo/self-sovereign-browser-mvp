// ref: https://github.com/getAlby/lightning-browser-extension/blob/master/src/extension/providers/webln/index.ts

import { WebLNProvider as WebLNProviderType } from "@webbtc/webln-types"
import ProviderBase from "./providerBase"

type RequestInvoiceArgs = {
  amount?: string | number
  defaultAmount?: string | number
  minimumAmount?: string | number
  maximumAmount?: string | number
  defaultMemo?: string
}

type KeysendArgs = {
  destination: string
  customRecords?: Record<string, string>
  amount: string | number
}

export default class WebLNProvider extends ProviderBase {
  constructor() {
    super("webln")
  }

  getInfo() {
    this._checkEnabled("getInfo")
    return this.execute("getInfo") as unknown as ReturnType<
      WebLNProviderType["getInfo"]
    >
  }

  lnurl(lnurlEncoded: string) {
    this._checkEnabled("lnurl")
    return this.execute("lnurl", { lnurlEncoded }) as unknown as ReturnType<
      WebLNProviderType["lnurl"]
    >
  }

  sendPayment(paymentRequest: string) {
    this._checkEnabled("sendPayment")
    return this.execute("sendPaymentOrPrompt", {
      paymentRequest,
    }) as unknown as ReturnType<WebLNProviderType["sendPayment"]>
  }
  sendPaymentAsync(paymentRequest: string) {
    this._checkEnabled("sendPaymentAsync")
    return this.execute("sendPaymentAsyncWithPrompt", {
      paymentRequest,
    }) as unknown as ReturnType<WebLNProviderType["sendPayment"]>
  }

  keysend(args: KeysendArgs) {
    this._checkEnabled("keysend")
    return this.execute("keysendOrPrompt", args) as unknown as ReturnType<
      WebLNProviderType["sendPayment"]
    >
  }

  makeInvoice(args: string | number | RequestInvoiceArgs) {
    this._checkEnabled("makeInvoice")
    if (typeof args !== "object") {
      args = { amount: args }
    }

    return this.execute("makeInvoice", args) as unknown as ReturnType<
      WebLNProviderType["makeInvoice"]
    >
  }

  signMessage(message: string) {
    this._checkEnabled("signMessage")

    return this.execute("signMessageOrPrompt", {
      message,
    }) as unknown as ReturnType<WebLNProviderType["signMessage"]>
  }

  async verifyMessage(signature: string, message: string) {
    this._checkEnabled("verifyMessage")
    throw new Error("Alby does not support `verifyMessage`")
  }

  getBalance() {
    this._checkEnabled("getBalance")
    return this.execute("getBalanceOrPrompt") as unknown as ReturnType<
      WebLNProviderType["getBalance"]
    >
  }

  request(method: string, params: Record<string, unknown>) {
    this._checkEnabled("request")

    return this.execute("request", {
      method,
      params,
    })
  }
}
