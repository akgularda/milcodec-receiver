/**
 * MILCODEC Web Decoder — "The Dolphin" (CSS)
 * Bit 1: Up-Chirp (14k -> 17k)
 * Bit 0: Down-Chirp (17k -> 14k)
 * Symbol Rate: 20 baud (50ms)
 * Protocol: PREAMBLE(U-U-D-D) + SYNC(16) + LEN(16) + PAYLOAD(N*8 * 3)
 */

const MILCODEC = {
    FS: 44100,
    F_START: 14000,
    F_END: 17000,
    BIT_DURATION: 0.050, // 50ms
    SAMPLES_PER_BIT: 2205, // 44100 * 0.05

    // Sync Word: 1010 1010 1100 1100
    SYNC_BITS: [1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 0],

    // Templates
    upChirp: null,
    downChirp: null,

    generateTemplates() {
        const len = this.SAMPLES_PER_BIT;
        this.upChirp = new Float32Array(len);
        this.downChirp = new Float32Array(len);

        for (let i = 0; i < len; i++) {
            const t = i / this.FS; // Time in seconds
            // Linear Chirp: f(t) = f0 + (f1-f0)/T * t
            // Phase(t) = 2*pi * Integral(f(t)) = 2*pi * (f0*t + (f1-f0)/(2T) * t^2)

            const k = (this.F_END - this.F_START) / this.BIT_DURATION;
            const phiUp = 2 * Math.PI * (this.F_START * t + (k / 2) * t * t);
            this.upChirp[i] = Math.cos(phiUp);

            // Down Chirp: f0=17k, f1=14k
            const kDown = (this.F_START - this.F_END) / this.BIT_DURATION;
            const phiDown = 2 * Math.PI * (this.F_END * t + (kDown / 2) * t * t);
            this.downChirp[i] = Math.cos(phiDown);
        }
    },

    correlate(input, template) {
        let sum = 0;
        for (let i = 0; i < template.length; i++) {
            sum += input[i] * template[i];
        }
        return sum;
    },

    extractFromAudio(audioData) {
        if (!this.upChirp) this.generateTemplates();

        console.log(`[DECODER] Processing ${audioData.length} samples (Dolphin CSS)...`);

        const step = 20; // Optimization: Check every 20 samples (~0.45ms)
        const len = this.upChirp.length;

        const correlations = [];

        // Sliding window correlation
        for (let i = 0; i < audioData.length - len; i += step) {
            const window = audioData.subarray(i, i + len);
            const scoreUp = this.correlate(window, this.upChirp);
            const scoreDown = this.correlate(window, this.downChirp);

            correlations.push({
                index: i,
                scoreUp: scoreUp,
                scoreDown: scoreDown,
                diff: scoreUp - scoreDown
            });
        }

        // Peak Detection & Bit Decisions
        // We look for peaks in ScoreUp vs ScoreDown
        const detectedBits = [];

        // Threshold: Peak must be substantial
        // A perfect match of amplitude 1.0 length 2205 gives score ~1100.
        // In noise, maybe 100-200.
        const threshold = 50.0;

        // Find synchronization (Preamble: U-U-D-D)
        // We look for 4 peaks spaced by ~2205 samples with pattern U-U-D-D

        const peaks = [];
        for (let i = 1; i < correlations.length - 1; i++) {
            const curr = correlations[i];
            const prev = correlations[i - 1];
            const next = correlations[i + 1];

            // Local Maxima for Up
            if (curr.scoreUp > threshold && curr.scoreUp > prev.scoreUp && curr.scoreUp > next.scoreUp) {
                peaks.push({ index: curr.index, type: 1, score: curr.scoreUp });
            }
            // Local Maxima for Down
            else if (curr.scoreDown > threshold && curr.scoreDown > prev.scoreDown && curr.scoreDown > next.scoreDown) {
                peaks.push({ index: curr.index, type: 0, score: curr.scoreDown });
            }
        }

        // Find Sync Pattern: U, U, D, D (1, 1, 0, 0)
        // Spaced by roughly 2205 samples (tolerance ±200)

        let syncIndex = -1;
        const spacing = this.SAMPLES_PER_BIT;
        const tolerance = 400; // samples

        for (let i = 0; i < peaks.length - 3; i++) {
            const p1 = peaks[i];
            const p2 = peaks[i + 1];
            const p3 = peaks[i + 2];
            const p4 = peaks[i + 3];

            if (p1.type === 1 && p2.type === 1 && p3.type === 0 && p4.type === 0) {
                // Check spacing
                const d1 = p2.index - p1.index;
                const d2 = p3.index - p2.index;
                const d3 = p4.index - p3.index;

                if (Math.abs(d1 - spacing) < tolerance &&
                    Math.abs(d2 - spacing) < tolerance &&
                    Math.abs(d3 - spacing) < tolerance) {

                    console.log(`[DECODER] Preamble found at ${p1.index}`);
                    syncIndex = p4.index + spacing; // Start of data
                    break;
                }
            }
        }

        if (syncIndex === -1) {
            console.log('[DECODER] No Preamble found');
            return null;
        }

        // Decode Bits starting from syncIndex
        const bits = [];
        let cursor = syncIndex;

        // Read until end of buffer
        // We actively correlate at expected positions
        while (cursor + len < audioData.length) {
            // Refine local peak search (±tolerance around expected cursor)
            let bestScore = -Infinity;
            let bestType = -1;

            // Search small window around expected time for peak
            const searchStart = Math.max(0, cursor - tolerance);
            const searchEnd = Math.min(audioData.length - len, cursor + tolerance);

            let localBestIdx = cursor;

            // We only check every 'step' samples to match our correlation grid
            // Re-running dense correlation locally IS efficient

            for (let i = searchStart; i < searchEnd; i += 20) {
                const window = audioData.subarray(i, i + len);
                const sUp = this.correlate(window, this.upChirp);
                const sDown = this.correlate(window, this.downChirp);

                if (sUp > bestScore) { bestScore = sUp; bestType = 1; localBestIdx = i; }
                if (sDown > bestScore) { bestScore = sDown; bestType = 0; localBestIdx = i; }
            }

            bits.push(bestType);
            cursor = localBestIdx + spacing; // Advance by exactly one symbol spacing from detected peak
        }

        console.log(`[DECODER] Extracted ${bits.length} raw bits`);

        // Parse Packet: Sync(16) + Len(16)
        // Skip Sync (16 bits)
        if (bits.length < 32) return null;

        const dataBits = bits.slice(16); // Sync is 16 bits
        const rawData = dataBits;

        // 5. Read Length (16 bits)
        if (rawData.length < 16) return null;
        let pLen = 0;
        for (let i = 0; i < 16; i++) pLen = (pLen << 1) | rawData[i];

        console.log(`[DECODER] Payload Length: ${pLen} bytes`);
        if (pLen <= 0 || pLen > 1024) return null;

        // 6. Majority Vote
        const payloadBits = new Uint8Array(pLen * 8);
        const dataStart = 16;
        const bitLen = pLen * 8;

        if (rawData.length < dataStart + (bitLen * 3)) {
            console.log('[DECODER] Incomplete Chirp packet');
            // Try to extract partial? No.
            return null;
        }

        for (let i = 0; i < bitLen; i++) {
            const b1 = rawData[dataStart + i];
            const b2 = rawData[dataStart + bitLen + i];
            const b3 = rawData[dataStart + (bitLen * 2) + i];
            const sum = b1 + b2 + b3;
            payloadBits[i] = sum >= 2 ? 1 : 0;
        }

        // 7. Reconstruct Bytes
        const bytes = new Uint8Array(pLen);
        for (let i = 0; i < pLen; i++) {
            let b = 0;
            for (let j = 0; j < 8; j++) {
                b = (b << 1) | payloadBits[i * 8 + j];
            }
            bytes[i] = b;
        }

        return bytes;
    }
};
