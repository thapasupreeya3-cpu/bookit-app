"use strict";

const pkg = require("../package.json");

module.exports = Object.freeze({
  APP_VERSION: pkg.version || "85.3.0",
  BUILD_SHA: process.env.BUILD_SHA || process.env.GIT_COMMIT || "development",
  BUILD_DATE: process.env.BUILD_DATE || "2026-08-19T15:48:45+10:00",
  SCHEMA_VERSION: Number(process.env.SCHEMA_VERSION || 85300)
});
