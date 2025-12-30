/**
 * Lofi Stream Server
 *
 * Receives video chunks from browser via WebSocket,
 * pipes them to ffmpeg which outputs RTMP to YouTube/Twitch.
 */

import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { config } from 'dotenv';

config();

const PORT = process.env.PORT || 3001;

// Load stream configuration
function loadStreamConfig(platform = 'youtube') {
  const envPath = `${process.env.HOME}/api-secrets/lofi-stream/platforms/${platform}.env`;
  if (!existsSync(envPath)) {
    console.error(`Stream config not found: ${envPath}`);
    return null;
  }

  const content = readFileSync(envPath, 'utf-8');
  const config = {};
  content.split('\n').forEach(line => {
    if (line && !line.startsWith('#')) {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length) {
        config[key.trim()] = valueParts.join('=').trim();
      }
    }
  });
  return config;
}

// FFmpeg process manager
class StreamOutput {
  constructor(platform, streamKey, streamUrl) {
    this.platform = platform;
    this.streamKey = streamKey;
    this.streamUrl = streamUrl;
    this.ffmpeg = null;
    this.isStreaming = false;
  }

  start() {
    if (this.ffmpeg) {
      console.log(`[${this.platform}] FFmpeg already running`);
      return;
    }

    const rtmpUrl = `${this.streamUrl}/${this.streamKey}`;
    console.log(`[${this.platform}] Starting ffmpeg → ${this.streamUrl}/***`);

    this.ffmpeg = spawn('ffmpeg', [
      // Input: WebM from stdin
      '-i', 'pipe:0',

      // Video: re-encode to H.264
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-tune', 'zerolatency',
      '-b:v', '2500k',
      '-maxrate', '2500k',
      '-bufsize', '5000k',
      '-pix_fmt', 'yuv420p',
      '-g', '60',  // Keyframe every 2 seconds at 30fps

      // Audio: re-encode to AAC
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',

      // Output: FLV to RTMP
      '-f', 'flv',
      rtmpUrl
    ], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.ffmpeg.stdout.on('data', (data) => {
      // FFmpeg outputs progress to stderr, stdout is usually empty
    });

    this.ffmpeg.stderr.on('data', (data) => {
      const msg = data.toString();
      // Log connection and error messages
      if (msg.includes('Error') || msg.includes('error') ||
          msg.includes('Opening') || msg.includes('Stream mapping') ||
          msg.includes('rtmp') || msg.includes('RTMP') ||
          msg.includes('Connection') || msg.includes('refused') ||
          msg.includes('Output #0') || msg.includes('frame=')) {
        console.log(`[${this.platform}] ffmpeg: ${msg.trim()}`);
      }
    });

    this.ffmpeg.on('close', (code) => {
      console.log(`[${this.platform}] FFmpeg exited with code ${code}`);
      this.ffmpeg = null;
      this.isStreaming = false;
    });

    this.ffmpeg.on('error', (err) => {
      console.error(`[${this.platform}] FFmpeg error:`, err);
      this.ffmpeg = null;
      this.isStreaming = false;
    });

    this.isStreaming = true;
  }

  write(chunk) {
    if (this.ffmpeg && this.ffmpeg.stdin.writable) {
      this.ffmpeg.stdin.write(chunk);
    }
  }

  stop() {
    if (this.ffmpeg) {
      console.log(`[${this.platform}] Stopping ffmpeg`);
      this.ffmpeg.stdin.end();
      this.ffmpeg.kill('SIGTERM');
      this.ffmpeg = null;
      this.isStreaming = false;
    }
  }
}

// Active streams
const streams = new Map();

// Create HTTP server for WebSocket upgrade
const server = createServer((req, res) => {
  // Simple health check endpoint
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      streams: Array.from(streams.keys()),
      activeStreams: Array.from(streams.values()).filter(s => s.isStreaming).length
    }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// WebSocket server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  console.log('Browser connected');

  let streamOutput = null;
  let platform = 'youtube'; // Default

  ws.on('message', (data, isBinary) => {
    // First message should be config (JSON)
    if (!streamOutput && !isBinary) {
      try {
        const config = JSON.parse(data.toString());
        platform = config.platform || 'youtube';

        console.log(`Configuring stream for platform: ${platform}`);

        const streamConfig = loadStreamConfig(platform);
        if (!streamConfig || !streamConfig.STREAM_KEY) {
          ws.send(JSON.stringify({ error: `No stream key found for ${platform}` }));
          return;
        }

        streamOutput = new StreamOutput(
          platform,
          streamConfig.STREAM_KEY,
          streamConfig.STREAM_URL || 'rtmp://a.rtmp.youtube.com/live2'
        );

        streamOutput.start();
        streams.set(platform, streamOutput);

        ws.send(JSON.stringify({ status: 'streaming', platform }));
        return;
      } catch (e) {
        console.error('Invalid config message:', e);
        return;
      }
    }

    // Binary data = video chunk
    if (isBinary && streamOutput) {
      streamOutput.write(data);
    }
  });

  ws.on('close', () => {
    console.log('Browser disconnected');
    if (streamOutput) {
      streamOutput.stop();
      streams.delete(platform);
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Stream server running on ws://localhost:${PORT}`);
  console.log('Waiting for browser to connect and send video...');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  for (const stream of streams.values()) {
    stream.stop();
  }
  process.exit(0);
});
