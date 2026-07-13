#!/usr/bin/env bash

set -euo pipefail

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

    if [ ! -e "$src" ]; then
        print_warning "Skipping missing source: $src"
        return
    fi

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

print_info "Creating symlinks..."

LINKS=(
    "zsh/.zshrc:$HOME/.zshrc"
    "zsh/.zshenv:$HOME/.zshenv"
    "zsh/.p10k.zsh:$HOME/.p10k.zsh"
    "zsh/oh-my-zsh-custom/git-worktree-completions.zsh:$HOME/.oh-my-zsh/custom/git-worktree-completions.zsh"
    "tmux/.tmux.conf:$HOME/.tmux.conf"
    "git/.gitconfig:$HOME/.gitconfig"
    "git/ignore:$HOME/.config/git/ignore"
    "starship/starship.toml:$HOME/.config/starship.toml"
    "lazygit/config.yml:$HOME/.config/lazygit/config.yml"
    "lazydocker/config.yml:$HOME/.config/lazydocker/config.yml"
    "gh-dash/config.yml:$HOME/.config/gh-dash/config.yml"
    "gh/config.yml:$HOME/.config/gh/config.yml"
    "gh-news/config.toml:$HOME/.config/gh-news/config.toml"
    "herdr/config.toml:$HOME/.config/herdr/config.toml"
    "ideavim/.ideavimrc:$HOME/.ideavimrc"
    "wsl/.wslgrc:$HOME/.wslgrc"
    "bash/.bashrc:$HOME/.bashrc"
    "bash/.profile:$HOME/.profile"
    "pi/agent/settings.json:$HOME/.pi/agent/settings.json"
    "pi/agent/keybindings.json:$HOME/.pi/agent/keybindings.json"
    "pi/agent/APPEND_SYSTEM.md:$HOME/.pi/agent/APPEND_SYSTEM.md"
    "pi/agent/models.json:$HOME/.pi/agent/models.json"
    "pi/agent/themes:$HOME/.pi/agent/themes"
    "pi/agent/zentui.json:$HOME/.pi/agent/zentui.json"
    "pi/agent/extensions/workflow:$HOME/.pi/agent/extensions/workflow"
    "pi/agent/extensions/plan-build:$HOME/.pi/agent/extensions/plan-build"
    "pi/agent/extensions/command-palette:$HOME/.pi/agent/extensions/command-palette"
    "pi/agent/extensions/dynamic-workflow-ux:$HOME/.pi/agent/extensions/dynamic-workflow-ux"
    "pi/agent/extensions/question:$HOME/.pi/agent/extensions/question"
    "pi/agent/extensions/progress:$HOME/.pi/agent/extensions/progress"
    "pi/agent/extensions/nvim-review:$HOME/.pi/agent/extensions/nvim-review"
    "pi/agent/extensions/openrouter-deepseek-only.ts:$HOME/.pi/agent/extensions/openrouter-deepseek-only.ts"
    "pi/agent/prompts:$HOME/.pi/agent/prompts"
    "pi/agent/skills/dynamic-workflows:$HOME/.pi/agent/skills/dynamic-workflows"
    "pi/agent/workflows:$HOME/.pi/agent/workflows"
)

for mapping in "${LINKS[@]}"; do
    src_rel="${mapping%%:*}"
    dest="${mapping#*:}"
    backup_and_link "$DOTFILES_DIR/$src_rel" "$dest"
done

print_info "Installing scripts to ~/.local/bin/..."
mkdir -p "$HOME/.local/bin"
for script in "$DOTFILES_DIR/scripts/"*; do
    if [ -f "$script" ]; then
        name="$(basename "$script")"
        backup_and_link "$script" "$HOME/.local/bin/$name"
        chmod +x "$HOME/.local/bin/$name"
    fi
done

if [ -f "$DOTFILES_DIR/zsh/.zshrc.local.example" ] && [ ! -f "$HOME/.zshrc.local" ]; then
    cp "$DOTFILES_DIR/zsh/.zshrc.local.example" "$HOME/.zshrc.local"
    print_warning "Created ~/.zshrc.local from template. Add your secrets there."
fi

