const SAFE_COMMANDS = [
  /^\s*(?:cat|head|tail|less|more|grep|rg|find|fd|ls|eza|tree|pwd|wc|sort|uniq|diff|file|stat|du|df|which|whereis|type|printenv|uname|whoami|id|date|uptime|ps|free|jq|bat)\b/i,
  /^\s*git\s+(?:status|log|diff|show|branch|remote|ls-files|ls-tree|rev-parse|config\s+--get)\b/i,
  /^\s*(?:npm|pnpm|yarn)\s+(?:list|ls|view|info|why|outdated|audit)\b/i,
  /^\s*(?:node|python|python3|ruby|go|rustc|cargo)\s+--version\b/i,
];

const UNSAFE_SYNTAX = [
  /(?:&&|\|\||[;|`\n\r]|\$\(|<\(|>\()/,
  /(?:^|[^<])>(?:>|&)?/,
  /\b(?:rm|rmdir|mv|cp|mkdir|touch|chmod|chown|ln|truncate|dd|shred|sudo|su|kill|pkill|killall)\b/i,
  /\bgit\s+(?:add|commit|push|pull|merge|rebase|reset|checkout|switch|restore|stash|cherry-pick|revert|tag|init|clone|clean)\b/i,
  /\b(?:npm|pnpm|yarn)\s+(?:install|add|remove|uninstall|update|ci|link|publish)\b/i,
  /\b(?:pip|pip3)\s+(?:install|uninstall)\b/i,
  /\b(?:apt|apt-get|brew|dnf|yum|pacman)\s+(?:install|remove|purge|update|upgrade)\b/i,
  /\b(?:vim|vi|nano|emacs|code|subl)\b/i,
];

export function isReadOnlyCommand(command: string): boolean {
  if (!SAFE_COMMANDS.some((pattern) => pattern.test(command))) return false;
  return !UNSAFE_SYNTAX.some((pattern) => pattern.test(command));
}
