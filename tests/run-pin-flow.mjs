// Assembles a runnable copy of the real index.js (stubbed ST modules + appended pin-flow tests)
// inside tests/.gen/ and runs it with node. Exit code 0 = all tests pass.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const testsDir = dirname(fileURLToPath(import.meta.url));
const genDir = resolve(testsDir, '.gen');
const extDir = join(genDir, 'scripts/extensions/third-party/LastChatsDashboard');

rmSync(genDir, { recursive: true, force: true });
mkdirSync(extDir, { recursive: true });

// Stub modules at the same relative positions the extension imports from.
cpSync(join(testsDir, 'stubs/script.js'), join(genDir, 'script.js'));
cpSync(join(testsDir, 'stubs/extensions.js'), join(genDir, 'scripts/extensions.js'));
cpSync(join(testsDir, 'stubs/scripts/group-chats.js'), join(genDir, 'scripts/group-chats.js'));
cpSync(join(testsDir, 'stubs/scripts/system-messages.js'), join(genDir, 'scripts/system-messages.js'));

// The real extension code + the appended tests, in one module. The prelude stubs
// browser globals so the module evaluates outside the browser (the jQuery ready
// callback is intentionally not executed — the tests drive internal functions).
const indexSource = readFileSync(resolve(testsDir, '../index.js'), 'utf8');
const testAppend = readFileSync(join(testsDir, 'pin-flow.append.mjs'), 'utf8');
const prelude = 'globalThis.jQuery = () => {};\nglobalThis.$ = () => ({ length: 0 });\n';
writeFileSync(join(extDir, 'index.test.mjs'), prelude + indexSource + testAppend);

const result = spawnSync(process.execPath, [join(extDir, 'index.test.mjs')], { stdio: 'inherit' });
process.exit(result.status ?? 1);
