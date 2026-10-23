import { config } from '../config.js';

export function createPublicInfoUI({ documentRef = document, dialogController, openFeedback }) {
    const dialog = documentRef.getElementById('public-info-dialog');
    const heading = documentRef.getElementById('public-info-title');
    const topics = Array.from(dialog.querySelectorAll('[data-public-title]'));

    documentRef.querySelectorAll('a[href="#public-help"]').forEach(link => {
        link.addEventListener('click', event => {
            event.preventDefault();
            const mobileMenu = documentRef.querySelector('.mobile-menu');
            if (mobileMenu) mobileMenu.open = false;
            const footer = documentRef.getElementById('public-help');
            footer.scrollIntoView({ block: 'start' });
            footer.querySelector('a').focus({ preventScroll: true });
        });
    });

    documentRef.querySelectorAll('[data-public-topic]').forEach(link => {
        link.addEventListener('click', event => {
            const topic = topics.find(item => item.id === link.dataset.publicTopic);
            if (!topic) return;
            event.preventDefault();
            topics.forEach(item => { item.hidden = item !== topic; });
            heading.textContent = topic.dataset.publicTitle;
            dialog.querySelectorAll('[data-public-topic]').forEach(item => {
                if (item.dataset.publicTopic === topic.id) item.setAttribute('aria-current', 'page');
                else item.removeAttribute('aria-current');
            });
            topic.querySelectorAll('details').forEach(item => { item.open = false; });
            const mobileMenu = documentRef.querySelector('.mobile-menu');
            if (mobileMenu) mobileMenu.open = false;
            dialogController.open(dialog, link);
            dialog.scrollTop = 0;
            heading.focus({ preventScroll: true });
        });
    });

    documentRef.getElementById('close-public-info').addEventListener('click', () => dialogController.close(dialog));
    documentRef.getElementById('public-share-feedback').addEventListener('click', () => {
        dialogController.transition(dialog, documentRef.getElementById('usability-feedback-dialog'));
        openFeedback();
    });

    const email = config.researchContactEmail.trim();
    if (/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(email)) {
        const link = documentRef.getElementById('research-contact-email');
        link.href = `mailto:${email}`;
        documentRef.getElementById('research-contact-link').hidden = false;
        documentRef.getElementById('research-contact-placeholder').hidden = true;
    }
}