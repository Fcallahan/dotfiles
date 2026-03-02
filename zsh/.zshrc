# Enable Powerlevel10k instant prompt. Should stay close to the top of ~/.zshrc.
if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi


# Load zoxide if not disabled
if [ -z "$DISABLE_ZOXIDE" ]; then
    eval "$(zoxide init zsh)"
fi


# Add to ~/.zshrc
autoload -Uz compinit
compinit
zstyle ':completion:*' matcher-list 'm:{a-z}={A-Z}'

# Path to your Oh My Zsh installation.
export ZSH="$HOME/.oh-my-zsh"

# Confluence environment variables
export CONFLUENCE_EMAIL="francis.callahan@emsmc.com"
export CONFLUENCE_SITE="emsmc1.atlassian.net"

  export CONFLUENCE_SPACE_ID="3832709162" # Franks
  export CONFLUENCE_PARENT_PAGE_ID="3832709489" # Franks
 # export CONFLUENCE_SPACE_ID="3413835784" # EMServices
 # export CONFLUENCE_PARENT_PAGE_ID="3801939973" # Emservices

# Local secrets and machine-specific overrides
if [ -f "$HOME/.zshrc.local" ]; then
    source "$HOME/.zshrc.local"
fi

# Set name of the theme to load
# ZSH_THEME="powerlevel10k/powerlevel10k" # Disabled for Starship

# Plugins to load
plugins=(
    git
    zsh-autosuggestions
    zsh-syntax-highlighting
    dotnet
    colored-man-pages
    command-not-found
   # docker
)

# Load Oh My Zsh
source $ZSH/oh-my-zsh.sh

# ===== ENVIRONMENT CONFIGURATION =====
export EDITOR="nvim"
export VISUAL="nvim"
export DOTNET_CLI_TELEMETRY_OPTOUT=1

# Custom LS_COLORS - better directory colors
export LS_COLORS="rs=0:di=01;36:ln=01;36:mh=00:pi=40;33:so=01;35:do=01;35:bd=40;33;01:cd=40;33;01:or=40;31;01:mi=00:su=37;41:sg=30;43:ca=00:tw=01;37:ow=01;37:st=37;44:ex=01;32:*.tar=01;31:*.tgz=01;31:*.arc=01;31:*.arj=01;31:*.taz=01;31:*.lha=01;31:*.lz4=01;31:*.lzh=01;31:*.lzma=01;31:*.tlz=01;31:*.txz=01;31:*.tzo=01;31:*.t7z=01;31:*.zip=01;31:*.z=01;31:*.dz=01;31:*.gz=01;31:*.lrz=01;31:*.lz=01;31:*.lzo=01;31:*.xz=01;31:*.zst=01;31:*.tzst=01;31:*.bz2=01;31:*.bz=01;31:*.tbz=01;31:*.tbz2=01;31:*.tz=01;31:*.deb=01;31:*.rpm=01;31:*.jar=01;31:*.war=01;31:*.ear=01;31:*.sar=01;31:*.rar=01;31:*.alz=01;31:*.ace=01;31:*.zoo=01;31:*.cpio=01;31:*.7z=01;31:*.rz=01;31:*.cab=01;31:*.wim=01;31:*.swm=01;31:*.dwm=01;31:*.esd=01;31:*.avif=01;35:*.jpg=01;35:*.jpeg=01;35:*.mjpg=01;35:*.mjpeg=01;35:*.gif=01;35:*.bmp=01;35:*.pbm=01;35:*.pgm=01;35:*.ppm=01;35:*.tga=01;35:*.xbm=01;35:*.xpm=01;35:*.tif=01;35:*.tiff=01;35:*.png=01;35:*.svg=01;35:*.svgz=01;35:*.mng=01;35:*.pcx=01;35:*.mov=01;35:*.mpg=01;35:*.mpeg=01;35:*.m2v=01;35:*.mkv=01;35:*.webm=01;35:*.webp=01;35:*.ogm=01;35:*.mp4=01;35:*.m4v=01;35:*.mp4v=01;35:*.vob=01;35:*.qt=01;35:*.nuv=01;35:*.wmv=01;35:*.asf=01;35:*.rm=01;35:*.rmvb=01;35:*.flc=01;35:*.avi=01;35:*.fli=01;35:*.flv=01;35:*.gl=01;35:*.dl=01;35:*.xcf=01;35:*.xwd=01;35:*.yuv=01;35:*.cgm=01;35:*.emf=01;35:*.ogv=01;35:*.ogx=01;35:*.aac=00;36:*.au=00;36:*.flac=00;36:*.m4a=00;36:*.mid=00;36:*.midi=00;36:*.mka=00;36:*.mp3=00;36:*.mpc=00;36:*.ogg=00;36:*.ra=00;36:*.wav=00;36:*.oga=00;36:*.opus=00;36:*.spx=00;36:*.xspf=00;36:*~=00;90:*#=00;90:*.bak=00;90:*.crdownload=00;90:*.dpkg-dist=00;90:*.dpkg-new=00;90:*.dpkg-old=00;90:*.dpkg-tmp=00;90:*.old=00;90:*.orig=00;90:*.part=00;90:*.rej=00;90:*.rpmnew=00;90:*.rpmorig=00;90:*.rpmsave=00;90:*.swp=00;90:*.tmp=00;90:*.ucf-dist=00;90:*.ucf-new=00;90:*.ucf-old=00;90:"

# ===== PATH CONFIGURATION =====
# Clean PATH setup - no duplications
export PATH="$HOME/.local/bin:$PATH"
export PATH="$HOME/.dotnet/tools:$PATH"
export PATH="/snap/bin:$PATH"

# Prefer user .NET install (has all SDKs); fall back to system.
if [[ -d "$HOME/.dotnet" ]]; then
    export DOTNET_ROOT="$HOME/.dotnet"
elif [[ -d "/usr/lib/dotnet" ]]; then
    export DOTNET_ROOT="/usr/lib/dotnet"
elif [[ -d "/usr/share/dotnet" ]]; then
    export DOTNET_ROOT="/usr/share/dotnet"
fi

if [[ -n "$DOTNET_ROOT" ]]; then
    export PATH="$DOTNET_ROOT:$PATH"
fi

# Windows paths (for WSL)
if [[ -d "/mnt/c" ]]; then
    export PATH="/c/Users/Francis.Callahan/.local/bin:$PATH"
    export PATH="/c/Program Files/Neovim/bin:$PATH"
    export PATH="/c/Program Files/Microsoft VS Code/bin:$PATH"
    export PATH="/c/Program Files/nodejs:$PATH"
    export PATH="/c/Users/Francis.Callahan/AppData/Roaming/npm:$PATH"
fi

# Update rider function in ~/.zshrc
# Update ~/.zshrc rider function
rider() {
   export _JAVA_AWT_WM_NONREPARENTING=1
   openbox &
   sleep 1
   ~/jetbrains/rider/bin/rider.sh "$(pwd)" &
}

# ===== SHELL OPTIONS =====
# Case-insensitive globbing
setopt NOCASEGLOB
# Auto cd when entering directory path
setopt AUTO_CD
# Better history
setopt APPEND_HISTORY
setopt SHARE_HISTORY
setopt HIST_IGNORE_DUPS
setopt HIST_IGNORE_ALL_DUPS
setopt HIST_IGNORE_SPACE
setopt HIST_SAVE_NO_DUPS
setopt HIST_VERIFY
setopt INC_APPEND_HISTORY

# History settings
HISTSIZE=10000
SAVEHIST=10000
HISTFILE=~/.zsh_history

# ===== ALIASES =====
# System shortcuts
alias src="source ~/.zshrc && echo 'Zsh configuration reloaded!'"
alias shell="nvim ~/.zshrc"
alias cls="clear"
alias oc="opencode"
alias ll="ls -lat"
alias la="ls -la"
alias l="ls -l"
alias md="mkdir -p"
alias rd="rmdir"
alias cde2="cd ~/code/Work/EMSmart2.0/"
alias cdE2="cd ~/code/Work/EMSmart2.0/"
alias cdbr="cd ~/code/Work/BR"
alias cdBR="cd ~/code/Work/BR"
alias cd='z'  # Use zoxide for cd


# Git shortcuts
alias lg="lazygit"
alias gs="git status"
alias ga="git add"
alias gc="git commit"
alias gp="git push"
alias gl="git log --oneline"
alias gd="git diff"
alias gfp="git fetch && git pull"
alias gitsubmodules="git submodule update --recursive"

