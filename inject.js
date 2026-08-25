// InjectScript function to capture console errors
(function() {
    const originalError = console.error;
    const originalWarn = console.warn;

    function sendErrorToExtension(type, args) {
        const message = args.map(arg => {
            try {
                return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
            } catch(e) {
                return String(arg);
            }
        }).join(' ');

        window.dispatchEvent(new CustomEvent('ChromeErrorNotify', {
            detail: { type, message, stack: new Error().stack }
        }));
    }

    console.error = function(...args) {
        sendErrorToExtension('error', args);
        originalError.apply(console, args);
    };

    window.addEventListener('error', function(event) {
        sendErrorToExtension('runtime-error', [event.message]);
    });

    window.addEventListener('unhandledrejection', function(event) {
        sendErrorToExtension('promise-rejection', [event.reason]);
    });
})();
