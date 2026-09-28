export function log(scope, msg) {
  const ts = new Date().toISOString().slice(11, 23);
  process.stderr.write(`${ts} [${scope}] ${msg}\n`);
}
