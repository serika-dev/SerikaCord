/**
 * Small syntax highlighter for chat code blocks (```lang).
 *
 * Loaded on demand (dynamic import from the code block component), so a chat
 * without code never pays for it. A single scanner drives every language from
 * a table of comment / string / keyword rules; it is not a parser, just the
 * token classes highlight.js would give the common cases (keywords, strings,
 * comments, numbers, function calls, types, tags, keys, diff lines).
 */

export type HighlightKind =
  | "keyword"
  | "string"
  | "comment"
  | "number"
  | "literal"
  | "function"
  | "type"
  | "builtin"
  | "tag"
  | "attr"
  | "property"
  | "meta"
  | "variable"
  | "addition"
  | "deletion";

export interface HighlightToken {
  text: string;
  kind?: HighlightKind;
}

interface LanguageDef {
  keywords?: string[];
  literals?: string[];
  builtins?: string[];
  lineComment?: string[];
  blockComment?: Array<[string, string]>;
  /** Quote characters that open a string. */
  quotes?: string[];
  /** Backtick template strings (JS/TS) or raw strings. */
  multilineQuotes?: string[];
  caseInsensitive?: boolean;
  /** Capitalized identifiers are types (C-like languages). */
  capsAreTypes?: boolean;
  /** `$name` / `@name` variables. */
  variablePrefix?: RegExp;
  /** `#include`, decorators etc. */
  meta?: RegExp;
}

const C_LIKE_LITERALS = ["true", "false", "null"];

const JS: LanguageDef = {
  keywords: [
    "as", "async", "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete",
    "do", "else", "enum", "export", "extends", "finally", "for", "from", "function", "get", "if", "implements",
    "import", "in", "instanceof", "interface", "let", "new", "of", "private", "protected", "public", "readonly",
    "return", "set", "static", "super", "switch", "this", "throw", "try", "type", "typeof", "var", "void", "while",
    "with", "yield", "declare", "namespace", "abstract", "keyof", "satisfies",
  ],
  literals: ["true", "false", "null", "undefined", "NaN", "Infinity"],
  builtins: ["console", "window", "document", "Math", "JSON", "Promise", "Object", "Array", "String", "Number", "Map", "Set", "Date", "Error", "require", "module", "process", "string", "number", "boolean", "any", "unknown", "never"],
  lineComment: ["//"],
  blockComment: [["/*", "*/"]],
  quotes: ['"', "'"],
  multilineQuotes: ["`"],
  capsAreTypes: true,
  meta: /^@[A-Za-z_]\w*/,
};

const PY: LanguageDef = {
  keywords: [
    "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else", "except",
    "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass",
    "raise", "return", "try", "while", "with", "yield", "match", "case",
  ],
  literals: ["True", "False", "None"],
  builtins: ["print", "len", "range", "str", "int", "float", "list", "dict", "set", "tuple", "open", "self", "super", "isinstance", "enumerate", "zip", "map", "filter"],
  lineComment: ["#"],
  quotes: ['"', "'"],
  multilineQuotes: ['"""', "'''"],
  capsAreTypes: true,
  meta: /^@[A-Za-z_][\w.]*/,
};

const C_KEYWORDS = [
  "auto", "break", "case", "char", "const", "continue", "default", "do", "double", "else", "enum", "extern",
  "float", "for", "goto", "if", "inline", "int", "long", "register", "return", "short", "signed", "sizeof",
  "static", "struct", "switch", "typedef", "union", "unsigned", "void", "volatile", "while", "bool",
];

const C: LanguageDef = {
  keywords: C_KEYWORDS,
  literals: ["true", "false", "NULL", "nullptr"],
  lineComment: ["//"],
  blockComment: [["/*", "*/"]],
  quotes: ['"', "'"],
  capsAreTypes: true,
  meta: /^#\s*[a-z]+/,
};

const CPP: LanguageDef = {
  ...C,
  keywords: [
    ...C_KEYWORDS, "class", "namespace", "template", "typename", "public", "private", "protected", "virtual",
    "override", "new", "delete", "this", "using", "try", "catch", "throw", "auto", "constexpr", "noexcept",
    "operator", "friend", "explicit", "static_cast", "dynamic_cast", "reinterpret_cast", "const_cast",
  ],
  builtins: ["std", "string", "vector", "map", "cout", "cin", "endl", "size_t"],
};

