/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
/* eslint-env node */

module.exports = {
  mode: "production",
  entry: {
    main: "./src/main.ts",
  },
  output: {
    filename: "[name].bundle.js",
    path: `${__dirname}/content/js/`,
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        loader: "ts-loader",
      },
    ],
  },
  resolve: {
    extensions: [".js", ".ts", ".tsx"],
  },
  optimization: {
    minimize: false,
    splitChunks: {
      cacheGroups: {
        vendor: {
          test: /[\\/]node_modules[\\/](react|react-dom|scheduler|object-assign)[\\/]/,
          name: "vendor",
          chunks: "all",
        },
      },
    },
  },
};
