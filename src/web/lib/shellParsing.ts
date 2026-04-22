export function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function commandBasename(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.at(-1) ?? normalized;
}

export function shortDisplayPath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part && !["build", "dist", "node_modules", "src", "."].includes(part)) {
      return part;
    }
  }
  return normalized || value;
}

function quoteToken(value: string): string {
  if (!value || /[\s"'|;&]/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

export function shellJoin(tokens: string[]): string {
  return tokens.map(quoteToken).join(" ");
}

export function tokenizeShell(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escapeNext = false;

  const pushCurrent = () => {
    if (!current) {
      return;
    }
    tokens.push(current);
    current = "";
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? "";
    const next = input[index + 1] ?? "";

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (quote === "'") {
      if (char === "'") {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (quote === '"') {
      if (char === '"') {
        quote = null;
      } else if (char === "\\") {
        escapeNext = true;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      continue;
    }

    if (/\s/.test(char)) {
      pushCurrent();
      continue;
    }

    if (char === "&" && next === "&") {
      pushCurrent();
      tokens.push("&&");
      index += 1;
      continue;
    }

    if (char === "|" && next === "|") {
      pushCurrent();
      tokens.push("||");
      index += 1;
      continue;
    }

    if (char === "|" || char === ";") {
      pushCurrent();
      tokens.push(char);
      continue;
    }

    current += char;
  }

  pushCurrent();
  return tokens;
}

export function splitSegments(tokens: string[]): string[][] {
  const segments: string[][] = [];
  let current: string[] = [];

  for (const token of tokens) {
    if (token === "|" || token === "&&" || token === "||" || token === ";") {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
      continue;
    }
    current.push(token);
  }

  if (current.length > 0) {
    segments.push(current);
  }

  return segments;
}

export function positionalOperands(tokens: string[], flagsWithValues: Set<string>): string[] {
  const operands: string[] = [];
  let afterDoubleDash = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (!token) {
      continue;
    }

    if (afterDoubleDash) {
      operands.push(token);
      continue;
    }

    if (token === "--") {
      afterDoubleDash = true;
      continue;
    }

    if (token.startsWith("--") && token.includes("=")) {
      continue;
    }

    if (flagsWithValues.has(token)) {
      index += 1;
      continue;
    }

    if (token.startsWith("-")) {
      continue;
    }

    operands.push(token);
  }

  return operands;
}

export function stripShellWrapper(commandText: string): string {
  const normalized = compactWhitespace(commandText);
  if (!normalized) {
    return "";
  }

  const tokens = tokenizeShell(normalized);
  if (tokens.length < 3) {
    return normalized;
  }

  const head = commandBasename(tokens[0] ?? "");
  const mode = tokens[1] ?? "";
  if (!["bash", "zsh", "sh"].includes(head) || (mode !== "-c" && mode !== "-lc")) {
    return normalized;
  }

  const script = tokens.slice(2).join(" ").trim();
  return compactWhitespace(script || normalized);
}
