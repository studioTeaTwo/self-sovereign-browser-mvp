/* global Handlebars:false */

/*
HomeOverlay is the view itself and contains all of the methods to manipute the overlay and messaging.
It does not contain any logic for saving or communication with the extension or server.
*/

import React from "react";
import ReactDOM from "react-dom";
import Home from "../components/Home/Home";

var HomeOverlay = function (options) {
  this.inited = false;
  this.active = false;
};

HomeOverlay.prototype = {
  create() {

    if (this.active) {
      return;
    }

    this.active = true;

    ReactDOM.render(
      <Home />,
      document.querySelector(`body`)
    );

    // if (window?.matchMedia(`(prefers-color-scheme: dark)`).matches) {
    //   document.querySelector(`body`).classList.add(`theme_dark`);
    // }
  },
};

export default HomeOverlay;
