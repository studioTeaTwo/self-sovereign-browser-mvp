/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
/* eslint-env node */
"use strict"

const webpack = require("webpack")

module.exports = (env, argv) => {
  return {
    mode: "production",
    entry: {
      "backgrounds/backgrounds": "./src/backgrounds/index.ts",
      "contents/contents": "./src/contents/index.ts",
      "inpages/inpages": "./src/inpages/index.ts",
    },
    output: {
      filename: "[name].bundle.js",
      path: __dirname,
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          exclude: "/node_modules",
          loader: "ts-loader",
        },
      ],
    },
    plugins: [
      new webpack.ProvidePlugin({
        Buffer: ["buffer", "Buffer"],
        process: ["process"],
      }),
      new webpack.DefinePlugin({
        "process.env": {
          NODE_ENV: JSON.stringify(
            env.WEBPACK_WATCH ? "development" : "production"
          ),
        },
      }),
    ],
    resolve: {
      extensions: [".js", ".ts", ".tsx"],
      alias: {
        Buffer: "buffer",
        process: "process/browser",
        assert: "assert",
        stream: "stream-browserify",
      },
    },
    optimization: {
      minimize: false,
    },
  }
}
