# Enhanced Git Worktree Completions
# Provides improved completions for git worktree commands with remote branch support

# Helper function to get both local and remote branches
_git_worktree_all_branches() {
  local -a branches
  local -a local_branches remote_branches

  # Get local branches
  local_branches=(${(f)"$(_call_program branches git for-each-ref --format='%(refname:short):%(subject)' refs/heads 2>/dev/null)"})

  # Get remote branches (without remote prefix for cleaner display)
  remote_branches=(${(f)"$(_call_program remote-branches git for-each-ref --format='%(refname:short):%(subject)' refs/remotes 2>/dev/null)"})

  # Combine and deduplicate
  branches=($local_branches $remote_branches)

  _describe -t branches 'branch' branches
}

# Override the git-worktree completion
_git-worktree() {
  local curcontext="$curcontext" state line ret=1
  typeset -A opt_args

  _arguments -C \
    '1: :->command' \
    '*::arg:->args' && ret=0

  case $state in
    (command)
      local -a subcommands
      subcommands=(
        'add:Create a new working tree'
        'list:List details of each worktree'
        'lock:Prevent a worktree from being pruned'
        'move:Move a worktree to a new location'
        'prune:Prune worktree information'
        'remove:Remove a worktree'
        'repair:Repair worktree administrative files'
        'unlock:Unlock a worktree'
      )
      _describe -t commands 'git worktree command' subcommands && ret=0
      ;;
    (args)
      case $line[1] in
        (add)
          _arguments -s \
            '(-f --force)'{-f,--force}'[checkout even if already checked out in another worktree]' \
            '(-b -B --detach)-b[create a new branch]:branch name:' \
            '(-b -B --detach)-B[create or reset a branch]:branch name:' \
            '(-b -B)--detach[detach HEAD in the new worktree]' \
            '--no-checkout[do not checkout files]' \
            '--lock[keep the worktree locked]' \
            '--reason=[reason for locking]:reason:' \
            '--track[set up tracking branch]' \
            '--no-track[do not set up tracking]' \
            '1:directory:_files -/' \
            '2:branch:_git_worktree_all_branches' \
            && ret=0
          ;;
        (list)
          _arguments -s \
            '--porcelain[output in porcelain format]' \
            '(-v --verbose)'{-v,--verbose}'[show extended information]' \
            '--expire[show worktrees older than]:time:' \
            && ret=0
          ;;
        (lock)
          _arguments -s \
            '--reason=[reason for locking]:reason:' \
            '1:worktree:->worktree' \
            && ret=0
          ;;
        (move)
          _arguments -s \
            '1:worktree:->worktree' \
            '2:new path:_files -/' \
            && ret=0
          ;;
        (prune)
          _arguments -s \
            '(-n --dry-run)'{-n,--dry-run}'[do not remove, show only]' \
            '(-v --verbose)'{-v,--verbose}'[report all removals]' \
            '--expire[expire worktrees older than]:time:' \
            && ret=0
          ;;
        (remove)
          _arguments -s \
            '(-f --force)'{-f,--force}'[force removal even if worktree is dirty]' \
            '1:worktree:->worktree' \
            && ret=0
          ;;
        (unlock)
          _arguments -s \
            '1:worktree:->worktree' \
            && ret=0
          ;;
      esac

      # Handle worktree argument completion
      case $state in
        (worktree)
          local -a worktrees
          worktrees=(${(f)"$(_call_program worktrees git worktree list --porcelain 2>/dev/null | grep '^worktree' | cut -d' ' -f2-)"})
          _describe -t worktrees 'worktree' worktrees && ret=0
          ;;
      esac
      ;;
  esac

  return ret
}

# Add helpful git worktree cheat sheet function (optional but useful!)
gwt-help() {
  cat <<'EOF'
📝 Git Worktree Quick Reference:

Common Commands:
  git worktree list                          # List all worktrees
  git worktree add <path> <branch>          # Checkout existing branch to new worktree
  git worktree add -b <new> <path> <base>   # Create new branch from base branch
  git worktree remove <path>                 # Remove a worktree

Examples:
  git worktree add ../feature-x origin/main           # New worktree from origin/main
  git worktree add -b feature-y ../feature-y main     # Create feature-y branch from main
  git worktree add --track -b fix ../fix origin/dev   # Track origin/dev

Useful Flags:
  -f, --force          # Checkout even if already checked out elsewhere
  -b <branch>          # Create new branch
  -B <branch>          # Create or reset branch
  --detach             # Detach HEAD at commit

Aliases (from your git plugin):
  gwt      = git worktree
  gwta     = git worktree add
  gwtls    = git worktree list
  gwtmv    = git worktree move
  gwtrm    = git worktree remove
EOF
}