# PR management shortcuts
alias prlist="gh pr list --json number,title,author,state,headRefName --template '{{tablerow \"NUMBER\" \"TITLE\" \"AUTHOR\" \"STATUS\" \"BRANCH\"}}{{range .}}{{tablerow (printf \"#%v\" .number) .title .author.login .state .headRefName}}{{end}}'"
alias prview="gh pr view"
alias propen="gh pr view --web"
alias prcreate="gh pr create"
alias prcheck="gh pr checks"
alias prmerge="mergepr"

# GitHub account management
alias ghstatus="gh auth status"
alias ghswitch="gh auth switch"
alias ghlogin="gh auth login"

# GitHub notifications
alias ghnotify="gh notify"
alias ghnews="gh news"
alias ghnotif="gh api notifications --jq '.[] | {title: .subject.title, type: .subject.type, reason: .reason, updated: .updated_at}'"
alias ghnotifcount="gh api notifications --jq 'length'"
alias ghnotifclear="gh api -X PUT notifications"  # Mark all as read (use carefully!)

# Local development patch application
alias patchlocal="~/.local/bin/apply-local-patch"

# Git worktree helpers
alias wtls="git worktree list"

# Enhanced worktree removal with interactive selection and smart handling
# Usage:
#   wtrm           - Remove current worktree (interactive confirmation)
#   wtrm <path>    - Remove specific worktree by path
#   wtrm -i        - Interactive fzf selection
unalias wtrm 2>/dev/null  # Remove alias if it exists
wtrm() {
    # Helper function to check if worktree is dirty
    _is_worktree_dirty() {
        local wt_path="$1"
        if [[ ! -d "$wt_path" ]]; then
            return 1
        fi

        # Check for uncommitted changes
        (cd "$wt_path" && ! git diff-index --quiet HEAD --) 2>/dev/null
    }

    # Helper function to get worktree path from current directory
    _get_current_worktree() {
        local current_dir=$(pwd)
        git worktree list --porcelain | grep -A 2 "^worktree" | while read -r line; do
            if [[ "$line" =~ ^worktree ]]; then
                local wt_path="${line#worktree }"
                if [[ "$current_dir" == "$wt_path"* ]]; then
                    echo "$wt_path"
                    return 0
                fi
            fi
        done
    }

    # Helper function to remove worktree with confirmation
    _remove_worktree() {
        local wt_path="$1"
        local is_current="$2"

        # Check if it's the main worktree
        if git rev-parse --is-inside-work-tree &>/dev/null; then
            local git_dir=$(git rev-parse --git-dir)
            local main_worktree=$(dirname "$git_dir")
            if [[ "$wt_path" == "$main_worktree" ]]; then
                echo "Error: Cannot remove main worktree"
                return 1
            fi
        fi

        # Check if worktree is dirty
        local needs_force=false
        if _is_worktree_dirty "$wt_path"; then
            echo "⚠️  Warning: Worktree has uncommitted changes"
            (cd "$wt_path" && git status --short)
            echo ""
            read -q "REPLY?Force remove anyway? (y/N): "
            echo ""
            if [[ ! "$REPLY" =~ ^[Yy]$ ]]; then
                echo "Cancelled"
                return 1
            fi
            needs_force=true
        fi

        # If we're in the worktree we're removing, cd out first
        if [[ "$is_current" == "true" ]]; then
            local git_dir=$(git rev-parse --git-dir 2>/dev/null)
            if [[ -n "$git_dir" ]]; then
                local is_bare=$(git rev-parse --is-bare-repository 2>/dev/null || echo "false")
                if [[ "$is_bare" == "true" ]]; then
                    cd "$git_dir"
                else
                    cd "$(dirname "$git_dir")"
                fi
            fi
        fi

        # Remove the worktree
        if [[ "$needs_force" == "true" ]]; then
            git worktree remove --force "$wt_path"
        else
            git worktree remove "$wt_path"
        fi

        if [[ $? -eq 0 ]]; then
            echo "✅ Removed worktree: $wt_path"
        else
            echo "❌ Failed to remove worktree: $wt_path"
            return 1
        fi
    }

    # Main logic
    if [[ -z "$1" ]]; then
        # No arguments - remove current worktree
        local current_wt=$(_get_current_worktree)

        if [[ -z "$current_wt" ]]; then
            echo "Error: Not in a worktree"
            echo "Usage: wtrm <path> or wtrm -i for interactive selection"
            return 1
        fi

        echo "Removing current worktree: $current_wt"
        _remove_worktree "$current_wt" "true"

    elif [[ "$1" == "-i" ]] || [[ "$1" == "--interactive" ]]; then
        # Interactive mode with fzf
        if ! command -v fzf &> /dev/null; then
            echo "Error: fzf not installed. Using simple selection."
            echo ""
            git worktree list
            echo ""
            read "wt_path?Enter worktree path to remove: "
            if [[ -n "$wt_path" ]]; then
                _remove_worktree "$wt_path" "false"
            fi
            return
        fi

        # Get list of worktrees (excluding main)
        local git_dir=$(git rev-parse --git-dir 2>/dev/null)
        if [[ -z "$git_dir" ]]; then
            echo "Error: Not in a git repository"
            return 1
        fi

        local selected=$(git worktree list --porcelain | \
            awk '/^worktree/ {path=$2} /^branch/ {branch=$2; print path " (" branch ")"} /^detached/ {print path " (detached HEAD)"}' | \
            fzf --prompt="Select worktree to remove: " \
                --preview='git -C {1} status --short 2>/dev/null || echo "No git status available"' \
                --preview-window=right:50% \
                --height=80%)

        if [[ -n "$selected" ]]; then
            local wt_path=$(echo "$selected" | awk '{print $1}')
            _remove_worktree "$wt_path" "false"
        else
            echo "Cancelled"
        fi

    else
        # Path provided - remove specific worktree
        local wt_path="$1"

        # Check if worktree exists
        if ! git worktree list | grep -q "$wt_path"; then
            echo "Error: Worktree not found: $wt_path"
            echo ""
            echo "Available worktrees:"
            git worktree list
            return 1
        fi

        # Check if we're currently in this worktree
        local current_wt=$(_get_current_worktree)
        local is_current="false"
        if [[ "$current_wt" == "$wt_path" ]] || [[ "$current_wt" == *"/$wt_path" ]] || [[ "$(pwd)" == "$wt_path"* ]]; then
            is_current="true"
        fi

        _remove_worktree "$wt_path" "$is_current"
    fi
}

