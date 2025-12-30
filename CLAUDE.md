# Lofi Stream AI

An AI-operated lofi radio station. The AI monitors chat, selects music and visuals, and streams 24/7 to YouTube/Twitch. Viewers influence the stream through natural chat—not just commands.

## Vision

Prove that AI can autonomously operate an engaging live stream:
- Play lofi music with reactive visualizations
- Respond to chat naturally (AI interprets intent, not rigid commands)
- Multiple simultaneous streams to different platforms
- Each stream could have its own "personality" or theme

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  AI DJ (Claude API)                     │
│  Interprets chat → decides music/visuals → responds     │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                   Stream Server                         │
│  - Music queue management                               │
│  - Visual selection                                     │
│  - Chat monitoring (YouTube/Twitch APIs)                │
│  - Receives video from browser via WebSocket            │
│  - Pipes to ffmpeg → RTMP                               │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│              Browser (headless ok)                      │
│  - Plays audio synced to pre-analyzed JSON              │
│  - Renders canvas visualization                         │
│  - captureStream() → MediaRecorder → WebSocket          │
└─────────────────────────────────────────────────────────┘
                          ↓
              YouTube / Twitch / Rumble
```

## Project Structure

```
/lofi-stream-ai
├── CLAUDE.md              # This file
├── .gitignore
├── server/                # Node.js stream server
│   ├── index.js           # Main server (WebSocket → ffmpeg → RTMP) ✓
│   └── package.json
├── browser/               # Browser-side code
│   ├── stream-client.js   # captureStream + MediaRecorder + WebSocket ✓
│   └── test-stream.html   # Test page with simple visualization ✓
├── scripts/
│   └── start-test.sh      # Start both servers for testing
├── audio -> ../audio-reactive-visuals/audio    # Symlink
├── data -> ../audio-reactive-visuals/data      # Symlink
└── visuals -> ../audio-reactive-visuals/visuals # Symlink

# Planned (not yet built):
# ├── server/ai-dj.js       # Claude API for chat interpretation
# ├── server/chat/          # Platform chat adapters (twitch.js, youtube.js)
# ├── browser/overlay.js    # On-screen queue/status display
# └── config/streams.json   # Multi-stream configurations
```

## Key Technical Concepts

### Audio-Visual Sync

Visualizations are driven by pre-computed audio analysis (librosa), not real-time FFT. This allows:
- Heavier analysis than real-time permits
- Deterministic playback (same song = same visuals)
- Analysis JSON contains per-frame data: RMS, spectral centroid, frequency bands, chromagram, onsets, etc.

The browser loads both the MP3 and its JSON. On each frame, it looks up `getFrameAtTime(audio.currentTime)` to get audio features, then maps them to visual properties.

### Streaming Pipeline

```javascript
// Browser captures its own canvas + audio
const canvas = document.getElementById('canvas');
const audio = document.getElementById('audio');

// Create combined stream
const canvasStream = canvas.captureStream(60);
const audioCtx = new AudioContext();
const source = audioCtx.createMediaElementSource(audio);
const dest = audioCtx.createMediaStreamDestination();
source.connect(dest);
source.connect(audioCtx.destination);

// Combine video + audio
const combined = new MediaStream([
  ...canvasStream.getVideoTracks(),
  ...dest.stream.getAudioTracks()
]);

// Record and send chunks
const recorder = new MediaRecorder(combined, {
  mimeType: 'video/webm;codecs=vp8,opus',
  videoBitsPerSecond: 2500000
});

recorder.ondataavailable = (e) => {
  if (e.data.size > 0) {
    websocket.send(e.data);
  }
};

recorder.start(1000); // 1 second chunks
```

### Server → ffmpeg → RTMP

```javascript
// Server receives WebSocket chunks, pipes to ffmpeg
const ffmpeg = spawn('ffmpeg', [
  '-i', 'pipe:0',           // Input from stdin
  '-c:v', 'libx264',        // Re-encode video
  '-preset', 'veryfast',
  '-c:a', 'aac',
  '-f', 'flv',
  `rtmp://a.rtmp.youtube.com/live2/${streamKey}`
]);

ws.on('message', (chunk) => {
  ffmpeg.stdin.write(chunk);
});
```

### AI DJ Decision Making

Chat messages go to Claude API for interpretation:

```javascript
const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-20250514',
  system: `You are the DJ for a lofi stream. Interpret viewer messages and decide:
    - Should we change the music? To what vibe?
    - Should we change the visual? To which one?
    - How should we respond in chat?
    Current song: ${currentSong}
    Current visual: ${currentVisual}
    Recent chat context: ${recentMessages}`,
  messages: [{ role: 'user', content: chatMessage }]
});
```

## Visualizations

12 pre-built visualizations in `~/audio-reactive-visuals/visuals/`:

| Key | Name | Vibe |
|-----|------|------|
| particles | Particle Physics | Energetic, rain-like |
| flow | Flow Field | Calm, organic |
| mandala | Geometric Mandala | Hypnotic, rhythmic |
| flocking | Flocking | Organic, emergent |
| chromagram | Chromagram Wheel | Harmonic, colorful |
| terrain | Waveform Terrain | Retro, 3D |
| trail | Trail Echo | Dreamy, temporal |
| reaction | Reaction Diffusion | Organic, chemical |
| layers | Multi-Layer | Deep, layered |
| state | State Machine | Dynamic, mode-switching |
| bars | Frequency Bars | Classic, simple |
| baseline | Baseline Circle | Minimal, foundational |

All consume the same JSON format—any song works with any visual.

## Configuration

Stream keys stored in `~/api-secrets/lofi-stream/platforms/`:
- `youtube.env` - YouTube stream key
- `twitch.env` - Twitch stream key
- `rumble.env`, `kick.env`, etc.

## Commands

```bash
# Analyze a new song
python ~/audio-reactive-visuals/analysis/analyze.py audio/newsong.mp3

# Start the stream server
cd server && npm start

# Open stream in browser (for testing)
open http://localhost:8080/stream.html
```

## Development Priorities

1. ~~**Streaming pipeline** - captureStream → server → ffmpeg → RTMP~~ ✅ DONE
2. **Multi-song support** - Queue system, smooth transitions
3. **AI DJ** - Claude interprets chat, makes decisions
4. **Multi-stream** - Multiple isolated browser instances

## Current Status

**Working:** Browser captures canvas + audio → WebSocket → Server → ffmpeg → YouTube RTMP

**Tested:** Successfully streaming at 30fps, ~1800 kbps to YouTube Live

## Notes

- Headless Chrome works for streaming (no visible window needed)
- Frame rate target: 60fps capture, 30fps output
- Bitrate: 2500-4000 kbps for 1080p
- Audio: 128-192 kbps AAC
- Keep chunks small (1 second) for low latency
