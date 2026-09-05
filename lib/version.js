"use strict";

const pkg = require("../package.json");

module.exports = Object.freeze({
  APP_VERSION: pkg.version || "87.0.0",
  BUILD_SHA: process.env.BUILD_SHA || process.env.GIT_COMMIT || "development",
  BUILD_DATE: process.env.BUILD_DATE || "2026-09-05T00:00:00+10:00",
  SCHEMA_VERSION: Number(process.env.SCHEMA_VERSION || 87000)
});
