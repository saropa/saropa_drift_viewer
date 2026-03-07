/**
 * Mocha --require hook: intercepts `require('vscode')` and redirects to our
 * mock module so tests can run outside of VS Code.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Module = require('module');
const path = require('path');

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'vscode') {
    return path.join(__dirname, '..', 'out', 'test', 'vscode-mock.js');
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
