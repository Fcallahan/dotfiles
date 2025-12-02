#!/bin/bash
# WSL browser launcher for Copilot authentication
if command -v wslview &> /dev/null; then
    wslview "$1"
elif [ -n "$WSL_INTEROP" ]; then
    powershell.exe -NoProfile -Command "Start-Process '$1'"
else
    echo "Could not open browser. Please manually visit: $1"
fi
