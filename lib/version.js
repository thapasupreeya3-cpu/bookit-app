"use strict";

const pkg = require("../package.json");

module.exports = Object.freeze({
  APP_VERSION: pkg.version || "86.4.2",
  BUILD_SHA: process.env.BUILD_SHA || process.env.GIT_COMMIT || "development",
  BUILD_DATE: process.env.BUILD_DATE || "2026-08-23T17:30:00+10:00",
  SCHEMA_VERSION: Number(process.env.SCHEMA_VERSION || 86400)
});
