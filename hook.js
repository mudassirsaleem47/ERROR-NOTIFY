(function() {
    const originalError = console.error;
    
    function getSourceInfo() {
        const stack = new Error().stack;
        if (!stack) return "Unknown Source";
        
        const lines = stack.split("\n");
        // Console.error call ke baad wali line stack mein source hoti hai
        // 0: Error, 1: getSourceInfo, 2: dispatch, 3: console.error, 4: Actual Source
        const sourceLine = lines[4] || lines[3]; 
        if (!sourceLine) return "Unknown Source";

        const match = sourceLine.match(/at\s+(.*):(\d+):(\d+)/) || sourceLine.match(/at\s+(.*)/);
        if (match) {
            const path = match[1].split('/').pop(); // Sirf filename dikhane ke liye
            const line = match[2] || "";
            return `${path}${line ? ':' + line : ''}`;
        }
        return "Internal";
    }

    function dispatch(type, args) {
        const source = getSourceInfo();
        const message = args.map(arg => {
            try {
                return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
            } catch(e) { return String(arg); }
        }).join(' ');

        window.dispatchEvent(new CustomEvent('ChromeErrorNotifyEvent', {
            detail: { type, message, source }
        }));
    }

    console.error = function(...args) {
        dispatch('console-error', args);
        originalError.apply(console, args);
    };

    window.addEventListener('error', (event) => {
        const source = `${event.filename ? event.filename.split('/').pop() : 'inline'}:${event.lineno || '?'}`;
        dispatch('runtime-error', [event.message]);
    }, true);

    window.addEventListener('unhandledrejection', (event) => {
        dispatch('promise-rejection', [event.reason]);
    }, true);
})();
