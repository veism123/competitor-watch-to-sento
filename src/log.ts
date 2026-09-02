export function log(msg: string, extra?: unknown): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  if (extra === undefined) console.log(line);
  else console.log(line, JSON.stringify(extra));
}

export function logError(msg: string, err: unknown): void {
  console.error(`[${new Date().toISOString()}] ERROR ${msg}`, err);
}
