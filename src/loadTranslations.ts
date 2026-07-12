import { readFile } from "node:fs/promises";
import { join } from "node:path";

export default async function loadTranslations(locale: string) {
  try {
    const data = await readFile(
      join(process.cwd(), "public", "_gt", `${locale}.json`),
      "utf8"
    );
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}
