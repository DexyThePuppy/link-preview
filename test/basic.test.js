"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const linkPreview = require("../index.js");

test("module exports an async function", () => {
  assert.equal(typeof linkPreview, "function");
  assert.equal(linkPreview.constructor.name, "AsyncFunction");
});
