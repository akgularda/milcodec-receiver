import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadScript(relativePath, additions = {}) {
  const context = vm.createContext({
    TextDecoder,
    TextEncoder,
    Uint8Array,
    Float32Array,
    console,
    ...additions,
  });
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  vm.runInContext(source, context, { filename: relativePath });
  return context;
}

function packetPlaintext(message, priority = 'ROUTINE', messageType = 1) {
  const json = new TextEncoder().encode(JSON.stringify({ p: priority, m: message }));
  const plaintext = new Uint8Array(65 + json.length);
  plaintext[0] = messageType;
  plaintext.set(json, 65);
  return plaintext;
}

test('decoder constants and chirp templates preserve the on-air format', () => {
  const context = loadScript('decoder.js');
  const decoder = context.MILCODEC;

  assert.equal(decoder.FS, 44100);
  assert.equal(decoder.F_START, 14000);
  assert.equal(decoder.F_END, 17000);
  assert.equal(decoder.SAMPLES_PER_BIT, 2205);
  assert.deepEqual(
    Array.from(decoder.SYNC_BITS),
    [1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 0],
  );
  decoder.generateTemplates();
  assert.equal(decoder.upChirp.length, decoder.SAMPLES_PER_BIT);
  assert.equal(decoder.downChirp.length, decoder.SAMPLES_PER_BIT);
  assert.ok(decoder.correlate(decoder.upChirp, decoder.upChirp) > 1000);
  assert.equal(decoder.extractFromAudio(new Float32Array(decoder.SAMPLES_PER_BIT * 2)), null);
});

test('decoder rejects malformed or excessive audio input without processing it', () => {
  const context = loadScript('decoder.js');
  const decoder = context.MILCODEC;

  assert.equal(decoder.extractFromAudio(null), null);
  assert.equal(decoder.extractFromAudio([0, 0, 0]), null);
  assert.equal(decoder.extractFromAudio(new Float32Array(decoder.MAX_AUDIO_SAMPLES + 1)), null);
});

test('receiver decodes the exact packet envelope without claiming sender authentication', () => {
  const plaintext = packetPlaintext('HELLO CASTLE', 'FLASH');
  const context = loadScript('crypto.js', {
    nacl: { secretbox: { open: () => plaintext } },
  });
  const result = context.MilcodecCrypto.decrypt(new Uint8Array(40));

  assert.equal(result.content, 'HELLO CASTLE');
  assert.equal(result.priority, 'FLASH');
  assert.equal(result.msgType, 'TEXT');
  assert.equal(result.status, 'OK');
  assert.equal(result.verified, false);
});

test('crypto input limits and parse errors produce bounded error states', () => {
  const context = loadScript('crypto.js', {
    nacl: { secretbox: { open: () => packetPlaintext('OK') } },
  });
  const codec = context.MilcodecCrypto;

  assert.match(codec.decrypt(null).error, /byte array/i);
  assert.match(codec.decrypt(new Uint8Array(39)).error, /too short/i);
  assert.match(codec.decrypt(new Uint8Array(codec.MAX_ENCRYPTED_BYTES + 1)).error, /too large/i);

  context.nacl.secretbox.open = () => packetPlaintext('x'.repeat(codec.MAX_MESSAGE_CHARS + 1));
  assert.match(codec.decrypt(new Uint8Array(40)).error, /message too large/i);

  context.nacl.secretbox.open = () => packetPlaintext('OK', 'UNRECOGNIZED');
  assert.equal(codec.decrypt(new Uint8Array(40)).priority, 'ROUTINE');
});

test('safe renderer keeps hostile message content as text', () => {
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const context = vm.createContext({ console });
  vm.runInContext(source, context, { filename: 'app.js' });

  const created = [];
  const documentRef = {
    createElement(tagName) {
      const node = {
        tagName,
        className: '',
        children: [],
        textContent: '',
        append(...children) {
          this.children.push(...children);
        },
      };
      created.push(node);
      return node;
    },
  };
  const hostile = '<img src=x onerror=alert(1)>';
  const rendered = context.MilcodecUI.createMessageItem(
    documentRef,
    { content: hostile, priority: 'FLASH' },
    '12:00:00',
  );

  assert.equal(rendered.children[0].textContent, hostile);
  assert.equal(created.some((node) => node.tagName === 'img'), false);
});