const JAVA: LanguageDef = {
  keywords: [
    "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char", "class", "const", "continue",
    "default", "do", "double", "else", "enum", "extends", "final", "finally", "float", "for", "if", "implements",
    "import", "instanceof", "int", "interface", "long", "native", "new", "package", "private", "protected",
    "public", "return", "short", "static", "super", "switch", "synchronized", "this", "throw", "throws",
    "try", "void", "volatile", "while", "var", "record", "sealed", "permits", "yield",
  ],
  literals: C_LIKE_LITERALS,
  lineComment: ["//"],
  blockComment: [["/*", "*/"]],
  quotes: ['"', "'"],
  multilineQuotes: ['"""'],
  capsAreTypes: true,
  meta: /^@[A-Za-z_]\w*/,
};

const CSHARP: LanguageDef = {
  ...JAVA,
  keywords: [
    "abstract", "as", "async", "await", "base", "bool", "break", "byte", "case", "catch", "char", "class", "const",
    "continue", "decimal", "default", "delegate", "do", "double", "else", "enum", "event", "explicit", "extern",
    "finally", "fixed", "float", "for", "foreach", "get", "if", "implicit", "in", "int", "interface", "internal",
    "is", "lock", "long", "namespace", "new", "object", "operator", "out", "override", "params", "private",
    "protected", "public", "readonly", "record", "ref", "return", "sealed", "set", "short", "sizeof", "static",
    "string", "struct", "switch", "this", "throw", "try", "typeof", "uint", "ulong", "using", "var", "virtual",
    "void", "while", "yield",
  ],
  meta: /^#\s*[a-z]+|^\[[A-Z]\w*/,
};

const GO: LanguageDef = {
  keywords: [
    "break", "case", "chan", "const", "continue", "default", "defer", "else", "fallthrough", "for", "func", "go",
    "goto", "if", "import", "interface", "map", "package", "range", "return", "select", "struct", "switch", "type", "var",
  ],
  literals: ["true", "false", "nil", "iota"],
  builtins: ["string", "int", "int64", "int32", "uint", "byte", "rune", "bool", "float64", "error", "make", "len", "cap", "append", "new", "panic", "fmt"],
  lineComment: ["//"],
  blockComment: [["/*", "*/"]],
  quotes: ['"', "'"],
  multilineQuotes: ["`"],
  capsAreTypes: true,
};

const RUST: LanguageDef = {
  keywords: [
    "as", "async", "await", "break", "const", "continue", "crate", "dyn", "else", "enum", "extern", "fn", "for",
    "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut", "pub", "ref", "return", "self", "Self",
    "static", "struct", "super", "trait", "type", "unsafe", "use", "where", "while",
  ],
  literals: ["true", "false", "None", "Some", "Ok", "Err"],
  builtins: ["i8", "i16", "i32", "i64", "u8", "u16", "u32", "u64", "usize", "isize", "f32", "f64", "bool", "char", "str", "String", "Vec", "Option", "Result", "Box", "println", "format", "vec"],
  lineComment: ["//"],
  blockComment: [["/*", "*/"]],
  quotes: ['"'],
  capsAreTypes: true,
  meta: /^#!?\[[^\]]*\]/,
};

const PHP: LanguageDef = {
  keywords: [
    "abstract", "and", "array", "as", "break", "case", "catch", "class", "const", "continue", "declare", "default",
    "do", "echo", "else", "elseif", "empty", "extends", "final", "finally", "fn", "for", "foreach", "function",
    "global", "if", "implements", "include", "instanceof", "interface", "isset", "list", "match", "namespace", "new",
    "or", "print", "private", "protected", "public", "require", "return", "static", "switch", "throw", "trait",
    "try", "unset", "use", "var", "while", "yield",
  ],
  literals: ["true", "false", "null", "TRUE", "FALSE", "NULL"],
  lineComment: ["//", "#"],
  blockComment: [["/*", "*/"]],
  quotes: ['"', "'"],
  variablePrefix: /^\$[A-Za-z_]\w*/,
  meta: /^<\?php|^\?>/,
};

