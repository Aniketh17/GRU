import { pathToFileURL } from "node:url";

/** True when this module is the process entry point. Works on Node 20 and 22+ (unlike import.meta.main). */
export function isMain(moduleUrl: string): boolean {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(entry).href === moduleUrl;
}
