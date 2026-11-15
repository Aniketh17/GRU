// Small terminal helpers for GRU's local scripts. Node only; no dependencies.
import { spawnSync } from "node:child_process";
import readline from "node:readline";

export async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (a) => {
      rl.close();
      resolve(a);
    }),
  );
}

/** Reads a line without echoing it. Falls back to visible input if stdin isn't a TTY. */
export async function askHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    process.stderr.write("(warning: this terminal can't hide input; use PowerShell or Windows Terminal)\n");
    return ask(question);
  }
  process.stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  let value = "";
  return new Promise((resolve) => {
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") process.exit(130); // Ctrl+C
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

export async function confirm(question: string): Promise<boolean> {
  return (await ask(`${question} [y/N] `)).trim().toLowerCase() === "y";
}

export type Exec = (args: string[], input?: string) => number;

/** Runs `npx wrangler <args>`. Secret values go through stdin, never argv. */
export const wrangler: Exec = (args, input) => {
  const r = spawnSync("npx", ["wrangler", ...args], {
    stdio: input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
    input,
    shell: process.platform === "win32", // npx is a .cmd shim on Windows
  });
  return r.status ?? 1;
};

export function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

export function flagValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
