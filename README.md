# Dotfiles

Personal WSL/Linux workstation setup with shell, tmux, git, CLI tools, and helper scripts.

This repo is designed so a fresh machine can reproduce the same terminal/dev environment quickly.

## Quick start

```bash
git clone https://github.com/Fcallahan/dotfiles.git ~/dotfiles
cd ~/dotfiles
chmod +x install.sh
./install.sh
```

The installer creates symlinks, backs up replaced files, and installs script entrypoints to `~/.local/bin`.

## What is managed

### Core dotfiles
- `zsh/.zshrc`
- `zsh/.zshenv`
- `zsh/.p10k.zsh`
- `tmux/.tmux.conf`
- `git/.gitconfig`
- `git/ignore`
- `bash/.bashrc`
- `bash/.profile`
- `ideavim/.ideavimrc`
- `wsl/.wslgrc`

### Tool config (`~/.config`)
- `starship/starship.toml`
- `lazygit/config.yml`
- `lazydocker/config.yml`
- `gh-dash/config.yml`
- `gh/config.yml`
- `gh-news/config.toml`

### Scripts (`~/.local/bin`)
- `scripts/browser-launcher.sh`
- `scripts/lazygit-wsl`
- `scripts/gh-pr-worktree`
- `scripts/gh-pr-review`
- `scripts/gh-notification-count`
- `scripts/gh-notification-watch`
- `scripts/theme-switch`
- `scripts/theme-starship`
- `scripts/theme-powerlevel10k`
- `scripts/apply-local-patch`
- `scripts/rider`
- `scripts/clone-wt`
- `scripts/tmuxwindownizer`

### Oh My Zsh custom
- `zsh/oh-my-zsh-custom/git-worktree-completions.zsh`

## Secrets and private data

Sensitive values are intentionally not tracked in git.

- `zsh/.zshrc.local` is ignored and loaded by `.zshrc`.
- Use `zsh/.zshrc.local.example` as the template for API keys/tokens.
- `gh/hosts.yml` is ignored (contains GitHub auth tokens).

Create your local secrets file after install:

```bash
cp ~/dotfiles/zsh/.zshrc.local.example ~/.zshrc.local
```

## Neovim config strategy

Neovim config stays in a separate repository:

- Repo: `https://github.com/Fcallahan/nvim-config.git`
- Target path: `~/.config/nvim`
- `install.sh` clones it automatically if it does not exist.

## First machine bootstrap

Install base dependencies first:

```bash
sudo apt update
sudo apt install -y zsh tmux git neovim fzf jq
```

Recommended extras:

```bash
# Oh My Zsh
sh -c "$(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"

# Zsh plugins
git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions
git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting

# Powerlevel10k
git clone --depth=1 https://github.com/romkatv/powerlevel10k.git ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/themes/powerlevel10k

# TPM (tmux plugin manager)
git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm

# gh-dash extension
gh extension install dlvhdr/gh-dash
```

## Post-install checks

```bash
source ~/.zshrc
tmux
# then press prefix + I
```

If you use multiple GitHub accounts, verify the active one before pushing:

```bash
gh auth status
gh auth switch -h github.com -u Fcallahan
```

## Notes

- Installer backups are written to `~/.dotfiles-backup-<timestamp>`.
- This setup is optimized for WSL + .NET/C# workflows and PR-heavy GitHub usage.
