const TYPE_META = {
    'console-error': { label: 'Error', color: '#f28b82' },
    'runtime-error': { label: 'Uncaught', color: '#f28b82' },
    'promise-rejection': { label: 'Promise', color: '#f28b82' },
    'resource-error': { label: 'Resource', color: '#fcad70' },
    'console-warn': { label: 'Warning', color: '#fdd663' }
};

const SETTINGS = {
    showToasts: { el: 'showToastsCheck', default: true },
    autoHide: { el: 'autoHideCheck', default: true },
    compactToasts: { el: 'compactToastsCheck', default: false },
    playSound: { el: 'playSoundCheck', default: false },
    captureWarnings: { el: 'captureWarningsCheck', default: false }
};

document.addEventListener('DOMContentLoaded', async () => {
    const errorList = document.getElementById('errorList');
    const clearBtn = document.getElementById('clearBtn');
    const copyAllBtn = document.getElementById('copyAllBtn');
    const countBadge = document.getElementById('countBadge');
    const searchInput = document.getElementById('searchInput');
    const scopeButtons = document.querySelectorAll('.scope-btn');
    const toastOnlyRows = ['autoHideCheck', 'compactToastsCheck']
        .map(id => document.getElementById(id).closest('.setting'));

    let allErrors = [];
    let visibleErrors = [];
    let scope = localStorage.getItem('scope') || 'tab';
    let query = '';
    const expanded = new Set();
    const stacksShown = new Set();

    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTabId = activeTab ? activeTab.id : null;

    // ---------- Settings ----------

    const defaults = Object.fromEntries(Object.entries(SETTINGS).map(([key, s]) => [key, s.default]));
    const stored = await chrome.storage.local.get(defaults);
    for (const [key, setting] of Object.entries(SETTINGS)) {
        const input = document.getElementById(setting.el);
        input.checked = Boolean(stored[key]);
        input.addEventListener('change', () => {
            chrome.storage.local.set({ [key]: input.checked });
            if (key === 'playSound' && input.checked) playAlertSound('error');
            syncSettingStates();
        });
    }

    function syncSettingStates() {
        const toastsOn = document.getElementById('showToastsCheck').checked;
        toastOnlyRows.forEach(row => row.classList.toggle('disabled', !toastsOn));
    }
    syncSettingStates();

    // ---------- Helpers ----------

    function typeMeta(err) {
        return TYPE_META[err.type] || TYPE_META['console-error'];
    }

    function shortSource(err) {
        if (!err.sourceUrl) return err.source || 'inline';
        let name = err.sourceUrl.split(/[?#]/)[0].split('/').pop() || err.sourceUrl;
        if (err.line) name += `:${err.line}`;
        return name;
    }

    function fullSource(err) {
        if (!err.sourceUrl) return err.source || '';
        return err.line ? `${err.sourceUrl}:${err.line}:${err.column}` : err.sourceUrl;
    }

    function hostOf(url) {
        try {
            return new URL(url).host || url;
        } catch (e) {
            return url || '';
        }
    }

    function formatTime(err) {
        if (!err.time) return err.timestamp || '';
        const date = new Date(err.time);
        const sameDay = date.toDateString() === new Date().toDateString();
        return sameDay ? date.toLocaleTimeString() : date.toLocaleString();
    }

    function formatReport(err) {
        const parts = [`[${typeMeta(err).label}] ${err.message}`];
        const source = fullSource(err);
        if (source) parts.push(`Source: ${source}`);
        if (err.url) parts.push(`Page: ${err.url}`);
        if ((err.count || 1) > 1) parts.push(`Occurrences: ${err.count}`);
        if (err.stack) parts.push(`Stack:\n${err.stack}`);
        return parts.join('\n');
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function flash(button, label) {
        const original = button.dataset.label || button.textContent;
        button.dataset.label = original;
        button.textContent = label;
        button.classList.add('done');
        setTimeout(() => {
            button.textContent = original;
            button.classList.remove('done');
        }, 1500);
    }

    async function copy(text, button) {
        try {
            await navigator.clipboard.writeText(text);
            flash(button, 'Copied!');
        } catch (e) {
            flash(button, 'Failed');
        }
    }

    function deleteErrors(payload) {
        return chrome.runtime.sendMessage({ action: 'delete-errors', ...payload });
    }

    // ---------- Rendering ----------

    function applyFilters() {
        const q = query.trim().toLowerCase();
        return allErrors.filter(err => {
            if (scope === 'tab' && err.tabId !== activeTabId) return false;
            if (!q) return true;
            return [err.message, err.sourceUrl, err.source, err.url, typeMeta(err).label]
                .some(field => typeof field === 'string' && field.toLowerCase().includes(q));
        });
    }

    function renderCard(err) {
        const meta = typeMeta(err);
        const card = el('div', 'error-card');
        card.dataset.id = err.id;
        card.style.setProperty('--accent', meta.color);
        if (expanded.has(err.id)) card.classList.add('expanded');
        if (stacksShown.has(err.id)) card.classList.add('show-stack');

        const metaRow = el('div', 'error-meta');
        const type = el('span', 'error-type', meta.label);
        if ((err.count || 1) > 1) type.appendChild(el('span', 'error-count', `×${err.count}`));
        const source = el('span', 'error-source', shortSource(err));
        source.title = fullSource(err) || 'Inline script';
        metaRow.append(type, source);

        const msg = el('div', 'error-msg', err.message);
        msg.title = 'Click to expand';
        msg.dataset.action = 'expand';

        card.append(metaRow, msg);

        if (err.stack) card.appendChild(el('pre', 'error-stack', err.stack));

        const footer = el('div', 'error-footer');
        const info = el('span', 'error-info', [formatTime(err), hostOf(err.url)].filter(Boolean).join(' · '));
        info.title = err.url || '';

        const actions = el('div', 'error-actions');
        const copyBtn = el('button', 'btn-sm', 'Copy');
        copyBtn.dataset.action = 'copy';
        actions.appendChild(copyBtn);
        if (err.stack) {
            const stackBtn = el('button', 'btn-sm', stacksShown.has(err.id) ? 'Hide stack' : 'Stack');
            stackBtn.dataset.action = 'stack';
            actions.appendChild(stackBtn);
        }
        const deleteBtn = el('button', 'btn-sm delete', '✕');
        deleteBtn.title = 'Delete';
        deleteBtn.dataset.action = 'delete';
        actions.appendChild(deleteBtn);

        footer.append(info, actions);
        card.appendChild(footer);
        return card;
    }

    function renderEmpty() {
        const empty = el('div', 'empty-state');
        if (query.trim()) {
            empty.textContent = 'No matching errors.';
        } else if (scope === 'tab') {
            empty.textContent = 'No errors on this tab.';
            if (allErrors.length) {
                empty.appendChild(el('small', '', `${allErrors.length} error(s) on other tabs - switch to "All tabs".`));
            }
        } else {
            empty.textContent = 'No errors tracked.';
        }
        errorList.appendChild(empty);
    }

    function render() {
        visibleErrors = applyFilters();
        const total = visibleErrors.reduce((sum, err) => sum + (err.count || 1), 0);
        countBadge.textContent = total > 999 ? '999+' : String(total);
        countBadge.classList.toggle('has-errors', total > 0);
        clearBtn.disabled = copyAllBtn.disabled = visibleErrors.length === 0;

        errorList.replaceChildren();
        if (!visibleErrors.length) {
            renderEmpty();
            return;
        }
        const fragment = document.createDocumentFragment();
        visibleErrors.forEach(err => fragment.appendChild(renderCard(err)));
        errorList.appendChild(fragment);
    }

    async function loadErrors() {
        const { errors = [] } = await chrome.storage.local.get({ errors: [] });
        allErrors = errors.map(err => ({ ...err, id: String(err.id) }));
        render();
    }

    // ---------- Events ----------

    errorList.addEventListener('click', async (event) => {
        const target = event.target.closest('[data-action]');
        if (!target) return;
        const card = target.closest('.error-card');
        const id = card && card.dataset.id;
        const err = allErrors.find(e => e.id === id);
        if (!err) return;

        switch (target.dataset.action) {
            case 'expand':
                if (window.getSelection().toString()) return;
                expanded.has(id) ? expanded.delete(id) : expanded.add(id);
                card.classList.toggle('expanded');
                break;
            case 'stack': {
                const shown = card.classList.toggle('show-stack');
                shown ? stacksShown.add(id) : stacksShown.delete(id);
                target.textContent = shown ? 'Hide stack' : 'Stack';
                break;
            }
            case 'copy':
                copy(formatReport(err), target);
                break;
            case 'delete':
                await deleteErrors({ ids: [err.id] });
                break;
        }
    });

    clearBtn.addEventListener('click', async () => {
        const ids = visibleErrors.map(err => err.id);
        if (!ids.length) return;
        if (scope === 'all' && !query.trim()) {
            await deleteErrors({ all: true });
        } else {
            await deleteErrors({ ids });
        }
    });

    copyAllBtn.addEventListener('click', () => {
        if (!visibleErrors.length) return;
        copy(visibleErrors.map(formatReport).join('\n\n----------\n\n'), copyAllBtn);
    });

    searchInput.addEventListener('input', () => {
        query = searchInput.value;
        render();
    });

    scopeButtons.forEach(button => {
        button.classList.toggle('active', button.dataset.scope === scope);
        button.addEventListener('click', () => {
            scope = button.dataset.scope;
            localStorage.setItem('scope', scope);
            scopeButtons.forEach(b => b.classList.toggle('active', b === button));
            render();
        });
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.errors) loadErrors();
    });

    loadErrors();
    searchInput.focus();
});
