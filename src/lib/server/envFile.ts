import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const envPath = path.join(process.cwd(), ".env.local");

export async function saveLocalEnvValue(key: string, value: string) {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return;

  const current = await readEnvFile();
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${escapeRegExp(key)}=.*$`, "m");
  const next = pattern.test(current) ? current.replace(pattern, line) : `${current.trimEnd()}\n${line}\n`;
  await writeFile(envPath, next, "utf8");
}

async function readEnvFile() {
  try {
    return await readFile(envPath, "utf8");
  } catch {
    return "";
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