# Helper function to update submodules in a worktree if .gitmodules exists
_update_worktree_submodules() {
    local wt_path="$1"
    if [[ -f "$wt_path/.gitmodules" ]]; then
        echo "📦 Updating submodules in '$wt_path'..."
        (cd "$wt_path" && git submodule update --init --recursive)
        if [[ $? -eq 0 ]]; then
            echo "✅ Submodules updated successfully"
        else
            echo "⚠️  Submodule update failed"
        fi
    fi
}

# wta <path> <remote-branch> - Detached HEAD at origin/branch
# Maps to: git worktree add foo origin/bar
wta() {
    if [[ -z "$1" ]] || [[ -z "$2" ]]; then
        echo "Usage: wta <path> <remote-branch>"
        echo "Creates worktree at origin/<branch> (DETACHED HEAD)"
        return 1
    fi
    git worktree add "$1" "origin/$2"
    echo "⚠️  Created worktree '$1' at origin/$2 (DETACHED HEAD)"
    _update_worktree_submodules "$1"
    cd "$1"
}

# wtl <path> <local-branch> - Attached to existing local branch
# Maps to: git worktree add foo bar
wtl() {
    if [[ -z "$1" ]] || [[ -z "$2" ]]; then
        echo "Usage: wtl <path> <local-branch>"
        echo "Creates worktree attached to existing local branch"
        return 1
    fi
    git worktree add "$1" "$2"
    echo "Created worktree '$1' attached to local branch '$2'"
    _update_worktree_submodules "$1"
    cd "$1"
}

# wtb <branch> <path> <start-point> - Create new branch tracking remote
# Maps to: git worktree add -b bar foo origin/bar
wtb() {
    if [[ -z "$1" ]] || [[ -z "$2" ]] || [[ -z "$3" ]]; then
        echo "Usage: wtb <new-branch> <path> <start-point>"
        echo "Creates worktree with new branch from start-point"
        echo "Example: wtb feature-x feature-x origin/main"
        return 1
    fi
    git worktree add -b "$1" "$2" "$3"
    echo "Created worktree '$2' with branch '$1' from '$3'"
    _update_worktree_submodules "$2"
    cd "$2"
}

