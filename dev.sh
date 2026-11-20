
#!/usr/bin/env bash

UUID="barstickynotes@oliver"

dbus-run-session -- bash -c '
    gnome-shell --devkit --wayland &
    SHELL_PID=$!

    sleep 3
    gnome-extensions enable barstickynotes@oliver

    wait "$SHELL_PID"
'