NVIM_REPO_URL="https://github.com/Fcallahan/nvim-config.git"
if [ ! -d "$HOME/.config/nvim/.git" ]; then
    print_info "Cloning Neovim config..."
    git clone "$NVIM_REPO_URL" "$HOME/.config/nvim"
    print_success "Cloned Neovim config to ~/.config/nvim"
else
    print_info "Neovim config already exists at ~/.config/nvim (left unchanged)."
fi

PI_EXTENSIONS_REPO_URL="https://github.com/tmustier/pi-extensions.git"
if [ ! -e "$HOME/pi-extensions" ]; then
    print_info "Cloning Pi files-widget extensions..."
    git clone "$PI_EXTENSIONS_REPO_URL" "$HOME/pi-extensions"
    print_success "Cloned Pi extensions to ~/pi-extensions"
else
    print_info "Pi extensions already exist at ~/pi-extensions (left unchanged)."
fi

echo ""
print_info "Checking dependencies..."

MISSING_DEPS=()
command -v zsh >/dev/null 2>&1 || MISSING_DEPS+=("zsh")
command -v tmux >/dev/null 2>&1 || MISSING_DEPS+=("tmux")
command -v git >/dev/null 2>&1 || MISSING_DEPS+=("git")
command -v nvim >/dev/null 2>&1 || MISSING_DEPS+=("neovim")
command -v starship >/dev/null 2>&1 || MISSING_DEPS+=("starship")
command -v lazygit >/dev/null 2>&1 || MISSING_DEPS+=("lazygit")
command -v gh >/dev/null 2>&1 || MISSING_DEPS+=("gh (GitHub CLI)")
command -v delta >/dev/null 2>&1 || MISSING_DEPS+=("delta (git-delta)")
command -v zoxide >/dev/null 2>&1 || MISSING_DEPS+=("zoxide")
command -v fzf >/dev/null 2>&1 || MISSING_DEPS+=("fzf")
command -v jq >/dev/null 2>&1 || MISSING_DEPS+=("jq")
command -v pi >/dev/null 2>&1 || MISSING_DEPS+=("pi")

if [ ${#MISSING_DEPS[@]} -gt 0 ]; then
    print_warning "Missing dependencies:"
    for dep in "${MISSING_DEPS[@]}"; do
        echo "  - $dep"
    done
    echo ""
fi

if [ ! -d "$HOME/.oh-my-zsh" ]; then
    print_warning "Oh My Zsh not installed"
    echo "  Install: sh -c \"\$(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh)\""
fi

if [ ! -d "$HOME/.oh-my-zsh/custom/plugins/zsh-autosuggestions" ]; then
    print_warning "zsh-autosuggestions not installed"
    echo "  Install: git clone https://github.com/zsh-users/zsh-autosuggestions \${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions"
fi

if [ ! -d "$HOME/.oh-my-zsh/custom/plugins/zsh-syntax-highlighting" ]; then
    print_warning "zsh-syntax-highlighting not installed"
    echo "  Install: git clone https://github.com/zsh-users/zsh-syntax-highlighting.git \${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting"
fi

if [ ! -d "$HOME/.oh-my-zsh/custom/themes/powerlevel10k" ]; then
    print_warning "powerlevel10k theme not installed"
    echo "  Install: git clone --depth=1 https://github.com/romkatv/powerlevel10k.git \${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/powerlevel10k"
fi

if [ ! -d "$HOME/.tmux/plugins/tpm" ]; then
    print_warning "TPM (Tmux Plugin Manager) not installed"
    echo "  Install: git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm"
    echo "  Then press prefix + I in tmux to install plugins"
fi

if command -v gh >/dev/null 2>&1; then
    if ! gh extension list 2>/dev/null | grep -q "dlvhdr/gh-dash"; then
        print_warning "gh-dash extension not installed"
        echo "  Install: gh extension install dlvhdr/gh-dash"
    fi
fi

echo ""
print_success "Dotfiles installation complete!"
echo ""
print_info "Next steps:"
echo "  1. Add secrets to ~/.zshrc.local"
echo "  2. Restart your shell or run: source ~/.zshrc"
echo "  3. In tmux, press prefix + I to install plugins"
echo ""

if [ -d "$BACKUP_DIR" ]; then
    print_info "Backups saved to: $BACKUP_DIR"
fi
