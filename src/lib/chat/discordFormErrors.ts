/**
 * Discord-style "Invalid Form Body" errors (code 50035) with the nested
 * `errors` tree, for the bot API's message validation:
 *
 *   { code: 50035, message: 'Invalid Form Body',
 *     errors: { embeds: { 0: { title: { _errors: [{ code, message }] } } } } }
 *
 * Pure, so the validators that build these trees are unit tested. The bot API
 * may later share a single helper for every route (WP0); this one only covers
 * the message routes.
 */

export interface FormErrorItem { code: string; message: string }
export interface FormErrorTree { _errors?: FormErrorItem[]; [key: string]: FormErrorTree | FormErrorItem[] | undefined }

export type FormPath = ReadonlyArray<string | number>;

/** Add one error at `path` (an empty path puts it on the root). Mutates and returns `tree`. */
export function addFormError(tree: FormErrorTree, path: FormPath, code: string, message: string): FormErrorTree {
  let node = tree;
  for (const part of path) {
    const key = String(part);
    const next = node[key];
    if (!next || Array.isArray(next)) node[key] = {};
    node = node[key] as FormErrorTree;
  }
  (node._errors ??= []).push({ code, message });
  return tree;
}

export function hasFormErrors(tree: FormErrorTree): boolean {
  return Object.keys(tree).length > 0;
}

/** The 400 body for a failed validation. */
export function invalidFormBody(errors: FormErrorTree): { code: 50035; message: string; errors: FormErrorTree } {
  return { code: 50035, message: 'Invalid Form Body', errors };
}

/** Shorthand: a body with one error at `path`. */
export function formError(path: FormPath, code: string, message: string) {
  return invalidFormBody(addFormError({}, path, code, message));
}
