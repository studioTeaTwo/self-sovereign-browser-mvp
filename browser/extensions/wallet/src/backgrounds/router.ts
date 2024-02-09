// ref: https://github.com/getAlby/lightning-browser-extension/blob/master/src/extension/background-script/router.ts

import * as ln from "./actions/ln"
import * as webln from "./actions/webln"

const routes = {
  getInfo: ln.getInfo,

  // Public calls that are accessible from the inpage script (through the content script)
  public: {
    webln: {
      enable: webln.enable,
      isEnabled: webln.isEnabled,
      getInfo: ln.getInfo,
    },
  },
}

const router = (path: FixMe) => {
  if (!path) {
    throw new Error("No action path provided to router")
  }
  const routeParts = path.split("/")
  const route = routeParts.reduce((route: FixMe, path: FixMe) => {
    return route[path]
  }, routes)

  if (!route) {
    console.warn(`Route not found: ${path}`)
    // return a function to keep the expected method signature
    return () => {
      return Promise.reject({ error: `${path} not found` })
    }
  }
  return route
}

export { router, routes }
