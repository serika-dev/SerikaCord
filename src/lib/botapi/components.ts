/**
 * Message components (Discord API v10): validation, normalization and lookup.
 *
 *   v1 (any message):        action rows (1) holding buttons (2) or one select
 *                            (3 string, 5 user, 6 role, 7 mentionable, 8 channel)
 *   v2 (flags & 1<<15):      container (17), section (9), text display (10),
 *                            thumbnail (11), media gallery (12), file (13),
 *                            separator (14) and action rows, up to 40 in total
 *   modals (callback 9):     label (18) wrapping a text input (4), select or
 *                            radio/checkbox group, text display (10), legacy
 *                            action rows of text inputs
 *
 * Everything a bot sends is rebuilt from known fields only (unknown keys are
 * dropped), length-checked against Discord's limits, and every component gets a
 * numeric `id` like Discord assigns. Link buttons and media accept http(s) URLs
 * only (plus `attachment://name` for media, resolved after upload). Pure, no I/O:
 * the services call this from the bot API, webhooks and interaction responses,
 * and the click / modal-submit routes use the lookup helpers to check what a
 * user sent against what the message really contains.
 */
import { FE, FormErrors, type FormErrorPath } from './formErrors';

export const ComponentType = {
  ACTION_ROW: 1,
  BUTTON: 2,
  STRING_SELECT: 3,
  TEXT_INPUT: 4,
  USER_SELECT: 5,
  ROLE_SELECT: 6,
  MENTIONABLE_SELECT: 7,
  CHANNEL_SELECT: 8,
  SECTION: 9,
  TEXT_DISPLAY: 10,
  THUMBNAIL: 11,
  MEDIA_GALLERY: 12,
  FILE: 13,
  SEPARATOR: 14,
  CONTAINER: 17,
  LABEL: 18,
  FILE_UPLOAD: 19,
  RADIO_GROUP: 21,
  CHECKBOX_GROUP: 22,
  CHECKBOX: 23,
} as const;

export const ButtonStyle = { PRIMARY: 1, SECONDARY: 2, SUCCESS: 3, DANGER: 4, LINK: 5, PREMIUM: 6 } as const;
export const TextInputStyle = { SHORT: 1, PARAGRAPH: 2 } as const;

/** Message flag that switches a message to the components v2 layout. */
export const IS_COMPONENTS_V2 = 1 << 15;

export const COMPONENT_LIMITS = {
  ACTION_ROWS_V1: 5,
  ROW_BUTTONS: 5,
  TOTAL_V2: 40,
  TEXT_DISPLAY_TOTAL: 4000,
  CUSTOM_ID: 100,
  BUTTON_LABEL: 80,
  URL: 512,
  MEDIA_URL: 2048,
  SELECT_OPTIONS: 25,
  SELECT_OPTION_TEXT: 100,
  PLACEHOLDER: 150,
  SELECT_VALUES: 25,
  SECTION_TEXTS: 3,
  GALLERY_ITEMS: 10,
  MEDIA_DESCRIPTION: 1024,
  EMOJI_NAME: 32,
  MODAL_TITLE: 45,
  MODAL_COMPONENTS: 5,
  MODAL_LABEL: 45,
  LABEL_DESCRIPTION: 100,
  TEXT_INPUT_VALUE: 4000,
  TEXT_INPUT_PLACEHOLDER: 100,
  GROUP_OPTIONS: 10,
} as const;

export interface ComponentEmoji { id?: string; name?: string; animated?: boolean }
export interface UnfurledMedia { url: string; width?: number; height?: number; content_type?: string; attachment_id?: string }
export interface SelectOption { label: string; value: string; description?: string; emoji?: ComponentEmoji; default?: boolean }
export interface SelectDefaultValue { id: string; type: 'user' | 'role' | 'channel' }

/** A stored / serialized component (Discord JSON shape). */
export interface MessageComponent {
  type: number;
  id?: number;
  // buttons
  style?: number;
  label?: string;
  custom_id?: string;
  url?: string;
  emoji?: ComponentEmoji;
  disabled?: boolean;
  // selects
  placeholder?: string;
  min_values?: number;
  max_values?: number;
  options?: SelectOption[];
  channel_types?: number[];
  default_values?: SelectDefaultValue[];
  required?: boolean;
  // text input
  value?: string;
  min_length?: number;
  max_length?: number;
  // checkbox
  default?: boolean;
  // layout
  components?: MessageComponent[];
  component?: MessageComponent;
  accessory?: MessageComponent;
  content?: string;
  description?: string;
  media?: UnfurledMedia;
  items?: Array<{ media: UnfurledMedia; description?: string; spoiler?: boolean }>;
  file?: UnfurledMedia;
  spoiler?: boolean;
  divider?: boolean;
  spacing?: number;
  accent_color?: number | null;
}

export interface Modal { custom_id: string; title: string; components: MessageComponent[] }

const SELECT_TYPES: ReadonlySet<number> = new Set([
  ComponentType.STRING_SELECT, ComponentType.USER_SELECT, ComponentType.ROLE_SELECT,
  ComponentType.MENTIONABLE_SELECT, ComponentType.CHANNEL_SELECT,
]);

export function isSelectType(type: number): boolean {
  return SELECT_TYPES.has(type);
}

export function isComponentsV2(flags: number | null | undefined): boolean {
  return typeof flags === 'number' && (flags & IS_COMPONENTS_V2) !== 0;
}

// ─── Small field validators ─────────────────────────────────

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g;
const LINE_CONTROL_CHARS = /[\u0000-\u001F\u007F‪-‮⁦-⁩]/g;

/** Single-line UI text: drops control and bidi-override characters. */
export function cleanLabel(s: string): string {
  return s.replace(LINE_CONTROL_CHARS, '');
}

