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

### Dictation cleanup
- `dictation/cleanup-dictation` — WSL cleanup script for Windows Voice Typing text.
- `dictation/replacements.tsv` — editable speech-to-text replacement dictionary.
- `dictation/vocabulary.txt` — editable work vocabulary for LLM cleanup prompts.
- `windows/dictation-cleanup.ahk` — AutoHotkey v2 popup and paste workflow.

See `dictation/README.md` for setup and usage.

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

## New machine checklist (Ubuntu/WSL)

Run these commands on a fresh machine to get this dotfiles setup working out of the box.

### 1) Install base packages

```bash
sudo apt update
sudo apt install -y \
  curl wget git zsh tmux neovim fzf jq \
  ca-certificates gnupg lsb-release unzip
```

### 2) Install GitHub CLI (gh)

```bash
sudo mkdir -p -m 755 /etc/apt/keyrings
wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | \
  sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | \
  sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
sudo apt update
sudo apt install -y gh
```

### 3) Install prompt + navigation tools

```bash
# Starship prompt
curl -sS https://starship.rs/install.sh | sh -s -- -y

# zoxide
curl -sSfL https://raw.githubusercontent.com/ajeetdsouza/zoxide/main/install.sh | sh
```

### 4) Install delta + lazygit

```bash
# delta (git pager)
sudo apt install -y git-delta || true

# lazygit (latest release)
LAZYGIT_VERSION=$(curl -s "https://api.github.com/repos/jesseduffield/lazygit/releases/latest" | jq -r .tag_name | sed 's/^v//')
curl -Lo lazygit.tar.gz "https://github.com/jesseduffield/lazygit/releases/latest/download/lazygit_${LAZYGIT_VERSION}_Linux_x86_64.tar.gz"
tar xf lazygit.tar.gz lazygit
sudo install lazygit /usr/local/bin
rm -f lazygit lazygit.tar.gz
```

### 5) Install Oh My Zsh + plugins + tmux plugin manager

```bash
# Oh My Zsh
sh -c "$(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"

# Plugins
git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions
git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting

# Theme used by .p10k.zsh
git clone --depth=1 https://github.com/romkatv/powerlevel10k.git ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/themes/powerlevel10k

# tmux plugin manager
git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
```

### 6) Clone dotfiles and run installer

```bash
git clone https://github.com/Fcallahan/dotfiles.git ~/dotfiles
cd ~/dotfiles
chmod +x install.sh
./install.sh
```

### 7) Authenticate GitHub + install gh-dash extension

```bash
gh auth login
gh extension install dlvhdr/gh-dash
gh auth switch -h github.com -u Fcallahan
```

### 8) Final post-install commands

```bash
cp ~/dotfiles/zsh/.zshrc.local.example ~/.zshrc.local
$EDITOR ~/.zshrc.local

chsh -s "$(which zsh)"
source ~/.zshrc

# install tmux plugins non-interactively
~/.tmux/plugins/tpm/bin/install_plugins
```

After this, open a new terminal session and your shell/tmux/git/tooling should match this setup.

If you use multiple GitHub accounts, verify the active one before pushing:

```bash
gh auth status
gh auth switch -h github.com -u Fcallahan
```

## Notes

- Installer backups are written to `~/.dotfiles-backup-<timestamp>`.
- This setup is optimized for WSL + .NET/C# workflows and PR-heavy GitHub usage.
