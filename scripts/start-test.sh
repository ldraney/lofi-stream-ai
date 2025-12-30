#!/bin/bash
# Start the test environment

echo "Starting Lofi Stream Test..."

# Kill any existing servers on our ports
pkill -f "python3 -m http.server 8080" 2>/dev/null
pkill -f "node.*lofi-stream-ai/server" 2>/dev/null

# Start static file server for browser files (port 8080)
echo "Starting static file server on :8080..."
cd ~/lofi-stream-ai
python3 -m http.server 8080 &
STATIC_PID=$!

# Start stream server (port 3001)
echo "Starting stream server on :3001..."
cd ~/lofi-stream-ai/server
node index.js &
STREAM_PID=$!

echo ""
echo "========================================="
echo "Servers running:"
echo "  Static files: http://localhost:8080"
echo "  Stream server: ws://localhost:3001"
echo ""
echo "Open in browser:"
echo "  http://localhost:8080/browser/test-stream.html"
echo ""
echo "Press Ctrl+C to stop all servers"
echo "========================================="

# Wait for interrupt
trap "kill $STATIC_PID $STREAM_PID 2>/dev/null; exit" INT
wait
