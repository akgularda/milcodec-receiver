/**
 * MILCODEC Web Decoder - DSSS Signal Processing
 * JavaScript port of milcodec_core.py signal extraction
 */

const MILCODEC = {
    // Constants matching Python implementation
    FS: 44100,
    FC_DEFAULT: 12000,

    // 31-bit Barker-like sequence
    BARKER_31: [1, 1, 1, 1, 1, -1, -1, 1, 1, -1, 1, -1, -1, 1, 1, 1, 1, 1, -1, -1, 1, 1, -1, 1, -1, 1, -1, -1, -1, -1, -1],
    SAMPLES_PER_CHIP: 4,

    // Sync word (32 bits)
    SYNC_WORD: [0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 0, 1],

    // Frequency pool for scanning
    FREQ_POOL: [8000, 9000, 10000, 11000, 12000, 13000, 14000, 15000, 16000, 17000, 18000],

    // Priority mappings
    PRIORITIES: {
        'ROUTINE': '#a0a0b8',
        'PRIORITY': '#00d4ff',
        'IMMEDIATE': '#ffb000',
        'FLASH': '#ff3355'
    },

    // Message types
    MSG_TYPES: {
        0x01: 'TEXT',
        0x02: 'LOCATION',
        0x03: 'FILE',
        0x04: 'IMAGE',
        0x05: 'ACK'
    },

    /**
     * Generate spread sequence template
     */
    getSpreadSeqTemplate() {
        const template = [];
        for (const chip of this.BARKER_31) {
            for (let i = 0; i < this.SAMPLES_PER_CHIP; i++) {
                template.push(chip);
            }
        }
        return new Float32Array(template);
    },

    /**
     * Find sync word in bit array
     * @param {Uint8Array} bits - Raw bits
     * @param {number[]} syncWord - Sync word to find
     * @returns {{index: number, inverted: boolean}|null}
     */
    findSyncWord(bits, syncWord) {
        const n = syncWord.length;
        const limit = Math.min(bits.length - n, 2000);

        for (let i = 0; i < limit; i++) {
            let match = true;
            let invertMatch = true;

            for (let j = 0; j < n; j++) {
                if (bits[i + j] !== syncWord[j]) match = false;
                if (bits[i + j] !== (1 - syncWord[j])) invertMatch = false;
                if (!match && !invertMatch) break;
            }

            if (match) return { index: i, inverted: false };
            if (invertMatch) return { index: i, inverted: true };
        }

        return null;
    },

    /**
     * Extract payload from audio buffer
     * @param {Float32Array} audioData - Audio samples
     * @param {string} mode - 'COVERT' (DSSS) or 'BURST' (BPSK)
     * @param {boolean} autoScan - Scan all frequencies
     * @returns {Uint8Array|null} - Extracted bytes or null
     */
    extractFromAudio(audioData, mode = 'COVERT', autoScan = true) {
        const scanList = autoScan ? this.FREQ_POOL : [this.FC_DEFAULT];
        const spreadSeq = this.getSpreadSeqTemplate();
        const samplesPerBitCovert = 31 * this.SAMPLES_PER_CHIP;

        for (const freq of scanList) {
            // Generate carrier and demodulate
            const carrier = new Float32Array(audioData.length);
            for (let i = 0; i < audioData.length; i++) {
                carrier[i] = Math.cos(2 * Math.PI * freq * i / this.FS);
            }

            // Baseband: multiply by carrier
            const baseband = new Float32Array(audioData.length);
            for (let i = 0; i < audioData.length; i++) {
                baseband[i] = audioData[i] * carrier[i];
            }

            // Extract bits
            const bits = [];

            if (mode === 'BURST') {
                const sps = 8;
                const numSymbols = Math.floor(baseband.length / sps);
                for (let i = 0; i < numSymbols; i++) {
                    let sum = 0;
                    for (let j = 0; j < sps; j++) {
                        sum += baseband[i * sps + j];
                    }
                    bits.push(sum > 0 ? 1 : 0);
                }
            } else {
                // COVERT mode with spreading
                const numBits = Math.floor(baseband.length / samplesPerBitCovert);
                for (let i = 0; i < numBits; i++) {
                    let score = 0;
                    const start = i * samplesPerBitCovert;
                    for (let j = 0; j < samplesPerBitCovert; j++) {
                        score += baseband[start + j] * spreadSeq[j];
                    }
                    bits.push(score > 0 ? 1 : 0);
                }
            }

            // Find sync word
            const rawBits = new Uint8Array(bits);
            const syncResult = this.findSyncWord(rawBits, this.SYNC_WORD);

            if (syncResult) {
                console.log(`Locked on ${freq} Hz (Inverted=${syncResult.inverted})`);

                // Extract data after sync
                let aligned = rawBits.slice(syncResult.index + this.SYNC_WORD.length);

                if (syncResult.inverted) {
                    for (let i = 0; i < aligned.length; i++) {
                        aligned[i] = 1 - aligned[i];
                    }
                }

                // Align to byte boundary
                const rem = aligned.length % 8;
                if (rem !== 0) {
                    aligned = aligned.slice(0, aligned.length - rem);
                }

                // Convert bits to bytes
                return this.bitsToBytes(aligned);
            }
        }

        console.log('Sync scan failed');
        return null;
    },

    /**
     * Convert bit array to byte array
     * @param {Uint8Array} bits 
     * @returns {Uint8Array}
     */
    bitsToBytes(bits) {
        const bytes = new Uint8Array(Math.floor(bits.length / 8));
        for (let i = 0; i < bytes.length; i++) {
            let byte = 0;
            for (let j = 0; j < 8; j++) {
                byte = (byte << 1) | bits[i * 8 + j];
            }
            bytes[i] = byte;
        }
        return bytes;
    },

    /**
     * Calculate signal energy for visualization
     * @param {Float32Array} audioData 
     * @param {number} numBins 
     * @returns {Float32Array}
     */
    calculateSpectrum(audioData, numBins = 32) {
        const spectrum = new Float32Array(numBins);
        const binSize = Math.floor(audioData.length / numBins);

        for (let i = 0; i < numBins; i++) {
            let energy = 0;
            for (let j = 0; j < binSize; j++) {
                const sample = audioData[i * binSize + j] || 0;
                energy += sample * sample;
            }
            spectrum[i] = Math.sqrt(energy / binSize);
        }

        return spectrum;
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MILCODEC;
}
