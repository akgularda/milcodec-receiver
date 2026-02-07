/**
 * MILCODEC Web Receiver - Main Application Controller
 * Disguised as FM Radio Tuner, reveals receiver on secret trigger
 */

class MilcodecWebReceiver {
    constructor() {
        // Radio state
        this.isPowered = false;
        this.freq = 101.5;
        this.unlockClicks = 0;
        this.lastClickTime = 0;
        this.isUnlocked = false;

        // Audio state
        this.audioContext = null;
        this.analyser = null;
        this.microphone = null;
        this.isListening = false;
        this.audioBuffer = [];
        this.messages = [];

        // Decode settings
        this.rxMode = 'COVERT';
        this.autoScan = true;

        // Elements
        this.freqDisplay = document.getElementById('freq-value');
        this.tuner = document.getElementById('tuner');
        this.powerBtn = document.getElementById('power-btn');
        this.scanBtn = document.getElementById('scan-btn');
        this.stereoIndicator = document.getElementById('stereo-indicator');
        this.signalIndicator = document.getElementById('signal-indicator');
        this.canvas = document.getElementById('spectrum');
        this.ctx = this.canvas.getContext('2d');
        this.messagesPanel = document.getElementById('messages-panel');
        this.inbox = document.getElementById('inbox');
        this.currentMessage = document.getElementById('current-message');
        this.rxStatus = document.getElementById('rx-status-text');
        this.passwordModal = document.getElementById('password-modal');
        this.passcodeInput = document.getElementById('passcode');
        this.authBtn = document.getElementById('auth-btn');
        this.authError = document.getElementById('auth-error');
        this.secretTrigger = document.getElementById('secret-trigger');

        this.initEventListeners();
        this.initAudio();
        this.startVisualization();
    }

