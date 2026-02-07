# MILCODEC Web Receiver

A browser-based signal receiver for MILCODEC encrypted communications, disguised as an FM radio tuner.

## Deployment to GitHub Pages

1. Create a new GitHub repository (e.g., `milcodec-receiver`)
2. Copy all files from this `web-receiver` folder to the repository
3. Go to **Settings** → **Pages**
4. Set Source to **Deploy from branch** and select `main`
5. Save and wait ~1 minute for deployment
6. Access at `https://yourusername.github.io/milcodec-receiver/`

## Usage

1. Open the URL on your phone browser
2. The interface appears as an FM radio tuner
3. **To unlock**: Triple-click the "STEREO" indicator
4. **Passcode**: `DELTA`
5. Click **POWER** to start listening
6. Grant microphone permission when prompted
7. Messages from the sender will appear in the inbox

## Signal Flow

```
PC Sender → Speaker → Air → Phone Mic → Web Receiver → Decoded Message
```

## Requirements

- HTTPS (GitHub Pages provides this automatically)
- Modern browser with Web Audio API support (Chrome, Safari, Firefox)
- Microphone access

## Local Testing

```bash
cd web-receiver
python -m http.server 8080
# Open http://localhost:8080
```

## Security Note

This demo uses a hardcoded default encryption key. For production use, implement proper key exchange.
