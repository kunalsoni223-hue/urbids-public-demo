import { STORAGE_KEYS } from '../core/constants.js';
import { readArray, writeJSON } from '../core/storage.js';

const scoreFields = [
    'conceptClarity',
    'trust',
    'biddingClarity',
    'inspectionPaymentClarity',
    'easeOfUse'
];
const policyFields = [
    'winnerCommitmentClear',
    'reservationDepositUnderstandable',
    'handoverChoiceAppropriate',
    'onPlatformValueSufficient'
];
const sensitiveTextPatterns = [
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /(?:\+?\d[\s().-]*){10,}/,
    /\b(?:street|road|lane|apartment|flat|house|address)\b\s*[#,:-]?\s*\d+/i,
    /\b(?:card|cvv|cvc|upi|account number|ifsc)\b/i
];

function readValue(documentRef, id) {
    return documentRef.getElementById(id).value.trim();
}

export function createPublicFeedbackUI({ documentRef = document, dialogController }) {
    const dialog = documentRef.getElementById('usability-feedback-dialog');
    const form = documentRef.getElementById('usability-feedback-form');
    const error = documentRef.getElementById('usability-feedback-error');
    const success = documentRef.getElementById('usability-feedback-success');
    const submitButton = documentRef.getElementById('submit-usability-feedback');
    const closeSuccessButton = documentRef.getElementById('close-usability-feedback-success');
    let isSubmitting = false;

    function openFeedback(trigger) {
        error.textContent = '';
        success.hidden = true;
        closeSuccessButton.hidden = true;
        form.hidden = false;
        form.reset();
        dialogController.open(dialog, trigger);
    }

    form.addEventListener('submit', event => {
        event.preventDefault();
        if (isSubmitting) return;
        isSubmitting = true;
        submitButton.disabled = true;
        error.textContent = '';

        const writtenFields = ['confusing', 'prevent-use', 'valuable'];
        const writtenFeedback = Object.fromEntries(writtenFields.map(field => [
            field === 'prevent-use' ? 'preventUse' : field,
            readValue(documentRef, `feedback-${field}`)
        ]));
        if (Object.values(writtenFeedback).some(value => sensitiveTextPatterns.some(pattern => pattern.test(value)))) {
            error.textContent = 'Remove personal details, contact information, addresses, and payment information before saving.';
            isSubmitting = false;
            submitButton.disabled = false;
            return;
        }

        const scores = Object.fromEntries(scoreFields.map(field => [
            field,
            Number(documentRef.getElementById(`feedback-${field}`).value)
        ]));
        const policyAnswers = Object.fromEntries(policyFields.map(field => [
            field,
            documentRef.getElementById(`feedback-${field}`).value
        ]));
        const id = globalThis.crypto?.randomUUID?.()
            || `feedback-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const response = {
            id,
            journey: readValue(documentRef, 'feedback-journey'),
            scores,
            policyAnswers,
            ...writtenFeedback,
            likelyBuyCategory: readValue(documentRef, 'feedback-buy-category'),
            likelySellCategory: readValue(documentRef, 'feedback-sell-category'),
            createdAt: new Date().toISOString()
        };
        const records = readArray(STORAGE_KEYS.feedback);
        if (!writeJSON(STORAGE_KEYS.feedback, [...records, response])) {
            error.textContent = 'Feedback could not be saved in this browser. Check browser storage permissions and try again.';
            isSubmitting = false;
            submitButton.disabled = false;
            return;
        }

        form.hidden = true;
        success.hidden = false;
        closeSuccessButton.hidden = false;
        isSubmitting = false;
        submitButton.disabled = false;
    });

    documentRef.getElementById('close-usability-feedback').addEventListener('click', () => dialogController.close(dialog));
    closeSuccessButton.addEventListener('click', () => dialogController.close(dialog));
    documentRef.getElementById('share-feedback-footer').addEventListener('click', event => openFeedback(event.currentTarget));
    documentRef.getElementById('share-feedback-banner')?.addEventListener('click', event => openFeedback(event.currentTarget));
    documentRef.getElementById('public-share-feedback').addEventListener('click', event => openFeedback(event.currentTarget));

    return { openFeedback };
}