const SHELL: LanguageDef = {
  keywords: ["if", "then", "else", "elif", "fi", "for", "while", "until", "do", "done", "case", "esac", "in", "function", "return", "local", "export", "select"],
  builtins: ["echo", "cd", "ls", "cat", "grep", "sed", "awk", "sudo", "rm", "cp", "mv", "mkdir", "chmod", "curl", "git", "npm", "bun", "npx", "yarn", "pnpm", "source", "exit", "set", "read", "printf", "test"],
  literals: ["true", "false"],
  lineComment: ["#"],
  quotes: ['"', "'"],
  variablePrefix: /^\$(?:\{[^}]*\}|[A-Za-z_]\w*|[0-9@#?$!*-])/,
};

const SQL: LanguageDef = {
  keywords: [
    "select", "from", "where", "and", "or", "not", "insert", "into", "values", "update", "set", "delete", "create",
    "table", "drop", "alter", "add", "column", "index", "on", "join", "left", "right", "inner", "outer", "full",
    "group", "by", "order", "having", "limit", "offset", "as", "distinct", "union", "all", "case", "when", "then",
    "else", "end", "exists", "in", "is", "like", "between", "primary", "key", "foreign", "references", "default",
    "returning", "with", "if", "begin", "commit", "rollback", "transaction", "asc", "desc", "conflict", "do", "nothing",
  ],
  literals: ["null", "true", "false"],
  builtins: ["count", "sum", "avg", "min", "max", "now", "coalesce", "uuid", "text", "int", "integer", "bigint", "varchar", "boolean", "timestamp", "jsonb", "serial"],
  lineComment: ["--"],
  blockComment: [["/*", "*/"]],
  quotes: ["'", '"'],
  caseInsensitive: true,
};

const LUA: LanguageDef = {
  keywords: ["and", "break", "do", "else", "elseif", "end", "for", "function", "goto", "if", "in", "local", "not", "or", "repeat", "return", "then", "until", "while"],
  literals: ["true", "false", "nil"],
  builtins: ["print", "pairs", "ipairs", "require", "table", "string", "math", "game", "workspace", "self"],
  lineComment: ["--"],
  blockComment: [["--[[", "]]"]],
  quotes: ['"', "'"],
};

const KOTLIN: LanguageDef = {
  ...JAVA,
  keywords: [
    "as", "break", "class", "continue", "do", "else", "for", "fun", "if", "in", "interface", "is", "object",
    "package", "return", "super", "this", "throw", "try", "typealias", "val", "var", "when", "while", "import",
    "private", "public", "protected", "internal", "override", "open", "data", "sealed", "suspend", "companion", "lateinit",
  ],
};

const SWIFT: LanguageDef = {
  ...JAVA,
  keywords: [
    "associatedtype", "class", "deinit", "enum", "extension", "func", "import", "init", "let", "protocol", "struct",
    "subscript", "typealias", "var", "break", "case", "continue", "default", "defer", "do", "else", "fallthrough",
    "for", "guard", "if", "in", "repeat", "return", "switch", "where", "while", "as", "catch", "is", "try", "throw",
    "throws", "self", "Self", "super", "public", "private", "internal", "static", "async", "await", "some",
  ],
  literals: ["true", "false", "nil"],
};

const RUBY: LanguageDef = {
  keywords: ["alias", "and", "begin", "break", "case", "class", "def", "defined?", "do", "else", "elsif", "end", "ensure", "for", "if", "in", "module", "next", "not", "or", "redo", "rescue", "retry", "return", "self", "super", "then", "undef", "unless", "until", "when", "while", "yield", "require", "attr_accessor", "puts"],
  literals: ["true", "false", "nil"],
  lineComment: ["#"],
  quotes: ['"', "'"],
  capsAreTypes: true,
  variablePrefix: /^[@$][A-Za-z_]\w*|^:[A-Za-z_]\w*/,
};

const CSS: LanguageDef = {
  blockComment: [["/*", "*/"]],
  quotes: ['"', "'"],
  meta: /^@[a-z-]+/,
};

const YAML: LanguageDef = {
  literals: ["true", "false", "null", "yes", "no", "on", "off", "~"],
  lineComment: ["#"],
  quotes: ['"', "'"],
};

const INI: LanguageDef = {
  literals: ["true", "false"],
  lineComment: ["#", ";"],
  quotes: ['"', "'"],
};

const JSON_DEF: LanguageDef = {
  literals: ["true", "false", "null"],
  quotes: ['"'],
};

type Mode = "code" | "markup" | "css" | "yaml" | "ini" | "json" | "diff";

const LANGS: Record<string, { def: LanguageDef; mode: Mode }> = {};
function register(names: string[], def: LanguageDef, mode: Mode = "code") {
  for (const n of names) LANGS[n] = { def, mode };
}
register(["js", "javascript", "jsx", "mjs", "cjs", "ts", "typescript", "tsx", "node"], JS);
register(["py", "python", "py3", "gyp"], PY);
register(["c", "h"], C);
register(["cpp", "c++", "cc", "cxx", "hpp", "hh", "ino"], CPP);
register(["java"], JAVA);
register(["cs", "csharp", "c#"], CSHARP);
register(["go", "golang"], GO);
register(["rs", "rust"], RUST);
register(["php"], PHP);
register(["sh", "bash", "shell", "zsh", "console", "shellsession", "ps1", "powershell"], SHELL);
register(["sql", "pgsql", "postgres", "mysql", "sqlite"], SQL);
register(["lua", "luau"], LUA);
register(["kt", "kotlin", "kts"], KOTLIN);
register(["swift"], SWIFT);
register(["rb", "ruby"], RUBY);
register(["css", "scss", "sass", "less"], CSS, "css");
register(["yaml", "yml"], YAML, "yaml");
register(["toml", "ini", "cfg", "conf", "env", "properties"], INI, "ini");
register(["json", "json5", "jsonc"], JSON_DEF, "json");
register(["html", "xml", "svg", "xhtml", "vue", "svelte", "htm", "plist"], { quotes: ['"', "'"], blockComment: [["<!--", "-->"]] }, "markup");
register(["diff", "patch"], {}, "diff");

/** Whether a language name has highlighting rules. */
export function isHighlightable(lang: string | null | undefined): boolean {
  return Boolean(lang && LANGS[lang.toLowerCase()]);
}

/** Merge adjacent tokens of the same kind (fewer DOM nodes). */
function pushToken(out: HighlightToken[], text: string, kind?: HighlightKind) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.kind === kind) last.text += text;
  else out.push(kind ? { text, kind } : { text });
}