/** Multi-line text (text display content, text input values): keeps \n and \t. */
export function cleanText(s: string): string {
  return s.replace(CONTROL_CHARS, '');
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function str(
  e: FormErrors, path: FormErrorPath, v: unknown,
  o: { min?: number; max: number; required?: boolean; multiline?: boolean },
): string | undefined {
  if (v === undefined || v === null) {
    if (o.required) e.add(path, FE.REQUIRED, 'This field is required');
    return undefined;
  }
  if (typeof v !== 'string') { e.add(path, FE.BAD_TYPE, 'Must be a string.'); return undefined; }
  const s = o.multiline ? cleanText(v) : cleanLabel(v);
  const min = o.min ?? 0;
  if (s.length > o.max) { e.add(path, FE.MAX_LENGTH, `Must be ${o.max} or fewer in length.`); return undefined; }
  if (s.length < min) {
    e.add(path, min === 1 && o.required ? FE.REQUIRED : FE.MIN_LENGTH, min === 1 ? 'This field is required' : `Must be ${min} or more in length.`);
    return undefined;
  }
  return s;
}

function int(e: FormErrors, path: FormErrorPath, v: unknown, o: { min: number; max: number }): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v)) { e.add(path, FE.COERCE, 'Value is not int.'); return undefined; }
  if (v < o.min) { e.add(path, FE.MIN, `int value should be greater than or equal to ${o.min}.`); return undefined; }
  if (v > o.max) { e.add(path, FE.MAX, `int value should be less than or equal to ${o.max}.`); return undefined; }
  return v;
}

function bool(e: FormErrors, path: FormErrorPath, v: unknown): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'boolean') { e.add(path, FE.BAD_TYPE, 'Must be either true or false.'); return undefined; }
  return v;
}

/** Absolute http(s) URL without credentials, or null. */
export function safeHttpUrl(v: string, max: number = COMPONENT_LIMITS.URL): string | null {
  if (v.length > max) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const ATTACHMENT_REF = /^attachment:\/\/([^/\\\u0000-\u001F]{1,255})$/;

/** `attachment://name` → name, else null. */
export function attachmentRefName(url: string): string | null {
  const m = ATTACHMENT_REF.exec(url);
  return m ? m[1] : null;
}

const SNOWFLAKE_OR_UUID = /^(?:\d{1,20}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function emoji(e: FormErrors, path: FormErrorPath, v: unknown): ComponentEmoji | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isObj(v)) { e.add(path, FE.BAD_TYPE, 'Must be an object.'); return undefined; }
  const out: ComponentEmoji = {};
  if (v.id !== undefined && v.id !== null) {
    if (typeof v.id !== 'string' || !SNOWFLAKE_OR_UUID.test(v.id)) { e.add([...path, 'id'], FE.BAD_TYPE, 'Value is not snowflake.'); return undefined; }
    out.id = v.id.toLowerCase();
  }
  const name = str(e, [...path, 'name'], v.name, { max: COMPONENT_LIMITS.EMOJI_NAME, required: !out.id });
  if (name !== undefined) out.name = name;
  if (v.animated === true) out.animated = true;
  if (!out.id && !out.name) return undefined;
  return out;
}

function media(
  e: FormErrors, path: FormErrorPath, v: unknown, refs: Set<string>, o: { attachmentOnly?: boolean } = {},
): UnfurledMedia | undefined {
  if (!isObj(v)) { e.add(path, FE.REQUIRED, 'This field is required'); return undefined; }
  const raw = str(e, [...path, 'url'], v.url, { max: COMPONENT_LIMITS.MEDIA_URL, required: true, min: 1 });
  if (raw === undefined) return undefined;
  const ref = attachmentRefName(raw);
  if (ref) { refs.add(ref); return { url: raw }; }
  if (o.attachmentOnly) { e.add([...path, 'url'], FE.URL_SCHEME, 'Must be an attachment:// reference to an uploaded file.'); return undefined; }
  const url = safeHttpUrl(raw, COMPONENT_LIMITS.MEDIA_URL);
  if (!url) { e.add([...path, 'url'], FE.URL_SCHEME, 'Scheme must be one of (http, https, attachment).'); return undefined; }
  return { url };
}

// ─── Component trees ────────────────────────────────────────

interface Ctx {
  e: FormErrors;
  /** Interactive custom_ids seen (must be unique per message / modal). */
  customIds: Set<string>;
  /** Explicit component ids seen (must be unique). */
  ids: Set<number>;
  /** `attachment://` names referenced by media. */
  refs: Set<string>;
  /** Components counted toward the v2 total. */
  total: number;
  /** Characters across text displays. */
  textChars: number;
  v2: boolean;
}

function customId(c: Ctx, path: FormErrorPath, v: unknown): string | undefined {
  const id = str(c.e, path, v, { min: 1, max: COMPONENT_LIMITS.CUSTOM_ID, required: true });
  if (id === undefined) return undefined;
  if (c.customIds.has(id)) { c.e.add(path, FE.DUPLICATE, 'Component custom id cannot be duplicated'); return undefined; }
  c.customIds.add(id);
  return id;
}

function baseOf(c: Ctx, path: FormErrorPath, v: Record<string, unknown>, type: number): MessageComponent {
  c.total++;
  const out: MessageComponent = { type };
  const id = int(c.e, [...path, 'id'], v.id, { min: 0, max: 2147483647 });
  if (id !== undefined && id > 0) {
    if (c.ids.has(id)) c.e.add([...path, 'id'], FE.DUPLICATE, 'Component id cannot be duplicated');
    else { c.ids.add(id); out.id = id; }
  }
  return out;
}

