const returnFocusTargets = new WeakMap();
const preparedDialogs = new WeakSet();

function firstFocusable(dialog) {
    return Array.from(dialog.querySelectorAll('[autofocus], input:not([type="hidden"]), select, textarea, button, a[href], summary, [tabindex="0"]'))
        .find(target => !target.matches(':disabled') && target.getClientRects().length);
}

export function createDialogController(documentRef = document) {
    function prepare(dialog) {
        if (preparedDialogs.has(dialog)) return;
        preparedDialogs.add(dialog);
        function associateErrors() {
            const error = dialog.querySelector('.bid-error, .form-error');
            if (error?.id) dialog.querySelectorAll('input, select, textarea').forEach(field => {
                const descriptions = new Set((field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
                descriptions.add(error.id);
                field.setAttribute('aria-describedby', [...descriptions].join(' '));
            });
        }
        associateErrors();
        dialog.addEventListener('invalid', event => event.target.setAttribute('aria-invalid', 'true'), true);
        dialog.addEventListener('input', event => event.target.removeAttribute('aria-invalid'));
        dialog.addEventListener('reset', () => dialog.querySelectorAll('[aria-invalid]').forEach(field => field.removeAttribute('aria-invalid')));
        new MutationObserver(() => {
            associateErrors();
            if (!dialog.open) return;
            const active = documentRef.activeElement;
            if (active === documentRef.body || (dialog.contains(active) && (!active.getClientRects().length || active.matches(':disabled')))) {
                firstFocusable(dialog)?.focus({ preventScroll: true });
            }
        }).observe(dialog, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled'] });
        dialog.addEventListener('close', () => {
            if (dialog.open) return;
            const target = returnFocusTargets.get(dialog);
            returnFocusTargets.delete(dialog);
            const activeDialog = Array.from(documentRef.querySelectorAll('dialog[open]')).at(-1);
            if (activeDialog) {
                if (target?.isConnected && activeDialog.contains(target) && target.getClientRects().length) target.focus({ preventScroll: true });
                else firstFocusable(activeDialog)?.focus({ preventScroll: true });
            } else if (typeof target === 'function') target();
            else if (target?.isConnected && target.getClientRects().length) target.focus({ preventScroll: true });
            else documentRef.getElementById('brand-name')?.focus({ preventScroll: true });
        });
    }

    function open(dialog, returnFocusTarget) {
        if (!dialog) return;
        prepare(dialog);
        if (dialog.open) return;

        const currentDialog = Array.from(documentRef.querySelectorAll('dialog[open]')).at(-1);
        const inheritedTarget = currentDialog ? returnFocusTargets.get(currentDialog) : null;
        returnFocusTargets.set(dialog, returnFocusTarget ?? inheritedTarget ?? documentRef.activeElement);
        dialog.showModal();
        const heading = dialog.querySelector('h2');
        if (heading) heading.tabIndex = -1;
        (dialog.querySelector('[autofocus]') || heading || firstFocusable(dialog))?.focus({ preventScroll: true });
    }

    function close(dialog, { restoreFocus = true } = {}) {
        if (!dialog?.open) return;
        if (!restoreFocus) returnFocusTargets.delete(dialog);
        dialog.close();
    }

    function transition(sourceDialog, targetDialog) {
        const returnFocusTarget = returnFocusTargets.get(sourceDialog) ?? documentRef.activeElement;
        close(sourceDialog, { restoreFocus: false });
        open(targetDialog, returnFocusTarget);
    }

    documentRef.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        const openDialogs = documentRef.querySelectorAll('dialog[open]');
        const topmostDialog = openDialogs[openDialogs.length - 1];
        if (!topmostDialog) return;
        event.preventDefault();
        close(topmostDialog);
    }, true);

    return { open, close, transition };
}