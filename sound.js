// Shared by popup.html (preview) and offscreen.html (alerts)
let alertAudioContext = null;

function playAlertSound(kind) {
    alertAudioContext = alertAudioContext || new AudioContext();
    const ctx = alertAudioContext;
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;
    const notes = kind === 'warning'
        ? [[660, 0]]
        : [[880, 0], [587, 0.13]];

    const master = ctx.createGain();
    master.gain.value = 0.16;
    master.connect(ctx.destination);

    for (const [frequency, offset] of notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(1, now + offset + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.28);
        osc.connect(gain).connect(master);
        osc.start(now + offset);
        osc.stop(now + offset + 0.3);
    }
}
