const LANGUAGE_BY_EXTENSION = new Map<string, string>([
  [".bash", "bash"],
  [".c", "c"],
  [".cc", "cpp"],
  [".cjs", "javascript"],
  [".cpp", "cpp"],
  [".cs", "csharp"],
  [".css", "css"],
  [".csv", "plaintext"],
  [".env", "ini"],
  [".fish", "shell"],
  [".go", "go"],
  [".h", "c"],
  [".hpp", "cpp"],
  [".html", "xml"],
  [".ini", "ini"],
  [".java", "java"],
  [".js", "javascript"],
  [".json", "json"],
  [".jsx", "javascript"],
  [".kt", "kotlin"],
  [".kts", "kotlin"],
  [".less", "less"],
  [".log", "plaintext"],
  [".mjs", "javascript"],
  [".php", "php"],
  [".py", "python"],
  [".rb", "ruby"],
  [".rs", "rust"],
  [".sass", "scss"],
  [".scss", "scss"],
  [".sh", "bash"],
  [".sql", "sql"],
  [".svelte", "xml"],
  [".swift", "swift"],
  [".toml", "ini"],
  [".ts", "typescript"],
  [".tsx", "typescript"],
  [".txt", "plaintext"],
  [".vue", "xml"],
  [".xml", "xml"],
  [".yaml", "yaml"],
  [".yml", "yaml"],
  [".zsh", "bash"],
]);

const LANGUAGE_BY_FILENAME = new Map<string, string>([
  [".dockerignore", "plaintext"],
  [".env", "ini"],
  [".gitignore", "plaintext"],
  ["dockerfile", "plaintext"],
  ["makefile", "makefile"],
  ["package-lock.json", "json"],
  ["pnpm-lock.yaml", "yaml"],
  ["yarn.lock", "yaml"],
]);

export function codeLanguageFromPath(displayPath: string): string | null {
  const basename = displayPath.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  const filenameLanguage = LANGUAGE_BY_FILENAME.get(basename);
  if (filenameLanguage) {
    return filenameLanguage;
  }

  const extensionMatch = /(\.[^.]+)$/.exec(basename);
  if (!extensionMatch) {
    return null;
  }
  return LANGUAGE_BY_EXTENSION.get(extensionMatch[1]) ?? null;
}

export function createCodePreviewMarkdown(content: string, displayPath: string): string {
  const longestBacktickRun = Math.max(
    2,
    ...(content.match(/`{3,}/g) ?? []).map((run) => run.length),
  );
  const fence = "`".repeat(longestBacktickRun + 1);
  const language = codeLanguageFromPath(displayPath) ?? "";
  const codeContent = content.endsWith("\n") ? content : `${content}\n`;

  return `${fence}${language}\n${codeContent}${fence}`;
}