function button(c: Ctx, path: FormErrorPath, v: Record<string, unknown>): MessageComponent {
  const out = baseOf(c, path, v, ComponentType.BUTTON);
  const style = int(c.e, [...path, 'style'], v.style, { min: 1, max: 6 });
  if (style === undefined) {
    if (v.style === undefined) c.e.add([...path, 'style'], FE.REQUIRED, 'This field is required');
    return out;
  }
  if (style === ButtonStyle.PREMIUM) {
    c.e.add([...path, 'style'], FE.CHOICES, 'Premium buttons are not supported on SerikaCord.');
    return out;
  }
  out.style = style;
  const label = str(c.e, [...path, 'label'], v.label, { max: COMPONENT_LIMITS.BUTTON_LABEL });
  if (label) out.label = label;
  const em = emoji(c.e, [...path, 'emoji'], v.emoji);
  if (em) out.emoji = em;
  if (!out.label && !out.emoji) c.e.add([...path, 'label'], FE.REQUIRED, 'A button needs a label or an emoji.');
  if (bool(c.e, [...path, 'disabled'], v.disabled)) out.disabled = true;
  if (style === ButtonStyle.LINK) {
    if (v.custom_id !== undefined && v.custom_id !== null) c.e.add([...path, 'custom_id'], FE.INVALID, 'Link buttons cannot have a custom_id.');
    const raw = str(c.e, [...path, 'url'], v.url, { min: 1, max: COMPONENT_LIMITS.URL, required: true });
    if (raw !== undefined) {
      const url = safeHttpUrl(raw);
      if (url) out.url = url;
      else c.e.add([...path, 'url'], FE.URL_SCHEME, 'Scheme must be one of (http, https).');
    }
  } else {
    if (v.url !== undefined && v.url !== null) c.e.add([...path, 'url'], FE.INVALID, 'Only link buttons can have a url.');
    const id = customId(c, [...path, 'custom_id'], v.custom_id);
    if (id !== undefined) out.custom_id = id;
  }
  return out;
}

function selectOption(c: Ctx, path: FormErrorPath, v: unknown, values: Set<string>): SelectOption | null {
  if (!isObj(v)) { c.e.add(path, FE.BAD_TYPE, 'Must be an object.'); return null; }
  const label = str(c.e, [...path, 'label'], v.label, { min: 1, max: COMPONENT_LIMITS.SELECT_OPTION_TEXT, required: true });
  const value = str(c.e, [...path, 'value'], v.value, { min: 1, max: COMPONENT_LIMITS.SELECT_OPTION_TEXT, required: true });
  if (label === undefined || value === undefined) return null;
  if (values.has(value)) { c.e.add([...path, 'value'], FE.DUPLICATE, 'Select option values must be unique.'); return null; }
  values.add(value);
  const opt: SelectOption = { label, value };
  const description = str(c.e, [...path, 'description'], v.description, { max: COMPONENT_LIMITS.SELECT_OPTION_TEXT });
  if (description) opt.description = description;
  const em = emoji(c.e, [...path, 'emoji'], v.emoji);
  if (em) opt.emoji = em;
  if (v.default === true) opt.default = true;
  return opt;
}

const DEFAULT_VALUE_TYPES: Record<number, ReadonlyArray<SelectDefaultValue['type']>> = {
  [ComponentType.USER_SELECT]: ['user'],
  [ComponentType.ROLE_SELECT]: ['role'],
  [ComponentType.MENTIONABLE_SELECT]: ['user', 'role'],
  [ComponentType.CHANNEL_SELECT]: ['channel'],
};

function select(c: Ctx, path: FormErrorPath, v: Record<string, unknown>, type: number, inModal: boolean): MessageComponent {
  const out = baseOf(c, path, v, type);
  const id = customId(c, [...path, 'custom_id'], v.custom_id);
  if (id !== undefined) out.custom_id = id;
  const placeholder = str(c.e, [...path, 'placeholder'], v.placeholder, { max: COMPONENT_LIMITS.PLACEHOLDER });
  if (placeholder) out.placeholder = placeholder;
  const min = int(c.e, [...path, 'min_values'], v.min_values, { min: 0, max: COMPONENT_LIMITS.SELECT_VALUES });
  const max = int(c.e, [...path, 'max_values'], v.max_values, { min: 1, max: COMPONENT_LIMITS.SELECT_VALUES });
  if (min !== undefined) out.min_values = min;
  if (max !== undefined) out.max_values = max;
  if ((min ?? 1) > (max ?? Math.max(1, min ?? 1))) c.e.add([...path, 'min_values'], FE.MAX, 'min_values must be less than or equal to max_values.');
  if (bool(c.e, [...path, 'disabled'], v.disabled)) {
    if (inModal) c.e.add([...path, 'disabled'], FE.INVALID, 'Selects in modals cannot be disabled.');
    else out.disabled = true;
  }
  const required = bool(c.e, [...path, 'required'], v.required);
  if (required !== undefined && inModal) out.required = required;
  if (type === ComponentType.STRING_SELECT) {
    if (!Array.isArray(v.options) || v.options.length === 0) {
      c.e.add([...path, 'options'], FE.REQUIRED, 'This field is required');
    } else if (v.options.length > COMPONENT_LIMITS.SELECT_OPTIONS) {
      c.e.add([...path, 'options'], FE.MAX_LENGTH, `Must be ${COMPONENT_LIMITS.SELECT_OPTIONS} or fewer in length.`);
    } else {
      const values = new Set<string>();
      const opts = v.options.map((o, i) => selectOption(c, [...path, 'options', i], o, values)).filter((o): o is SelectOption => !!o);
      out.options = opts;
      if ((out.max_values ?? 1) > opts.length) c.e.add([...path, 'max_values'], FE.MAX, 'max_values cannot exceed the number of options.');
    }
  } else {
    if (type === ComponentType.CHANNEL_SELECT && Array.isArray(v.channel_types)) {
      const types = v.channel_types.filter((t): t is number => Number.isInteger(t) && (t as number) >= 0 && (t as number) <= 16);
      if (types.length) out.channel_types = [...new Set(types)];
    }
    if (Array.isArray(v.default_values)) {
      const allowed = DEFAULT_VALUE_TYPES[type] ?? [];
      const defaults: SelectDefaultValue[] = [];
      v.default_values.slice(0, COMPONENT_LIMITS.SELECT_VALUES).forEach((d, i) => {
        if (!isObj(d) || typeof d.id !== 'string' || !SNOWFLAKE_OR_UUID.test(d.id) || !allowed.includes(d.type as SelectDefaultValue['type'])) {
          c.e.add([...path, 'default_values', i], FE.INVALID, 'Invalid default value.');
          return;
        }
        defaults.push({ id: d.id.toLowerCase(), type: d.type as SelectDefaultValue['type'] });
      });
      if (defaults.length) out.default_values = defaults;
    }
  }
  return out;
}

