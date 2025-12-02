# Dotfiles

Personal dotfiles for WSL development environment, optimized for .NET/C# development.

## Quick Start

```bash
# Clone the repo
git clone https://github.com/Fcallahan/dotfiles.git ~/dotfiles

# Run the install script
cd ~/dotfiles
chmod +x install.sh
./install.sh
```

## What's Included

### Shell (zsh)
- **Oh My Zsh** with plugins: git, zsh-autosuggestions, zsh-syntax-highlighting, dotnet, docker
- Custom aliases for .NET development, git, and PR management
- Functions: `mkpr`, `runbr`, `rune2api`, `runworker`, `dotnet-launch`
- **zoxide** for smart directory navigation

### Prompt
- **Starship** cross-shell prompt with git status, .NET version, and more

### Terminal Multiplexer
- **tmux** with Catppuccin theme
- vim-tmux-navigator for seamless pane switching
- TPM plugin manager with tmux-resurrect, tmux-yank

### Git Tools
- **delta** for beautiful side-by-side diffs
- **lazygit** TUI with delta integration
- **gh-dash** for PR management with custom keybindings

### Scripts
| Script | Description |
|--------|-------------|
| `gh-pr-worktree` | Checkout PR in git worktree + open in Neovim |
| `lazygit-wsl` | WSL wrapper for lazygit TTY fixes |
| `browser-launcher.sh` | WSL browser launcher for auth flows |

## Dependencies

Install before running install.sh:

```bash
# Ubuntu/Debian
sudo apt install zsh tmux git neovim fzf

# Install Oh My Zsh
sh -c "$(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"

# Zsh plugins
git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions
git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting

# Starship prompt
curl -sS https://starship.rs/install.sh | sh

# zoxide
curl -sSfL https://raw.githubusercontent.com/ajeetdsouza/zoxide/main/install.sh | sh

# delta (git pager)
# Download from: https://github.com/dandavison/delta/releases

# lazygit
# Download from: https://github.com/jesseduffield/lazygit/releases

# GitHub CLI
# See: https://github.com/cli/cli/blob/trunk/docs/install_linux.md

# gh-dash extension
gh extension install dlvhdr/gh-dash

# TPM (Tmux Plugin Manager)
git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
```

## Post-Installation

1. **Restart your shell** or run `source ~/.zshrc`
2. **Install tmux plugins**: Open tmux, press `Ctrl-s` then `I`
3. **Clone nvim config**: `git clone https://github.com/Fcallahan/nvim-config.git ~/.config/nvim`

## Directory Structure

```
dotfiles/
├── README.md
├── install.sh
├── zsh/
│   └── .zshrc
├── tmux/
│   └── .tmux.conf
├── git/
│   └── .gitconfig
├── starship/
│   └── starship.toml
├── lazygit/
│   └── config.yml
├── gh-dash/
│   └── config.yml
└── scripts/
    ├── gh-pr-worktree
    ├── lazygit-wsl
    └── browser-launcher.sh
```

## Key Bindings

### tmux
| Key | Action |
|-----|--------|
| `Ctrl-s` | Prefix (instead of Ctrl-b) |
| `prefix + v` | Vertical split |
| `prefix + b` | Horizontal split |
| `Ctrl-h/j/k/l` | Navigate panes (vim-style) |
| `prefix + I` | Install plugins |

### gh-dash
| Key | Action |
|-----|--------|
| `d` | View diff (side-by-side with delta) |
| `W` | Checkout PR in worktree + open Neovim |
| `r` | Review PR |
| `o` | Open in browser |
| `m` | Merge PR |

### Shell Aliases
| Alias | Command |
|-------|---------|
| `src` | Reload zsh config |
| `gs` | git status |
| `gfp` | git fetch && git pull |
| `mkpr` | Push branch and create PR |
| `prlist` | List PRs |
| `propen` | Open PR in browser |

## Related

- [nvim-config](https://github.com/Fcallahan/nvim-config) - Neovim configuration
