# Antigravity Live Task Progress Status Bar Extension

A high-performance, real-time live task progress tracker and telemetry HUD for the Google Antigravity Agent.

## Features
- **Live Status Bar Visualizer**: Real-time ASCII progress bar (`[████████░░] 80%`), animated spinner, and step status indicator.
- **Rich Markdown Tooltip**: Hovering over the status bar item displays current task title, step ratio, active tool, and dynamic objective checklist.
- **Interactive QuickPick Dashboard**: Click to inspect objectives, step details, and perform instant reset/file inspection actions.
- **Multi-Source Telemetry Sync**: Real-time synchronization via workspace `.agents/task_progress.json`, global state, and ultra-low latency local IPC socket.
- **Crashproof & Hangproof**: Non-blocking async I/O with fault-tolerant fallbacks.

## Configuration
- `antigravity.progress.barLength`: Length of the progress bar (default: 10).
- `antigravity.progress.showToolName`: Display current tool/action in status bar (default: true).
- `antigravity.progress.alignment`: "left" or "right" status bar placement (default: "left").
- `antigravity.progress.priority`: Status bar priority order (default: 100).
