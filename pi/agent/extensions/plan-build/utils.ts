const SAFE_COMMAND = /^\s*(?:cat|head|tail|less|more|grep|rg|find|fd|ls|eza|tree|pwd|wc|sort|uniq|diff|file|stat|du|df|which|whereis|type|printenv|printf|echo|awk|uname|whoami|id|date|uptime|ps|free|jq|bat|column|cut|tr|fold|expand|nl|od|strings|hexdump|xxd)\b/i;

// Read-only git subcommands (inspect, never mutate)
const SAFE_GIT = /^\s*git(?:\s+-C\s+(?:"[^"]+"|'[^']+'|\S+))*\s+(?:status|log|diff|show|branch|remote|ls-files|ls-tree|rev-parse|config\s+--get|describe|shortlog|blame|annotate|name-rev|submodule\s+status|worktree\s+list|tag\s+-l|tag\s+--list|for-each-ref|count-objects|verify-pack|fsck|check-attr|check-ignore|check-mailmap|check-ref-format|help|version|var)\b/i;

// Read-only gh subcommands
const SAFE_GH = /^\s*gh\s+(?:auth\s+status|pr\s+(?:view|list|checks|diff|status|review\s+--help)|issue\s+(?:view|list|status)|run\s+(?:view|list)|api\s+(?:\/[\w\/.-]+|--method\s+GET\s+\S+)|search\s+(?:prs|issues|commits|code)|release\s+(?:view|list)|repo\s+(?:view|list))\b/i;

// Read-only acli subcommands (Jira workflow)
const SAFE_ACLI = /^\s*acli\s+(?:jira\s+(?:workitem\s+(?:view|list|search)|search|project\s+(?:view|list)|board\s+(?:view|list))|help|--version)(?:$|\s)/i;

// Read-only aws subcommands (ls, describe, list, get, help, wait)
// Allows common global flags: --profile, --region, --output, --endpoint-url, --no-sign-request, --color
const AWS_GLOBAL_FLAGS = /(?:\s+--(?:profile|region|output|endpoint-url|no-sign-request|color|cli-read-timeout|cli-connect-timeout|ca-bundle|debug|no-paginate|no-cli-pager|page-size)(?:\s+\S+)?)*/;
const SAFE_AWS = new RegExp(`^\\s*aws${AWS_GLOBAL_FLAGS.source}\\s+\\S+\\s+(?:ls\\b|describe\\b|list\\b|get\\b|help\\b|wait\\b)`, 'i');

// Read-only kubectl subcommands
const SAFE_KUBECTL = /^\s*kubectl\s+(?:get|describe|logs|top|api-resources|explain|cluster-info|version|options|certificate\s+--help)(?:$|\s)/i;

// Read-only docker subcommands
const SAFE_DOCKER = /^\s*docker\s+(?:ps|images|inspect|logs|stats|info|version|network\s+ls|volume\s+ls|system\s+df|system\s+info|history|port|search|help)(?:$|\s)/i;

// Read-only dotnet (info, no build/test which write to disk)
const SAFE_DOTNET = /^\s*dotnet\s+(?:--version|--list-sdks|--list-runtimes|--info|--help|new\s+--help|tool\s+(?:list|--help))$/i;

const SAFE_PACKAGE = /^\s*(?:npm|pnpm|yarn)\s+(?:list|ls|view|info|why|outdated|audit)\b/i;
const SAFE_VERSION = /^\s*(?:node|python|python3|ruby|go|rustc|cargo)\s+--version\b/i;
const SAFE_PSQL = /^\s*psql\b.*(?:-c|--command(?:=|\s))\s*["']\s*BEGIN\s+(?:TRANSACTION\s+)?READ\s+ONLY\s*;/i;
const SAFE_BUILTIN = /^\s*(?:true|false|:)\s*$/i;

const MUTATION = /\b(?:rm|rmdir|mv|cp|mkdir|touch|chmod|chown|ln|truncate|dd|shred|sudo|su|kill|pkill|killall)\b|\bpsql\b.*\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|CALL)\b|\bcurl\b.*(?:--request|-X)\s*(?:POST|PUT|PATCH|DELETE)\b|\bcurl\b.*(?:--data(?:-binary|-raw|-urlencode)?|-d|--upload-file|-T)\b|\bgit(?:\s+-C\s+(?:"[^"]+"|'[^']+'|\S+))*\s+(?:add|commit|push|pull|merge|rebase|reset|checkout|switch|restore|stash|cherry-pick|revert|tag|init|clone|clean)\b|\b(?:npm|pnpm|yarn)\s+(?:install|add|remove|uninstall|update|ci|link|publish)\b|\b(?:pip|pip3)\s+(?:install|uninstall)\b|\b(?:apt|apt-get|brew|dnf|yum|pacman)\s+(?:install|remove|purge|update|upgrade)\b|\b(?:vim|vi|nano|emacs|code|subl)\b|\bgh\s+(?:pr\s+(?:checkout|merge|close|reopen|ready|review|create|edit)|issue\s+(?:close|reopen|create|edit)|api\s+--method\s+(?:POST|PUT|PATCH|DELETE)|release\s+create|repo\s+(?:create|fork|rename|archive|delete)|secret\s+(?:set|remove)|variable\s+(?:set|remove))\b|\bacli\s+(?:jira\s+(?:workitem\s+(?:create|update|delete|transition)|project\s+create|board\s+create))\b|\baws\s+\S+\s+(?:cp\b|mv\b|sync\b|create-|delete-|update-|put-|post-|patch-|terminate-|stop-|start-|reboot-|run-|modify-|attach-|detach-|import-|export-|cancel-)\b|\bkubectl\s+(?:apply|create|delete|edit|patch|replace|rollout|scale|autoscale|label|annotate|taint|cordon|uncordon|drain|exec|attach|cp|port-forward|proxy|run|expose|set|config\s+(?:set|use-context|delete-context|rename-context))\b|\bdocker\s+(?:run|exec|start|stop|restart|kill|pause|unpause|rm|rmi|pull|push|build|commit|tag|save|load|export|import|cp|rename|update|create|network\s+(?:create|connect|disconnect|rm)|volume\s+(?:create|rm)|system\s+prune)\b|\bdotnet\s+(?:build|test|run|publish|pack|clean|restore|nuget|add|remove|new|tool\s+(?:install|uninstall|update)|format|watch|ef)\b/i;

function isSafeSimpleCommand(command: string): boolean {
  return [
    SAFE_COMMAND, SAFE_GIT, SAFE_GH, SAFE_ACLI, SAFE_AWS, SAFE_KUBECTL,
    SAFE_DOCKER, SAFE_DOTNET, SAFE_PACKAGE, SAFE_VERSION, SAFE_PSQL, SAFE_BUILTIN,
  ].some((pattern) => pattern.test(command));
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

    const canStartFdRedirect = (char === "1" || char === "2") && (i === 0 || /\s|[;&|]/.test(command[i - 1]));
    if (char === ">" || (char === "&" && command[i + 1] === ">") || canStartFdRedirect) {
      const redirect = command.slice(i).match(/^(?:[12]>&[12]|(?:[12]|&)?>>?\s*\/dev\/null)(?=\s|;|&|\||$)/);
      if (redirect) {
        current += " ";
        i += redirect[0].length - 1;
        continue;
      }
      if (char === ">" || (char === "&" && command[i + 1] === ">")) return undefined;
    }

    if (char === "<") return undefined;
    if (char === "|") {
      if (command[i + 1] === "|") {
        // || - logical OR separator
        parts.push(current.trim());
        current = "";
        i += 1;
        continue;
      }
      // | - pipe: split here and validate each segment independently
      parts.push(current.trim());
      current = "";
      continue;
    }
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

export type ShellCommandClassification = "safe" | "unknown" | "mutating-or-ambiguous";

export function findMutationEvidence(command: string): string | undefined {
  return command.match(MUTATION)?.[0];
}

export function classifyShellCommand(command: string): ShellCommandClassification {
  if (findMutationEvidence(command)) return "mutating-or-ambiguous";
  const parts = splitShell(command);
  if (!parts?.length) return "mutating-or-ambiguous";

  let hasUnknownPart = false;
  for (const part of parts) {
    const normalized = part
      .replace(/^for\s+\w+\s+in\s+.+?\s+do\s+/i, "")
      .replace(/^do\s+/i, "")
      .replace(/\s*done\s*$/i, "")
      .trim();
    if (!normalized || /^for\s+\w+\s+in\s+.+$/i.test(normalized)) continue;
    if (!isSafeSimpleCommand(normalized)) hasUnknownPart = true;
  }
  return hasUnknownPart ? "unknown" : "safe";
}

export type ShellCommandAction = "allow" | "confirm" | "block";

export function decideShellCommand(command: string, hasUI: boolean): {
  classification: ShellCommandClassification;
  action: ShellCommandAction;
} {
  const classification = classifyShellCommand(command);
  const action = classification === "safe"
    ? "allow"
    : classification === "unknown" && hasUI
      ? "confirm"
      : "block";
  return { classification, action };
}

export function isReadOnlyCommand(command: string): boolean {
  return classifyShellCommand(command) === "safe";
}