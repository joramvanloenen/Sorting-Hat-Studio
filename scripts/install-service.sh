#!/usr/bin/env bash
set -euo pipefail
if [[ "$EUID" -ne 0 ]]; then echo 'Run with: sudo bash scripts/install-service.sh' >&2; exit 1; fi
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OWNER="${SUDO_USER:-}"
if [[ -z "$OWNER" || "$OWNER" == root ]]; then echo 'Invoke sudo from the Pi user account, not a root shell.' >&2; exit 1; fi
PIGPIOD="$(command -v pigpiod || true)"
if [[ -z "$PIGPIOD" ]]; then echo 'pigpiod not found. See README for Bookworm/Trixie installation.' >&2; exit 1; fi
systemctl disable --now pigpiod.service 2>/dev/null || true
cat >/etc/systemd/system/sorting-hat-pigpio.service <<EOF
[Unit]
Description=Servo timing daemon (PWM clock, leaving PCM for I2S)
After=local-fs.target
[Service]
Type=simple
ExecStart=${PIGPIOD} -g -t 0 -l
Restart=on-failure
[Install]
WantedBy=multi-user.target
EOF
cat >/etc/systemd/system/sorting-hat.service <<EOF
[Unit]
Description=Sorting Hat Studio web editor and ceremony controller
Requires=sorting-hat-pigpio.service
After=network.target sound.target sorting-hat-pigpio.service
[Service]
Type=simple
User=${OWNER}
WorkingDirectory=${PROJECT_DIR}
ExecStart=/usr/bin/python3 ${PROJECT_DIR}/server.py --hardware --host 0.0.0.0 --port 8080
Restart=on-failure
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now sorting-hat-pigpio.service
systemctl enable --now sorting-hat.service
echo 'Installed. Check: sudo systemctl status sorting-hat'
echo 'Open http://<PI_IP>:8080 on the same trusted Wi-Fi.'
