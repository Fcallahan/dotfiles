type ParsedLine = {
  indent: number;
  text: string;
  raw: string;
  line: number;
};

function stripInlineComment(input: string): string {
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote && input[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === "#" && (i === 0 || /\s/.test(input[i - 1] ?? ""))) return input.slice(0, i).trimEnd();
  }
  return input.trimEnd();
}

function preprocess(source: string): ParsedLine[] {
  return source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n").map((raw, idx) => {
    const indent = raw.match(/^ */)?.[0].length ?? 0;
    return { indent, text: stripInlineComment(raw.slice(indent)), raw, line: idx + 1 };
  }).filter((line) => line.text.trim().length > 0);
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (trimmed === "null" || trimmed === "~") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    const inner = trimmed.slice(1, -1);
    return trimmed[0] === '"'
      ? inner.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\")
      : inner.replace(/''/g, "'");
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return splitInline(inner).map((part) => parseScalar(part));
  }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      const obj: Record<string, unknown> = {};
      const inner = trimmed.slice(1, -1).trim();
      for (const part of splitInline(inner)) {
        const idx = part.indexOf(":");
        if (idx === -1) continue;
        obj[part.slice(0, idx).trim()] = parseScalar(part.slice(idx + 1));
      }
      return obj;
    }
  }
  return trimmed;
}

function splitInline(input: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let depth = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quote) {
      current += ch;
      if (ch === quote && input[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "[" || ch === "{") depth++;
    if (ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function splitKeyValue(text: string): { key: string; value: string | undefined } | null {
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote && text[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === ":") {
      const key = text.slice(0, i).trim();
      if (!key) return null;
      const rawValue = text.slice(i + 1);
      return { key, value: rawValue.trim() || undefined };
    }
  }
  return null;
}

function parseBlock(lines: ParsedLine[], index: number, indent: number): { value: unknown; index: number } {
  while (index < lines.length && lines[index]!.indent < indent) index++;
  const line = lines[index];
  if (!line || line.indent < indent) return { value: null, index };
  if (line.indent === indent && line.text.startsWith("- ")) return parseArray(lines, index, indent);
  return parseObject(lines, index, indent);
}

function collectBlockScalar(lines: ParsedLine[], index: number, parentIndent: number, folded: boolean): { value: string; index: number } {
  const collected: string[] = [];
  let baseIndent: number | undefined;
  while (index < lines.length && lines[index]!.indent > parentIndent) {
    const line = lines[index]!;
    baseIndent ??= line.indent;
    const cut = Math.min(baseIndent, line.raw.length);
    collected.push(line.raw.slice(cut));
    index++;
  }
  if (!folded) return { value: collected.join("\n"), index };
  return { value: collected.map((l) => l.trim()).join(" ").replace(/\s+/g, " ").trim(), index };
}

function parseObject(lines: ParsedLine[], index: number, indent: number): { value: Record<string, unknown>; index: number } {
  const obj: Record<string, unknown> = {};
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.indent < indent) break;
    if (line.indent > indent) break;
    if (line.text.startsWith("- ")) break;
    const kv = splitKeyValue(line.text);
    if (!kv) throw new Error(`Invalid YAML at line ${line.line}: ${line.raw}`);
    index++;
    if (kv.value === undefined) {
      if (index >= lines.length || lines[index]!.indent <= line.indent) {
        obj[kv.key] = null;
      } else {
        const parsed = parseBlock(lines, index, lines[index]!.indent);
        obj[kv.key] = parsed.value;
        index = parsed.index;
      }
    } else if (kv.value === "|" || kv.value === ">") {
      const parsed = collectBlockScalar(lines, index, line.indent, kv.value === ">");
      obj[kv.key] = parsed.value;
      index = parsed.index;
    } else {
      obj[kv.key] = parseScalar(kv.value);
    }
  }
  return { value: obj, index };
}

function parseArray(lines: ParsedLine[], index: number, indent: number): { value: unknown[]; index: number } {
  const arr: unknown[] = [];
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.indent < indent) break;
    if (line.indent > indent) break;
    if (!line.text.startsWith("- ")) break;
    const rest = line.text.slice(2).trim();
    index++;
    if (!rest) {
      if (index < lines.length && lines[index]!.indent > line.indent) {
        const parsed = parseBlock(lines, index, lines[index]!.indent);
        arr.push(parsed.value);
        index = parsed.index;
      } else {
        arr.push(null);
      }
      continue;
    }
    const kv = splitKeyValue(rest);
    if (kv) {
      const obj: Record<string, unknown> = {};
      if (kv.value === undefined) {
        if (index < lines.length && lines[index]!.indent > line.indent) {
          const parsed = parseBlock(lines, index, lines[index]!.indent);
          obj[kv.key] = parsed.value;
          index = parsed.index;
        } else {
          obj[kv.key] = null;
        }
      } else if (kv.value === "|" || kv.value === ">") {
        const parsed = collectBlockScalar(lines, index, line.indent, kv.value === ">");
        obj[kv.key] = parsed.value;
        index = parsed.index;
      } else {
        obj[kv.key] = parseScalar(kv.value);
      }
      if (index < lines.length && lines[index]!.indent > line.indent) {
        const parsed = parseObject(lines, index, lines[index]!.indent);
        Object.assign(obj, parsed.value);
        index = parsed.index;
      }
      arr.push(obj);
    } else {
      arr.push(parseScalar(rest));
      if (index < lines.length && lines[index]!.indent > line.indent) {
        throw new Error(`Invalid YAML continuation after scalar list item at line ${line.line}`);
      }
    }
  }
  return { value: arr, index };
}

export function parseYaml(source: string): unknown {
  const lines = preprocess(source);
  if (lines.length === 0) return null;
  return parseBlock(lines, 0, lines[0]!.indent).value;
}

function scalarToYaml(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const str = String(value);
  if (!str || /[:#\[\]{}\n]|^\s|\s$/.test(str)) return JSON.stringify(str);
  return str;
}

export function stringifyYaml(value: unknown, indent = 0): string {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const entries = Object.entries(item as Record<string, unknown>);
        if (entries.length === 0) return `${pad}- {}`;
        const [firstKey, firstVal] = entries[0]!;
        const first = isComplex(firstVal)
          ? `${pad}- ${firstKey}:\n${stringifyYaml(firstVal, indent + 4)}`
          : `${pad}- ${firstKey}: ${scalarToYaml(firstVal)}`;
        const rest = entries.slice(1).map(([key, val]) => formatYamlPair(key, val, indent + 2));
        return [first, ...rest].join("\n");
      }
      if (isComplex(item)) return `${pad}-\n${stringifyYaml(item, indent + 2)}`;
      return `${pad}- ${scalarToYaml(item)}`;
    }).join("\n");
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(([key, val]) => formatYamlPair(key, val, indent)).join("\n");
  }
  return `${pad}${scalarToYaml(value)}`;
}

function isComplex(value: unknown): boolean {
  return Array.isArray(value) || (value !== null && typeof value === "object") || (typeof value === "string" && value.includes("\n"));
}

function formatYamlPair(key: string, value: unknown, indent: number): string {
  const pad = " ".repeat(indent);
  if (typeof value === "string" && value.includes("\n")) {
    return `${pad}${key}: |\n${value.split("\n").map((line) => `${" ".repeat(indent + 2)}${line}`).join("\n")}`;
  }
  if (Array.isArray(value) || (value !== null && typeof value === "object")) {
    return `${pad}${key}:\n${stringifyYaml(value, indent + 2)}`;
  }
  return `${pad}${key}: ${scalarToYaml(value)}`;
}
