export function announceGlobalStatus(message, documentRef = document, { allowDialog = false } = {}) {
    if (!allowDialog && documentRef.querySelector('dialog[open]')) return false;
    const status = documentRef.getElementById('global-status');
    if (!status || typeof message !== 'string' || !message.trim()) return false;
    if (status.textContent === message) {
        status.textContent = '';
        documentRef.defaultView.setTimeout(() => { status.textContent = message; }, 50);
    } else {
        status.textContent = message;
    }
    return true;
}