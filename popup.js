document.addEventListener('DOMContentLoaded', () => {
    const errorList = document.getElementById('errorList');
    const clearBtn = document.getElementById('clearBtn');
    const autoHideCheck = document.getElementById('autoHideCheck');

    // Load Settings
    chrome.storage.local.get({ autoHide: true }, (data) => {
        autoHideCheck.checked = data.autoHide;
    });

    autoHideCheck.addEventListener('change', () => {
        chrome.storage.local.set({ autoHide: autoHideCheck.checked });
    });

    function renderErrors() {
        chrome.storage.local.get({ errors: [] }, (data) => {
            if (data.errors.length === 0) {
                errorList.innerHTML = '<div class="empty-state">No errors tracked.</div>';
                return;
            }

            errorList.innerHTML = '';
            data.errors.forEach(err => {
                const card = document.createElement('div');
                card.className = 'error-card';
                card.innerHTML = `
                    <div class="error-meta">
                        <span class="error-type">Error</span>
                        <span class="error-source">${err.source || 'inline'}</span>
                    </div>
                    <div class="error-msg">${err.message}</div>
                    <div class="error-actions">
                        <button class="btn-sm copy-btn" data-msg="${err.message.replace(/"/g, '&quot;')}">Copy</button>
                    </div>
                `;
                errorList.appendChild(card);
            });

            document.querySelectorAll('.copy-btn').forEach(btn => {
                btn.onclick = () => {
                    navigator.clipboard.writeText(btn.getAttribute('data-msg'));
                    btn.innerText = 'Copied!';
                    setTimeout(() => btn.innerText = 'Copy', 2000);
                };
            });
        });
    }

    clearBtn.onclick = () => {
        chrome.storage.local.set({ errors: [] }, renderErrors);
    };

    renderErrors();
});
