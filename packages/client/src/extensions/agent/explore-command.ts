const EXPLORE_COMMANDS = new Set([
  // Search / grep
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "ag",
  "ack",
  "ast-grep",
  "sg",
  // Find files
  "find",
  "fd",
  "locate",
  // List / tree
  "ls",
  "tree",
  // Read file contents
  "cat",
  "bat",
  "head",
  "tail",
  "less",
  "more",
  // File info
  "file",
  "stat",
  "wc",
  "du",
  "df",
  // Resolve paths / identify commands
  "which",
  "where",
  "type",
  "realpath",
  "readlink",
  // Shell navigation
  "cd",
  "pwd",
]);

const GIT_EXPLORE_SUBCOMMANDS = new Set([
  "show",
  "log",
  "diff",
  "status",
  "branch",
  "blame",
  "grep",
  "rev-parse",
  "ls-files",
  "cat-file",
]);

function splitShellExpressions(command: string): string[] {
  const expressions: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed.length > 0) {
      expressions.push(trimmed);
    }
    current = "";
  };

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    const next = command[i + 1];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      current += char;
      escaped = true;
      continue;
    }

    if (quote) {
      current += char;
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }

    if ((char === "&" && next === "&") || (char === "|" && next === "|")) {
      pushCurrent();
      i++;
      continue;
    }

    if (char === "|" || char === ";") {
      pushCurrent();
      continue;
    }

    current += char;
  }

  pushCurrent();
  return expressions;
}

function splitShellWords(expression: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  const pushCurrent = () => {
    if (current.length > 0) {
      words.push(current);
      current = "";
    }
  };

  for (let i = 0; i < expression.length; i++) {
    const char = expression[i];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === " " || char === "\n" || char === "\t" || char === "\r") {
      pushCurrent();
      continue;
    }

    current += char;
  }

  if (escaped) {
    current += "\\";
  }

  pushCurrent();
  return words;
}

function stripLeadingAssignments(words: string[]): string[] {
  let start = 0;
  while (start < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[start])) {
    start++;
  }
  return words.slice(start);
}

function isExploreProgram(words: string[]): boolean {
  const [command, subcommand] = words;

  if (!command) {
    return false;
  }

  if (command === "git") {
    return Boolean(subcommand && GIT_EXPLORE_SUBCOMMANDS.has(subcommand));
  }

  return EXPLORE_COMMANDS.has(command);
}

export function isExploreCommand(command: string): boolean {
  const expressions = splitShellExpressions(command);
  if (expressions.length === 0) {
    return false;
  }

  return expressions.every((expression) => {
    const words = stripLeadingAssignments(splitShellWords(expression));
    if (words.length === 0) {
      return false;
    }
    return isExploreProgram(words);
  });
}
