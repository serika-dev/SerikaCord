/**
 * SVG Sanitizer — strips dangerous elements and attributes from SVG files
 * before they are stored. This prevents stored XSS if a user opens the
 * SVG URL directly in a browser tab (outside of an <img> tag).
 *
 * Strategy: parse as text, strip everything known-dangerous via regex.
 * We do NOT try to build a full DOM — that would require a heavy dependency.
 * Instead we use an aggressive allowlist approach on elements and attributes.
 */

// Elements that are dangerous in SVGs and must be removed entirely
const DANGEROUS_ELEMENTS = [
  'script',
  'foreignObject',
  'iframe',
  'object',
  'embed',
  'applet',
  'form',
  'input',
  'textarea',
  'button',
  'select',
  'option',
];

// Attributes that can execute script — removed from ALL elements
const DANGEROUS_ATTR_PATTERNS = [
  // Event handlers: onclick, onload, onmouseover, onerror, etc.
  /\bon\w+\s*=/gi,
  // set / animate that can target event handlers
  /\battributeName\s*=\s*["']?\s*on\w+/gi,
];

// URL-bearing attributes whose value is checked for script schemes after
// entity decoding (browsers decode `&#106;avascript:` before use).
const URL_ATTR = /\b(?:href|xlink:href|src|action|formaction)\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi;
const DANGEROUS_SCHEME = /^(?:javascript|data|vbscript):/i;

const NAMED_ENTITIES: Record<string, string> = {
  colon: ':', tab: '\t', newline: '\n', lpar: '(', rpar: ')', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>',
};

/** Decode numeric and the few relevant named entities in an attribute value. */
export function decodeAttrEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? m;
  });
}

function isDangerousUrlValue(raw: string): boolean {
  const unquoted = raw.replace(/^["']|["']$/g, '');
  // Browsers ignore ASCII whitespace/control chars inside the scheme.
  const decoded = decodeAttrEntities(unquoted).replace(/[\u0000-\u0020]/g, '');
  return DANGEROUS_SCHEME.test(decoded);
}

/**
 * Remove an entire element (open tag through close tag, or self-closing) from
 * the SVG source. Handles both <script>...</script> and <script ... /> forms.
 */
function stripElement(svg: string, tagName: string): string {
  // Remove paired tags: <script ...>...</script>  (case-insensitive, dotAll)
  const paired = new RegExp(
    `<${tagName}\\b[^>]*>[\\s\\S]*?</${tagName}\\s*>`,
    'gi'
  );
  svg = svg.replace(paired, '');

  // Remove self-closing: <script ... />
  const selfClosing = new RegExp(`<${tagName}\\b[^>]*/>`, 'gi');
  svg = svg.replace(selfClosing, '');

  // Remove orphaned opening tags (malformed SVGs): <script ...>
  const orphan = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  svg = svg.replace(orphan, '');

  return svg;
}

/**
 * One sanitization pass (see sanitizeSvg, which repeats it to a fixpoint).
 */
function sanitizeOnce(svgSource: string): string {
  let svg = svgSource;

  // 1. Strip dangerous elements
  for (const tag of DANGEROUS_ELEMENTS) {
    svg = stripElement(svg, tag);
  }

  // 2. Strip dangerous attributes from remaining elements
  for (const pattern of DANGEROUS_ATTR_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    // Remove the entire attribute (key="value" or key='value' or key=value)
    // We match the attribute pattern then consume through the closing quote
    svg = svg.replace(
      new RegExp(
        // Match attribute name=, then a quoted or unquoted value
        pattern.source + `\\s*(?:"[^"]*"|'[^']*'|[^\\s>]*)`,
        'gi'
      ),
      ''
    );
  }

  // URL attributes with script schemes (entity-decoded)
  svg = svg.replace(URL_ATTR, (m, value: string) => (isDangerousUrlValue(value) ? '' : m));

  // 3. Strip <!-- ... --> HTML comments that might hide payloads
  // (keep XML processing instructions like <?xml ... ?>)
  // Actually, SVG comments are harmless — skip this to preserve valid files.

  // 4. Strip <use> with external references (can load cross-origin SVGs)
  svg = svg.replace(
    /<use\b[^>]*\bhref\s*=\s*["']https?:\/\/[^"']*["'][^>]*\/?>/gi,
    ''
  );
  svg = svg.replace(
    /<use\b[^>]*\bxlink:href\s*=\s*["']https?:\/\/[^"']*["'][^>]*\/?>/gi,
    ''
  );

  return svg;
}

/**
 * Sanitize an SVG string by removing all dangerous elements and attributes.
 * Runs to a fixpoint: a single regex pass can rebuild a tag from fragments
 * (`<scr<script>ipt>`), so repeat until the output stops changing.
 */
export function sanitizeSvg(svgSource: string): string {
  let svg = svgSource;
  for (let i = 0; i < 20; i++) {
    const next = sanitizeOnce(svg);
    if (next === svg) return svg;
    svg = next;
  }
  // Still changing after many passes: input is adversarial, refuse it.
  return '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
}

/**
 * Sanitize an SVG buffer. Returns a new Buffer with the cleaned content.
 */
export function sanitizeSvgBuffer(buffer: Buffer): Buffer {
  const svgString = buffer.toString('utf-8');
  const cleaned = sanitizeSvg(svgString);
  return Buffer.from(cleaned, 'utf-8');
}
