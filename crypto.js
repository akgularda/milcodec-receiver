/**
 * MILCODEC packet envelope decoder.
 *
 * The bundled key is intentionally a shared demonstration key. NaCl secretbox
 * authenticates packet integrity under that key; it does not establish sender
 * identity.
 */
const MilcodecCrypto = {
    DEFAULT_KEY: new Uint8Array([
        0x2b, 0x7e, 0x15, 0x16, 0x28, 0xae, 0xd2, 0xa6,
        0xab, 0xf7, 0x15, 0x88, 0x09, 0xcf, 0x4f, 0x3c,
        0x76, 0x2e, 0x71, 0x60, 0xf3, 0x8b, 0x4d, 0xa5,
        0x6a, 0x78, 0x4d, 0x90, 0x45, 0x19, 0x0c, 0xfe,
    ]),
    MAX_ENCRYPTED_BYTES: 1024,
    MAX_MESSAGE_CHARS: 2048,
    ALLOWED_PRIORITIES: new Set(['ROUTINE', 'PRIORITY', 'IMMEDIATE', 'FLASH']),
    key: null,

    init(keyHex = null) {
        this.key = keyHex === null ? new Uint8Array(this.DEFAULT_KEY) : this.hexToBytes(keyHex);
        if (this.key.length !== 32) throw new Error('MILCODEC key must contain exactly 32 bytes.');
    },

    hexToBytes(value) {
        if (typeof value !== 'string' || !/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) {
            throw new Error('Key must be an even-length hexadecimal string.');
        }

        const bytes = new Uint8Array(value.length / 2);
        for (let index = 0; index < value.length; index += 2) {
            bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
        }
        return bytes;
    },

    decrypt(encryptedBytes) {
        try {
            if (!(encryptedBytes instanceof Uint8Array)) {
                throw new Error('Encrypted packet must be a byte array.');
            }
            if (encryptedBytes.length < 40) {
                throw new Error('Encrypted packet is too short.');
            }
            if (encryptedBytes.length > this.MAX_ENCRYPTED_BYTES) {
                throw new Error('Encrypted packet is too large.');
            }
            if (!this.key) this.init();
            if (
                typeof nacl === 'undefined'
                || !nacl.secretbox
                || typeof nacl.secretbox.open !== 'function'
            ) {
                throw new Error('NaCl packet decoder is unavailable.');
            }

            const nonce = encryptedBytes.subarray(0, 24);
            const ciphertext = encryptedBytes.subarray(24);
            const plaintext = nacl.secretbox.open(ciphertext, nonce, this.key);
            if (!plaintext) throw new Error('Packet integrity check failed.');
            if (!(plaintext instanceof Uint8Array) || plaintext.length < 65) {
                throw new Error('Decoded packet envelope is invalid.');
            }

            const messageType = plaintext[0];
            const jsonBytes = plaintext.subarray(65);
            const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(jsonBytes));
            if (!data || typeof data !== 'object' || Array.isArray(data)) {
                throw new Error('Decoded packet payload must be an object.');
            }
            if (typeof data.m !== 'string') {
                throw new Error('Decoded packet message must be text.');
            }
            if (data.m.length > this.MAX_MESSAGE_CHARS) {
                throw new Error('Decoded message too large.');
            }

            const priority = this.ALLOWED_PRIORITIES.has(data.p) ? data.p : 'ROUTINE';
            return {
                content: data.m,
                priority,
                msgType: messageType === 1 ? 'TEXT' : 'OTHER',
                status: 'OK',
                verified: false,
            };
        } catch (error) {
            return {
                status: 'ERROR',
                error: error instanceof Error ? error.message : 'Packet decoding failed.',
            };
        }
    },
};

MilcodecCrypto.init();
globalThis.MilcodecCrypto = MilcodecCrypto;
