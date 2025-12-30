/**
 * Stream Client
 *
 * Captures canvas + audio, sends to server via WebSocket.
 * Include this in any visualization page to enable streaming.
 *
 * Usage:
 *   import { StreamClient } from './stream-client.js';
 *   const client = new StreamClient(canvas, audioElement);
 *   client.start('youtube');
 */

export class StreamClient {
  constructor(canvas, audioElement, options = {}) {
    this.canvas = canvas;
    this.audio = audioElement;
    this.options = {
      serverUrl: options.serverUrl || 'ws://localhost:3001',
      fps: options.fps || 30,
      videoBitrate: options.videoBitrate || 2500000,
      audioBitrate: options.audioBitrate || 128000,
      chunkInterval: options.chunkInterval || 1000, // ms
      ...options
    };

    this.ws = null;
    this.recorder = null;
    this.stream = null;
    this.audioContext = null;
    this.isStreaming = false;

    // Status callback
    this.onStatusChange = options.onStatusChange || ((status) => {
      console.log('[StreamClient]', status);
    });
  }

  async start(platform = 'youtube') {
    if (this.isStreaming) {
      console.warn('Already streaming');
      return;
    }

    try {
      this.onStatusChange({ state: 'connecting', message: 'Connecting to server...' });

      // Connect to server
      await this._connectWebSocket(platform);

      // Set up media capture
      await this._setupMediaCapture();

      // Start recording
      this._startRecording();

      this.isStreaming = true;
      this.onStatusChange({ state: 'streaming', message: `Streaming to ${platform}` });

    } catch (err) {
      this.onStatusChange({ state: 'error', message: err.message });
      this.stop();
      throw err;
    }
  }

  stop() {
    this.onStatusChange({ state: 'stopping', message: 'Stopping stream...' });

    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.stop();
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    this.isStreaming = false;
    this.onStatusChange({ state: 'stopped', message: 'Stream stopped' });
  }

  _connectWebSocket(platform) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.options.serverUrl);

      this.ws.onopen = () => {
        // Send config as first message
        this.ws.send(JSON.stringify({ platform }));
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.status === 'streaming') {
            resolve();
          } else if (msg.error) {
            reject(new Error(msg.error));
          }
        } catch (e) {
          // Ignore non-JSON messages
        }
      };

      this.ws.onerror = (err) => {
        reject(new Error('WebSocket connection failed'));
      };

      this.ws.onclose = () => {
        if (this.isStreaming) {
          this.onStatusChange({ state: 'disconnected', message: 'Connection lost' });
          this.isStreaming = false;
        }
      };

      // Timeout
      setTimeout(() => {
        if (this.ws.readyState !== WebSocket.OPEN) {
          reject(new Error('Connection timeout'));
        }
      }, 10000);
    });
  }

  async _setupMediaCapture() {
    // Capture canvas at specified fps
    const canvasStream = this.canvas.captureStream(this.options.fps);

    // Capture audio from the audio element
    this.audioContext = new AudioContext();
    const source = this.audioContext.createMediaElementSource(this.audio);
    const destination = this.audioContext.createMediaStreamDestination();

    // Connect: source → destination (for capture) AND source → speakers (for playback)
    source.connect(destination);
    source.connect(this.audioContext.destination);

    // Combine video + audio tracks
    this.stream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...destination.stream.getAudioTracks()
    ]);

    console.log('[StreamClient] Media capture ready:', {
      videoTracks: canvasStream.getVideoTracks().length,
      audioTracks: destination.stream.getAudioTracks().length
    });
  }

  _startRecording() {
    // Determine best codec
    const mimeTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=h264,opus',
      'video/webm'
    ];

    let mimeType = mimeTypes.find(mt => MediaRecorder.isTypeSupported(mt));
    if (!mimeType) {
      throw new Error('No supported video codec found');
    }

    console.log('[StreamClient] Using codec:', mimeType);

    this.recorder = new MediaRecorder(this.stream, {
      mimeType,
      videoBitsPerSecond: this.options.videoBitrate,
      audioBitsPerSecond: this.options.audioBitrate
    });

    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(event.data);
      }
    };

    this.recorder.onerror = (event) => {
      console.error('[StreamClient] Recorder error:', event.error);
      this.onStatusChange({ state: 'error', message: 'Recording error' });
    };

    this.recorder.onstop = () => {
      console.log('[StreamClient] Recorder stopped');
    };

    // Start recording, emit chunks every N ms
    this.recorder.start(this.options.chunkInterval);
    console.log('[StreamClient] Recording started');
  }
}

// Auto-initialize if data attributes present
// <canvas id="canvas" data-stream-auto="youtube"></canvas>
document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.querySelector('canvas[data-stream-auto]');
  if (canvas) {
    const platform = canvas.dataset.streamAuto;
    const audio = document.querySelector('audio');

    if (audio) {
      const client = new StreamClient(canvas, audio);
      window.streamClient = client;

      // Add start button
      const btn = document.createElement('button');
      btn.textContent = 'Start Stream';
      btn.style.cssText = 'position:fixed;top:10px;right:10px;z-index:9999;padding:10px 20px;';
      btn.onclick = () => {
        if (client.isStreaming) {
          client.stop();
          btn.textContent = 'Start Stream';
        } else {
          client.start(platform);
          btn.textContent = 'Stop Stream';
        }
      };
      document.body.appendChild(btn);
    }
  }
});
