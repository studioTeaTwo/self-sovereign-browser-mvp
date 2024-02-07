import React from "react"
import Lnc from "./Lnc"
import LightningDevTools from "./DevTools"

export const isDev = process.env.NODE_ENV === "development"

export default function (props) {
  return (
    <div>
      <Lnc />
      {isDev && <LightningDevTools />}
    </div>
  )
}
