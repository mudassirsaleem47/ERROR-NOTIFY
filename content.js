window.addEventListener('ChromeErrorNotifyEvent', (e) => {
    const { type, message, source } = e.detail;
    
    chrome.storage.local.get({ errors: [], autoHide: true }, (data) => {
        const errors = data.errors;
        errors.unshift({
            id: Date.now(),
            type,
            message,
            source,
            url: window.location.href,
            timestamp: new Date().toLocaleTimeString()
        });
        chrome.storage.local.set({ errors: errors.slice(0, 50) });

        if (document.body) {
            showChromeToastRight(message, source, data.autoHide);
        }
    });
});

function showChromeToastRight(message, source, autoHide) {
    let container = document.getElementById('chrome-error-notify-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'chrome-error-notify-container';
        container.style.cssText = 'position:fixed; top:20px; right:20px; z-index:2147483647; display:flex; flex-direction:column; align-items:flex-end; gap:10px; pointer-events:none; max-width: 450px;';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.style.cssText = `
        background: #292a2d;
        border: 1px solid #3c4043;
        border-top: 3px solid #f28b82;
        border-radius: 6px;
        padding: 12px 16px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        font-family: 'Segoe UI', Tahoma, sans-serif;
        font-size: 13px;
        width: 350px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        pointer-events: auto;
        animation: slideInRight 0.3s ease-out;
        color: #e8eaed;
        transition: all 0.3s;
    `;

    // Animations update
    if (!document.getElementById('error-notify-animations')) {
        const styleTag = document.createElement('style');
        styleTag.id = 'error-notify-animations';
        styleTag.textContent = `
            @keyframes slideInRight { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
            @keyframes slideOutRight { from { transform: translateX(0); opacity: 1; } to { transform: translateX(120%); opacity: 0; } }
        `;
        document.head.appendChild(styleTag);
    }

    toast.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="color:#f28b82; font-weight:bold; font-size:11px;">ERROR</span>
            <span style="color:#9aa0a6; font-family:monospace; font-size:10px;">${source}</span>
        </div>
        <div style="color:#e8eaed; line-height:1.5; word-break:break-all; font-weight:400;">${message}</div>
        <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:4px;">
            <button id="error-copy-btn" style="background:transparent; border:1px solid #5f6368; color:#8ab4f8; padding:5px 12px; border-radius:4px; cursor:pointer; font-size:11px; font-weight:500;">Copy</button>
            <button id="error-close-btn" style="background:transparent; border:1px solid #5f6368; color:#9aa0a6; padding:5px 12px; border-radius:4px; cursor:pointer; font-size:11px; font-weight:500;">Dismiss</button>
        </div>
    `;

    container.appendChild(toast);

    const closeToast = () => {
        toast.style.animation = 'slideOutRight 0.3s forwards';
        setTimeout(() => toast.remove(), 300);
    };

    toast.querySelector('#error-close-btn').onclick = closeToast;
    
    toast.querySelector('#error-copy-btn').onclick = () => {
        navigator.clipboard.writeText(message);
        toast.querySelector('#error-copy-btn').innerText = 'Copied!';
        toast.querySelector('#error-copy-btn').style.color = '#81c995';
        setTimeout(closeToast, 300);
    };

    if (autoHide) {
        setTimeout(closeToast, 5000);
    }
}
