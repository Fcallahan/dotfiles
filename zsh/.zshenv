. "$HOME/.cargo/env"

# Trust Netskope TLS inspection CA (Node-based tools like Claude Code)
export NODE_EXTRA_CA_CERTS="$HOME/certs/netskope.pem"

# WSL VirtioProxy needs explicit listener ports for reliable localhost forwarding.
if [ -n "${WSL_DISTRO_NAME:-}" ]; then
    export PLANNOTATOR_PORT="${PLANNOTATOR_PORT:-19432-19559}"
fi

# Netskope proxy for WSL (see ~/.config/wsl-proxy/env.sh)
[ -f "$HOME/.config/wsl-proxy/env.sh" ] && . "$HOME/.config/wsl-proxy/env.sh"