function textDisplay(c: Ctx, path: FormErrorPath, v: Record<string, unknown>): MessageComponent {
  const out = baseOf(c, path, v, ComponentType.TEXT_DISPLAY);
  const content = str(c.e, [...path, 'content'], v.content, { min: 1, max: COMPONENT_LIMITS.TEXT_DISPLAY_TOTAL, required: true, multiline: true });
  if (content !== undefined) {
    out.content = content;
    c.textChars += content.length;
  }
  return out;
}

function thumbnail(c: Ctx, path: FormErrorPath, v: Record<string, unknown>): MessageComponent {
  const out = baseOf(c, path, v, ComponentType.THUMBNAIL);
  const m = media(c.e, [...path, 'media'], v.media, c.refs);
  if (m) out.media = m;
  const description = str(c.e, [...path, 'description'], v.description, { max: COMPONENT_LIMITS.MEDIA_DESCRIPTION, multiline: true });
  if (description) out.description = description;
  if (v.spoiler === true) out.spoiler = true;
  return out;
}

function actionRow(c: Ctx, path: FormErrorPath, v: Record<string, unknown>): MessageComponent {
  const out = baseOf(c, path, v, ComponentType.ACTION_ROW);
  if (!Array.isArray(v.components) || v.components.length === 0) {
    c.e.add([...path, 'components'], FE.REQUIRED, 'This field is required');
    return out;
  }
  const children: MessageComponent[] = [];
  let buttons = 0;
  let selects = 0;
  v.components.forEach((child, i) => {
    const p = [...path, 'components', i];
    if (!isObj(child)) { c.e.add(p, FE.BAD_TYPE, 'Must be an object.'); return; }
    if (child.type === ComponentType.BUTTON) { buttons++; children.push(button(c, p, child)); }
    else if (typeof child.type === 'number' && isSelectType(child.type)) { selects++; children.push(select(c, p, child, child.type, false)); }
    else c.e.add([...p, 'type'], FE.CHOICES, 'Action rows can only contain buttons or one select menu.');
  });
  if (selects > 1 || (selects && buttons)) c.e.add([...path, 'components'], FE.LAYOUT, 'An action row holds either up to 5 buttons or a single select menu.');
  if (buttons > COMPONENT_LIMITS.ROW_BUTTONS) c.e.add([...path, 'components'], FE.LAYOUT, `The specified component exceeds the maximum width (${COMPONENT_LIMITS.ROW_BUTTONS} buttons per row).`);
  out.components = children;
  return out;
}

function section(c: Ctx, path: FormErrorPath, v: Record<string, unknown>): MessageComponent {
  const out = baseOf(c, path, v, ComponentType.SECTION);
  if (!Array.isArray(v.components) || v.components.length === 0 || v.components.length > COMPONENT_LIMITS.SECTION_TEXTS) {
    c.e.add([...path, 'components'], FE.BAD_LENGTH, `Must be between 1 and ${COMPONENT_LIMITS.SECTION_TEXTS} in length.`);
  } else {
    out.components = v.components.map((child, i) => {
      const p = [...path, 'components', i];
      if (!isObj(child) || child.type !== ComponentType.TEXT_DISPLAY) { c.e.add([...p, 'type'], FE.CHOICES, 'Sections can only contain text displays.'); return null; }
      return textDisplay(c, p, child);
    }).filter((x): x is MessageComponent => !!x);
  }
  const acc = v.accessory;
  if (!isObj(acc)) c.e.add([...path, 'accessory'], FE.REQUIRED, 'This field is required');
  else if (acc.type === ComponentType.BUTTON) out.accessory = button(c, [...path, 'accessory'], acc);
  else if (acc.type === ComponentType.THUMBNAIL) out.accessory = thumbnail(c, [...path, 'accessory'], acc);
  else c.e.add([...path, 'accessory', 'type'], FE.CHOICES, 'A section accessory must be a button or a thumbnail.');
  return out;
}

function mediaGallery(c: Ctx, path: FormErrorPath, v: Record<string, unknown>): MessageComponent {
  const out = baseOf(c, path, v, ComponentType.MEDIA_GALLERY);
  if (!Array.isArray(v.items) || v.items.length === 0 || v.items.length > COMPONENT_LIMITS.GALLERY_ITEMS) {
    c.e.add([...path, 'items'], FE.BAD_LENGTH, `Must be between 1 and ${COMPONENT_LIMITS.GALLERY_ITEMS} in length.`);
    return out;
  }
  out.items = v.items.map((item, i) => {
    const p = [...path, 'items', i];
    if (!isObj(item)) { c.e.add(p, FE.BAD_TYPE, 'Must be an object.'); return null; }
    const m = media(c.e, [...p, 'media'], item.media, c.refs);
    if (!m) return null;
    const entry: { media: UnfurledMedia; description?: string; spoiler?: boolean } = { media: m };
    const description = str(c.e, [...p, 'description'], item.description, { max: COMPONENT_LIMITS.MEDIA_DESCRIPTION, multiline: true });
    if (description) entry.description = description;
    if (item.spoiler === true) entry.spoiler = true;
    return entry;
  }).filter((x): x is { media: UnfurledMedia } => !!x);
  return out;
}

function fileComponent(c: Ctx, path: FormErrorPath, v: Record<string, unknown>): MessageComponent {
  const out = baseOf(c, path, v, ComponentType.FILE);
  const f = media(c.e, [...path, 'file'], v.file, c.refs, { attachmentOnly: true });
  if (f) out.file = f;
  if (v.spoiler === true) out.spoiler = true;
  return out;
}

function separator(c: Ctx, path: FormErrorPath, v: Record<string, unknown>): MessageComponent {
  const out = baseOf(c, path, v, ComponentType.SEPARATOR);
  const divider = bool(c.e, [...path, 'divider'], v.divider);
  out.divider = divider ?? true;
  const spacing = int(c.e, [...path, 'spacing'], v.spacing, { min: 1, max: 2 });
  out.spacing = spacing ?? 1;
  return out;
}

