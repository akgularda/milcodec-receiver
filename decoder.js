/**
 * MILCODEC Web Decoder — "The Screecher" (2-FSK)
 * Mark (1): 14000 Hz
 * Space (0): 14200 Hz
 * Symbol Rate: 20 baud (50ms)
 * Protocol: PREAMBLE + SYNC(16) + LEN(16) + PAYLOAD(N*8 * 3)
 */

const MILCODEC = {
    FS: 44100,
    FREQ_1: 14000,
    FREQ_0: 14200,
    BIT_DURATION: 0.050, // 50ms

    // SYNC WORD: 1010 1010 1100 1100
    SYNC_BITS: [1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 0],

    // Goertzel Algorithm for single-frequency energy measurement
    // Optimized for detecting specific tones without full FFT overhead
    goertzel(samples, targetFreq, sampleRate) {
        const k = Math.round(0.5 + (samples.length * targetFreq) / sampleRate);
        const w = (2 * Math.PI * k) / samples.length;
        const cosine = Math.cos(w);
        const sine = Math.sin(w);
        const coeff = 2 * cosine;

        let q1 = 0;
        let q2 = 0;

        for (let i = 0; i < samples.length; i++) {
            const q0 = coeff * q1 - q2 + samples[i];
            q2 = q1;
            q1 = q0;
        }

        const real = (q1 - q2 * cosine);
        const imag = (q2 * sine);
        return real * real + imag * imag; // Magnitude squared
    },

    extractFromAudio(audioData) {
        console.log(`[DECODER] Analyzing ${audioData.length} samples (Screecher 2-FSK)...`);

        // 1. Sliding Window Power Analysis
        // We scan the buffer in steps of ~25ms (half-bit) to find bit boundaries
        const stepSize = Math.floor(this.FS * this.BIT_DURATION / 2); // 25ms
        const windowSize = Math.floor(this.FS * this.BIT_DURATION); // 50ms

        const detectedBits = [];
        const bitEnergies = [];

        for (let i = 0; i < audioData.length - windowSize; i += stepSize) {
            const window = audioData.slice(i, i + windowSize);

            const p1 = this.goertzel(window, this.FREQ_1, this.FS);
            const p0 = this.goertzel(window, this.FREQ_0, this.FS);

            // Normalize relative to local energy
            const total = p1 + p0 + 1e-9;
            const r1 = p1 / total;
            const r0 = p0 / total;

            // Simple decision
            if (r1 > 0.6) {
                detectedBits.push(1);
                bitEnergies.push(p1);
            } else if (r0 > 0.6) {
                detectedBits.push(0);
                bitEnergies.push(p0);
            } else {
                detectedBits.push(-1); // Indeterminate
                bitEnergies.push(0);
            }
        }

        // Logic: Detected bits are sampled at 2x rate. 
        // We need to synchronize and decimate.
        // Let's just look for the SYNC pattern in the raw oversampled stream.

        // Oversampled SYNC pattern (approximate)
        // SYNC: 1 0 1 0... -> 1 1 0 0 1 1 0 0... (since 2 samples/bit)

        const rawStream = detectedBits; // -1, 0, 1

        // Search for Sync Pattern
        // 1010 1010 1100 1100
        // In 2x oversampled: 11 00 11 00 11 00 11 00 11 11 00 00 11 11 00 00

        const targetSyncPattern = [];
        for (let b of this.SYNC_BITS) {
            targetSyncPattern.push(b);
            targetSyncPattern.push(b); // 2x oversampling
        }

        let syncIndex = -1;
        // Search
        for (let i = 0; i < rawStream.length - targetSyncPattern.length; i++) {
            let errors = 0;
            for (let j = 0; j < targetSyncPattern.length; j++) {
                if (rawStream[i + j] !== targetSyncPattern[j]) errors++;
            }
            if (errors <= 4) { // Allow some errors
                syncIndex = i;
                break;
            }
        }

        if (syncIndex === -1) {
            console.log('[DECODER] No FSK Sync found');
            return null;
        }

        console.log(`[DECODER] FSK Sync found at index ${syncIndex}`);

        // Downsample from here (take every 2nd sample)
        const dataStream = [];
        // Skip sync
        let cursor = syncIndex + targetSyncPattern.length;

        // Phase adjustment: try to sample in middle of bit
        cursor += 1;

        while (cursor < rawStream.length) {
            dataStream.push(rawStream[cursor]);
            cursor += 2; // Step by 2 (50ms)
        }

        // 2. Read Length (16 bits)
        if (dataStream.length < 16) return null;
        let len = 0;
        for (let i = 0; i < 16; i++) {
            const bit = dataStream[i] === 1 ? 1 : 0; // treat -1 as 0
            len = (len << 1) | bit;
        }

        console.log(`[DECODER] Payload Length: ${len} bytes`);
        if (len <= 0 || len > 1024) return null;

        // 3. Majority Vote
        const payloadBits = new Uint8Array(len * 8);
        const dataStart = 16;
        const bitLen = len * 8;

        if (dataStream.length < dataStart + (bitLen * 3)) {
            console.log('[DECODER] Incomplete FSK packet');
            return null;
        }

        for (let i = 0; i < bitLen; i++) {
            let b1 = dataStream[dataStart + i];
            let b2 = dataStream[dataStart + bitLen + i];
            let b3 = dataStream[dataStart + (bitLen * 2) + i];

            // Clean up -1s
            if (b1 < 0) b1 = 0;
            if (b2 < 0) b2 = 0;
            if (b3 < 0) b3 = 0;

            const sum = b1 + b2 + b3;
            payloadBits[i] = sum >= 2 ? 1 : 0;
        }

        // 4. Reconstruct Bytes
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
