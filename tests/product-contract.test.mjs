import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const hash = (relativePath) =>
  crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relativePath))).digest('hex');

test('brand header uses the official dark MILCODEC lockup', () => {
  assert.ok(fs.existsSync(path.join(root, 'logo.png')), 'runtime logo must exist');
  assert.equal(
    hash('logo.png'),
    '9dfeaad8d391b9d0dc6a2d76e049d47e578f17000b7469575a8e5cb7ba7a54f5',
  );

  const html = read('index.html');
  assert.match(
    html,
    /<img[^>]+src=["']logo\.png["'][^>]+alt=["']MILCODEC Receiver["']/i,
  );
  assert.match(html, /Part of Monarch Castle Technologies\./);
});

test('product copy clearly bounds the receiver as a technical demonstration', () => {
  const html = read('index.html');
  const readme = read('README.md');
  const exactDisclaimer =
    'Technical demonstration utility. Not authenticated operational intelligence.';
  const keyDisclaimer =
    'Shared demo key verifies packet integrity only; it does not authenticate sender identity.';

  assert.ok(html.includes(exactDisclaimer));
  assert.ok(html.includes(keyDisclaimer));
  assert.ok(readme.includes(exactDisclaimer));
  assert.ok(readme.includes(keyDisclaimer));
  assert.doesNotMatch(`${html}\n${readme}`, /authenticated sender/i);
});

test('runtime is semantic, keyboard-operable, and exposes accessible status', () => {
  const html = read('index.html');

  assert.match(html, /<header\b/i);
  assert.match(html, /<main\b/i);
  assert.match(html, /<section[^>]+aria-labelledby=/i);
  assert.match(html, /<button[^>]+id=["']startButton["'][^>]+type=["']button["']/i);
  assert.match(html, /id=["']statusText["'][^>]+role=["']status["'][^>]+aria-live=["']polite["']/i);
  assert.match(html, /id=["']debugLog["'][^>]+role=["']log["'][^>]+aria-live=["']polite["']/i);
  assert.match(html, /<canvas[^>]+aria-label=/i);
  assert.doesNotMatch(html, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/i);
});

test('responsive layout and visible keyboard focus are contractual', () => {
  const css = read('style.css');

  assert.match(css, /@media\s*\(\s*max-width:\s*640px\s*\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /overflow-x:\s*(?:clip|hidden)/);
  assert.match(css, /#c9a24b/i);
});

test('message rendering does not use HTML injection sinks', () => {
  const app = read('app.js');

  assert.doesNotMatch(app, /\.innerHTML\s*=/);
  assert.match(app, /\.textContent\s*=/);
});

test('legacy Pages deployment is deliberately preserved', () => {
  assert.equal(
    fs.existsSync(path.join(root, '.github', 'workflows', 'pages.yml')),
    false,
    'do not replace legacy Pages without an identical-artifact migration',
  );
  assert.match(read('README.md'), /Legacy GitHub Pages.*main.*repository root/is);
});

test('repository retains an MIT license and rights notice', () => {
  const license = read('LICENSE');

  assert.match(license, /^MIT License/m);
  assert.match(license, /Monarch Castle Technologies/);
  assert.match(license, /Permission is hereby granted, free of charge/);
  assert.match(license, /THE SOFTWARE IS PROVIDED "AS IS"/);
});