/** Any component allowed at the top level of a v2 message or inside a container. */
function v2Block(c: Ctx, path: FormErrorPath, v: unknown, inContainer: boolean): MessageComponent | null {
  if (!isObj(v)) { c.e.add(path, FE.BAD_TYPE, 'Must be an object.'); return null; }
  switch (v.type) {
    case ComponentType.ACTION_ROW: return actionRow(c, path, v);
    case ComponentType.SECTION: return section(c, path, v);
    case ComponentType.TEXT_DISPLAY: return textDisplay(c, path, v);
    case ComponentType.MEDIA_GALLERY: return mediaGallery(c, path, v);
    case ComponentType.FILE: return fileComponent(c, path, v);
    case ComponentType.SEPARATOR: return separator(c, path, v);
    case ComponentType.THUMBNAIL:
      c.e.add([...path, 'type'], FE.CHOICES, 'Thumbnails can only be used as a section accessory.');
      return null;
    case ComponentType.CONTAINER: {
      if (inContainer) { c.e.add([...path, 'type'], FE.CHOICES, 'Containers cannot be nested.'); return null; }
      const out = baseOf(c, path, v, ComponentType.CONTAINER);
      const accent = v.accent_color === null ? null : int(c.e, [...path, 'accent_color'], v.accent_color, { min: 0, max: 0xffffff });
      if (accent !== undefined) out.accent_color = accent;
      if (v.spoiler === true) out.spoiler = true;
      if (!Array.isArray(v.components) || v.components.length === 0) {
        c.e.add([...path, 'components'], FE.REQUIRED, 'This field is required');
      } else {
        out.components = v.components
          .map((child, i) => v2Block(c, [...path, 'components', i], child, true))
          .filter((x): x is MessageComponent => !!x);
      }
      return out;
    }
    default:
      c.e.add([...path, 'type'], FE.CHOICES, 'Value must be one of {1, 9, 10, 12, 13, 14, 17}.');
      return null;
  }
}

/** Give every component without an explicit id the next free one (Discord does the same). */
function assignIds(list: MessageComponent[], used: Set<number>): void {
  let next = 1;
  const visit = (comp: MessageComponent) => {
    if (comp.id === undefined) {
      while (used.has(next)) next++;
      comp.id = next;
      used.add(next);
    }
    comp.components?.forEach(visit);
    if (comp.component) visit(comp.component);
    if (comp.accessory) visit(comp.accessory);
  };
  list.forEach(visit);
}

export interface ValidatedComponents {
  components: MessageComponent[];
  /** `attachment://` names the media / file components reference. */
  attachmentRefs: string[];
}

/**
 * Validate `components` from a bot message create/edit, webhook execute or
 * interaction response. Adds errors to `errors` (under `components`) and
 * returns the normalized list (null when nothing usable / on error). Pass the
 * message flags: with IS_COMPONENTS_V2 the v2 layout rules apply.
 */
export function validateMessageComponents(
  input: unknown,
  opts: { flags?: number | null; errors: FormErrors; path?: FormErrorPath },
): ValidatedComponents | null {
  const e = opts.errors;
  const path = opts.path ?? ['components'];
  if (input === undefined || input === null) return null;
  if (!Array.isArray(input)) { e.add(path, FE.BAD_TYPE, 'Must be an array.'); return null; }
  const before = e.count;
  const c: Ctx = { e, customIds: new Set(), ids: new Set(), refs: new Set(), total: 0, textChars: 0, v2: isComponentsV2(opts.flags) };
  const out: MessageComponent[] = [];
  if (c.v2) {
    input.forEach((v, i) => {
      const block = v2Block(c, [...path, i], v, false);
      if (block) out.push(block);
    });
    if (c.total > COMPONENT_LIMITS.TOTAL_V2) e.add(path, FE.MAX_LENGTH, `Must be ${COMPONENT_LIMITS.TOTAL_V2} or fewer components in total.`);
    if (c.textChars > COMPONENT_LIMITS.TEXT_DISPLAY_TOTAL) e.add(path, FE.MAX_LENGTH, `Text displays must be ${COMPONENT_LIMITS.TEXT_DISPLAY_TOTAL} or fewer characters in total.`);
  } else {
    if (input.length > COMPONENT_LIMITS.ACTION_ROWS_V1) e.add(path, FE.MAX_LENGTH, `Must be ${COMPONENT_LIMITS.ACTION_ROWS_V1} or fewer in length.`);
    input.slice(0, COMPONENT_LIMITS.ACTION_ROWS_V1).forEach((v, i) => {
      const p = [...path, i];
      if (!isObj(v)) { e.add(p, FE.BAD_TYPE, 'Must be an object.'); return; }
      if (v.type !== ComponentType.ACTION_ROW) {
        e.add([...p, 'type'], FE.CHOICES, 'Top-level components must be action rows unless the IS_COMPONENTS_V2 flag is set.');
        return;
      }
      out.push(actionRow(c, p, v));
    });
  }
  if (e.count > before) return null;
  assignIds(out, c.ids);
  return { components: out, attachmentRefs: [...c.refs] };
}

export interface ResolvableAttachment {
  id: string;
  filename: string;
  url: string;
  contentType?: string;
  width?: number;
  height?: number;
}

/**
 * Replace `attachment://name` media URLs with the uploaded file's URL (adding
 * `attachment_id`, size and type). Returns the unknown name on failure.
 */
