// --- CONFIGURATION ---
const PIN = "8080";
const MAX_LEN = 4;
const MAX_ATTEMPTS = 3;
const LOCKOUT_TIME = 10000;

// --- STATE ---
let current = "";
let attempts = 0;
let isProcessing = false;
let isLightMode = false;

// --- DOM ELEMENTS ---
const dots = document.querySelectorAll('.dot');
const msg = document.getElementById('msg');
const card = document.getElementById('card');
const iconContainer = document.getElementById('lockIcon');
const themeIcon = document.getElementById('themeIcon');

// --- THEME LOGIC ---
function toggleTheme() {
    isLightMode = !isLightMode;
    document.body.classList.toggle('light-theme');

    if (isLightMode) {
        themeIcon.innerHTML = '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';
    } else {
        themeIcon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
    }
}

// --- CORE LOGIC ---
function updateUI() {
    dots.forEach((dot, idx) => {
        if (idx < current.length) dot.classList.add('filled');
        else dot.classList.remove('filled', 'error', 'success');
    });
    if (current.length === 0) msg.innerText = "Awaiting Input...";
}

function input(num) {
    if (isProcessing) return;
    if (current.length < MAX_LEN) {
        current += num;
        updateUI();
        msg.innerText = "";
    }
}

function backspace() {
    if (isProcessing) return;
    current = current.slice(0, -1);
    updateUI();
}

function verify() {
    if (current.length !== MAX_LEN || isProcessing) return;

    isProcessing = true;
    msg.innerHTML = '<span class="spinner"></span> Verifying...';

    setTimeout(() => {
        if (current === PIN) {
            handleSuccess();
        } else {
            handleFailure();
        }
    }, 800);
}

function handleSuccess() {
    msg.innerText = "ACCESS GRANTED";
    msg.style.color = "var(--success)";

    dots.forEach(d => d.classList.add('success'));

    iconContainer.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';

    if (isLightMode) {
        iconContainer.style.background = "rgba(16, 185, 129, 0.2)";
        iconContainer.style.borderColor = "#10b981";
    } else {
        iconContainer.style.background = "rgba(52, 211, 153, 0.2)";
        iconContainer.style.borderColor = "#34d399";
        iconContainer.style.boxShadow = "0 0 30px rgba(52, 211, 153, 0.4)";
    }
}

function handleFailure() {
    attempts++;
    isProcessing = false;

    msg.innerText = "ACCESS DENIED";
    msg.style.color = "var(--error)";

    card.classList.add('shake');
    dots.forEach(d => d.classList.add('error'));

    setTimeout(() => {
        card.classList.remove('shake');
        current = "";
        updateUI();
        msg.style.color = "var(--text-muted)";
        checkLockout();
    }, 600);
}

function checkLockout() {
    if (attempts >= MAX_ATTEMPTS) {
        isProcessing = true;
        msg.innerText = `LOCKED (${LOCKOUT_TIME / 1000}s)`;
        msg.style.color = "var(--error)";
        card.classList.add('locked-out');

        let countdown = LOCKOUT_TIME / 1000;
        let interval = setInterval(() => {
            countdown--;
            msg.innerText = `LOCKED (${countdown}s)`;
            if (countdown <= 0) {
                clearInterval(interval);
                resetLockout();
            }
        }, 1000);
    }
}

function resetLockout() {
    attempts = 0;
    isProcessing = false;
    card.classList.remove('locked-out');
    msg.innerText = "Awaiting Input...";
    msg.style.color = "var(--text-muted)";
}

document.addEventListener('keydown', (e) => {
    if (isProcessing) return;
    if (!isNaN(e.key) && e.key !== ' ') input(e.key);
    if (e.key === 'Backspace') backspace();
    if (e.key === 'Enter') verify();
});
