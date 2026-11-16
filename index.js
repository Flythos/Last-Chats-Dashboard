import { extension_settings, renderExtensionTemplateAsync } from '../../../extensions.js';
import {
    saveSettingsDebounced,
    setActiveCharacter,
    setActiveGroup,
    getCurrentChatId,
    deleteCharacterChatByName,
} from '../../../../script.js';
import { openGroupById, deleteGroupChatByName } from '../../../../scripts/group-chats.js';
import { system_message_types } from '../../../../scripts/system-messages.js';

// Fixed settings key, independent of the folder name the extension is installed as.
const MODULE_NAME = 'lastChatsDashboard';

// The folder name the extension actually lives in (used for the template path).
const folderName = decodeURIComponent(
    new URL(import.meta.url).pathname.split('/').filter(Boolean).slice(-2, -1)[0],
);
const extensionFolderPath = `third-party/${folderName}`;

const defaultSettings = {
    maxChats: 12,
    showOnStartup: true,
    disableWelcomePage: true,
};

function getSettings() {
    const settings = extension_settings[MODULE_NAME] ?? {};
    extension_settings[MODULE_NAME] = { ...defaultSettings, ...settings };
    return extension_settings[MODULE_NAME];
}

// /recent items may carry last_mes as a number (mtime ms) or a date string (chat send_date).
function toMillis(value) {
    const n = Number(value);
    if (Number.isFinite(n)) {
        return n;
    }
    const t = Date.parse(String(value));
    return Number.isNaN(t) ? 0 : t;
}

function formatRelativeTime(mtimeMs) {
    const diff = Date.now() - toMillis(mtimeMs);
    const minute = 60_000;
    const hour = 3_600_000;
    const day = 86_400_000;
    if (diff < minute) {
        return 'just now';
    }
    if (diff < hour) {
        return `${Math.floor(diff / minute)}m ago`;
    }
    if (diff < day) {
        return `${Math.floor(diff / hour)}h ago`;
    }
    if (diff < 7 * day) {
        return `${Math.floor(diff / day)}d ago`;
    }
    return new Date(mtimeMs).toLocaleDateString();
}

