/* global WALLET_PANEL:false */

function onDOMLoaded() {
  if (!window.theWALLET_PANEL) {
    var theWALLET_PANEL = new WALLET_PANEL();
    /* global thePKT_PANEL */
    window.theWALLET_PANEL = theWALLET_PANEL;
    theWALLET_PANEL.initHome();
  }
  window.theWALLET_PANEL.create();
}

if (document.readyState != `loading`) {
  onDOMLoaded();
} else {
  document.addEventListener(`DOMContentLoaded`, onDOMLoaded);
}