const NUMBER_RE = /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)[a-zA-Z]{0,3}/;
const IDENT_RE = /^[A-Za-z_$][\w$]*[?!]?/;

function readString(src: string, i: number, quote: string, multiline: boolean): number {
  let j = i + quote.length;
  while (j < src.length) {
    if (src[j] === "\\") {
      j += 2;
      continue;
    }
    if (src.startsWith(quote, j)) return j + quote.length;
    if (!multiline && src[j] === "\n") return j;
    j++;
  }
  return src.length;
}

function scanCode(src: string, def: LanguageDef): HighlightToken[] {
  const out: HighlightToken[] = [];
  const norm = (w: string) => (def.caseInsensitive ? w.toLowerCase() : w);
  const keywords = new Set((def.keywords ?? []).map(norm));
  const literals = new Set((def.literals ?? []).map(norm));
  const builtins = new Set((def.builtins ?? []).map(norm));
  const multi = def.multilineQuotes ?? [];
  const quotes = def.quotes ?? [];
  let i = 0;
  let lineStart = true;
  while (i < src.length) {
    const rest = src.slice(i, i + 400);
    const ch = src[i];

    const block = def.blockComment?.find(([open]) => src.startsWith(open, i));
    if (block) {
      const end = src.indexOf(block[1], i + block[0].length);
      const stop = end === -1 ? src.length : end + block[1].length;
      pushToken(out, src.slice(i, stop), "comment");
      i = stop;
      continue;
    }
    const line = def.lineComment?.find((c) => src.startsWith(c, i));
    if (line && !(line === "#" && def.meta?.test(rest) && def.meta.source.startsWith("^#"))) {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? src.length : end;
      pushToken(out, src.slice(i, stop), "comment");
      i = stop;
      continue;
    }
    const mq = multi.find((q) => src.startsWith(q, i));
    const q = mq ?? quotes.find((qq) => src.startsWith(qq, i));
    if (q) {
      const stop = readString(src, i, q, Boolean(mq));
      pushToken(out, src.slice(i, stop), "string");
      i = stop;
      continue;
    }
    if (def.meta && (lineStart || ch === "@" || ch === "[")) {
      const m = rest.match(def.meta);
      if (m) {
        pushToken(out, m[0], "meta");
        i += m[0].length;
        lineStart = false;
        continue;
      }
    }
    if (def.variablePrefix) {
      const m = rest.match(def.variablePrefix);
      if (m) {
        pushToken(out, m[0], "variable");
        i += m[0].length;
        lineStart = false;
        continue;
      }
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const prev = src[i - 1] ?? "";
      if (!/[\w$]/.test(prev)) {
        const m = rest.match(NUMBER_RE);
        if (m) {
          pushToken(out, m[0], "number");
          i += m[0].length;
          lineStart = false;
          continue;
        }
      }
    }
    const id = rest.match(IDENT_RE);
    if (id) {
      const word = id[0];
      const key = norm(word);
      const after = src.slice(i + word.length).match(/^\s*(\(|<[A-Za-z_][\w,\s<>[\]]*>\s*\()/);
      let kind: HighlightKind | undefined;
      if (keywords.has(key)) kind = "keyword";
      else if (literals.has(key)) kind = "literal";
      else if (builtins.has(key)) kind = "builtin";
      else if (after) kind = "function";
      else if (def.capsAreTypes && /^[A-Z][a-z0-9]\w*$/.test(word)) kind = "type";
      else if (src[i - 1] === "." && !/^\d/.test(word)) kind = "property";
      pushToken(out, word, kind);
      i += word.length;
      lineStart = false;
      continue;
    }
    pushToken(out, ch);
    if (ch === "\n") lineStart = true;
    else if (!/\s/.test(ch)) lineStart = false;
    i++;
  }
  return out;
}

function scanMarkup(src: string): HighlightToken[] {
  const out: HighlightToken[] = [];
  let i = 0;
  while (i < src.length) {
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      const stop = end === -1 ? src.length : end + 3;
      pushToken(out, src.slice(i, stop), "comment");
      i = stop;
      continue;
    }
    const tag = src.slice(i).match(/^<\/?[A-Za-z][\w:.-]*|^<!\w+|^<\?\w+/);
    if (tag) {
      pushToken(out, "<", undefined);
      pushToken(out, tag[0].slice(1), "tag");
      i += tag[0].length;
      // Attributes until the tag closes.
      while (i < src.length && src[i] !== ">") {
        const attr = src.slice(i).match(/^[A-Za-z_:@#.-][\w:.-]*/);
        if (attr) {
          pushToken(out, attr[0], "attr");
          i += attr[0].length;
          continue;
        }
        if (src[i] === '"' || src[i] === "'") {
          const stop = readString(src, i, src[i], true);
          pushToken(out, src.slice(i, stop), "string");
          i = stop;
          continue;
        }
        pushToken(out, src[i]);
        i++;
      }
      if (i < src.length) {
        pushToken(out, ">");
        i++;
      }
      continue;
    }
    if (src[i] === "&") {
      const ent = src.slice(i).match(/^&#?\w+;/);
      if (ent) {
        pushToken(out, ent[0], "literal");
        i += ent[0].length;
        continue;
      }
    }
    pushToken(out, src[i]);
    i++;
  }
  return out;
}

/** Key/value languages: highlight the key before `:` / `=` on each line, the value as code. */
function scanKeyValue(src: string, def: LanguageDef, sep: RegExp, sectionRe?: RegExp): HighlightToken[] {
  const out: HighlightToken[] = [];
  const lines = src.split("\n");
  lines.forEach((line, idx) => {
    if (sectionRe && sectionRe.test(line.trim())) {
      pushToken(out, line, "meta");
    } else {
      const m = line.match(sep);
      if (m && !(def.lineComment ?? []).some((c) => line.trimStart().startsWith(c))) {
        pushToken(out, m[1]);
        pushToken(out, m[2], "attr");
        for (const t of scanCode(line.slice(m[0].length - m[3].length), def)) pushToken(out, t.text, t.kind);
      } else {
        for (const t of scanCode(line, def)) pushToken(out, t.text, t.kind);
      }
    }
    if (idx < lines.length - 1) pushToken(out, "\n");
  });
  return out;
}

function scanCss(src: string): HighlightToken[] {
  const out: HighlightToken[] = [];
  let depth = 0;
  let i = 0;
  while (i < src.length) {
    if (src.startsWith("/*", i)) {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      pushToken(out, src.slice(i, stop), "comment");
      i = stop;
      continue;
    }
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      const stop = readString(src, i, ch, false);
      pushToken(out, src.slice(i, stop), "string");
      i = stop;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") depth = Math.max(0, depth - 1);
    const rest = src.slice(i, i + 200);
    const at = rest.match(/^@[a-z-]+/);
    if (at) {
      pushToken(out, at[0], "keyword");
      i += at[0].length;
      continue;
    }
    if (depth > 0) {
      const prop = rest.match(/^(--)?[a-z-]+(?=\s*:)/i);
      if (prop && /[\s{;]/.test(src[i - 1] ?? " ")) {
        pushToken(out, prop[0], "property");
        i += prop[0].length;
        continue;
      }
      const num = rest.match(/^-?\d*\.?\d+(?:px|em|rem|%|vh|vw|s|ms|deg|fr|ch)?/);
      if (num && !/[\w-]/.test(src[i - 1] ?? "")) {
        pushToken(out, num[0], "number");
        i += num[0].length;
        continue;
      }
      const hex = rest.match(/^#[\da-fA-F]{3,8}\b/);
      if (hex) {
        pushToken(out, hex[0], "number");
        i += hex[0].length;
        continue;
      }
    } else {
      const sel = rest.match(/^[.#][\w-]+|^[a-z][\w-]*(?=[^;{}]*\{)/i);
      if (sel) {
        pushToken(out, sel[0], "tag");
        i += sel[0].length;
        continue;
      }
    }
    pushToken(out, ch);
    i++;
  }
  return out;
}

function scanJson(src: string): HighlightToken[] {
  const out: HighlightToken[] = [];
  for (const t of scanCode(src, JSON_DEF)) out.push({ ...t });
  // A string followed by ":" is a key.
  for (let k = 0; k < out.length; k++) {
    if (out[k].kind !== "string") continue;
    const next = out[k + 1];
    if (next && !next.kind && /^\s*:/.test(next.text)) out[k].kind = "attr";
  }
  return out;
}

function scanDiff(src: string): HighlightToken[] {
  const out: HighlightToken[] = [];
  const lines = src.split("\n");
  lines.forEach((line, idx) => {
    let kind: HighlightKind | undefined;
    if (/^(\+\+\+|---)/.test(line) || /^@@/.test(line) || /^diff /.test(line) || /^index /.test(line)) kind = "meta";
    else if (line.startsWith("+")) kind = "addition";
    else if (line.startsWith("-")) kind = "deletion";
    pushToken(out, line, kind);
    if (idx < lines.length - 1) pushToken(out, "\n");
  });
  return out;
}

/** Longest code we highlight; past this it's shown plain (keeps scrolling cheap). */
export const MAX_HIGHLIGHT_LENGTH = 20_000;

/** Tokens for `code` in `lang`, or null when the language is unknown / code too long. */
export function highlightCode(code: string, lang: string | null | undefined): HighlightToken[] | null {
  if (!lang || code.length > MAX_HIGHLIGHT_LENGTH) return null;
  const entry = LANGS[lang.toLowerCase()];
  if (!entry) return null;
  switch (entry.mode) {
    case "markup":
      return scanMarkup(code);
    case "css":
      return scanCss(code);
    case "json":
      return scanJson(code);
    case "diff":
      return scanDiff(code);
    case "yaml":
      return scanKeyValue(code, entry.def, /^(\s*-?\s*)([\w.$/-]+|"[^"]*"|'[^']*')(\s*:(?:\s|$))/);
    case "ini":
      return scanKeyValue(code, entry.def, /^(\s*)([\w.-]+)(\s*=)/, /^\[[^\]]*\]$/);
    default:
      return scanCode(code, entry.def);
  }
}
