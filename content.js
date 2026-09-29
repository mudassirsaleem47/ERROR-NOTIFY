(() => {
    const EVENT_NAME = 'ChromeErrorNotifyEvent';
    const PAGE_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const MAX_TOASTS = 4;
    const AUTO_HIDE_MS = 5000;
    const FLUSH_DELAY_MS = 250;
    // Browsers clamp larger z-index values to this 32-bit maximum
    const MAX_Z_INDEX = 2147483647;

    const TYPE_META = {
        'console-error': {
            label: 'Error', title: 'Console Error', icon: 'error',
            tile: 'linear-gradient(160deg, #ff7b72 0%, #e5383b 100%)'
        },
        'runtime-error': {
            label: 'Uncaught', title: 'Uncaught Error', icon: 'uncaught',
            tile: 'linear-gradient(160deg, #ff6b81 0%, #c9184a 100%)'
        },
        'promise-rejection': {
            label: 'Promise', title: 'Unhandled Rejection', icon: 'promise',
            tile: 'linear-gradient(160deg, #c38fff 0%, #7b2ff7 100%)'
        },
        'resource-error': {
            label: 'Resource', title: 'Failed to Load', icon: 'resource',
            tile: 'linear-gradient(160deg, #ffb660 0%, #f76b1c 100%)'
        },
        'console-warn': {
            label: 'Warning', title: 'Warning', icon: 'warning',
            tile: 'linear-gradient(160deg, #ffe066 0%, #f5a300 100%)'
        }
    };

    const DEFAULT_SETTINGS = { showToasts: true, autoHide: true, captureWarnings: false, compactToasts: false };
    let settings = { ...DEFAULT_SETTINGS };
    let settingsLoaded = false;
    const pendingEvents = [];

    function isExtensionAlive() {
        try {
            return Boolean(chrome.runtime && chrome.runtime.id);
        } catch (e) {
            return false;
        }
    }

    chrome.storage.local.get(DEFAULT_SETTINGS, (data) => {
        settings = { ...DEFAULT_SETTINGS, ...data };
        settingsLoaded = true;
        pendingEvents.splice(0).forEach(handle);
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        for (const key of Object.keys(DEFAULT_SETTINGS)) {
            if (changes[key]) settings[key] = changes[key].newValue;
        }
        if (changes.compactToasts) applyLayoutMode();
    });

    window.addEventListener(EVENT_NAME, (event) => {
        if (!isExtensionAlive()) return;
        const detail = event.detail;
        if (!settingsLoaded) {
            pendingEvents.push(detail);
            return;
        }
        handle(detail);
    });

    function handle(detail) {
        if (!detail || typeof detail.message !== 'string') return;
        const type = TYPE_META[detail.type] ? detail.type : 'console-error';
        if (type === 'console-warn' && !settings.captureWarnings) return;

        const entry = {
            type,
            message: detail.message,
            stack: typeof detail.stack === 'string' ? detail.stack : '',
            sourceUrl: typeof detail.sourceUrl === 'string' ? detail.sourceUrl : '',
            line: Number(detail.line) || 0,
            column: Number(detail.column) || 0,
            url: location.href,
            pageId: PAGE_ID,
            time: Date.now(),
            count: 1
        };
        entry.key = `${entry.type}|${entry.message}|${entry.sourceUrl}:${entry.line}:${entry.column}`;

        queueForStorage(entry);
        if (settings.showToasts) showToast(entry);
    }

    // ---------- Storage (batched, written by the background worker) ----------

    let queue = [];
    let flushTimer = null;

    function queueForStorage(entry) {
        const existing = queue.find(item => item.key === entry.key);
        if (existing) {
            existing.count += 1;
            existing.time = entry.time;
        } else {
            queue.push({ ...entry });
        }
        if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
    }

    function flush() {
        clearTimeout(flushTimer);
        flushTimer = null;
        const batch = queue;
        queue = [];
        if (!batch.length || !isExtensionAlive()) return;
        try {
            chrome.runtime.sendMessage({ action: 'log-errors', entries: batch }).catch(() => {});
        } catch (e) {
            // Extension was reloaded; this content script is orphaned
        }
    }

    window.addEventListener('pagehide', flush);

    // ---------- Helpers ----------

    function shortSource(entry) {
        if (!entry.sourceUrl) return 'inline script';
        let name = entry.sourceUrl.split(/[?#]/)[0].split('/').pop() || entry.sourceUrl;
        if (entry.line) name += `:${entry.line}`;
        return name;
    }

    function fullSource(entry) {
        if (!entry.sourceUrl) return '';
        return entry.line ? `${entry.sourceUrl}:${entry.line}:${entry.column}` : entry.sourceUrl;
    }

    function formatReport(entry) {
        const parts = [`[${TYPE_META[entry.type].label}] ${entry.message}`];
        const source = fullSource(entry);
        if (source) parts.push(`Source: ${source}`);
        parts.push(`Page: ${entry.url}`);
        if (entry.stack) parts.push(`Stack:\n${entry.stack}`);
        return parts.join('\n');
    }

    function relativeTime(time) {
        const seconds = Math.round((Date.now() - time) / 1000);
        if (seconds < 45) return 'now';
        const minutes = Math.round(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        return new Date(time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (e) {
            // Clipboard API is blocked on insecure or unfocused pages; fall back below
        }
        try {
            const area = el('textarea');
            area.value = text;
            area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
            (shadow || document.documentElement).appendChild(area);
            area.select();
            const ok = document.execCommand('copy');
            area.remove();
            return ok;
        } catch (e) {
            return false;
        }
    }

    // ---------- Toasts (macOS look, stacked like Base UI Toast) ----------

    const FONT = `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif`;
    const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
    const GAP = 10;
    const PEEK = 10;
    const SCALE_STEP = 0.06;
    const VISIBLE_IN_STACK = 3;
    const EXIT_MS = 500;
    const SWIPE_DISMISS_PX = 60;
    const REDUCED_MOTION = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    const ICONS = {
        error: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M15 9l-6 6M9 9l6 6' }]],
        uncaught: [['path', { d: 'M8.5 3h7L21 8.5v7L15.5 21h-7L3 15.5v-7z' }], ['path', { d: 'M12 8v5M12 16.5v.01' }]],
        promise: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 7v5l3 2' }]],
        resource: [['rect', { x: 3.5, y: 5, width: 17, height: 14, rx: 2 }], ['path', { d: 'M3.5 15l4.5-4.5 4 4 3-3 5.5 5.5' }]],
        warning: [['path', { d: 'M12 3.5l9.5 16.5h-19z' }], ['path', { d: 'M12 10v4M12 17v.01' }]],
        close: [['path', { d: 'M7 7l10 10M17 7L7 17' }]]
    };

    const TOAST_STYLES = `
        :host { all: initial; }
        .container {
            --bg: rgba(40,40,42,0.78);
            --bg-hover: rgba(48,48,50,0.86);
            --border: rgba(255,255,255,0.14);
            --ring: rgba(0,0,0,0.55);
            --shadow: 0 12px 40px rgba(0,0,0,0.38);
            --highlight: rgba(255,255,255,0.08);
            --text: rgba(255,255,255,0.95);
            --text-body: rgba(255,255,255,0.86);
            --text-dim: rgba(255,255,255,0.6);
            --text-faint: rgba(255,255,255,0.5);
            --chip: rgba(255,255,255,0.16);
            --btn: rgba(255,255,255,0.14);
            --btn-hover: rgba(255,255,255,0.22);
            --close-bg: rgba(72,72,74,0.92);
            --close-hover: rgba(98,98,102,0.96);
            --close-text: rgba(255,255,255,0.85);
            --success: #30d158;
            --danger: #ff453a;
            --scrollbar: rgba(255,255,255,0.25);

            position: fixed; top: 12px; right: 12px; z-index: ${MAX_Z_INDEX};
            width: min(356px, calc(100vw - 24px));
            pointer-events: none; font-family: ${FONT};
            -webkit-font-smoothing: antialiased;
        }
        @media (prefers-color-scheme: light) {
            .container {
                --bg: rgba(246,246,248,0.84);
                --bg-hover: rgba(252,252,253,0.92);
                --border: rgba(0,0,0,0.08);
                --ring: rgba(0,0,0,0.1);
                --shadow: 0 10px 34px rgba(0,0,0,0.16);
                --highlight: rgba(255,255,255,0.7);
                --text: rgba(0,0,0,0.88);
                --text-body: rgba(0,0,0,0.76);
                --text-dim: rgba(0,0,0,0.5);
                --text-faint: rgba(0,0,0,0.42);
                --chip: rgba(0,0,0,0.08);
                --btn: rgba(0,0,0,0.06);
                --btn-hover: rgba(0,0,0,0.11);
                --close-bg: rgba(255,255,255,0.96);
                --close-hover: #ffffff;
                --close-text: rgba(0,0,0,0.7);
                --success: #248a3d;
                --danger: #d70015;
                --scrollbar: rgba(0,0,0,0.2);
            }
        }

        .region { display: flex; flex-direction: column; align-items: stretch; pointer-events: none; }
        .stack { position: relative; pointer-events: auto; transition: height .5s ${EASE}; }

        .clear-all {
            display: none; align-self: flex-end; margin-top: 2px;
            pointer-events: auto; cursor: pointer;
            padding: 5px 12px; border-radius: 999px;
            background: var(--bg); color: var(--text);
            border: 0.5px solid var(--border);
            box-shadow: 0 0 0 0.5px var(--ring), 0 4px 16px rgba(0,0,0,0.18);
            backdrop-filter: blur(24px) saturate(180%);
            font: 600 11px ${FONT};
            transition: background .2s, transform .2s;
        }
        .clear-all.visible { display: inline-flex; animation: fadeIn .3s ${EASE}; }
        .clear-all:hover { background: var(--bg-hover); }
        .clear-all:active { transform: scale(0.96); }

        .toast {
            --y: 0px; --scale: 1; --swipe-x: 0px; --swipe-y: 0px;
            position: absolute; top: 0; left: 0; right: 0;
            box-sizing: content-box;
            border-radius: 18px;
            background: var(--bg);
            backdrop-filter: blur(30px) saturate(190%);
            border: 0.5px solid var(--border);
            box-shadow: 0 0 0 0.5px var(--ring), var(--shadow), inset 0 0.5px 0 var(--highlight);
            color: var(--text); font-size: 13px;
            transform-origin: bottom center;
            transform: translateX(var(--swipe-x)) translateY(calc(var(--y) + var(--swipe-y))) scale(var(--scale));
            transition: transform .5s ${EASE}, opacity .5s, height .15s, background .2s;
            pointer-events: auto; touch-action: none; cursor: default;
            -webkit-user-select: none; user-select: none;
        }
        .toast:hover { background: var(--bg-hover); }
        .toast.starting { opacity: 0; transform: translateY(calc(-100% - 24px)) scale(var(--scale)); }
        .toast.limited { opacity: 0; pointer-events: none; }
        .toast.swiping { transition: opacity .5s, height .15s, background .2s; cursor: grabbing; }
        .toast.ending { opacity: 0; pointer-events: none; transform: translateX(calc(var(--swipe-x) + 120%)) translateY(var(--y)) scale(var(--scale)); }
        .toast.ending[data-swipe="up"] { transform: translateY(calc(var(--y) + var(--swipe-y) - 150%)) scale(var(--scale)); }

        .inner {
            display: flex; align-items: flex-start; gap: 11px;
            padding: 12px 14px 13px 12px;
            transition: opacity .25s ${EASE};
        }
        .toast.behind .inner { opacity: 0; pointer-events: none; }

        .app-icon {
            align-self: center;
            flex-shrink: 0; width: 36px; height: 36px; border-radius: 9px;
            display: flex; align-items: center; justify-content: center;
            background: var(--tile); color: #fff;
            box-shadow: inset 0 0.5px 0 rgba(255,255,255,0.35), 0 1px 3px rgba(0,0,0,0.3);
        }
        .app-icon svg { width: 20px; height: 20px; filter: drop-shadow(0 0.5px 0.5px rgba(0,0,0,0.25)); }

        .content { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
        .title-row { display: flex; align-items: center; gap: 6px; min-height: 18px; }
        .title {
            font-weight: 600; font-size: 13px; color: var(--text);
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .count {
            display: none; flex-shrink: 0;
            background: var(--chip); color: var(--text);
            border-radius: 999px; padding: 0 6px;
            font-size: 10.5px; font-weight: 600; line-height: 16px;
        }
        .count.visible { display: inline-block; }
        .count.pop { animation: pop .4s cubic-bezier(.34,1.56,.64,1); }
        .spacer { flex: 1; }
        .meta { position: relative; flex-shrink: 0; display: flex; align-items: center; justify-content: flex-end; min-width: 44px; height: 20px; }
        .time { font-size: 11.5px; color: var(--text-faint); transition: opacity .18s; }
        .copy {
            position: absolute; right: -4px; top: 50%;
            padding: 2px 10px; border-radius: 999px;
            background: var(--btn); color: var(--text);
            border: 0.5px solid var(--border);
            font: 600 11px ${FONT}; cursor: pointer; white-space: nowrap;
            opacity: 0; transform: translateY(-50%) scale(0.9); pointer-events: none;
            transition: opacity .18s, transform .18s ${EASE}, background .15s, color .15s;
        }
        .copy:hover { background: var(--btn-hover); }
        .copy:active { transform: translateY(-50%) scale(0.95); }
        .copy.done { color: var(--success); }
        .copy.failed { color: var(--danger); }
        .toast:not(.behind):hover .copy, .toast:focus-within .copy, .copy.done, .copy.failed {
            opacity: 1; transform: translateY(-50%) scale(1); pointer-events: auto;
        }
        .toast:not(.behind):hover .time, .toast:focus-within .time, .toast.copied .time { opacity: 0; }

        .subtitle {
            font-size: 12px; color: var(--text-dim);
            font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .msg {
            margin-top: 2px;
            font-size: 13px; line-height: 1.38; color: var(--text-body);
            word-break: break-word; white-space: pre-wrap;
            display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
            cursor: pointer;
        }
        .toast.expanded .msg {
            display: block; -webkit-line-clamp: unset;
            max-height: 11em; overflow-y: auto;
        }
        .msg::-webkit-scrollbar { width: 6px; }
        .msg::-webkit-scrollbar-thumb { background: var(--scrollbar); border-radius: 3px; }

        .close {
            position: absolute; top: -7px; left: -7px; width: 22px; height: 22px; padding: 0;
            display: flex; align-items: center; justify-content: center;
            border-radius: 50%; cursor: pointer;
            background: var(--close-bg); color: var(--close-text);
            border: 0.5px solid var(--border);
            box-shadow: 0 0 0 0.5px var(--ring), 0 2px 6px rgba(0,0,0,0.25);
            backdrop-filter: blur(20px);
            opacity: 0; transform: scale(0.6); pointer-events: none;
            transition: opacity .18s, transform .22s ${EASE}, background .15s;
        }
        .close svg { width: 11px; height: 11px; }
        .close:hover { background: var(--close-hover); }
        .toast:not(.behind):hover .close, .toast:focus-within .close { opacity: 1; transform: scale(1); pointer-events: auto; }

        button:focus-visible { outline: 2px solid #0a84ff; outline-offset: 2px; }

        .progress {
            position: absolute; left: 0; bottom: 0; width: 100%; height: 1px;
            opacity: 0; pointer-events: none;
            animation: timer ${AUTO_HIDE_MS}ms linear forwards;
        }
        .region:hover .progress, .toast.swiping .progress, .toast:focus-within .progress { animation-play-state: paused; }

        .container.compact { width: min(320px, calc(100vw - 24px)); }
        .compact .toast { border-radius: 14px; }
        .compact .inner { padding: 9px 12px 10px 10px; gap: 10px; }
        .compact .app-icon { width: 28px; height: 28px; border-radius: 7px; }
        .compact .app-icon svg { width: 16px; height: 16px; }
        .compact .subtitle { display: none; }
        .compact .msg { font-size: 12px; -webkit-line-clamp: 2; }

        @keyframes timer { from { transform: scaleX(1); } to { transform: scaleX(0); } }
        @keyframes pop { 0% { transform: scale(1); } 40% { transform: scale(1.3); } 100% { transform: scale(1); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px) scale(0.96); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) {
            .toast, .stack, .inner, .close, .copy { transition: none; }
            .count.pop, .clear-all.visible { animation: none; }
        }
    `;

    let host = null;
    let shadow = null;
    let container = null;
    let region = null;
    let stack = null;
    let clearAllBtn = null;
    let clockTimer = null;
    let layoutFrame = 0;
    let hovering = false;
    let focusInside = false;
    const toasts = new Map();
    let order = [];

    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => scheduleLayout()) : null;

    // Built with createElementNS because innerHTML is blocked on Trusted Types sites
    function svgIcon(name, className, strokeWidth = 2.2) {
        const SVG_NS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(SVG_NS, 'svg');
        const attrs = {
            viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': String(strokeWidth),
            'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true'
        };
        Object.entries(attrs).forEach(([key, value]) => svg.setAttribute(key, value));
        for (const [tag, shapeAttrs] of ICONS[name]) {
            const shape = document.createElementNS(SVG_NS, tag);
            Object.entries(shapeAttrs).forEach(([key, value]) => shape.setAttribute(key, String(value)));
            svg.appendChild(shape);
        }
        const wrap = el('span', className);
        wrap.appendChild(svg);
        return wrap;
    }

    function applyLayoutMode() {
        if (!container) return;
        container.classList.toggle('compact', Boolean(settings.compactToasts));
        scheduleLayout();
    }

    function syncClock() {
        if (order.length && !clockTimer) {
            clockTimer = setInterval(() => order.forEach(rec => rec.refreshTime()), 15000);
        } else if (!order.length && clockTimer) {
            clearInterval(clockTimer);
            clockTimer = null;
        }
    }

    function scheduleLayout() {
        if (layoutFrame) return;
        layoutFrame = requestAnimationFrame(() => {
            layoutFrame = 0;
            layout();
        });
    }

    // Collapsed: newest in front, older ones scaled down and peeking below.
    // Expanded (hover/focus): every toast at its own height, listed with a gap.
    function layout() {
        if (!stack) return;
        const expanded = (hovering || focusInside) && order.length > 1;
        const heights = order.map(rec => rec.inner.offsetHeight);
        const frontHeight = heights[0] || 0;
        let offset = 0;

        order.forEach((rec, index) => {
            let y;
            let scale;
            let height;
            if (expanded) {
                y = offset;
                scale = 1;
                height = heights[index];
                offset += heights[index] + GAP;
            } else {
                y = index * PEEK;
                scale = Math.max(0, 1 - index * SCALE_STEP);
                height = frontHeight;
            }
            const toast = rec.toast;
            toast.style.setProperty('--y', `${y}px`);
            toast.style.setProperty('--scale', String(scale));
            toast.style.height = `${height}px`;
            toast.style.zIndex = String(1000 - index);
            toast.classList.toggle('behind', !expanded && index > 0);
            toast.classList.toggle('limited', !expanded && index >= VISIBLE_IN_STACK);
        });

        const peeking = Math.min(order.length, VISIBLE_IN_STACK) - 1;
        const stackHeight = !order.length ? 0
            : expanded ? offset - GAP + 1
            : frontHeight + 1 + Math.max(0, peeking) * PEEK;
        stack.style.height = `${stackHeight + (order.length ? 8 : 0)}px`;

        clearAllBtn.classList.toggle('visible', expanded && order.length >= 2);
        clearAllBtn.textContent = `Clear All (${order.length})`;
    }

    function ensureContainer() {
        if (host && host.isConnected) return true;
        const parent = document.documentElement;
        if (!parent) return false;
        toasts.clear();
        order = [];
        hovering = false;
        focusInside = false;

        host = document.createElement('error-notify-root');
        host.style.setProperty('position', 'fixed', 'important');
        host.style.setProperty('top', '0', 'important');
        host.style.setProperty('right', '0', 'important');
        host.style.setProperty('z-index', String(MAX_Z_INDEX), 'important');
        host.style.setProperty('display', 'block', 'important');
        host.style.setProperty('visibility', 'visible', 'important');
        host.style.setProperty('opacity', '1', 'important');
        shadow = host.attachShadow({ mode: 'closed' });

        const style = el('style');
        style.textContent = TOAST_STYLES;
        container = el('div', 'container');
        region = el('div', 'region');
        stack = el('div', 'stack');
        clearAllBtn = el('button', 'clear-all');
        clearAllBtn.type = 'button';
        clearAllBtn.addEventListener('click', () => {
            [...order].forEach(rec => rec.close());
        });
        region.append(stack, clearAllBtn);
        container.appendChild(region);

        region.addEventListener('mouseenter', () => { hovering = true; layout(); });
        region.addEventListener('mouseleave', () => { hovering = false; layout(); });
        region.addEventListener('focusin', () => { focusInside = true; layout(); });
        region.addEventListener('focusout', (event) => {
            if (event.relatedTarget && region.contains(event.relatedTarget)) return;
            focusInside = false;
            layout();
        });

        applyLayoutMode();
        shadow.append(style, container);
        parent.appendChild(host);
        return true;
    }

    function showToast(entry) {
        const existing = toasts.get(entry.key);
        if (existing) {
            existing.bump();
            return;
        }
        if (!ensureContainer()) {
            document.addEventListener('DOMContentLoaded', () => showToast(entry), { once: true });
            return;
        }
        while (order.length >= MAX_TOASTS) {
            order[order.length - 1].close();
        }

        const meta = TYPE_META[entry.type];
        let count = 1;
        let lastTime = entry.time;

        const toast = el('div', 'toast starting');
        toast.style.setProperty('--tile', meta.tile);
        toast.setAttribute('role', 'alert');

        const inner = el('div', 'inner');

        const titleRow = el('div', 'title-row');
        const title = el('span', 'title', meta.title);
        const countBadge = el('span', 'count');
        const metaBox = el('div', 'meta');
        const time = el('span', 'time', relativeTime(lastTime));
        const copyBtn = el('button', 'copy', 'Copy');
        copyBtn.type = 'button';
        metaBox.append(time, copyBtn);
        titleRow.append(title, countBadge, el('span', 'spacer'), metaBox);

        const subtitle = el('div', 'subtitle', shortSource(entry));
        subtitle.title = fullSource(entry) || 'Inline script';

        const msg = el('div', 'msg', entry.message);
        msg.title = 'Click to expand';

        const content = el('div', 'content');
        content.append(titleRow, subtitle, msg);
        inner.append(svgIcon(meta.icon, 'app-icon'), content);

        const closeBtn = el('button', 'close');
        closeBtn.type = 'button';
        closeBtn.title = 'Dismiss';
        closeBtn.setAttribute('aria-label', 'Dismiss');
        closeBtn.appendChild(svgIcon('close', '', 2.6));

        toast.append(inner, closeBtn);

        const rec = { key: entry.key, toast, inner, closed: false };

        let progress = null;
        function startTimer() {
            if (!settings.autoHide) return;
            if (progress) progress.remove();
            progress = el('div', 'progress');
            progress.addEventListener('animationend', (event) => {
                if (event.animationName === 'timer') close();
            });
            toast.appendChild(progress);
        }

        function close(direction) {
            if (rec.closed) return;
            rec.closed = true;
            toasts.delete(entry.key);
            order = order.filter(item => item !== rec);
            if (resizeObserver) resizeObserver.unobserve(inner);
            if (direction) toast.dataset.swipe = direction;
            toast.classList.remove('swiping');
            toast.classList.add('ending');
            layout();
            syncClock();
            setTimeout(() => toast.remove(), REDUCED_MOTION ? 0 : EXIT_MS);
        }

        function refreshTime() {
            time.textContent = relativeTime(lastTime);
        }

        function bump() {
            count += 1;
            lastTime = Date.now();
            refreshTime();
            countBadge.textContent = String(count);
            countBadge.classList.add('visible');
            countBadge.classList.remove('pop');
            void countBadge.offsetWidth;
            countBadge.classList.add('pop');
            if (order[0] !== rec) {
                order = [rec, ...order.filter(item => item !== rec)];
                layout();
            }
            startTimer();
        }

        // Swipe right or up to dismiss
        let dragPointer = null;
        let startX = 0;
        let startY = 0;
        let axis = null;
        let moveX = 0;
        let moveY = 0;
        toast.addEventListener('pointerdown', (event) => {
            if (event.button !== 0 || event.target.closest('button')) return;
            dragPointer = event.pointerId;
            startX = event.clientX;
            startY = event.clientY;
            axis = null;
            moveX = 0;
            moveY = 0;
            toast.setPointerCapture(dragPointer);
            toast.classList.add('swiping');
        });
        toast.addEventListener('pointermove', (event) => {
            if (event.pointerId !== dragPointer) return;
            const dx = event.clientX - startX;
            const dy = event.clientY - startY;
            if (!axis && Math.hypot(dx, dy) > 4) axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
            moveX = axis === 'x' ? (dx > 0 ? dx : dx * 0.2) : 0;
            moveY = axis === 'y' ? (dy < 0 ? dy : dy * 0.2) : 0;
            toast.style.setProperty('--swipe-x', `${moveX}px`);
            toast.style.setProperty('--swipe-y', `${moveY}px`);
        });
        function endDrag(event) {
            if (event.pointerId !== dragPointer) return;
            dragPointer = null;
            if (axis === 'x' && moveX > SWIPE_DISMISS_PX) {
                close('right');
                return;
            }
            if (axis === 'y' && moveY < -SWIPE_DISMISS_PX) {
                close('up');
                return;
            }
            toast.classList.remove('swiping');
            toast.style.setProperty('--swipe-x', '0px');
            toast.style.setProperty('--swipe-y', '0px');
        }
        toast.addEventListener('pointerup', endDrag);
        toast.addEventListener('pointercancel', endDrag);

        msg.addEventListener('click', () => {
            if (axis) return;
            toast.classList.toggle('expanded');
            layout();
        });

        closeBtn.addEventListener('click', () => close());

        copyBtn.addEventListener('click', async () => {
            const ok = await copyText(formatReport(entry));
            copyBtn.textContent = ok ? 'Copied' : 'Failed';
            copyBtn.classList.add(ok ? 'done' : 'failed');
            toast.classList.add('copied');
            if (ok) {
                setTimeout(() => close(), 800);
            } else {
                setTimeout(() => {
                    copyBtn.textContent = 'Copy';
                    copyBtn.classList.remove('failed');
                    toast.classList.remove('copied');
                }, 1500);
            }
        });

        Object.assign(rec, { close, bump, refreshTime });
        toasts.set(entry.key, rec);
        order.unshift(rec);
        stack.appendChild(toast);
        if (resizeObserver) resizeObserver.observe(inner);

        layout();
        void toast.offsetHeight;
        toast.classList.remove('starting');
        syncClock();
        startTimer();
    }
})();
