(() => {
    'use strict';

    const ALLOWED_PRIORITIES = new Set(['ROUTINE', 'PRIORITY', 'IMMEDIATE', 'FLASH']);
    const MAX_LOG_ENTRIES = 80;

    function createElement(documentRef, tagName, className, text) {
        const element = documentRef.createElement(tagName);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = String(text);
        return element;
    }

    function createMessageItem(documentRef, result, timestamp) {
        const priority = ALLOWED_PRIORITIES.has(result.priority) ? result.priority : 'ROUTINE';
        const item = createElement(documentRef, 'article', `message-item priority-${priority.toLowerCase()}`);
        const content = createElement(documentRef, 'p', 'message-content', result.content);
        const metadata = createElement(documentRef, 'div', 'message-metadata');
        const priorityLabel = createElement(documentRef, 'span', 'message-priority', priority);
        const timeLabel = createElement(documentRef, 'time', 'message-time', timestamp);

        metadata.append(priorityLabel, timeLabel);
        item.append(content, metadata);
        return item;
    }

    class ReceiverController {
        constructor(documentRef) {
            this.document = documentRef;
            this.startButton = documentRef.getElementById('startButton');
            this.demoButton = documentRef.getElementById('demoButton');
            this.statusIndicator = documentRef.getElementById('statusIndicator');
            this.statusText = documentRef.getElementById('statusText');
            this.errorState = documentRef.getElementById('errorState');
            this.spectrum = documentRef.getElementById('spectrum');
            this.inbox = documentRef.getElementById('inbox');
            this.emptyInbox = documentRef.getElementById('emptyInbox');
            this.messageCount = documentRef.getElementById('messageCount');
            this.debugLog = documentRef.getElementById('debugLog');

            this.audioContext = null;
            this.stream = null;
            this.source = null;
            this.processor = null;
            this.analyser = null;
            this.animationFrame = null;
            this.audioChunks = [];
            this.bufferedSamples = 0;
            this.processCycles = 0;
            this.messagesReceived = 0;
            this.isListening = false;

            this.startButton.addEventListener('click', () => this.toggleListening());
            this.demoButton.addEventListener('click', () => this.runLocalDemo());
        }

        runLocalDemo() {
            this.clearError();
            this.demoButton.disabled = true;
            try {
                if (typeof nacl === 'undefined' || typeof nacl.secretbox !== 'function') {
                    throw new Error('The local packet decoder is still loading. Try again in a moment.');
                }
                const payload = new TextEncoder().encode(JSON.stringify({
                    p: 'ROUTINE',
                    m: 'Local MILCODEC packet path verified. Receiver is ready for an acoustic transmission.',
                }));
                const plaintext = new Uint8Array(65 + payload.length);
                plaintext[0] = 1;
                plaintext.set(payload, 65);
                const nonce = globalThis.crypto.getRandomValues(new Uint8Array(24));
                const ciphertext = nacl.secretbox(plaintext, nonce, MilcodecCrypto.key);
                const packet = new Uint8Array(nonce.length + ciphertext.length);
                packet.set(nonce);
                packet.set(ciphertext, nonce.length);
                const result = MilcodecCrypto.decrypt(packet);
                if (result.status !== 'OK') throw new Error(result.error);
                this.addMessage(result);
                this.setStatus('Local packet demo passed', 'active');
                this.log('Local encrypted packet created, authenticated, and decoded.');
            } catch (error) {
                this.showError(error instanceof Error ? error.message : 'Local packet demo failed.');
                this.setStatus('Local packet demo failed', 'error');
                this.log('Local packet demo failed safely.');
            } finally {
                this.demoButton.disabled = false;
            }
        }

        async toggleListening() {
            if (this.isListening) {
                this.stopListening();
                return;
            }
            await this.startListening();
        }

        async startListening() {
            this.clearError();
            this.startButton.disabled = true;
            this.setStatus('Requesting microphone access…', 'pending');

            try {
                if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                    throw new Error('Microphone capture is not supported by this browser.');
                }

                this.stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        autoGainControl: false,
                        echoCancellation: false,
                        noiseSuppression: false,
                    },
                    video: false,
                });

                const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                if (!AudioContextClass) throw new Error('Web Audio is not supported by this browser.');

                this.audioContext = new AudioContextClass({ sampleRate: MILCODEC.FS });
                if (this.audioContext.sampleRate !== MILCODEC.FS) {
                    throw new Error(`A ${MILCODEC.FS} Hz audio context is required.`);
                }

                await this.audioContext.resume();
                this.source = this.audioContext.createMediaStreamSource(this.stream);
                this.analyser = this.audioContext.createAnalyser();
                this.analyser.fftSize = 2048;
                this.analyser.smoothingTimeConstant = 0.72;

                this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
                this.processor.onaudioprocess = (event) => {
                    const output = event.outputBuffer.getChannelData(0);
                    output.fill(0);
                    this.acceptAudio(event.inputBuffer.getChannelData(0));
                };

                this.source.connect(this.analyser);
                this.source.connect(this.processor);
                this.processor.connect(this.audioContext.destination);

                this.isListening = true;
                this.startButton.disabled = false;
                this.startButton.textContent = 'Stop microphone receiver';
                this.setStatus('Listening for MILCODEC packets', 'active');
                this.log('Microphone active. Audio remains in this browser tab.');
                this.drawSpectrum();
            } catch (error) {
                await this.releaseAudio();
                this.startButton.disabled = false;
                this.showError(error instanceof Error ? error.message : 'Unable to start the receiver.');
                this.setStatus('Receiver unavailable', 'error');
                this.log('Receiver start failed.');
            }
        }

        stopListening() {
            this.releaseAudio();
            this.isListening = false;
            this.startButton.disabled = false;
            this.startButton.textContent = 'Start microphone receiver';
            this.audioChunks = [];
            this.bufferedSamples = 0;
            this.setStatus('Receiver idle', 'idle');
            this.log('Microphone stopped.');
            this.clearSpectrum();
        }

        async releaseAudio() {
            if (this.animationFrame !== null) {
                cancelAnimationFrame(this.animationFrame);
                this.animationFrame = null;
            }
            if (this.processor) {
                this.processor.onaudioprocess = null;
                this.processor.disconnect();
                this.processor = null;
            }
            if (this.source) {
                this.source.disconnect();
                this.source = null;
            }
            if (this.analyser) {
                this.analyser.disconnect();
                this.analyser = null;
            }
            if (this.stream) {
                this.stream.getTracks().forEach((track) => track.stop());
                this.stream = null;
            }
            if (this.audioContext && this.audioContext.state !== 'closed') {
                await this.audioContext.close();
            }
            this.audioContext = null;
        }

        acceptAudio(input) {
            const chunk = new Float32Array(input);
            this.audioChunks.push(chunk);
            this.bufferedSamples += chunk.length;
            this.processCycles += 1;

            const maxSamples = MILCODEC.MAX_AUDIO_SAMPLES;
            while (this.bufferedSamples > maxSamples && this.audioChunks.length > 1) {
                const removed = this.audioChunks.shift();
                this.bufferedSamples -= removed.length;
            }

            const minimumFrame = MILCODEC.SAMPLES_PER_BIT * 36;
            if (this.bufferedSamples >= minimumFrame && this.processCycles % 6 === 0) {
                this.decodeBufferedAudio();
            }
        }

        decodeBufferedAudio() {
            const audio = new Float32Array(this.bufferedSamples);
            let offset = 0;
            for (const chunk of this.audioChunks) {
                audio.set(chunk, offset);
                offset += chunk.length;
            }

            try {
                const encryptedPacket = MILCODEC.extractFromAudio(audio);
                if (!encryptedPacket) return;

                const result = MilcodecCrypto.decrypt(encryptedPacket);
                if (result.status !== 'OK') {
                    this.log(`Packet rejected: ${result.error}`);
                    return;
                }

                this.addMessage(result);
                this.audioChunks = [];
                this.bufferedSamples = 0;
            } catch {
                this.log('Packet processing failed safely.');
            }
        }

        addMessage(result) {
            if (this.emptyInbox) {
                this.emptyInbox.remove();
                this.emptyInbox = null;
            }

            const timestamp = new Date().toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            });
            const item = createMessageItem(this.document, result, timestamp);
            this.inbox.prepend(item);
            this.messagesReceived += 1;
            this.messageCount.textContent = String(this.messagesReceived);
            this.messageCount.setAttribute(
                'aria-label',
                `${this.messagesReceived} ${this.messagesReceived === 1 ? 'message' : 'messages'}`,
            );
            this.log(`Decoded ${result.priority} ${result.msgType.toLowerCase()} packet.`);
        }

        setStatus(message, state) {
            this.statusText.textContent = message;
            this.statusIndicator.className = `status-indicator status-${state}`;
        }

        showError(message) {
            this.errorState.textContent = message;
            this.errorState.hidden = false;
        }

        clearError() {
            this.errorState.textContent = '';
            this.errorState.hidden = true;
        }

        log(message) {
            const entry = createElement(
                this.document,
                'p',
                '',
                `${new Date().toLocaleTimeString()} · ${message}`,
            );
            this.debugLog.append(entry);
            while (this.debugLog.childElementCount > MAX_LOG_ENTRIES) {
                this.debugLog.firstElementChild.remove();
            }
            this.debugLog.scrollTop = this.debugLog.scrollHeight;
        }

        drawSpectrum() {
            if (!this.analyser || !this.isListening) return;
            const context = this.spectrum.getContext('2d');
            const data = new Uint8Array(this.analyser.frequencyBinCount);
            this.analyser.getByteFrequencyData(data);

            const { width, height } = this.spectrum;
            context.clearRect(0, 0, width, height);
            context.fillStyle = '#15130f';
            context.fillRect(0, 0, width, height);

            const minHz = 12000;
            const maxHz = 20000;
            const nyquist = this.audioContext.sampleRate / 2;
            const startBin = Math.floor((minHz / nyquist) * data.length);
            const endBin = Math.min(data.length - 1, Math.ceil((maxHz / nyquist) * data.length));
            const span = Math.max(1, endBin - startBin);

            context.strokeStyle = '#2c2820';
            context.lineWidth = 1;
            for (let index = 1; index < 4; index += 1) {
                const y = (height / 4) * index;
                context.beginPath();
                context.moveTo(0, y);
                context.lineTo(width, y);
                context.stroke();
            }

            context.fillStyle = '#c9a24b';
            for (let bin = startBin; bin <= endBin; bin += 1) {
                const x = ((bin - startBin) / span) * width;
                const barWidth = Math.max(1, width / span);
                const barHeight = (data[bin] / 255) * height;
                context.fillRect(x, height - barHeight, barWidth, barHeight);
            }

            this.animationFrame = requestAnimationFrame(() => this.drawSpectrum());
        }

        clearSpectrum() {
            const context = this.spectrum.getContext('2d');
            context.clearRect(0, 0, this.spectrum.width, this.spectrum.height);
        }
    }

    globalThis.MilcodecUI = Object.freeze({
        ReceiverController,
        createMessageItem,
    });

    if (typeof document !== 'undefined') {
        document.addEventListener('DOMContentLoaded', () => {
            new ReceiverController(document);
        });
    }
})();