    initEventListeners() {
        // Tuner dial
        this.tuner.addEventListener('input', (e) => {
            this.freq = parseFloat(e.target.value);
            this.freqDisplay.textContent = this.freq.toFixed(1);
        });

        // Power button
        this.powerBtn.addEventListener('click', () => this.togglePower());

        // Scan button
        this.scanBtn.addEventListener('click', () => this.scanAnimation());

        // Secret trigger (triple click on stereo indicator)
        this.stereoIndicator.addEventListener('click', () => this.handleSecretClick());
        this.secretTrigger.addEventListener('click', () => this.handleSecretClick());

        // Password modal
        this.authBtn.addEventListener('click', () => this.authenticate());
        this.passcodeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.authenticate();
        });
    }

    async initAudio() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: MILCODEC.FS
            });

            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;

            console.log('Audio context initialized');
        } catch (e) {
            console.error('Audio init failed:', e);
        }
    }

    async startMicrophone() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: MILCODEC.FS,
                    channelCount: 1,
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });

            this.microphone = this.audioContext.createMediaStreamSource(stream);
            this.microphone.connect(this.analyser);

            // Set up ScriptProcessorNode for raw audio access
            const bufferSize = 4096;
            const processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

            processor.onaudioprocess = (e) => {
                if (!this.isListening) return;

                const input = e.inputBuffer.getChannelData(0);
                const copy = new Float32Array(input);
                this.audioBuffer.push(copy);

                // Process every ~2 seconds of audio
                if (this.audioBuffer.length * bufferSize >= MILCODEC.FS * 2) {
                    this.processAudioBuffer();
                }
            };

            this.microphone.connect(processor);
            processor.connect(this.audioContext.destination);

            this.isListening = true;
            this.setStatus('LISTENING...', 'var(--green)');
            this.signalIndicator.classList.add('signal-on');
            this.signalIndicator.classList.remove('signal-off');

            console.log('Microphone active');

        } catch (e) {
            console.error('Microphone access denied:', e);
            this.setStatus('MIC ACCESS DENIED', 'var(--red)');
        }
    }

    stopMicrophone() {
        this.isListening = false;
        this.audioBuffer = [];
        this.signalIndicator.classList.remove('signal-on');
        this.signalIndicator.classList.add('signal-off');
        this.setStatus('STOPPED', 'var(--amber)');
    }

    processAudioBuffer() {
        // Concatenate buffered audio
        const totalLength = this.audioBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
        const combined = new Float32Array(totalLength);
        let offset = 0;

        for (const chunk of this.audioBuffer) {
            combined.set(chunk, offset);
            offset += chunk.length;
        }

        this.audioBuffer = [];

        this.setStatus('SCANNING/DECODING...', 'var(--amber)');

        // Extract signal
        const payload = MILCODEC.extractFromAudio(combined, this.rxMode, this.autoScan);

        if (payload) {
            console.log('Payload extracted:', payload.length, 'bytes');

            // Decrypt
            const result = MilcodecCrypto.decrypt(payload);

            if (result.status === 'OK') {
                this.addMessage(result);
            } else {
                console.log('Decrypt failed:', result.content);
            }
        }

        this.setStatus('LISTENING...', 'var(--green)');
    }

    addMessage(result) {
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const authBadge = result.verified ? '✅' : '⚠️';

        const message = {
            content: result.content,
            priority: result.priority,
            msgType: result.msgType,
            verified: result.verified,
            timestamp
        };

        this.messages.unshift(message);

        // Update inbox
        const preview = result.content.length > 30
            ? result.content.substring(0, 30) + '...'
            : result.content;

        const item = document.createElement('div');
        item.className = `message-item ${result.priority.toLowerCase()}`;
        item.textContent = `[${result.priority}] ${timestamp} ${authBadge} - ${preview}`;
        item.addEventListener('click', () => this.showMessage(message));

        // Remove empty state
        const emptyState = this.inbox.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        this.inbox.insertBefore(item, this.inbox.firstChild);

        // Auto-show latest message
        this.showMessage(message);

        // Audio alert for high priority
        if (result.priority === 'FLASH' || result.priority === 'IMMEDIATE') {
            this.playAlert();
        }
    }

    showMessage(message) {
        const authStr = message.verified ? 'AUTHENTICATED SENDER ✅' : 'UNVERIFIED SENDER ⚠️';
        this.currentMessage.innerHTML = `<strong>${authStr}</strong><br><br>${message.content}`;
        this.currentMessage.style.color = MILCODEC.PRIORITIES[message.priority] || 'var(--text)';
    }

    playAlert() {
        // Simple beep using Web Audio
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        osc.connect(gain);
        gain.connect(this.audioContext.destination);
        osc.frequency.value = 880;
        gain.gain.value = 0.1;
        osc.start();
        setTimeout(() => osc.stop(), 200);
    }

    togglePower() {
        this.isPowered = !this.isPowered;

        if (this.isPowered) {
            this.powerBtn.classList.add('power-on');
            this.powerBtn.classList.remove('power-off');
            this.playStatic();

            if (this.isUnlocked) {
                this.audioContext.resume().then(() => this.startMicrophone());
            }
        } else {
            this.powerBtn.classList.remove('power-on');
            this.powerBtn.classList.add('power-off');
            this.stopMicrophone();
        }
    }

    playStatic() {
        // Play radio static noise
        if (!this.audioContext) return;

        const duration = 0.5;
        const samples = MILCODEC.FS * duration;
        const buffer = this.audioContext.createBuffer(1, samples, MILCODEC.FS);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < samples; i++) {
            data[i] = (Math.random() * 2 - 1) * 0.05;
        }

        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(this.audioContext.destination);
        source.start();
    }

    scanAnimation() {
        let count = 0;
        const interval = setInterval(() => {
            this.freq = 88 + Math.random() * 20;
            this.freqDisplay.textContent = this.freq.toFixed(1);
            this.tuner.value = this.freq;
            count++;

            if (count >= 20) {
                clearInterval(interval);
                this.freq = 101.5;
                this.freqDisplay.textContent = '101.5';
                this.tuner.value = 101.5;
            }
        }, 100);
    }

    handleSecretClick() {
        const now = Date.now();

        if (now - this.lastClickTime < 500) {
            this.unlockClicks++;
        } else {
            this.unlockClicks = 1;
        }

        this.lastClickTime = now;

        // Flash stereo indicator
        this.stereoIndicator.style.color = 'white';
        setTimeout(() => {
            this.stereoIndicator.style.color = '';
        }, 100);

        if (this.unlockClicks >= 3) {
            this.unlockClicks = 0;
            this.showPasswordModal();
        }
    }

    showPasswordModal() {
        this.passwordModal.classList.remove('hidden');
        this.passcodeInput.focus();
        this.authError.classList.add('hidden');
    }

    authenticate() {
        const code = this.passcodeInput.value;

        if (code === 'DELTA') {
            this.passwordModal.classList.add('hidden');
            this.passcodeInput.value = '';
            this.unlock();
        } else {
            this.authError.classList.remove('hidden');
            this.passcodeInput.value = '';
            this.passcodeInput.focus();
        }
    }

    unlock() {
        this.isUnlocked = true;
        this.messagesPanel.classList.remove('hidden');

        // If power is on, start listening
        if (this.isPowered) {
            this.audioContext.resume().then(() => this.startMicrophone());
        }
    }

    setStatus(text, color) {
        this.rxStatus.textContent = `● ${text}`;
        this.rxStatus.style.color = color;
    }

    startVisualization() {
        const draw = () => {
            requestAnimationFrame(draw);

            const width = this.canvas.width;
            const height = this.canvas.height;

            this.ctx.fillStyle = '#000';
            this.ctx.fillRect(0, 0, width, height);

            if (this.analyser && this.isPowered) {
                const bufferLength = this.analyser.frequencyBinCount;
                const dataArray = new Uint8Array(bufferLength);
                this.analyser.getByteFrequencyData(dataArray);

                const barWidth = width / bufferLength * 2;
                let x = 0;

                for (let i = 0; i < bufferLength; i++) {
                    const barHeight = (dataArray[i] / 255) * height;

                    // Gradient from green to red
                    const hue = 120 - (dataArray[i] / 255) * 120;
                    this.ctx.fillStyle = `hsl(${hue}, 80%, 50%)`;

                    this.ctx.fillRect(x, height - barHeight, barWidth - 1, barHeight);
                    x += barWidth;
                }
            } else {
                // Static noise when off
                for (let x = 0; x < width; x += 3) {
                    const y = height - Math.random() * (this.isPowered ? 20 : 5);
                    this.ctx.fillStyle = '#333';
                    this.ctx.fillRect(x, y, 2, height - y);
                }
            }
        };

        draw();
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.receiver = new MilcodecWebReceiver();
});
