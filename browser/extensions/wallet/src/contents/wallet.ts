function loadInpageScript(url) {
  try {
    if (!document) throw new Error("No document")
    const container = document.head || document.documentElement
    if (!container) throw new Error("No container element")
    const scriptEl = document.createElement("script")
    scriptEl.setAttribute("async", "false")
    scriptEl.setAttribute("type", "text/javascript")
    scriptEl.src = url
    container.insertBefore(scriptEl, container.children[0])
    container.removeChild(scriptEl)
  } catch (err) {
    console.error("injection failed", err)
  }
}
loadInpageScript(browser.runtime.getURL("inpages/inpages.bundle.js"))

console.log(
  "wallet! contentscript",
  window.TEST10,
  browser.runtime.getURL("inpages/inpages.bundle.js")
)

browser.runtime.onMessage.addListener((request) => {
  console.log("Message from the background script:")
  console.log(request.credentials)
  return Promise.resolve({ response: "Hi from content script" })
})