export function resolveAttachmentRefs(
  components: MessageComponent[],
  attachments: ResolvableAttachment[],
): { ok: true; components: MessageComponent[] } | { ok: false; missing: string } {
  const byName = new Map(attachments.map((a) => [a.filename, a]));
  let missing: string | null = null;
  const fix = (m: UnfurledMedia | undefined): UnfurledMedia | undefined => {
    if (!m) return m;
    const name = attachmentRefName(m.url);
    if (!name) return m;
    const a = byName.get(name);
    if (!a) { missing ??= name; return m; }
    return {
      url: a.url,
      attachment_id: a.id,
      ...(a.contentType ? { content_type: a.contentType } : {}),
      ...(a.width ? { width: a.width } : {}),
      ...(a.height ? { height: a.height } : {}),
    };
  };
  const walk = (comp: MessageComponent): MessageComponent => {
    const next: MessageComponent = { ...comp };
    if (next.media) next.media = fix(next.media);
    if (next.file) next.file = fix(next.file);
    if (next.items) next.items = next.items.map((it) => ({ ...it, media: fix(it.media)! }));
    if (next.components) next.components = next.components.map(walk);
    if (next.accessory) next.accessory = walk(next.accessory);
    return next;
  };
  const out = components.map(walk);
  return missing ? { ok: false, missing } : { ok: true, components: out };
}

// ─── Reading stored components ──────────────────────────────

/** Every component in a tree, depth-first (rows, containers, section accessories, labels). */
export function* walkComponents(list: readonly MessageComponent[] | null | undefined): Generator<MessageComponent> {
  if (!Array.isArray(list)) return;
  for (const comp of list) {
    if (!comp || typeof comp !== 'object') continue;
    yield comp;
    if (comp.components) yield* walkComponents(comp.components);
    if (comp.component) yield* walkComponents([comp.component]);
    if (comp.accessory) yield* walkComponents([comp.accessory]);
  }
}

/** The interactive component (button / select) with this custom_id, or null. */
export function findInteractiveComponent(
  list: readonly MessageComponent[] | null | undefined,
  id: string,
): MessageComponent | null {
  for (const comp of walkComponents(list)) {
    if (comp.custom_id === id && (comp.type === ComponentType.BUTTON || isSelectType(comp.type))) return comp;
  }
  return null;
}

/** Stored components as JSON a client or bot may see (null when absent / malformed). */
export function parseStoredComponents(value: unknown): MessageComponent[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.filter((c) => c && typeof c === 'object' && typeof (c as MessageComponent).type === 'number') as MessageComponent[];
}

