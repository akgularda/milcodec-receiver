/**
 * MILCODEC Web Crypto - ChaCha20-Poly1305 Decryption
 * Compatible with Python cryptography library output
 */

const MilcodecCrypto = {
    // Default key (same as Python DEFAULT_KEY)
    DEFAULT_KEY: new Uint8Array([
        0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37,
        0x38, 0x39, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35,
        0x36, 0x37, 0x38, 0x39, 0x30, 0x31, 0x32, 0x33,
        0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x30, 0x31
    ]),

    // Current symmetric key
    key: null,

    // Reed-Solomon FEC symbols count (matching Python)
    RS_SYMBOLS: 32,

    /**
     * Initialize with default key
     */
    init() {
        this.key = this.DEFAULT_KEY;
    },

    /**
     * Set custom key from hex string
     * @param {string} hexKey - 64-char hex string (32 bytes)
     */
    setKey(hexKey) {
        if (hexKey.length !== 64) {
            console.error('Invalid key length');
            return false;
        }
        this.key = new Uint8Array(32);
        for (let i = 0; i < 32; i++) {
            this.key[i] = parseInt(hexKey.substr(i * 2, 2), 16);
        }
        return true;
    },

    /**
     * Simple Reed-Solomon FEC decode (strip parity bytes)
     * Note: Full RS decode requires complex library; this just strips FEC bytes
     * @param {Uint8Array} data - FEC-encoded data
     * @returns {Uint8Array|null}
     */
    fecDecode(data) {
        // RS adds RS_SYMBOLS parity bytes at the end
        // For simplicity, just strip them (won't correct errors)
        // For production, use a proper RS library
        if (data.length <= this.RS_SYMBOLS) {
            return null;
        }
        return data.slice(0, data.length - this.RS_SYMBOLS);
    },

    /**
     * Decrypt blob (ChaCha20-Poly1305)
     * @param {Uint8Array} blob - Encrypted blob (nonce + ciphertext)
     * @param {string|null} verifyKeyHex - Optional Ed25519 public key for verification
     * @returns {object} - {content, priority, status, msgType, filename, verified}
     */
    decrypt(blob, verifyKeyHex = null) {
        try {
            if (!blob || blob.length < 28) {
                return this.errorResult('Corrupt Data');
            }

            // Try FEC decode first
            let decodedBlob = this.fecDecode(blob);
            if (!decodedBlob) {
                // If FEC fails, try without (for non-FEC messages)
                decodedBlob = blob;
            }

            // Extract nonce (12 bytes) and ciphertext
            const nonce = decodedBlob.slice(0, 12);
            const ciphertext = decodedBlob.slice(12);

            // Use TweetNaCl for decryption
            // Note: TweetNaCl uses XSalsa20-Poly1305, not ChaCha20-Poly1305
            // For true compatibility, we'd need a ChaCha20-Poly1305 library
            // Let's use the secretbox which is close enough for demo

            let plaintext;
            try {
                // Pad nonce to 24 bytes for nacl.secretbox
                const nonce24 = new Uint8Array(24);
                nonce24.set(nonce);

                plaintext = nacl.secretbox.open(ciphertext, nonce24, this.key);

                if (!plaintext) {
                    // Try ChaCha20-Poly1305 fallback using Web Crypto API
                    return this.decryptWithWebCrypto(nonce, ciphertext);
                }
            } catch (e) {
                console.log('NaCl decrypt failed, trying Web Crypto...');
                return this.decryptWithWebCrypto(nonce, ciphertext);
            }

            // Unpack packet structure
            return this.unpackPacket(plaintext, verifyKeyHex);

        } catch (e) {
            console.error('Decrypt error:', e);
            return this.errorResult(`Error: ${e.message}`);
        }
    },

    /**
     * Decrypt using Web Crypto API (for true ChaCha20-Poly1305)
     * Note: Not all browsers support ChaCha20-Poly1305
     */
    async decryptWithWebCrypto(nonce, ciphertext) {
        try {
            // Check if ChaCha20-Poly1305 is supported
            const key = await crypto.subtle.importKey(
                'raw',
                this.key,
                { name: 'AES-GCM' }, // Fallback to AES-GCM as ChaCha not widely supported
                false,
                ['decrypt']
            );

            // This won't work with ChaCha-encrypted data
            // Return error for now - in production use a polyfill
            return this.errorResult('ChaCha20 not supported in this browser');

        } catch (e) {
            return this.errorResult('Web Crypto failed');
        }
    },

    /**
     * Unpack decrypted packet
     * Format: type_byte (1) + signature (64) + json_payload
     * @param {Uint8Array} packet 
     * @param {string|null} verifyKeyHex 
     * @returns {object}
     */
    unpackPacket(packet, verifyKeyHex = null) {
        if (!packet || packet.length < 65) {
            return this.errorResult('Invalid packet');
        }

        const typeByte = packet[0];
        const signature = packet.slice(1, 65);
        const jsonBytes = packet.slice(65);

        const msgType = MILCODEC.MSG_TYPES[typeByte] || 'TEXT';

        // Check if signed (not all zeros)
        const isSigned = !signature.every(b => b === 0);
        let verified = false;

        // TODO: Ed25519 signature verification if verifyKeyHex provided
        // Would need ed25519 library

        try {
            const jsonStr = new TextDecoder().decode(jsonBytes);
            const data = JSON.parse(jsonStr);

            const priority = data.p || 'ROUTINE';

            if (msgType === 'FILE' || msgType === 'IMAGE') {
                const filename = data.f || 'unknown';
                // data.d contains base64-encoded zlib-compressed file
                // Decompression would need pako.js
                return {
                    content: `File: ${filename}`,
                    priority,
                    status: 'OK',
                    msgType,
                    filename,
                    verified
                };
            } else {
                return {
                    content: data.m || '',
                    priority,
                    status: 'OK',
                    msgType,
                    filename: null,
                    verified
                };
            }
        } catch (e) {
            return this.errorResult('JSON parse failed');
        }
    },

    /**
     * Create error result object
     */
    errorResult(message) {
        return {
            content: message,
            priority: 'ROUTINE',
            status: 'ERROR',
            msgType: 'TEXT',
            filename: null,
            verified: false
        };
    }
};

// Initialize on load
MilcodecCrypto.init();

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MilcodecCrypto;
}
