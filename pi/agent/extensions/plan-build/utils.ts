const SAFE_COMMAND = /^\s*(?:cat|head|tail|less|more|grep|rg|find|fd|ls|eza|tree|pwd|wc|sort|uniq|diff|file|stat|du|df|which|whereis|type|printenv|printf|echo|awk|uname|whoami|id|date|uptime|ps|free|jq|bat)\b/i;
const SAFE_GIT = /^\s*git(?:\s+-C\s+(?:"[^"]+"|'[^']+'|\S+))*\s+(?:status|log|diff|show|branch|remote|ls-files|ls-tree|rev-parse|config\s+--get)\b/i;
const SAFE_PACKAGE = /^\s*(?:npm|pnpm|yarn)\s+(?:list|ls|view|info|why|outdated|audit)\b/i;
const SAFE_VERSION = /^\s*(?:node|python|python3|ruby|go|rustc|cargo)\s+--version\b/i;
const SAFE_PSQL = /^\s*psql\b.*(?:-c|--command(?:=|\s))\s*["']\s*BEGIN\s+(?:TRANSACTION\s+)?READ\s+ONLY\s*;/i;

const MUTATION = /\b(?:rm|rmdir|mv|cp|mkdir|touch|chmod|chown|ln|truncate|dd|shred|sudo|su|kill|pkill|killall)\b|\bgit(?:\s+-C\s+(?:"[^"]+"|'[^']+'|\S+))*\s+(?:add|commit|push|pull|merge|rebase|reset|checkout|switch|restore|stash|cherry-pick|revert|tag|init|clone|clean)\b|\b(?:npm|pnpm|yarn)\s+(?:install|add|remove|uninstall|update|ci|link|publish)\b|\b(?:pip|pip3)\s+(?:install|uninstall)\b|\b(?:apt|apt-get|brew|dnf|yum|pacman)\s+(?:install|remove|purge|update|upgrade)\b|\b(?:vim|vi|nano|emacs|code|subl)\b/i;

function isSafeSimpleCommand(command: string): boolean {
  return [SAFE_COMMAND, SAFE_GIT, SAFE_PACKAGE, SAFE_VERSION, SAFE_PSQL].some((pattern) => pattern.test(command));
}

function splitShell(command: string): string[] | undefined {
  const parts: string[] = [];
  let current = "";
  let quote = "";

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (quote) {
      current += char;
      if (char === quote && command[i - 1] !== "\\") quote = "";
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === "`" || (char === "$" && command[i + 1] === "(")) return undefined;
    if (char === ">" || char === "<" || char === "|") return undefined;
    if (char === ";" || (char === "&" && command[i + 1] === "&")) {
      parts.push(current.trim());
      current = "";
      if (char === "&") i += 1;
      continue;
    }
    if (char === "\n" || char === "\r") {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (quote) return undefined;
  parts.push(current.trim());
  return parts.filter(Boolean);
}

export function isReadOnlyCommand(command: string): boolean {
  if (MUTATION.test(command)) return false;
  const parts = splitShell(command);
  if (!parts?.length) return false;

  return parts.every((part) => {
    const normalized = part
      .replace(/^for\s+\w+\s+in\s+.+?\s+do\s+/i, "")
      .replace(/^do\s+/i, "")
      .replace(/\s*done\s*$/i, "")
      .trim();
    return !normalized || /^for\s+\w+\s+in\s+.+$/i.test(normalized) || isSafeSimpleCommand(normalized);
  });
}
