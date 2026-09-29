chrome.runtime.onMessage.addListener((message) => {
    if (message && message.target === 'offscreen' && message.action === 'play-sound') {
        playAlertSound(message.kind);
    }
});