function stripTags(text) {
    return String(text ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function truncate(text, max = 140) {
    return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

// toastr is a ST global, but guard it anyway so a missing/toast-disabled setup can never throw.
function toast(kind, message, title) {
    if (typeof toastr === 'function') {
        toastr[kind](message, title);
    } else {
        console.warn(`[${MODULE_NAME}] ${title}: ${message}`);
    }
}

// Full-size character avatar (served statically from the user's characters folder).
// The /thumbnail endpoint crops to 96x144, which looks blurry on large dashboard cards.
function getFullAvatarUrl(file) {
    return `/characters/${encodeURIComponent(file)}`;
}

/*
 * Pinned chats — same accountStorage key and key format as ST's built-in
 * PinnedChatsManager (welcome-screen.js), so pins made here and in ST's own
 * welcome panel stay in sync.
 */
const PINNED_CHATS_KEY = 'pinnedChats';

function getPinState() {
    try {
        const parsed = JSON.parse(SillyTavern.getContext().accountStorage.getItem(PINNED_CHATS_KEY) ?? '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        console.warn(`[${MODULE_NAME}] Failed to read pinned chats from account storage`, error);
        return {};
    }
}

function savePinState(state) {
    SillyTavern.getContext().accountStorage.setItem(PINNED_CHATS_KEY, JSON.stringify(state));
}

// chat = { file_name (with .jsonl), avatar? | group? } — the /api/chats/recent item shape.
function getPinKey(chat) {
    return `${chat.group ? 'group_' + chat.group : ''}${chat.avatar ? 'char_' + chat.avatar : ''}_${chat.file_name}`;
}

function isChatPinned(chat) {
    const state = getPinState();
    if (getPinKey(chat) in state) {
        return true;
    }
    // Fallback: match by identity (chat file + character/group), tolerating entries
    // that were stored under a different key format (e.g. older/foreign writers).
    return Object.values(state).some(pin =>
        pin
        && pin.file_name === chat.file_name
        && (pin.group ?? undefined) === (chat.group ?? undefined)
        && (pin.avatar ?? undefined) === (chat.avatar ?? undefined));
}

function setChatPinned(chat, pinned) {
    const state = getPinState();
    const key = getPinKey(chat);
    if (pinned) {
        state[key] = { group: chat.group, avatar: chat.avatar, file_name: chat.file_name };
    } else {
        delete state[key];
    }
    savePinState(state);
}

function getPinnedChats() {
    return Object.values(getPinState());
}

// Drop pins whose chat file no longer exists (all pinned chats are always included in /recent's response).
// Matching is by identity (group/avatar/file_name), not by storage key format.
function pruneStalePins(recentItems) {
    const state = getPinState();
    const present = new Set(recentItems.map(item => `${item.group ?? ''}|${item.avatar ?? ''}|${item.file_name}`));
    let changed = false;
    for (const [key, pin] of Object.entries(state)) {
        const identity = `${pin?.group ?? ''}|${pin?.avatar ?? ''}|${pin?.file_name}`;
        if (!present.has(identity)) {
            delete state[key];
            changed = true;
        }
    }
    if (changed) {
        savePinState(state);
    }
}

/**
 * Builds the view model for one recent chat entry.
 * Returns null if the character or group no longer exists.
 */
function toCardModel(chat) {
    const ctx = SillyTavern.getContext();
    const fileName = String(chat.file_name ?? '').replace(/\.jsonl$/, '');

    if (chat.group) {
        const group = ctx.groups.find(x => x.id === chat.group);
        if (!group) {
            return null;
        }
        const memberAvatars = [];
        if (Array.isArray(group.members)) {
            for (const member of group.members) {
                const character = ctx.characters.find(x => x.avatar === member);
                if (character && character.avatar !== 'none') {
                    memberAvatars.push(getFullAvatarUrl(character.avatar));
                }
                if (memberAvatars.length === 4) {
                    break;
                }
            }
        }
        const hasOwnAvatar = typeof group.avatar_url === 'string' && group.avatar_url.length > 0 && group.avatar_url !== 'none';
        const currentChatId = getCurrentChatId();
        return {
            isGroup: true,
            groupId: group.id,
            avatarId: '',
            fileName,
            avatarUrl: hasOwnAvatar ? group.avatar_url : '',
            collage: hasOwnAvatar ? [] : memberAvatars,
            charName: group.name ?? '[Group]',
            displayName: fileName,
            preview: truncate(stripTags(chat.mes)),
            messageCount: Number(chat.chat_items) || 0,
            timeLabel: formatRelativeTime(chat.last_mes),
            lastMes: toMillis(chat.last_mes),
            isActive: ctx.groupId === group.id && currentChatId === fileName,
            isPinned: isChatPinned(chat),
        };
    }

    const character = ctx.characters.find(x => x.avatar === chat.avatar);
    if (!character) {
        return null;
    }
    const characterId = ctx.characters.findIndex(x => x.avatar === chat.avatar);
    const currentChatId = getCurrentChatId();
    return {
        isGroup: false,
        groupId: '',
        avatarId: character.avatar,
        fileName,
        avatarUrl: getFullAvatarUrl(character.avatar),
        collage: [],
        charName: character.name ?? '',
        displayName: fileName,
        preview: truncate(stripTags(chat.mes)),
        messageCount: Number(chat.chat_items) || 0,
        timeLabel: formatRelativeTime(chat.last_mes),
        lastMes: toMillis(chat.last_mes),
        isActive: ctx.characterId === characterId && currentChatId === fileName,
        isPinned: isChatPinned(chat),
    };
}

async function fetchRecentChats() {
    const ctx = SillyTavern.getContext();
    const settings = getSettings();
    const response = await fetch('/api/chats/recent', {
        method: 'POST',
        headers: ctx.getRequestHeaders(),
        body: JSON.stringify({ max: settings.maxChats, pinned: getPinnedChats() }),
        cache: 'no-cache',
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch recent chats (HTTP ${response.status})`);
    }
    return await response.json();
}

async function renderDashboard() {
    const recentItems = await fetchRecentChats();
    pruneStalePins(recentItems);

    const cards = recentItems
        .map(toCardModel)
        .filter(model => model !== null);

    // Latest = the N most recent chats. Pinned chats stay in here too and carry
    // their pin marker; a pinned chat outside the window shows up in Pinned only.
    const settings = getSettings();
    const latest = [...cards]
        .sort((a, b) => (b.lastMes ?? 0) - (a.lastMes ?? 0))
        .slice(0, settings.maxChats);

    // Pinned = every pinned chat, even old ones the latest window no longer covers.
    const pinned = cards.filter(model => model.isPinned);

    console.debug(`[${MODULE_NAME}] render: ${cards.length} chats, ${pinned.length} pinned, pin keys:`, Object.keys(getPinState()));

    return await renderExtensionTemplateAsync(extensionFolderPath, 'dashboard', {
        pinned,
        latest,
        hasAny: pinned.length + latest.length > 0,
    });
}

function isDashboardOpen() {
    return $('#last_chats_dashboard').length > 0;
}

function closeDashboard() {
    $('#last_chats_dashboard').remove();
}

async function openDashboard() {
    let html;
    try {
        html = await renderDashboard();
    } catch (error) {
        console.error(`[${MODULE_NAME}] Failed to load recent chats`, error);
        toast('error', 'Failed to load recent chats. See console for details.', 'Last Chats Dashboard');
        return;
    }

    // Close first so a stale dashboard never lingers behind the fresh one.
    closeDashboard();
    $('body').append(html);
}

function openRecentCharacterChat(avatarId, fileName) {
    return openChat(
        async () => {
            const ctx = SillyTavern.getContext();
            const characterId = ctx.characters.findIndex(x => x.avatar === avatarId);
            if (characterId === -1) {
                throw new Error('Character not found');
            }
            await ctx.selectCharacterById(characterId);
            setActiveCharacter(avatarId);
            saveSettingsDebounced();
            const currentChatId = getCurrentChatId();
            if (currentChatId === fileName) {
                return;
            }
            await ctx.openCharacterChat(fileName);
        },
        'Failed to open chat. See console for details.',
    );
}

function openRecentGroupChat(groupId, fileName) {
    return openChat(
        async () => {
            const ctx = SillyTavern.getContext();
            const group = ctx.groups.find(x => x.id === groupId);
            if (!group) {
                throw new Error('Group not found');
            }
            await openGroupById(groupId);
            setActiveGroup(groupId);
            saveSettingsDebounced();
            const currentChatId = getCurrentChatId();
            if (currentChatId === fileName) {
                return;
            }
            await ctx.openGroupChat(groupId, fileName);
        },
        'Failed to open group chat. See console for details.',
    );
}

async function openChat(opener, errorMessage) {
    try {
        await opener();
    } catch (error) {
        console.error(`[${MODULE_NAME}]`, error);
        toast('error', errorMessage, 'Last Chats Dashboard');
    } finally {
        closeDashboard();
    }
}

async function deleteRecentChat(card) {
    const ctx = SillyTavern.getContext();
    const fileName = card.attr('data-file');
    const avatarId = card.attr('data-avatar');
    const groupId = card.attr('data-group');

    const confirm = await ctx.callGenericPopup('Delete this chat file? This cannot be undone.', ctx.POPUP_TYPE.CONFIRM);
    if (!confirm) {
        return;
    }

    try {
        if (groupId) {
            await deleteGroupChatByName(groupId, fileName);
        } else if (avatarId) {
            const characterId = ctx.characters.findIndex(x => x.avatar === avatarId);
            if (characterId === -1) {
                throw new Error('Character not found');
            }
            await deleteCharacterChatByName(String(characterId), fileName);
        }
        toast('success', 'Chat deleted.');
        await refreshIfOpen();
    } catch (error) {
        console.error(`[${MODULE_NAME}] Failed to delete chat`, error);
        toast('error', 'Failed to delete chat. See console for details.', 'Last Chats Dashboard');
    }
}

async function refreshIfOpen() {
    if (!isDashboardOpen()) {
        return;
    }
    let html;
    try {
        html = await renderDashboard();
    } catch (error) {
        console.error(`[${MODULE_NAME}] Failed to refresh dashboard`, error);
        return;
    }
    const scrollTop = $('.lcd-grid').scrollTop();
    closeDashboard();
    $('body').append(html);
    if (scrollTop) {
        $('.lcd-grid').scrollTop(scrollTop);
    }
}

async function onAppReady() {
    const settings = getSettings();
    if (settings.showOnStartup && getCurrentChatId() === undefined) {
        await openDashboard();
    }
}

async function onChatChanged() {
    if (getCurrentChatId() !== undefined) {
        closeDashboard();
        return;
    }
    // No chat active: this is where ST would show its welcome page.
    const settings = getSettings();
    if (settings.disableWelcomePage) {
        await openDashboard();
    }
}

function registerEventListeners() {
    const { eventSource, eventTypes } = SillyTavern.getContext();

    eventSource.on(eventTypes.APP_READY, onAppReady);
    eventSource.on(eventTypes.CHAT_CHANGED, onChatChanged);
    eventSource.on(eventTypes.CHAT_CREATED, refreshIfOpen);
    eventSource.on(eventTypes.CHAT_DELETED, refreshIfOpen);
    eventSource.on(eventTypes.CHAT_RENAMED, refreshIfOpen);

    // Card click: open the chat.
    $(document).on('click', '#last_chats_dashboard .lcd-card', function () {
        const card = $(this);
        if (card.data('busy')) {
            return;
        }
        const avatarId = card.attr('data-avatar');
        const groupId = card.attr('data-group');
        const fileName = card.attr('data-file');
        card.data('busy', true);
        if (groupId) {
            void openRecentGroupChat(groupId, fileName).finally(() => card.removeData('busy'));
        } else if (avatarId) {
            void openRecentCharacterChat(avatarId, fileName).finally(() => card.removeData('busy'));
        }
    });

    // Pin toggle on a card.
    $(document).on('click', '#last_chats_dashboard .lcd-pin', function (event) {
        event.stopPropagation();
        const card = $(this).closest('.lcd-card');
        const chat = {
            group: card.attr('data-group') || undefined,
            avatar: card.attr('data-avatar') || undefined,
            file_name: `${card.attr('data-file')}.jsonl`,
        };
        try {
            setChatPinned(chat, !isChatPinned(chat));
        } catch (error) {
            console.error(`[${MODULE_NAME}] Failed to toggle pin`, error);
            toast('error', 'Failed to toggle pin. See console for details.', 'Last Chats Dashboard');
            return;
        }
        void refreshIfOpen();
    });

    // Delete button on hover (inside the card, stop propagation).
    $(document).on('click', '#last_chats_dashboard .lcd-delete', function (event) {
        event.stopPropagation();
        void deleteRecentChat($(this).closest('.lcd-card'));
    });

    // Close button.
    $(document).on('click', '#last_chats_dashboard .lcd-close', () => closeDashboard());

    // Click on the backdrop (the overlay root itself) closes the dashboard.
    $(document).on('mousedown', '#last_chats_dashboard', function (event) {
        if (event.target === this) {
            closeDashboard();
        }
    });

    // Escape key closes the dashboard (unless a popup dialog is on top).
    $(document).on('keydown', (event) => {
        if (event.key !== 'Escape' || !isDashboardOpen()) {
            return;
        }
        if ($('dialog[open]').length > 0) {
            return;
        }
        closeDashboard();
    });
}

/**
 * Adds a pin toggle button to every entry of ST's "Manage chat files" dialog
 * (#select_chat_div), next to the export/delete actions. A MutationObserver
 * keeps enhancing entries as the dialog re-renders (open, search, delete...).
 */
function startPastChatsEnhancer() {
    const container = document.getElementById('select_chat_div');
    if (!container || typeof MutationObserver === 'undefined') {
        return;
    }

    const enhance = () => {
        container.querySelectorAll('.select_chat_block_wrapper').forEach(wrapper => {
            const actions = wrapper.querySelector('.select_chat_actions');
            if (!actions || actions.querySelector('.lcd-past-chat-pin')) {
                return;
            }
            const fileName = wrapper.querySelector('.select_chat_block')?.getAttribute('file_name');
            if (!fileName) {
                return;
            }
            const button = document.createElement('div');
            button.className = 'lcd-past-chat-pin opacity50p hoverglow fa-solid fa-thumbtack';
            actions.insertBefore(button, actions.firstChild);
            updatePastChatPinButton(button, fileName);
            button.addEventListener('click', event => {
                event.stopPropagation();
                try {
                    setChatPinned(currentChatIdentity(fileName), !isChatPinned(currentChatIdentity(fileName)));
                } catch (error) {
                    console.error(`[${MODULE_NAME}] Failed to toggle pin`, error);
                    toast('error', 'Failed to toggle pin. See console for details.', 'Last Chats Dashboard');
                    return;
                }
                updatePastChatPinButton(button, fileName);
            });
        });
    };

    new MutationObserver(enhance).observe(container, { childList: true });
}

// Pin identity for the chat currently open in the "Manage chat files" dialog.
function currentChatIdentity(fileName) {
    const ctx = SillyTavern.getContext();
    if (ctx.groupId) {
        return { group: ctx.groupId, file_name: fileName };
    }
    const character = ctx.characters[ctx.characterId];
    return { avatar: character?.avatar, file_name: fileName };
}

function updatePastChatPinButton(button, fileName) {
    const pinned = isChatPinned(currentChatIdentity(fileName));
    button.classList.toggle('lcd-pin-active', pinned);
    button.title = pinned ? 'Unpin from Last Chats Dashboard' : 'Pin to Last Chats Dashboard';
}

/**
 * When enabled, removes the built-in welcome page (panel + assistant messages)
 * from #chat whenever SillyTavern injects it, so the dashboard is the only
 * landing page.
 */
function startWelcomeSuppression() {
    const chatElement = document.getElementById('chat');
    if (!chatElement || typeof MutationObserver === 'undefined') {
        return;
    }

    const suppress = () => {
        try {
            if (!getSettings().disableWelcomePage) {
                return;
            }
            // Only strip the welcome page while no chat is active.
            if (getCurrentChatId() !== undefined) {
                return;
            }
            const panel = chatElement.querySelector(':scope > .welcomePanel');
            if (!panel) {
                return;
            }
            const ctx = SillyTavern.getContext();
            for (let i = ctx.chat.length - 1; i >= 0; i--) {
                const type = ctx.chat[i]?.extra?.type;
                if (type === system_message_types.ASSISTANT_MESSAGE || type === system_message_types.WELCOME_PROMPT) {
                    ctx.chat.splice(i, 1);
                }
            }
            $(chatElement).empty();
        } catch (error) {
            // Never let the observer callback break the app; report and move on.
            console.error(`[${MODULE_NAME}] Welcome suppression failed`, error);
        }
    };

    new MutationObserver(suppress).observe(chatElement, { childList: true });
}

// Top-bar icon (rightmost spot in the icon row), styled like the other top-bar icons.
function addTopBarIcon() {
    const html = `<div id="lcd_top_button" class="drawer-icon fa-solid fa-table-cells-large fa-fw closedIcon" title="Last Chats Dashboard"></div>`;
    $('#top-settings-holder').append(html);
    $(document).on('click', '#lcd_top_button', () => void openDashboard());
}

function addWandMenuButton() {
    const html = `
    <div id="lcd_wand_item" class="list-group-item flex-container flexGap5" title="Open the Last Chats Dashboard">
        <div class="fa-fw fa-solid fa-table-cells-large extensionsMenuExtensionButton"></div>
        <span>Last Chats Dashboard</span>
    </div>`;
    $('#extensionsMenu').append(html);
    $(document).on('click', '#lcd_wand_item', () => void openDashboard());
}

function addSettingsPanel() {
    const settings = getSettings();
    const html = `
    <div class="last-chats-dashboard-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Last Chats Dashboard</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="flex-container flexFlowColumn alignItemsFlexStart">
                    <label class="checkbox_label" for="lcd_show_on_startup">
                        <input id="lcd_show_on_startup" type="checkbox" ${settings.showOnStartup ? 'checked' : ''}>
                        <span>Show on startup when no chat is open</span>
                    </label>
                    <label class="checkbox_label" for="lcd_disable_welcome">
                        <input id="lcd_disable_welcome" type="checkbox" ${settings.disableWelcomePage ? 'checked' : ''}>
                        <span>Replace the built-in welcome page</span>
                    </label>
                    <label for="lcd_max_chats">Number of chats to show</label>
                    <input id="lcd_max_chats" class="text_pole" type="number" min="1" max="100" value="${settings.maxChats}">
                    <div id="lcd_open_now" class="menu_button">
                        <i class="fa-solid fa-table-cells-large fa-fw"></i>
                        <span>Open dashboard now</span>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
    $('#extensions_settings2').append(html);

    $('#lcd_show_on_startup').on('change', function () {
        getSettings().showOnStartup = Boolean($(this).prop('checked'));
        saveSettingsDebounced();
    });
    $('#lcd_disable_welcome').on('change', function () {
        getSettings().disableWelcomePage = Boolean($(this).prop('checked'));
        saveSettingsDebounced();
    });
    $('#lcd_max_chats').on('input', function () {
        const value = Number($(this).val());
        if (Number.isInteger(value) && value >= 1 && value <= 100) {
            getSettings().maxChats = value;
            saveSettingsDebounced();
        }
    });
    $('#lcd_open_now').on('click', () => void openDashboard());
}

jQuery(() => {
    getSettings();
    addTopBarIcon();
    addWandMenuButton();
    addSettingsPanel();
    registerEventListeners();
    startPastChatsEnhancer();
    startWelcomeSuppression();
    console.debug(`[${MODULE_NAME}] Ready`);
});
