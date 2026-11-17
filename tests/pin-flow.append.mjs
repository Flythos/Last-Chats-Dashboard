
// ==================== TEST HARNESS APPEND (not part of the extension) ====================
// Appended to a copy of the real index.js by tests/run-pin-flow.mjs so the tests
// run against the exact production code (same module scope, stubbed ST modules).
import { __lastTemplateData } from '../../../extensions.js';
import { __setCurrentChatId } from '../../../../script.js';

const storage = new Map();
const fakeCtx = {
    characters: [{ avatar: 'a.png', name: 'Alice' }, { avatar: 'b.png', name: 'Bob' }],
    groups: [{ id: 'g1', name: 'Party', members: ['a.png'], avatar_url: '' }],
    accountStorage: {
        getItem: k => (storage.has(k) ? storage.get(k) : null),
        setItem: (k, v) => storage.set(k, String(v)),
    },
    getRequestHeaders: () => ({}),
    extensionSettings: extension_settings,
    eventSource: { on() {} },
    eventTypes: {},
    characterId: undefined,
    groupId: undefined,
    chat: [],
    POPUP_TYPE: { CONFIRM: 2 },
    callGenericPopup: async () => 1,
    getThumbnailUrl: (t, f) => `/thumbnail?type=${t}&file=${f}`,
};
globalThis.SillyTavern = { getContext: () => fakeCtx };

// Fake chat store — recency: newest-a(5000) > newest-b(4000) > mid-a(3000) > group-1(2000) > old-a(1000)
const chatFiles = [
    { pngFile: 'a.png', filePath: 'chats/Alice/newest-a.jsonl', mtime: 5000 },
    { pngFile: 'b.png', filePath: 'chats/Bob/newest-b.jsonl', mtime: 4000 },
    { pngFile: 'a.png', filePath: 'chats/Alice/mid-a.jsonl', mtime: 3000 },
    { groupId: 'g1', filePath: 'groupchats/group-1.jsonl', mtime: 2000 },
    { pngFile: 'a.png', filePath: 'chats/Alice/old-a.jsonl', mtime: 1000 },
];

// Faithful port of ST 1.19.0 POST /api/chats/recent semantics (src/endpoints/chats.js:1054).
globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    const pinnedChats = Array.isArray(body.pinned) ? body.pinned : [];
    const max = parseInt(body.max ?? Number.MAX_SAFE_INTEGER) + pinnedChats.length;
    const base = p => p.split('/').pop();
    const isPinned = f => pinnedChats.some(p => p.file_name === base(f.filePath) && (p.avatar === f.pngFile || p.group === f.groupId));
    const sorted = [...chatFiles].sort((x, y) => {
        const px = isPinned(x);
        const py = isPinned(y);
        if (px && !py) return -1;
        if (!px && py) return 1;
        return y.mtime - x.mtime;
    }).slice(0, max);
    const items = sorted.map(f => ({
        file_name: base(f.filePath),
        file_size: '1 KB',
        chat_items: 3,
        mes: 'hello preview',
        last_mes: f.lastMesOverride ?? f.mtime,
        ...(f.pngFile ? { avatar: f.pngFile } : {}),
        ...(f.groupId ? { group: f.groupId } : {}),
    }));
    return { ok: true, status: 200, json: async () => items };
};

extension_settings.lastChatsDashboard = { maxChats: 3 };

const results = [];
const assert = (name, ok) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };

// T1: no pins → Latest only, window = 3 most recent
await renderDashboard();
let data = __lastTemplateData();
assert('T1 latest window = newest-a, newest-b, mid-a (old-a excluded)',
    data.latest.length === 3 && !data.latest.some(c => c.fileName === 'old-a') && data.pinned.length === 0);

// T2: pin an OLD chat (outside the window) via the exact card-attr reconstruction path
setChatPinned({ group: undefined, avatar: 'a.png', file_name: 'old-a' + '.jsonl' }, true);
await renderDashboard();
data = __lastTemplateData();
assert('T2 old pinned chat appears in pinned section', data.pinned.length === 1 && data.pinned[0].fileName === 'old-a' && data.pinned[0].isPinned === true);
assert('T2 pin survived pruneStalePins', isChatPinned({ avatar: 'a.png', file_name: 'old-a.jsonl' }));
assert('T2 latest window unchanged (3, no old-a)', data.latest.length === 3 && !data.latest.some(c => c.fileName === 'old-a'));

// T3: pin a chat that is ALSO in the latest window → must appear in BOTH sections
setChatPinned({ avatar: 'a.png', file_name: 'newest-a.jsonl' }, true);
await renderDashboard();
data = __lastTemplateData();
assert('T3 newest-a in pinned section', data.pinned.some(c => c.fileName === 'newest-a' && c.isPinned));
assert('T3 newest-a ALSO in latest, marked isPinned (USER REQUIREMENT)', data.latest.some(c => c.fileName === 'newest-a' && c.isPinned));

// T4: group pin via dialog identity path
setChatPinned({ group: 'g1', file_name: 'group-1.jsonl' }, true);
await renderDashboard();
data = __lastTemplateData();
assert('T4 group pin in pinned section', data.pinned.some(c => c.fileName === 'group-1' && c.isGroup && c.isPinned));

