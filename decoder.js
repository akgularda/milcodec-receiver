/**
 * MILCODEC Web Decoder — Robust Air-Gap (Heavy Duty)
 * Carrier: 14500 Hz
 * SAMPLES_PER_CHIP: 20 (Slow rate for echo resilience)
 * Protocol: SYNC(32) + LEN(16) + PAYLOAD(N*8) + PAYLOAD(N*8) + PAYLOAD(N*8)
 */

const MILCODEC = {
    FS: 44100,
    CARRIER_FREQ: 14500,

    // Barker-31 PN code
    BARKER_31: [1, 1, 1, 1, 1, -1, -1, 1, 1, -1, 1, -1, -1, 1, 1, 1, 1, 1, -1, -1, 1, 1, -1, 1, -1, 1, -1, -1, -1, -1, -1],
    SAMPLES_PER_CHIP: 20, // Match Heavy Duty Sender

    // 32-bit sync word
    SYNC_WORD: [0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 0, 1],

    bandpassFilter(data, centerFreq, bandwidth) {
        const fs = this.FS;
        const w0 = 2 * Math.PI * centerFreq / fs;
        const Q = centerFreq / bandwidth;
        const alpha = Math.sin(w0) / (2 * Q);

        const b0 = alpha;
        const b1 = 0;
        const b2 = -alpha;
        const a0 = 1 + alpha;
        const a1 = -2 * Math.cos(w0);
        const a2 = 1 - alpha;

        const out = new Float32Array(data.length);
        let x1 = 0, x2 = 0, y1 = 0, y2 = 0;

        for (let i = 0; i < data.length; i++) {
            const x0 = data[i];
            out[i] = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
            x2 = x1; x1 = x0;
            y2 = y1; y1 = out[i];
        }
        return out;
    },

    getSpreadTemplate() {
        // Build template dynamically based on SAMPLES_PER_CHIP
        const template = new Float32Array(this.BARKER_31.length * this.SAMPLES_PER_CHIP);
        for (let c = 0; c < this.BARKER_31.length; c++) {
            for (let s = 0; s < this.SAMPLES_PER_CHIP; s++) {
                template[c * this.SAMPLES_PER_CHIP + s] = this.BARKER_31[c];
            }
        }
        return template;
    },

    extractFromAudio(audioData) {
        const samplesPerBit = this.BARKER_31.length * this.SAMPLES_PER_CHIP; // 31 * 20 = 620
        const spreadTemplate = this.getSpreadTemplate();

        console.log(`[DECODER] Processing ${audioData.length} samples (Heavy Duty)...`);

        // 1. Bandpass 14.5kHz ±1kHz
        const filtered = this.bandpassFilter(audioData, this.CARRIER_FREQ, 2000);

        // 2. Demodulate
        const baseband = new Float32Array(filtered.length);
        for (let i = 0; i < filtered.length; i++) {
            baseband[i] = filtered[i] * Math.cos(2 * Math.PI * this.CARRIER_FREQ * i / this.FS);
        }

        // 3. Despread
        const numBits = Math.floor(baseband.length / samplesPerBit);
        console.log(`[DECODER] Bits capacity: ${numBits}`);
        const bits = new Uint8Array(numBits);

        for (let i = 0; i < numBits; i++) {
            let score = 0;
            const start = i * samplesPerBit;
            for (let j = 0; j < samplesPerBit; j++) {
                score += baseband[start + j] * spreadTemplate[j];
            }
            bits[i] = score > 0 ? 1 : 0;
        }

        // 4. Find Sync (lenient search: allow 1 bit error)
        const sw = this.SYNC_WORD;
        let syncIndex = -1, inverted = false;

        for (let i = 0; i < Math.min(bits.length - 32, 5000); i++) {
            let matchErrors = 0, invErrors = 0;
            for (let j = 0; j < 32; j++) {
                if (bits[i + j] !== sw[j]) matchErrors++;
                if (bits[i + j] !== (1 - sw[j])) invErrors++;
            }

            // Allow up to 2 bit errors in sync word
            if (matchErrors <= 2) { syncIndex = i; inverted = false; break; }
            if (invErrors <= 2) { syncIndex = i; inverted = true; break; }
        }

        if (syncIndex === -1) {
            console.log('[DECODER] No sync found.');
            return null;
        }

        console.log(`[DECODER] Sync at ${syncIndex}, inverted=${inverted}`);

        let rawData = bits.slice(syncIndex + 32);
        if (inverted) {
            for (let i = 0; i < rawData.length; i++) rawData[i] = 1 - rawData[i];
        }

        // 5. Read Length (16 bits)
        if (rawData.length < 16) return null;
        let len = 0;
        for (let i = 0; i < 16; i++) len = (len << 1) | rawData[i];

        console.log(`[DECODER] Payload Length: ${len} bytes`);
        if (len <= 0 || len > 1024) return null;

        const totalBitsNeeded = 16 + (len * 8 * 3);
        if (bits.length < syncIndex + 32 + totalBitsNeeded) {
            console.log('[DECODER] Incomplete packet.');
            return null;
        }

        // 6. Majority Vote (Triple Redundancy)
        const payloadBits = new Uint8Array(len * 8);
        const dataStart = 16;
        const bitLen = len * 8;

        for (let i = 0; i < bitLen; i++) {
            const b1 = rawData[dataStart + i];
            const b2 = rawData[dataStart + bitLen + i];
            const b3 = rawData[dataStart + (bitLen * 2) + i];
            const sum = b1 + b2 + b3;
            payloadBits[i] = sum >= 2 ? 1 : 0;
        }

        // 7. Reconstruct Bytes
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            let b = 0;
            for (let j = 0; j < 8; j++) {
                b = (b << 1) | payloadBits[i * 8 + j];
            }
            bytes[i] = b;
        }

        return bytes;
    }
};
