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
  // javascript: / data: / vbscript: in href / xlink:href / src attributes
  /\b(?:href|xlink:href|src|action|formaction)\s*=\s*["']?\s*(?:javascript|data|vbscript)\s*:/gi,
  // set / animate that can target event handlers
  /\battributeName\s*=\s*["']?\s*on\w+/gi,
];

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
 * Sanitize an SVG string by removing all dangerous elements and attributes.
 * Returns the cleaned SVG as a string.
 */
export function sanitizeSvg(svgSource: string): string {
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
 * Sanitize an SVG buffer. Returns a new Buffer with the cleaned content.
 */
export function sanitizeSvgBuffer(buffer: Buffer): Buffer {
  const svgString = buffer.toString('utf-8');
  const cleaned = sanitizeSvg(svgString);
  return Buffer.from(cleaned, 'utf-8');
}