/** Plain text of a v2 message (text displays), for notifications and search previews. */
export function componentsPlainText(list: readonly MessageComponent[] | null | undefined, max = 500): string {
  const parts: string[] = [];
  for (const comp of walkComponents(list)) {
    if (comp.type === ComponentType.TEXT_DISPLAY && comp.content) parts.push(comp.content);
  }
  const text = parts.join('\n');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export type ComponentClickCheck =
  | { ok: true; component: MessageComponent; values?: string[] }
  | { ok: false; reason: 'unknown' | 'disabled' | 'type' | 'values' };

/**
 * Check a user's click / selection against the message's stored components:
 * the custom_id must exist on an enabled component of that type, and select
 * values must fit min/max (string selects: only declared option values; the
 * user/role/channel ids of entity selects are checked by the caller).
 */
export function checkComponentClick(
  list: readonly MessageComponent[] | null | undefined,
  input: { customId: string; componentType: number; values?: unknown },
): ComponentClickCheck {
  const component = findInteractiveComponent(list, input.customId);
  if (!component) return { ok: false, reason: 'unknown' };
  if (component.type !== input.componentType) return { ok: false, reason: 'type' };
  if (component.disabled) return { ok: false, reason: 'disabled' };
  if (component.type === ComponentType.BUTTON) {
    if (component.style === ButtonStyle.LINK || !component.custom_id) return { ok: false, reason: 'type' };
    return { ok: true, component };
  }
  if (!Array.isArray(input.values) || input.values.some((v) => typeof v !== 'string' || v.length === 0 || v.length > 100)) {
    return { ok: false, reason: 'values' };
  }
  const values = [...new Set(input.values as string[])];
  const min = component.min_values ?? 1;
  const max = component.max_values ?? 1;
  if (values.length < min || values.length > max || values.length > COMPONENT_LIMITS.SELECT_VALUES) return { ok: false, reason: 'values' };
  if (component.type === ComponentType.STRING_SELECT) {
    const allowed = new Set((component.options ?? []).map((o) => o.value));
    if (values.some((v) => !allowed.has(v))) return { ok: false, reason: 'values' };
  }
  return { ok: true, component, values };
}

/** A copy of the tree with every interactive component disabled (e.g. after a failed delivery). */
export function withAllDisabled(list: readonly MessageComponent[]): MessageComponent[] {
  const walk = (comp: MessageComponent): MessageComponent => {
    const next: MessageComponent = { ...comp };
    if ((next.type === ComponentType.BUTTON && next.style !== ButtonStyle.LINK) || isSelectType(next.type)) next.disabled = true;
    if (next.components) next.components = next.components.map(walk);
    if (next.accessory) next.accessory = walk(next.accessory);
    return next;
  };
  return list.map(walk);
}

// ─── Modals ─────────────────────────────────────────────────

function textInput(c: Ctx, path: FormErrorPath, v: Record<string, unknown>, legacy: boolean): MessageComponent {
  const out = baseOf(c, path, v, ComponentType.TEXT_INPUT);
  const id = customId(c, [...path, 'custom_id'], v.custom_id);
  if (id !== undefined) out.custom_id = id;
  const style = int(c.e, [...path, 'style'], v.style, { min: 1, max: 2 });
  out.style = style ?? TextInputStyle.SHORT;
  if (v.style === undefined) c.e.add([...path, 'style'], FE.REQUIRED, 'This field is required');
  if (legacy || v.label !== undefined) {
    const label = str(c.e, [...path, 'label'], v.label, { min: 1, max: COMPONENT_LIMITS.MODAL_LABEL, required: legacy });
    if (label) out.label = label;
  }
  const min = int(c.e, [...path, 'min_length'], v.min_length, { min: 0, max: COMPONENT_LIMITS.TEXT_INPUT_VALUE });
  const max = int(c.e, [...path, 'max_length'], v.max_length, { min: 1, max: COMPONENT_LIMITS.TEXT_INPUT_VALUE });
  if (min !== undefined) out.min_length = min;
  if (max !== undefined) out.max_length = max;
  if (min !== undefined && max !== undefined && min > max) c.e.add([...path, 'min_length'], FE.MAX, 'min_length must be less than or equal to max_length.');
  const required = bool(c.e, [...path, 'required'], v.required);
  out.required = required ?? true;
  const value = str(c.e, [...path, 'value'], v.value, { max: COMPONENT_LIMITS.TEXT_INPUT_VALUE, multiline: true });
  if (value) out.value = value;
  const placeholder = str(c.e, [...path, 'placeholder'], v.placeholder, { max: COMPONENT_LIMITS.TEXT_INPUT_PLACEHOLDER });
  if (placeholder) out.placeholder = placeholder;
  return out;
}

function choiceGroup(c: Ctx, path: FormErrorPath, v: Record<string, unknown>, type: number): MessageComponent {
  const out = baseOf(c, path, v, type);
  const id = customId(c, [...path, 'custom_id'], v.custom_id);
  if (id !== undefined) out.custom_id = id;
  const required = bool(c.e, [...path, 'required'], v.required);
  if (required !== undefined) out.required = required;
  if (type === ComponentType.CHECKBOX) {
    if (v.default === true) out.default = true;
    return out;
  }
  const minOptions = type === ComponentType.RADIO_GROUP ? 2 : 1;
  if (!Array.isArray(v.options) || v.options.length < minOptions || v.options.length > COMPONENT_LIMITS.GROUP_OPTIONS) {
    c.e.add([...path, 'options'], FE.BAD_LENGTH, `Must be between ${minOptions} and ${COMPONENT_LIMITS.GROUP_OPTIONS} in length.`);
    return out;
  }
  const values = new Set<string>();
  out.options = v.options.map((o, i) => selectOption(c, [...path, 'options', i], o, values)).filter((o): o is SelectOption => !!o);
  if (type === ComponentType.CHECKBOX_GROUP) {
    const min = int(c.e, [...path, 'min_values'], v.min_values, { min: 0, max: COMPONENT_LIMITS.GROUP_OPTIONS });
    const max = int(c.e, [...path, 'max_values'], v.max_values, { min: 1, max: COMPONENT_LIMITS.GROUP_OPTIONS });
    if (min !== undefined) out.min_values = min;
    if (max !== undefined) out.max_values = max;
  }
  return out;
}

function labelled(c: Ctx, path: FormErrorPath, v: Record<string, unknown>): MessageComponent {
  const out = baseOf(c, path, v, ComponentType.LABEL);
  const label = str(c.e, [...path, 'label'], v.label, { min: 1, max: COMPONENT_LIMITS.MODAL_LABEL, required: true });
  if (label) out.label = label;
  const description = str(c.e, [...path, 'description'], v.description, { max: COMPONENT_LIMITS.LABEL_DESCRIPTION });
  if (description) out.description = description;
  const inner = v.component;
  const p = [...path, 'component'];
  if (!isObj(inner)) { c.e.add(p, FE.REQUIRED, 'This field is required'); return out; }
  const t = inner.type;
  if (t === ComponentType.TEXT_INPUT) out.component = textInput(c, p, inner, false);
  else if (typeof t === 'number' && isSelectType(t)) out.component = select(c, p, inner, t, true);
  else if (t === ComponentType.RADIO_GROUP || t === ComponentType.CHECKBOX_GROUP || t === ComponentType.CHECKBOX) out.component = choiceGroup(c, p, inner, t);
  else c.e.add([...p, 'type'], FE.CHOICES, 'A label can hold a text input, a select menu, a radio group, a checkbox group or a checkbox.');
  return out;
}

/** Validate callback type 9 (MODAL) data. */
export function validateModal(input: unknown, errors: FormErrors, path: FormErrorPath = ['data']): Modal | null {
  const before = errors.count;
  if (!isObj(input)) { errors.add(path, FE.REQUIRED, 'This field is required'); return null; }
  const c: Ctx = { e: errors, customIds: new Set(), ids: new Set(), refs: new Set(), total: 0, textChars: 0, v2: false };
  const custom_id = str(errors, [...path, 'custom_id'], input.custom_id, { min: 1, max: COMPONENT_LIMITS.CUSTOM_ID, required: true });
  const title = str(errors, [...path, 'title'], input.title, { min: 1, max: COMPONENT_LIMITS.MODAL_TITLE, required: true });
  const list = input.components;
  const comps: MessageComponent[] = [];
  if (!Array.isArray(list) || list.length === 0 || list.length > COMPONENT_LIMITS.MODAL_COMPONENTS) {
    errors.add([...path, 'components'], FE.BAD_LENGTH, `Must be between 1 and ${COMPONENT_LIMITS.MODAL_COMPONENTS} in length.`);
  } else {
    list.forEach((v, i) => {
      const p = [...path, 'components', i];
      if (!isObj(v)) { errors.add(p, FE.BAD_TYPE, 'Must be an object.'); return; }
      if (v.type === ComponentType.LABEL) comps.push(labelled(c, p, v));
      else if (v.type === ComponentType.TEXT_DISPLAY) comps.push(textDisplay(c, p, v));
      else if (v.type === ComponentType.ACTION_ROW) {
        // Legacy modal layout: an action row with exactly one text input.
        const row = baseOf(c, p, v, ComponentType.ACTION_ROW);
        const inner = Array.isArray(v.components) ? v.components : [];
        if (inner.length !== 1 || !isObj(inner[0]) || inner[0].type !== ComponentType.TEXT_INPUT) {
          errors.add([...p, 'components'], FE.LAYOUT, 'Modal action rows hold exactly one text input.');
          return;
        }
        row.components = [textInput(c, [...p, 'components', 0], inner[0], true)];
        comps.push(row);
      } else {
        errors.add([...p, 'type'], FE.CHOICES, 'Value must be one of {1, 10, 18}.');
      }
    });
  }
  if (errors.count > before || custom_id === undefined || title === undefined) return null;
  assignIds(comps, c.ids);
  return { custom_id, title, components: comps };
}

/** The fields of a modal a user fills in (text inputs and label-wrapped inputs). */
export function modalInputs(modal: Modal): MessageComponent[] {
  const out: MessageComponent[] = [];
  for (const comp of modal.components) {
    if (comp.type === ComponentType.ACTION_ROW) out.push(...(comp.components ?? []));
    else if (comp.type === ComponentType.LABEL && comp.component) out.push(comp.component);
  }
  return out;
}

export type ModalSubmitValue = { custom_id: string; value?: unknown; values?: unknown };

/** Ids picked in a modal's entity selects, by kind (role selects resolve to roles only). */
export interface ModalEntityIds {
  users: string[];
  roles: string[];
  channels: string[];
  mentionables: string[];
  /** Channel selects with channel_types: the picked channels must be of those types. */
  channelTypes: Array<{ values: string[]; types: number[] }>;
}

/** Do the resolved channels (Discord partials with `type`) fit each select's channel_types? */
export function channelTypesAllowed(
  checks: Array<{ values: string[]; types: number[] }>,
  resolvedChannels: Record<string, unknown> | undefined,
): boolean {
  for (const { values, types } of checks) {
    for (const v of values) {
      const entry = Object.entries(resolvedChannels ?? {}).find(([k]) => k.toLowerCase() === v.toLowerCase())?.[1] as { type?: unknown } | undefined;
      if (!entry || typeof entry.type !== 'number' || !types.includes(entry.type)) return false;
    }
  }
  return true;
}

/**
 * Check a modal submission against the stored modal and build the
 * `data.components` Discord sends with MODAL_SUBMIT (same layout as the modal,
 * with `value` / `values` filled in). Entity-select ids are returned for the
 * caller to verify and resolve.
 */
export function buildModalSubmit(
  modal: Modal,
  submitted: ModalSubmitValue[],
 ): { ok: true; components: MessageComponent[]; entityIds: ModalEntityIds } | { ok: false; field: string; reason: string } {
  const byId = new Map<string, ModalSubmitValue>();
  for (const s of submitted.slice(0, 50)) {
    if (s && typeof s.custom_id === 'string') byId.set(s.custom_id, s);
  }
  const entityIds: ModalEntityIds = { users: [], roles: [], channels: [], mentionables: [], channelTypes: [] };
  let failure: { field: string; reason: string } | null = null;

  const fill = (comp: MessageComponent): MessageComponent => {
    const id = comp.custom_id ?? '';
    const sub = byId.get(id);
    const base: MessageComponent = { type: comp.type, id: comp.id, custom_id: id };
    if (comp.type === ComponentType.TEXT_INPUT) {
      const raw = sub?.value;
      const value = typeof raw === 'string' ? cleanText(raw) : '';
      const required = comp.required !== false;
      if (raw !== undefined && typeof raw !== 'string') failure ??= { field: id, reason: 'type' };
      else if (required && value.length === 0) failure ??= { field: id, reason: 'required' };
      else if (value.length > (comp.max_length ?? COMPONENT_LIMITS.TEXT_INPUT_VALUE)) failure ??= { field: id, reason: 'max_length' };
      else if (value.length > 0 && value.length < (comp.min_length ?? 0)) failure ??= { field: id, reason: 'min_length' };
      return { ...base, value };
    }
    if (comp.type === ComponentType.CHECKBOX) {
      const raw = sub?.value;
      if (raw !== undefined && typeof raw !== 'boolean') failure ??= { field: id, reason: 'type' };
      if (comp.required && raw !== true) failure ??= { field: id, reason: 'required' };
      return { ...base, value: raw === true } as unknown as MessageComponent;
    }
    const raw = sub?.values;
    const values = Array.isArray(raw) ? [...new Set(raw.filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 100))] : [];
    if (raw !== undefined && (!Array.isArray(raw) || values.length !== raw.length)) failure ??= { field: id, reason: 'values' };
    const required = comp.required !== false;
    const min = comp.type === ComponentType.RADIO_GROUP ? (required ? 1 : 0) : (comp.min_values ?? (required ? 1 : 0));
    const max = comp.type === ComponentType.RADIO_GROUP ? 1 : (comp.max_values ?? (comp.type === ComponentType.CHECKBOX_GROUP ? (comp.options?.length ?? 1) : 1));
    if (values.length > 0 || required) {
      if (values.length < min || values.length > max) failure ??= { field: id, reason: 'values' };
    }
    if (comp.type === ComponentType.STRING_SELECT || comp.type === ComponentType.RADIO_GROUP || comp.type === ComponentType.CHECKBOX_GROUP) {
      const allowed = new Set((comp.options ?? []).map((o) => o.value));
      if (values.some((v) => !allowed.has(v))) failure ??= { field: id, reason: 'values' };
      if (comp.type === ComponentType.RADIO_GROUP) return { ...base, value: values[0] ?? null } as unknown as MessageComponent;
    } else if (comp.type === ComponentType.USER_SELECT) entityIds.users.push(...values);
    else if (comp.type === ComponentType.ROLE_SELECT) entityIds.roles.push(...values);
    else if (comp.type === ComponentType.CHANNEL_SELECT) {
      entityIds.channels.push(...values);
      if (comp.channel_types?.length && values.length) entityIds.channelTypes.push({ values, types: comp.channel_types });
    } else if (comp.type === ComponentType.MENTIONABLE_SELECT) entityIds.mentionables.push(...values);
    return { ...base, values } as MessageComponent;
  };

  const components = modal.components.map((comp): MessageComponent => {
    if (comp.type === ComponentType.ACTION_ROW) return { type: comp.type, id: comp.id, components: (comp.components ?? []).map(fill) };
    if (comp.type === ComponentType.LABEL && comp.component) return { type: comp.type, id: comp.id, component: fill(comp.component) };
    return { type: comp.type, id: comp.id };
  });
  if (failure) return { ok: false, ...(failure as { field: string; reason: string }) };
  return { ok: true, components, entityIds };
}