# Convenience: create worktree + branch from origin/branch (most common for PRs)
# Usage: wtpr EMSVC-123
wtpr() {
    if [[ -z "$1" ]]; then
        echo "Usage: wtpr <branch-name>"
        echo "Fetches and creates worktree tracking origin/<branch>"
        return 1
    fi
    git fetch origin "$1"
    git worktree add -b "$1" "$1" "origin/$1"
    echo "Created worktree '$1' tracking origin/$1"
    _update_worktree_submodules "$1"
    cd "$1"
}

# Convenience: create worktree + new branch from specified base (defaults to main)
# Usage: wtnew <directory-name> [base-branch]
# Always uses origin/<branch> format for bare repository compatibility
# Works from both bare repos and worktrees
wtnew() {
    if [[ -z "$1" ]]; then
        echo "Usage: wtnew <directory-name> [base-branch]"
        echo "Creates worktree with new branch from origin/<base-branch>"
        echo "Default base-branch: main"
        echo "Works from both bare repos and worktrees"
        return 1
    fi

    local dir_name="$1"
    local base_branch="${2:-main}"
    local start_point="origin/${base_branch}"

    # Get git directory (works in bare and non-bare repos)
    local git_dir=$(git rev-parse --git-dir 2>/dev/null)

    if [[ -z "$git_dir" ]]; then
        echo "Error: Not in a git repository"
        return 1
    fi

    # Determine base directory for worktrees.
    # If the repo uses a .bare directory, use its parent as the base.
    local common_dir=$(git rev-parse --git-common-dir 2>/dev/null)
    local common_dir_abs="$common_dir"
    if [[ "$common_dir_abs" != /* ]]; then
        common_dir_abs="$(cd "$common_dir_abs" 2>/dev/null && pwd -P)" || common_dir_abs="$common_dir"
    fi

    local repo_base=""
    if [[ "$(basename "$common_dir_abs")" == ".bare" ]]; then
        repo_base="$(dirname "$common_dir_abs")"
    else
        repo_base="$(git rev-parse --show-toplevel 2>/dev/null)"
    fi

    if [[ -z "$repo_base" ]]; then
        repo_base="$PWD"
    fi

    # Convert relative path to absolute based on repo base
    if [[ "$dir_name" != /* ]]; then
        dir_name="${repo_base}/${dir_name}"
    fi

    # Fetch the latest from origin
    echo "Fetching origin/${base_branch}..."
    git fetch origin "$base_branch" 2>/dev/null || {
        echo "Warning: Could not fetch origin/${base_branch}"
        echo "Proceeding with existing remote ref..."
    }

    # Create the worktree
    git worktree add -b "$(basename "$dir_name")" "$dir_name" "$start_point" || {
        echo "Error: Failed to create worktree"
        return 1
    }

    echo "✅ Created worktree '$dir_name' with new branch from $start_point"
    _update_worktree_submodules "$dir_name"
    cd "$dir_name"
}

# Smart PR creation function with optional parameters
mkpr() {
    local branch=$(git branch --show-current)

    if [[ "$branch" == "main" ]] || [[ "$branch" == "master" ]]; then
        echo "❌ Error: Cannot create PR from main/master branch"
        return 1
    fi

    echo "🚀 Creating PR for branch: \033[1;36m$branch\033[0m"

    # Push branch first
    echo "📤 Pushing branch to remote..."
    git push -u origin "$branch"

    if [[ $? -ne 0 ]]; then
        echo "❌ Failed to push branch"
        return 1
    fi

    echo "✅ Branch pushed successfully"

    # Extract ticket number from branch (e.g., EMSVC-119, AM-18425, EMS-117, etc.)
    local ticket=$(echo "$branch" | grep -oE '[A-Z]+-[0-9]+' | head -1)

    # No parameters: open browser
    if [[ -z "$1" ]]; then
        echo "🌐 Opening browser to create PR..."
        gh pr create --web
        return 0
    fi

    # Parameters provided: create PR with title/body
    local title="$1"
    local body="${2:-}"

    # If ticket found and no body provided, add ticket reference
    if [[ -n "$ticket" ]] && [[ -z "$body" ]]; then
        body="Related to ticket: $ticket"
    fi

    echo "📝 Creating PR: \"$title\""

    if [[ -n "$body" ]]; then
        gh pr create --title "$title" --body "$body"
    else
        gh pr create --title "$title"
    fi
}

# Merge approved PR for current branch
mergepr() {
    local branch=$(git branch --show-current)

    # Get PR number for current branch
    echo "🔍 Looking for PR associated with branch: \033[1;36m$branch\033[0m"
    local pr_number=$(gh pr view --json number -q .number 2>/dev/null)

    if [[ -z "$pr_number" ]]; then
        echo "❌ Error: No PR found for current branch"
        echo "💡 Tip: Make sure you're on a branch with an open PR"
        return 1
    fi

    echo "📋 Found PR #$pr_number"

    # Check approval status
    local review_decision=$(gh pr view "$pr_number" --json reviewDecision -q .reviewDecision)

    if [[ "$review_decision" != "APPROVED" ]]; then
        echo "❌ Error: PR #$pr_number is not approved"
        echo "   Current status: ${review_decision:-PENDING}"
        echo "💡 Tip: Use 'gh pr view' to check PR details"
        return 1
    fi

    echo "✅ PR is approved"

    # Merge the PR using repo default method
    echo "🔀 Merging PR #$pr_number..."
    gh pr merge "$pr_number" --auto

    if [[ $? -eq 0 ]]; then
        echo "✅ PR #$pr_number merged successfully!"
    else
        echo "❌ Failed to merge PR #$pr_number"
        return 1
    fi
}

# .NET development commands
alias build="dotnet build"
alias run="dotnet run"
alias test="dotnet test"
alias restore="dotnet restore"
alias clean="dotnet clean"
alias seedrules="dotnet run --project src/EMServices.BillingRules -- --seed-rules"

# Navigation helpers  
alias ..="cd .."
alias ...="cd ../.."
alias home="cd ~"
alias cdwork="cd ~/code/Work"
alias cdworkwindows="cd /mnt/c/Work"
# go home on start

# ===== FUNCTIONS =====
# Quick directory creation and navigation
mkcd() {
    mkdir -p "$1" && cd "$1"
}

# Git commit with message
gitcommit() {
    git commit -m "$1"
}

# Find and kill process
fkill() {
    local pid
    pid=$(ps -ef | sed 1d | fzf -m | awk '{print $2}')
    if [ "x$pid" != "x" ]; then
        echo $pid | xargs kill -${1:-9}
    fi
}

# ===== STARTUP BEHAVIOR =====
# Always start in Work directory if it exists
if [[ -d "~/code/Work" ]]; then
    cd ~code/Work 2>/dev/null || cd ~
fi

# Load Powerlevel10k configuration
[[ ! -f ~/.p10k.zsh ]] || source ~/.p10k.zsh

# ===== COMPLETION ENHANCEMENTS =====
# Better completion
zstyle ':completion:*' menu select
zstyle ':completion:*' group-name ''
zstyle ':completion:*:descriptions' format '%B%d%b'
zstyle ':completion:*:warnings' format 'No matches for: %d'
zstyle ':completion:*' list-colors ${(s.:.)LS_COLORS}

# Case insensitive completion
zstyle ':completion:*' matcher-list 'm:{a-zA-Z}={A-Za-z}' 'r:|[._-]=* r:|=*' 'l:|=* r:|=*'
# ===== DOTNET LAUNCH CONFIGURATION LAUNCHER =====
# Interactive launcher for dotnet projects with launch configuration selection
dotnet-launch() {
    local project_dir="$1"

    if [[ -z "$project_dir" ]]; then
        echo "Usage: dotnet-launch <project-directory>"
        return 1
    fi

    if [[ ! -d "$project_dir" ]]; then
        echo "Error: Directory not found: $project_dir"
        return 1
    fi

    local launch_settings="$project_dir/Properties/launchSettings.json"

    if [[ ! -f "$launch_settings" ]]; then
        echo "Error: launchSettings.json not found in $project_dir/Properties/"
        return 1
    fi

    # Extract profile names from launchSettings.json
    local profiles=$(grep -oP '"\K[^"]+(?="\s*:\s*{)' "$launch_settings" | grep -v "^\$schema$\|^iisSettings$\|^profiles$\|^windowsAuthentication$\|^anonymousAuthentication$\|^iisExpress$\|^applicationUrl$\|^sslPort$\|^commandName$\|^launchBrowser$\|^environmentVariables$\|^ASPNETCORE_ENVIRONMENT$\|^DOTNET_ENVIRONMENT$")

    if [[ -z "$profiles" ]]; then
        echo "Error: No launch profiles found in $launch_settings"
        return 1
    fi

    # Use fzf for selection, fallback to simple menu if fzf not available
    local selected_profile
    if command -v fzf &> /dev/null; then
        selected_profile=$(echo "$profiles" | fzf --height=~40% --reverse --prompt="Select launch profile: ")
    else
        echo "Available profiles:"
        echo "$profiles" | nl
        echo -n "Select profile number: "
        read profile_num
        selected_profile=$(echo "$profiles" | sed -n "${profile_num}p")
    fi

    if [[ -z "$selected_profile" ]]; then
        echo "No profile selected"
        return 1
    fi

    echo "Running with profile: $selected_profile"
    cd "$project_dir" && dotnet run --launch-profile "$selected_profile"
}

# Smart launcher functions - detect current worktree and run from there
runbr() {
    local current_dir="$PWD"
    local br_base="$HOME/code/Work/BR"
    local project_path=""

    # Check if we're under the BR directory
    if [[ "$current_dir" == "$br_base"* ]]; then
        # Extract the worktree name (e.g., EMSVC-170-GitAction, main, etc.)
        # Remove the base path and get the first directory component
        local relative_path="${current_dir#$br_base/}"
        local worktree_name="${relative_path%%/*}"

        # Build the project path
        if [[ -n "$worktree_name" && -d "$br_base/$worktree_name/src/EMServices.BillingRules" ]]; then
            project_path="$br_base/$worktree_name/src/EMServices.BillingRules"
        fi
    fi

    # Fallback: if not in a BR worktree or can't detect, show error
    if [[ -z "$project_path" ]]; then
        echo "Error: Not in a BR worktree. Navigate to a BR worktree directory first."
        echo "Example: cd ~/code/Work/BR/EMSVC-170-GitAction"
        return 1
    fi

    echo "Detected worktree: $worktree_name"
    dotnet-launch "$project_path"
}

rune2api() {
    local current_dir="$PWD"
    local em2_base="$HOME/code/Work/EMSmart2.0"
    local project_path=""

    # Check if we're under the EMSmart2.0 directory
    if [[ "$current_dir" == "$em2_base"* ]]; then
        # Extract the worktree name
        local relative_path="${current_dir#$em2_base/}"
        local worktree_name="${relative_path%%/*}"

        # Build the project path
        if [[ -n "$worktree_name" && -d "$em2_base/$worktree_name/src/WebApi" ]]; then
            project_path="$em2_base/$worktree_name/src/WebApi"
        fi
    fi

    # Fallback
    if [[ -z "$project_path" ]]; then
        echo "Error: Not in an EMSmart2.0 worktree. Navigate to a worktree directory first."
        echo "Example: cd ~/code/Work/EMSmart2.0/AM-18744"
        return 1
    fi

    echo "Detected worktree: $worktree_name"
    dotnet-launch "$project_path"
}

runworker() {
    local current_dir="$PWD"
    local em2_base="$HOME/code/Work/EMSmart2.0"
    local project_path=""

    # Check if we're under the EMSmart2.0 directory
    if [[ "$current_dir" == "$em2_base"* ]]; then
        # Extract the worktree name
        local relative_path="${current_dir#$em2_base/}"
        local worktree_name="${relative_path%%/*}"

        # Build the project path
        if [[ -n "$worktree_name" && -d "$em2_base/$worktree_name/src/WorkerApp" ]]; then
            project_path="$em2_base/$worktree_name/src/WorkerApp"
        fi
    fi

    # Fallback
    if [[ -z "$project_path" ]]; then
        echo "Error: Not in an EMSmart2.0 worktree. Navigate to a worktree directory first."
        echo "Example: cd ~/code/Work/EMSmart2.0/AM-18744"
        return 1
    fi

    echo "Detected worktree: $worktree_name"
    dotnet-launch "$project_path"
}

# Display helpful custom commands
cmds() {
    echo ""
    echo "\033[1;36m╔════════════════════════════════════════════════════════════════╗\033[0m"
    echo "\033[1;36m║           Custom Commands & Aliases Reference                  ║\033[0m"
    echo "\033[1;36m╚════════════════════════════════════════════════════════════════╝\033[0m"
    echo ""

    echo "\033[1;33m⚡ FUNCTIONS:\033[0m"
    echo "  \033[1;32mrider\033[0m                 Launch Rider IDE with proper window manager"
    echo "  \033[1;32mmkcd\033[0m <dir>           Create directory and navigate into it"
    echo "  \033[1;32mmkpr\033[0m [title] [body]  Push branch and create PR (browser or inline)"
    echo "  \033[1;32mgitcommit\033[0m <msg>       Quick git commit with message"
    echo "  \033[1;32mfkill\033[0m                 Interactive process finder/killer (uses fzf)"
    echo "  \033[1;32mdotnet-launch\033[0m <path>  Interactive .NET launch profile selector"
    echo "  \033[1;32mrunbr\033[0m                 Run BillingRules from current BR worktree"
    echo "  \033[1;32mrune2api\033[0m              Run EMSmart2.0 WebApi from current worktree"
    echo "  \033[1;32mrunworker\033[0m             Run EMSmart2.0 WorkerApp from current worktree"
    echo "  \033[1;32mgh-pr-worktree\033[0m <PR#>  Review PR in isolated worktree"
    echo "  \033[1;32mcmds\033[0m                  Show this help message"
    echo ""

    echo "\033[1;33m🔧 ALIASES:\033[0m"
    echo "  \033[1;34msrc\033[0m                   Reload zsh configuration"
    echo "  \033[1;34mshell\033[0m                 Edit ~/.zshrc in nvim"
    echo "  \033[1;34mseedrules\033[0m             Seed billing rules into database"
    echo "  \033[1;34mcde2\033[0m                  Navigate to EMSmart2.0 directory"
    echo "  \033[1;34mcdwork\033[0m                Navigate to Work directory"
    echo "  \033[1;34mgitsubmodules\033[0m         Update all git submodules recursively"
    echo "  \033[1;34mpatchlocal\033[0m            Apply local dev patch to current EMSmart2.0 worktree"
    echo ""

    echo "\033[1;33m📋 PR MANAGEMENT:\033[0m"
    echo "  \033[1;34mprlist\033[0m                List all pull requests"
    echo "  \033[1;34mprview\033[0m                View current branch's PR (terminal)"
    echo "  \033[1;34mpropen\033[0m                Open current branch's PR (browser)"
    echo "  \033[1;34mprcreate\033[0m              Create PR interactively"
    echo "  \033[1;34mprcheck\033[0m               Check PR CI status"
    echo "  \033[1;34mprmerge\033[0m               Merge Recently approved PR"
    echo ""

    echo "\033[1;33m🔐 GITHUB ACCOUNTS:\033[0m"
    echo "  \033[1;34mghstatus\033[0m              Show all authenticated accounts & active account"
    echo "  \033[1;34mghswitch\033[0m              Interactive picker to switch accounts"
    echo "  \033[1;34mghlogin\033[0m               Login to an additional GitHub account"
    echo ""

    echo "\033[1;33m🌳 GIT WORKTREES:\033[0m"
    echo "  \033[1;34mwtls\033[0m                      List all worktrees"
    echo "  \033[1;34mwtrm\033[0m <path>               Remove a worktree"
    echo "  \033[1;90m--- Core commands ---\033[0m"
    echo "  \033[1;32mwta\033[0m <path> <remote>       Detached HEAD at origin/<remote>"
    echo "  \033[1;32mwtl\033[0m <path> <local>        Attach to existing local branch"
    echo "  \033[1;32mwtb\033[0m <branch> <path> <ref> New branch from any ref"
    echo "  \033[1;90m--- Shortcuts ---\033[0m"
    echo "  \033[1;32mwtpr\033[0m <branch>             Fetch + track remote branch (for PRs)"
    echo "  \033[1;32mwtnew\033[0m <name>              New branch from main (new features)"
    echo "  \033[1;90m--- PR Review ---\033[0m"
    echo "  \033[1;32mgh-pr-worktree\033[0m <PR#>     Create worktree for PR review"
    echo "    \033[1;90m└─ For BR2/E2: Creates pr-<number> in repo root\033[0m"
    echo "    \033[1;90m└─ For BR: Creates pr-<number> in repo directory\033[0m"
    echo "    \033[1;90m└─ Opens nvim automatically\033[0m"
    echo ""

    echo "\033[1;90m💡 Tip: Type any command name for help, or check ~/.zshrc for details\033[0m"
    echo ""
}

# Starship prompt
eval "$(starship init zsh)"
export BROWSER="$HOME/.local/bin/browser-launcher.sh"

[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh

# lazydocker alias
alias lzd='lazydocker'

# Auto-start GitHub notification watcher
if ! tmux has-session -t gh-watch 2>/dev/null; then
    tmux new-session -d -s gh-watch "~/.local/bin/gh-notification-watch"
fi
