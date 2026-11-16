// Import audit: resolves every named import + ctx member used by index.js against the
// SillyTavern reference clone (.st-src next to this repo). A mismatch here = silent
// module kill in the browser (named-import mismatches have caused real bugs before).
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const stPublic = resolve(here, '../../.st-src/public');

const indexSource = readFileSync(resolve(here, '../index.js'), 'utf8');
const extDir = resolve(stPublic, 'scripts/extensions/third-party/LastChatsDashboard');

const imports = [];
const importRegex = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
let m;
while ((m = importRegex.exec(indexSource)) !== null) {
    const names = m[1].split(',').map(s => s.trim()).filter(Boolean);
    imports.push({ names, path: resolve(extDir, m[2]), raw: m[2] });
}

function getExports(source) {
    const names = new Set();
    const patterns = [
        /export\s+async\s+function\s+(\w+)/g,
        /export\s+function\s+(\w+)/g,
        /export\s+const\s+(\w+)/g,
        /export\s+let\s+(\w+)/g,
        /export\s+var\s+(\w+)/g,
        /export\s+class\s+(\w+)/g,
    ];
    for (const p of patterns) {
        let mm;
        while ((mm = p.exec(source)) !== null) {
            names.add(mm[1]);
        }
    }
    const brace = /export\s*\{([^}]+)\}/g;
    let bm;
    while ((bm = brace.exec(source)) !== null) {
        for (const part of bm[1].split(',')) {
            const name = part.trim().split(/\s+as\s+/)[0].trim();
            if (name) {
                names.add(name);
            }
        }
    }
    return names;
}

let failures = 0;
console.log(`Auditing ${imports.length} import statements:`);
for (const imp of imports) {
    let source;
    try {
        source = readFileSync(imp.path, 'utf8');
    } catch {
        console.log(`FAIL  module not found: ${imp.raw}`);
        failures++;
        continue;
    }
    const exports = getExports(source);
    for (const name of imp.names) {
        if (exports.has(name)) {
            console.log(`PASS  ${name}  <-  ${imp.raw}`);
        } else {
            console.log(`FAIL  ${name}  <-  ${imp.raw}  (not exported)`);
            failures++;
        }
    }
}

const ctxSource = readFileSync(resolve(stPublic, 'scripts/st-context.js'), 'utf8');
const ctxMembers = [
    'characters', 'groups', 'groupId', 'characterId', 'chat',
    'eventSource', 'eventTypes', 'event_types',
    'selectCharacterById', 'openCharacterChat', 'openGroupChat',
    'getThumbnailUrl', 'getRequestHeaders', 'saveSettingsDebounced',
    'extensionSettings', 'callGenericPopup', 'POPUP_TYPE', 'accountStorage',
];
for (const member of ctxMembers) {
    if (!new RegExp(`\\b${member}\\b`).test(ctxSource)) {
        console.log(`FAIL  ctx.${member}  (missing on context)`);
        failures++;
    }
}
console.log('ctx members: all present');

const usedCtx = [...new Set([...indexSource.matchAll(/ctx\.(\w+)/g)].map(x => x[1]))];
const known = ctxMembers.filter(member => new RegExp(`\\b${member}\\b`).test(ctxSource));
for (const member of usedCtx) {
    if (!known.includes(member)) {
        console.log(`FAIL  ctx.${member} referenced in index.js but unknown on context`);
        failures++;
    }
}
console.log('ctx references in index.js:', usedCtx.join(', '));

console.log(failures === 0 ? '\nAUDIT CLEAN' : `\nAUDIT FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
