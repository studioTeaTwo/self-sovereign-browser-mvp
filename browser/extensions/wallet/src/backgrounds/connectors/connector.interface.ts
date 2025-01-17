export interface WebLNNode {
  alias: string
  pubkey?: string
  color?: string
}

interface Route {
  total_amt: number
  total_fees: number
}

export interface ConnectorTransaction {
  custom_records?: {
    "696969"?: string
    "7629169"?: string
    "5482373484"?: string
  } & Record<string, string>
  id: string
  memo?: string
  preimage: string
  payment_hash?: string
  settled: boolean
  settleDate: number
  totalAmount: number
  type: "received" | "sent"
}

export interface MakeInvoiceArgs {
  amount: string | number
  memo: string
}

export type MakeInvoiceResponse = {
  data: {
    paymentRequest: string
    rHash: string
  }
}

export type GetInfoResponse<T extends WebLNNode = WebLNNode> = {
  data: T
}

export type GetBalanceResponse = {
  data: {
    balance: number
  }
}

export type GetTransactionsResponse = {
  data: {
    transactions: ConnectorTransaction[]
  }
}

export type GetPaymentsResponse = {
  data: {
    payments: ConnectorTransaction[]
  }
}

export type SendPaymentResponse = {
  data: {
    preimage: string
    paymentHash: string
    route: Route
  }
}

export type SendPaymentAsyncResponse = {
  // eslint-disable-next-line @typescript-eslint/ban-types
  data: {}
}

export interface SendPaymentArgs {
  paymentRequest: string
}

export interface KeysendArgs {
  pubkey: string
  amount: number
  customRecords: Record<string, string>
}

export interface CheckPaymentArgs {
  paymentHash: string
}

export type CheckPaymentResponse = {
  data: {
    paid: boolean
    preimage?: string
  }
}

export interface SignMessageArgs {
  message: string
  key_loc: {
    key_family: number
    key_index: number
  }
}

export interface SignMessageResponse {
  data: {
    message: string
    signature: string
  }
}

export interface ConnectPeerResponse {
  data: boolean
}

export interface ConnectPeerArgs {
  pubkey: string
  host: string
}

export default interface Connector {
  init(): Promise<void>
  unload(): Promise<void>
  getInfo(): Promise<GetInfoResponse>
  getBalance(): Promise<GetBalanceResponse>
  getTransactions(): Promise<GetTransactionsResponse>
  makeInvoice(args: MakeInvoiceArgs): Promise<MakeInvoiceResponse>
  sendPayment(args: SendPaymentArgs): Promise<SendPaymentResponse>
  keysend(args: KeysendArgs): Promise<SendPaymentResponse>
  checkPayment(args: CheckPaymentArgs): Promise<CheckPaymentResponse>
  signMessage(args: SignMessageArgs): Promise<SignMessageResponse>
  connectPeer(args: ConnectPeerArgs): Promise<ConnectPeerResponse>
  supportedMethods?: string[]
  requestMethod?(
    method: string,
    args: Record<string, unknown>
  ): Promise<{ data: unknown }>
}

export function flattenRequestMethods(methods: string[]) {
  return methods.map((method) => `request.${method}`)
}
