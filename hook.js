(function () {
    if (window.__errorNotifyHooked) return;
    window.__errorNotifyHooked = true;

    const EVENT_NAME = 'ChromeErrorNotifyEvent';
    const MAX_LENGTH = 10000;
    let dispatching = false;

    function stackFrames(stack) {
        if (typeof stack !== 'string') return [];
        return stack.split('\n').filter(line => /^\s*at\s/.test(line));
    }

    function parseFrame(line) {
        if (!line) return null;
        const match = line.trim().match(/\(?([^\s()]+):(\d+):(\d+)\)?$/);
        if (!match) return null;
        return { url: match[1], line: Number(match[2]), column: Number(match[3]) };
    }

    const SELF_URL = (() => {
        const frame = parseFrame(stackFrames(new Error().stack)[0]);
        return frame ? frame.url : null;
    })();

    function isOwnFrame(line) {
        return SELF_URL !== null && line.includes(SELF_URL);
    }

    function firstExternalFrame(stack) {
        for (const line of stackFrames(stack)) {
            if (isOwnFrame(line)) continue;
            const frame = parseFrame(line);
            if (frame) return frame;
        }
        return null;
    }

    function cleanStack(stack) {
        return stackFrames(stack).filter(line => !isOwnFrame(line)).map(line => line.trim()).join('\n');
    }

    function truncate(text) {
        return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH)}… [truncated]` : text;
    }

    function serialize(arg) {
        if (typeof arg === 'string') return arg;
        if (arg === undefined) return 'undefined';
        if (arg === null) return 'null';
        if (arg instanceof Error) return `${arg.name || 'Error'}: ${arg.message}`;
        if (typeof arg === 'function') return `[Function ${arg.name || 'anonymous'}]`;
        if (typeof arg === 'symbol' || typeof arg === 'bigint') return arg.toString();
        if (typeof Element !== 'undefined' && arg instanceof Element) {
            return `<${arg.tagName.toLowerCase()}${arg.id ? '#' + arg.id : ''}>`;
        }
        if (typeof arg === 'object') {
            try {
                const seen = new WeakSet();
                const json = JSON.stringify(arg, (key, value) => {
                    if (typeof value === 'bigint') return value.toString();
                    if (value instanceof Error) return `${value.name}: ${value.message}`;
                    if (value && typeof value === 'object') {
                        if (seen.has(value)) return '[Circular]';
                        seen.add(value);
                    }
                    return value;
                });
                return json === undefined ? Object.prototype.toString.call(arg) : json;
            } catch (e) {
                return Object.prototype.toString.call(arg);
            }
        }
        return String(arg);
    }

    // Supports printf-style console calls, e.g. console.error('%s failed', name)
    function formatArgs(args) {
        if (!args.length) return '';
        const rest = args.slice(1);
        const first = args[0];
        let head;
        if (typeof first === 'string' && /%[sdifoOc]/.test(first)) {
            head = first.replace(/%([sdifoOc%])/g, (match, token) => {
                if (token === '%') return '%';
                if (!rest.length) return match;
                const value = rest.shift();
                if (token === 'c') return '';
                if (token === 'd' || token === 'i') return String(parseInt(value, 10));
                if (token === 'f') return String(parseFloat(value));
                return serialize(value);
            });
        } else {
            head = serialize(first);
        }
        return [head, ...rest.map(serialize)].join(' ');
    }

    function emit(type, message, frame, stack) {
        if (dispatching) return;
        dispatching = true;
        try {
            window.dispatchEvent(new CustomEvent(EVENT_NAME, {
                detail: {
                    type,
                    message: truncate(message || '(empty message)'),
                    sourceUrl: frame ? frame.url : '',
                    line: frame ? frame.line : 0,
                    column: frame ? frame.column : 0,
                    stack: truncate(stack || '')
                }
            }));
        } catch (e) {
            // Never let the monitor break the page
        } finally {
            dispatching = false;
        }
    }

    function hookConsole(method, type) {
        const original = console[method];
        if (typeof original !== 'function') return;
        console[method] = function (...args) {
            try {
                const callStack = new Error().stack;
                const error = args.find(arg => arg instanceof Error);
                const stack = error && error.stack ? error.stack : cleanStack(callStack);
                emit(type, formatArgs(args), firstExternalFrame(callStack), stack);
            } catch (e) {
                // ignore
            }
            return original.apply(this, args);
        };
    }

    hookConsole('error', 'console-error');
    hookConsole('warn', 'console-warn');

    window.addEventListener('error', (event) => {
        const target = event.target;
        if (target && target !== window && typeof Element !== 'undefined' && target instanceof Element) {
            const url = target.currentSrc || target.src || target.href || '';
            emit(
                'resource-error',
                `Failed to load <${target.tagName.toLowerCase()}>: ${url || '(unknown source)'}`,
                url ? { url, line: 0, column: 0 } : null,
                ''
            );
            return;
        }

        const error = event.error;
        const stack = error && error.stack ? error.stack : '';
        const frame = event.filename
            ? { url: event.filename, line: event.lineno || 0, column: event.colno || 0 }
            : firstExternalFrame(stack);
        emit('runtime-error', event.message || (error ? serialize(error) : 'Unknown error'), frame, stack);
    }, true);

    window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        const stack = reason instanceof Error && reason.stack ? reason.stack : '';
        emit('promise-rejection', `Uncaught (in promise) ${serialize(reason)}`, firstExternalFrame(stack), stack);
    }, true);
})();