// T5: unpin removes it
setChatPinned({ avatar: 'a.png', file_name: 'newest-a.jsonl' }, false);
await renderDashboard();
data = __lastTemplateData();
assert('T5 unpin removes from pinned section', !data.pinned.some(c => c.fileName === 'newest-a'));

// T6: accountStorage round-trip (what ST's welcome panel would read back)
const stored = JSON.parse(storage.get('pinnedChats'));
assert('T6 storage format matches ST PinnedChatsManager', typeof stored === 'object' && 'char_a.png_old-a.jsonl' in stored && stored['char_a.png_old-a.jsonl'].file_name === 'old-a.jsonl');

// T7: string last_mes (chat send_date) must not break the client-side recency sort
chatFiles[1].lastMesOverride = '2026-11-17T10:00:00.000Z';
await renderDashboard();
data = __lastTemplateData();
assert('T7 string last_mes: newest-b sorts first in latest', data.latest[0].fileName === 'newest-b');
assert('T7 its timeLabel is not garbage', !['NaN', 'undefined'].includes(data.latest[0].timeLabel));
delete chatFiles[1].lastMesOverride;

// T8: pins stored under a foreign/legacy key format must still be recognized and survive prune
// (mirror cleared first: the foreign pin was not written by this extension)
extension_settings.lastChatsDashboard.pins = {};
storage.set('pinnedChats', JSON.stringify({ 'some_foreign_key': { avatar: 'b.png', file_name: 'newest-b.jsonl' } }));
await renderDashboard();
data = __lastTemplateData();
assert('T8 legacy-key pin recognized as pinned', data.pinned.some(c => c.fileName === 'newest-b' && c.isPinned));
assert('T8 legacy pin also still in latest, marked', data.latest.some(c => c.fileName === 'newest-b' && c.isPinned));
assert('T8 legacy pin survives prune (chat still exists)', storage.get('pinnedChats').includes('some_foreign_key'));

// T9: a truly deleted chat's pin is pruned (mirror cleared first: foreign state)
extension_settings.lastChatsDashboard.pins = {};
storage.set('pinnedChats', JSON.stringify({ 'char_a.png_gone.jsonl': { avatar: 'a.png', file_name: 'gone.jsonl' } }));
await renderDashboard();
assert('T9 stale pin pruned when chat file vanished', !storage.get('pinnedChats').includes('gone.jsonl'));
assert('T9 prune also syncs the mirror', (extension_settings.lastChatsDashboard.pins['char_a.png_gone.jsonl'] ?? null) === null);

// T10: a foreign full-key overwrite (ST's cached PinnedChatsManager rewrites the
// whole key from its app-start cache) is healed from the mirror on the next read
setChatPinned({ avatar: 'a.png', file_name: 'old-a.jsonl' }, true);
storage.set('pinnedChats', '{}');
await renderDashboard();
data = __lastTemplateData();
assert('T10 wiped pin healed from mirror and shown', data.pinned.some(c => c.fileName === 'old-a' && c.isPinned));
assert('T10 healed pin written back to live storage', storage.get('pinnedChats').includes('old-a.jsonl'));

// T11: a legitimate unpin must NOT be resurrected by the heal
setChatPinned({ avatar: 'a.png', file_name: 'old-a.jsonl' }, false);
assert('T11 unpin persists (mirror synced, no resurrection)', !storage.get('pinnedChats').includes('old-a.jsonl'));
await renderDashboard();
data = __lastTemplateData();
assert('T11 unpin survives a render', !data.pinned.some(c => c.fileName === 'old-a'));

// T12: renaming a pinned character chat migrates the pin (otherwise it dangles
// under the old name and gets pruned on the next render)
setChatPinned({ avatar: 'a.png', file_name: 'mid-a.jsonl' }, true);
onChatRenamed({ avatarId: 'a.png', groupId: undefined, oldFileName: 'mid-a.jsonl', newFileName: 'mid-a-renamed.jsonl' });
const t12storage = storage.get('pinnedChats');
assert('T12 pin migrated to new file name', t12storage.includes('mid-a-renamed.jsonl') && !t12storage.includes('"mid-a.jsonl"'));
chatFiles.push({ pngFile: 'a.png', filePath: 'chats/Alice/mid-a-renamed.jsonl', mtime: 6000 });
await renderDashboard();
data = __lastTemplateData();
assert('T12 migrated pin survives prune + shows in pinned section', data.pinned.some(c => c.fileName === 'mid-a-renamed' && c.isPinned));

// T13: renaming a pinned group chat migrates the pin too
setChatPinned({ group: 'g1', file_name: 'group-1.jsonl' }, true);
onChatRenamed({ avatarId: undefined, groupId: 'g1', oldFileName: 'group-1.jsonl', newFileName: 'group-1-renamed.jsonl' });
assert('T13 group pin migrated', storage.get('pinnedChats').includes('group-1-renamed.jsonl'));
chatFiles.push({ groupId: 'g1', filePath: 'groupchats/group-1-renamed.jsonl', mtime: 7000 });
await renderDashboard();
data = __lastTemplateData();
assert('T13 migrated group pin survives prune + shows', data.pinned.some(c => c.fileName === 'group-1-renamed' && c.isGroup && c.isPinned));

const failed = results.filter(r => !r).length;
console.log(failed === 0 ? 'HARNESS ALL PASS' : `HARNESS FAILURES: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
