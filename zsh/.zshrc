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
export CONFLUENCE_API_TOKEN="REDACTED"
export CONFLUENCE_SITE="emsmc1.atlassian.net"

  export CONFLUENCE_SPACE_ID="3832709162" # Franks
  export CONFLUENCE_PARENT_PAGE_ID="3832709489" # Franks
 # export CONFLUENCE_SPACE_ID="3413835784" # EMServices
 # export CONFLUENCE_PARENT_PAGE_ID="3801939973" # Emservices

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
    docker
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

# Windows paths (for WSL)
if [[ -d "/mnt/c" ]]; then
    export DOTNET_ROOT="/c/Users/Francis.Callahan/.dotnet"
    export PATH="/c/Users/Francis.Callahan/.dotnet:$PATH"
    export PATH="/c/Users/Francis.Callahan/.local/bin:$PATH"
    export PATH="/c/Program Files/Neovim/bin:$PATH"
    export PATH="/c/Program Files/Microsoft VS Code/bin:$PATH"
    export PATH="/c/Program Files/nodejs:$PATH"
    export PATH="/c/Users/Francis.Callahan/AppData/Roaming/npm:$PATH"
    export PATH="/c/Users/Francis.Callahan/.dotnet/tools:$PATH"
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
alias ll="ls -la" 
alias la="ls -la"
alias l="ls -CF"
alias md="mkdir -p"
alias rd="rmdir"
alias cde2="cd ~/code/Work/EMSmart2.0/worktrees/"
alias cdE2="cd ~/code/Work/EMSmart2.0/worktrees/"
alias cdbr="cd ~/code/Work/BR"
alias cdBR="cd ~/code/Work/BR"
alias cd='z'  # Use zoxide for cd


# Git shortcuts
alias gs="git status"
alias ga="git add"
alias gc="git commit"
alias gp="git push"
alias gl="git log --oneline"
alias gd="git diff"
alias gfp="git fetch && git pull"
alias gitsubmodules="git submodule update --recursive"

# PR management shortcuts
alias prlist="gh pr list"
alias prview="gh pr view"
alias propen="gh pr view --web"
alias prcreate="gh pr create"
alias prcheck="gh pr checks"

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
    local em2_base="$HOME/code/Work/EMSmart2.0/worktrees"
    local project_path=""

    # Check if we're under the EMSmart2.0/worktrees directory
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
        echo "Example: cd ~/code/Work/EMSmart2.0/worktrees/ESMVC-141-MileageRule"
        return 1
    fi

    echo "Detected worktree: $worktree_name"
    dotnet-launch "$project_path"
}

runworker() {
    local current_dir="$PWD"
    local em2_base="$HOME/code/Work/EMSmart2.0/worktrees"
    local project_path=""

    # Check if we're under the EMSmart2.0/worktrees directory
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
        echo "Example: cd ~/code/Work/EMSmart2.0/worktrees/ESMVC-141-MileageRule"
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
    echo "  \033[1;32mcmds\033[0m                  Show this help message"
    echo ""

    echo "\033[1;33m🔧 ALIASES:\033[0m"
    echo "  \033[1;34msrc\033[0m                   Reload zsh configuration"
    echo "  \033[1;34mshell\033[0m                 Edit ~/.zshrc in nvim"
    echo "  \033[1;34mseedrules\033[0m             Seed billing rules into database"
    echo "  \033[1;34mcde2\033[0m                  Navigate to EMSmart2.0 directory"
    echo "  \033[1;34mcdwork\033[0m                Navigate to Work directory"
    echo "  \033[1;34mgitsubmodules\033[0m         Update all git submodules recursively"
    echo ""

    echo "\033[1;33m📋 PR MANAGEMENT:\033[0m"
    echo "  \033[1;34mprlist\033[0m                List all pull requests"
    echo "  \033[1;34mprview\033[0m                View current branch's PR (terminal)"
    echo "  \033[1;34mpropen\033[0m                Open current branch's PR (browser)"
    echo "  \033[1;34mprcreate\033[0m              Create PR interactively"
    echo "  \033[1;34mprcheck\033[0m               Check PR CI status"
    echo ""

    echo "\033[1;90m💡 Tip: Type any command name for help, or check ~/.zshrc for details\033[0m"
    echo ""
}

# Starship prompt
eval "$(starship init zsh)"
export BROWSER="$HOME/.local/bin/browser-launcher.sh"

[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh
