const MAX_ENTRIES = 100;
const MAX_TEXT = 10000;
const BADGE_COLOR = '#d93025';
const VALID_TYPES = ['console-error', 'runtime-error', 'promise-rejection', 'resource-error', 'console-warn'];

// All storage writes go through this chain so concurrent tabs can't overwrite each other
let chain = Promise.resolve();
function serial(task) {
    const run = chain.then(task);
    chain = run.catch((e) => console.warn('Error Notify:', e));
    return run;
}

function text(value, limit = MAX_TEXT) {
    return typeof value === 'string' ? value.slice(0, limit) : '';
}

function sanitize(raw, tabId) {
    if (!raw || typeof raw.message !== 'string') return null;
    return {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        key: text(raw.key, MAX_TEXT * 2),
        type: VALID_TYPES.includes(raw.type) ? raw.type : 'console-error',
        message: text(raw.message),
        stack: text(raw.stack),
        sourceUrl: text(raw.sourceUrl, 2000),
        line: Number(raw.line) || 0,
        column: Number(raw.column) || 0,
        url: text(raw.url, 2000),
        pageId: text(raw.pageId, 50),
        tabId,
        time: Number(raw.time) || Date.now(),
        count: Math.max(1, Number(raw.count) || 1)
    };
}

const SOUND_COOLDOWN_MS = 1500;
let lastSoundAt = 0;
let creatingOffscreen = null;

async function ensureOffscreenDocument() {
    if (chrome.offscreen.hasDocument && await chrome.offscreen.hasDocument()) return;
    if (!creatingOffscreen) {
        creatingOffscreen = chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['AUDIO_PLAYBACK'],
            justification: 'Play a short alert sound when a page logs an error'
        }).catch((e) => {
            if (!String(e && e.message).includes('single offscreen')) throw e;
        }).finally(() => {
            creatingOffscreen = null;
        });
    }
    await creatingOffscreen;
}

async function playSound(kind) {
    const now = Date.now();
    if (now - lastSoundAt < SOUND_COOLDOWN_MS) return;
    const { playSound: enabled = false } = await chrome.storage.local.get('playSound');
    if (!enabled) return;
    lastSoundAt = now;
    try {
        await ensureOffscreenDocument();
        await chrome.runtime.sendMessage({ target: 'offscreen', action: 'play-sound', kind });
    } catch (e) {
        console.warn('Error Notify: could not play sound', e);
    }
}

async function getPages() {
    const { pages = {} } = await chrome.storage.session.get('pages');
    return pages;
}

async function updateBadge(tabId, errors, pageId) {
    const count = pageId
        ? errors.reduce((sum, e) => sum + (e.tabId === tabId && e.pageId === pageId ? e.count || 1 : 0), 0)
        : 0;
    try {
        await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR });
        if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' });
        await chrome.action.setBadgeText({ tabId, text: count ? (count > 99 ? '99+' : String(count)) : '' });
    } catch (e) {
        // Tab was closed
    }
}

async function refreshAllBadges(errors) {
    const pages = await getPages();
    await Promise.all(Object.entries(pages).map(([tabId, pageId]) => updateBadge(Number(tabId), errors, pageId)));
}

async function logErrors(tabId, rawEntries) {
    const entries = rawEntries.map(raw => sanitize(raw, tabId)).filter(Boolean);
    if (!entries.length) return;

    const { errors = [] } = await chrome.storage.local.get('errors');
    const list = errors.slice();
    const newTypes = [];

    for (const entry of entries) {
        const index = list.findIndex(e => e.key && e.key === entry.key && e.pageId === entry.pageId);
        if (index !== -1) {
            const [previous] = list.splice(index, 1);
            entry.id = previous.id;
            entry.count += previous.count || 1;
        } else {
            newTypes.push(entry.type);
        }
        list.unshift(entry);
    }

    if (newTypes.length) {
        playSound(newTypes.some(type => type !== 'console-warn') ? 'error' : 'warning');
    }

    const trimmed = list.slice(0, MAX_ENTRIES);
    await chrome.storage.local.set({ errors: trimmed });

    const pageId = entries[entries.length - 1].pageId;
    const pages = await getPages();
    pages[tabId] = pageId;
    await chrome.storage.session.set({ pages });
    await updateBadge(tabId, trimmed, pageId);
}

async function deleteErrors({ ids, all }) {
    const { errors = [] } = await chrome.storage.local.get('errors');
    let list;
    if (all) {
        list = [];
    } else if (Array.isArray(ids)) {
        const remove = new Set(ids.map(String));
        list = errors.filter(e => !remove.has(String(e.id)));
    } else {
        return;
    }
    await chrome.storage.local.set({ errors: list });
    await refreshAllBadges(list);
}

async function forgetTab(tabId) {
    const pages = await getPages();
    if (!(tabId in pages)) return;
    delete pages[tabId];
    await chrome.storage.session.set({ pages });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return;

    if (message.action === 'log-errors') {
        if (sender.tab && typeof sender.tab.id === 'number' && Array.isArray(message.entries)) {
            serial(() => logErrors(sender.tab.id, message.entries));
        }
        return;
    }

    if (message.action === 'delete-errors') {
        serial(() => deleteErrors(message)).then(
            () => sendResponse({ ok: true }),
            () => sendResponse({ ok: false })
        );
        return true;
    }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status !== 'loading') return;
    serial(async () => {
        await forgetTab(tabId);
        await updateBadge(tabId, [], null);
    });
});

chrome.tabs.onRemoved.addListener((tabId) => {
    serial(() => forgetTab(tabId));
});
