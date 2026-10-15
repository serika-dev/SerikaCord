/**
 * Discord "Invalid Form Body" (50035) error trees, e.g.
 *
 *   { "code": 50035, "message": "Invalid Form Body",
 *     "errors": { "components": { "0": { "custom_id": { "_errors": [
 *       { "code": "BASE_TYPE_MAX_LENGTH", "message": "Must be 100 or fewer in length." } ] } } } } }
 *
 * Libraries (discord.js DiscordAPIError, discord.py HTTPException) flatten the
 * tree into readable paths, so every validator here reports where it failed.
 * Pure, no I/O.
 */

export type FormErrorPath = Array<string | number>;
export interface FormErrorLeaf { code: string; message: string }
export type FormErrorTree = { _errors?: FormErrorLeaf[]; [key: string]: FormErrorTree | FormErrorLeaf[] | undefined };

export interface DiscordFormError {
  code: 50035;
  message: string;
  errors: FormErrorTree;
}

/** Collects errors at paths; `ok` until the first one is added. */
export class FormErrors {
  readonly tree: FormErrorTree = {};
  count = 0;
  private first: string | null = null;

  add(path: FormErrorPath, code: string, message: string): void {
    this.count++;
    if (!this.first) this.first = `${path.join('.') || 'body'}: ${message}`;
    let node: FormErrorTree = this.tree;
    for (const seg of path) {
      const key = String(seg);
      const next = node[key];
      if (!next || Array.isArray(next)) node[key] = {};
      node = node[key] as FormErrorTree;
    }
    (node._errors ??= []).push({ code, message });
  }

  get ok(): boolean {
    return this.count === 0;
  }

  /** First error as one line ("components.0.custom_id: Must be ..."), for logs and plain clients. */
  get summary(): string {
    return this.first ?? '';
  }

  toBody(): DiscordFormError {
    return { code: 50035, message: this.first ? `Invalid Form Body (${this.first})` : 'Invalid Form Body', errors: this.tree };
  }
}

/** A one-error 50035 body. */
export function formError(path: FormErrorPath, code: string, message: string): DiscordFormError {
  const e = new FormErrors();
  e.add(path, code, message);
  return e.toBody();
}

// Discord's error codes for the common failures.
export const FE = {
  REQUIRED: 'BASE_TYPE_REQUIRED',
  BAD_TYPE: 'BASE_TYPE_BAD_TYPE',
  MAX_LENGTH: 'BASE_TYPE_MAX_LENGTH',
  MIN_LENGTH: 'BASE_TYPE_MIN_LENGTH',
  BAD_LENGTH: 'BASE_TYPE_BAD_LENGTH',
  CHOICES: 'BASE_TYPE_CHOICES',
  MAX: 'NUMBER_TYPE_MAX',
  MIN: 'NUMBER_TYPE_MIN',
  COERCE: 'NUMBER_TYPE_COERCE',
  URL: 'URL_TYPE_INVALID_URL',
  URL_SCHEME: 'URL_TYPE_INVALID_SCHEME',
  DUPLICATE: 'COMPONENT_CUSTOM_ID_DUPLICATED',
  LAYOUT: 'COMPONENT_LAYOUT_WIDTH_EXCEEDED',
  INVALID: 'COMPONENT_INVALID',
  APP_CMD_NAME: 'APPLICATION_COMMAND_INVALID_NAME',
  APP_CMD_DUPLICATE: 'APPLICATION_COMMANDS_DUPLICATE_NAME',
  APP_CMD_TOO_LARGE: 'APPLICATION_COMMAND_TOO_LARGE',
  APP_CMD_OPTIONS_ORDER: 'APPLICATION_COMMAND_OPTIONS_ORDER_INVALID',
  APP_CMD_OPTIONS_DUPLICATE: 'APPLICATION_COMMAND_OPTIONS_NAME_ALREADY_EXISTS',
  APP_CMD_OPTIONS_TYPE: 'APPLICATION_COMMAND_OPTIONS_TYPE_INVALID',
} as const;
