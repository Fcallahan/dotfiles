#!/bin/bash

# Dotfiles Installation Script
# This script creates symlinks and installs dependencies for a new machine setup

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[OK]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$HOME/.dotfiles-backup-$(date +%Y%m%d-%H%M%S)"

backup_and_link() {
    local src="$1"
    local dest="$2"

    if [ -e "$dest" ] && [ ! -L "$dest" ]; then
        mkdir -p "$BACKUP_DIR"
        print_warning "Backing up existing $dest to $BACKUP_DIR/"
        mv "$dest" "$BACKUP_DIR/"
    elif [ -L "$dest" ]; then
        rm "$dest"
    fi

    mkdir -p "$(dirname "$dest")"
    ln -sf "$src" "$dest"
    print_success "Linked $dest -> $src"
}

print_info "Starting dotfiles installation..."
echo ""

# Create symlinks
print_info "Creating symlinks..."

backup_and_link "$DOTFILES_DIR/zsh/.zshrc" "$HOME/.zshrc"
backup_and_link "$DOTFILES_DIR/tmux/.tmux.conf" "$HOME/.tmux.conf"
backup_and_link "$DOTFILES_DIR/git/.gitconfig" "$HOME/.gitconfig"
backup_and_link "$DOTFILES_DIR/starship/starship.toml" "$HOME/.config/starship.toml"
backup_and_link "$DOTFILES_DIR/lazygit/config.yml" "$HOME/.config/lazygit/config.yml"
backup_and_link "$DOTFILES_DIR/gh-dash/config.yml" "$HOME/.config/gh-dash/config.yml"

# Link scripts
print_info "Installing scripts to ~/.local/bin/..."
mkdir -p "$HOME/.local/bin"
for script in "$DOTFILES_DIR/scripts/"*; do
    if [ -f "$script" ]; then
        name=$(basename "$script")
        backup_and_link "$script" "$HOME/.local/bin/$name"
        chmod +x "$HOME/.local/bin/$name"
    fi
done

echo ""
print_info "Checking dependencies..."

# Check for required tools
MISSING_DEPS=()

command -v zsh &>/dev/null || MISSING_DEPS+=("zsh")
command -v tmux &>/dev/null || MISSING_DEPS+=("tmux")
command -v git &>/dev/null || MISSING_DEPS+=("git")
command -v nvim &>/dev/null || MISSING_DEPS+=("neovim")
command -v starship &>/dev/null || MISSING_DEPS+=("starship")
command -v lazygit &>/dev/null || MISSING_DEPS+=("lazygit")
command -v gh &>/dev/null || MISSING_DEPS+=("gh (GitHub CLI)")
command -v delta &>/dev/null || MISSING_DEPS+=("delta (git-delta)")
command -v zoxide &>/dev/null || MISSING_DEPS+=("zoxide")
command -v fzf &>/dev/null || MISSING_DEPS+=("fzf")

if [ ${#MISSING_DEPS[@]} -gt 0 ]; then
    print_warning "Missing dependencies:"
    for dep in "${MISSING_DEPS[@]}"; do
        echo "  - $dep"
    done
    echo ""
fi

# Check for Oh My Zsh
if [ ! -d "$HOME/.oh-my-zsh" ]; then
    print_warning "Oh My Zsh not installed"
    echo "  Install: sh -c \"\$(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh)\""
fi

# Check for zsh plugins
if [ ! -d "$HOME/.oh-my-zsh/custom/plugins/zsh-autosuggestions" ]; then
    print_warning "zsh-autosuggestions not installed"
    echo "  Install: git clone https://github.com/zsh-users/zsh-autosuggestions \${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions"
fi

if [ ! -d "$HOME/.oh-my-zsh/custom/plugins/zsh-syntax-highlighting" ]; then
    print_warning "zsh-syntax-highlighting not installed"
    echo "  Install: git clone https://github.com/zsh-users/zsh-syntax-highlighting.git \${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting"
fi

# Check for TPM (Tmux Plugin Manager)
if [ ! -d "$HOME/.tmux/plugins/tpm" ]; then
    print_warning "TPM (Tmux Plugin Manager) not installed"
    echo "  Install: git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm"
    echo "  Then press prefix + I in tmux to install plugins"
fi

# Check for gh-dash
if ! command -v gh &>/dev/null || ! gh extension list 2>/dev/null | grep -q "dlvhdr/gh-dash"; then
    print_warning "gh-dash extension not installed"
    echo "  Install: gh extension install dlvhdr/gh-dash"
fi

echo ""
print_success "Dotfiles installation complete!"
echo ""
print_info "Next steps:"
echo "  1. Install any missing dependencies listed above"
echo "  2. Restart your shell or run: source ~/.zshrc"
echo "  3. In tmux, press prefix + I to install plugins"
echo "  4. Clone nvim config: git clone https://github.com/Fcallahan/nvim-config.git ~/.config/nvim"
echo ""

if [ -d "$BACKUP_DIR" ]; then
    print_info "Backups saved to: $BACKUP_DIR"
fi
