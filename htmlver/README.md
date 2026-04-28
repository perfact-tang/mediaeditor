# MediaSplitter AI Static HTML Version

This version runs from `index.html` with no Node server.

What it can do:

- Load video/audio in the browser
- Preview playback
- Set Start/End ranges
- Manage segment list
- Choose video/audio output settings
- Download a JSON file that contains the segment list and FFmpeg commands

Limit:

- A browser-only static file cannot execute local FFmpeg or write split media files directly.
- Use the generated commands in a terminal, or use the Node version in the project root for actual splitting.

