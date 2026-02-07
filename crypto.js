/**
 * MILCODEC Crypto Module - NaCl Compatible
 * Uses TweetNaCl secretbox (XSalsa20-Poly1305)
 */

const MilcodecCrypto = {
    // Must match Python DEFAULT_KEY
    DEFAULT_KEY: new Uint8Array([
        48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 48, 49, 50, 51, 52, 53,
        54, 55, 56, 57, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 48, 49
    ]), // "01234567890123456789012345678901"

    key: null,

    init(keyHex = null) {
        if (keyHex) {
            this.key = this.hexToBytes(keyHex);
        } else {
            this.key = this.DEFAULT_KEY;
        }
        console.log('[CRYPTO] Initialized with key');
    },

    hexToBytes(hex) {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
            bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
        }
        return bytes;
    },

    decrypt(encryptedBytes) {
        if (!this.key) this.init();

        try {
            // NaCl secretbox format: 24-byte nonce + ciphertext
            if (encryptedBytes.length < 24 + 16) {
                return { content: 'Too short', status: 'ERROR', priority: 'ROUTINE' };
            }

            const nonce = encryptedBytes.slice(0, 24);
            const ciphertext = encryptedBytes.slice(24);

            // Decrypt using TweetNaCl
            const plaintext = nacl.secretbox.open(ciphertext, nonce, this.key);

            if (!plaintext) {
                return { content: 'Decryption failed', status: 'ERROR', priority: 'ROUTINE' };
            }

            // Parse packet: 1 byte type + 64 bytes signature + JSON
            const msgType = plaintext[0];
            const jsonBytes = plaintext.slice(65);

            const jsonStr = new TextDecoder().decode(jsonBytes);
            const data = JSON.parse(jsonStr);

            return {
                content: data.m || '',
                priority: data.p || 'ROUTINE',
                msgType: msgType === 1 ? 'TEXT' : 'OTHER',
                status: 'OK',
                verified: false
            };

        } catch (e) {
            console.error('[CRYPTO] Decrypt error:', e);
            return { content: 'Error: ' + e.message, status: 'ERROR', priority: 'ROUTINE' };
        }
    }
};

// Auto-init
MilcodecCrypto.init();
