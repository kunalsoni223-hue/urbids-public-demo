export function createPublicFeedbackUI({ documentRef = document, dialogController, researchService }) {
    const dialog = documentRef.getElementById('usability-feedback-dialog');
    const form = documentRef.getElementById('usability-feedback-form');
    const error = documentRef.getElementById('usability-feedback-error');
    const success = documentRef.getElementById('usability-feedback-success');
    const submit = documentRef.getElementById('submit-usability-feedback');
    const done = documentRef.getElementById('close-usability-feedback-success');
    let submitting = false;

    function openFeedback(trigger = documentRef.activeElement) {
        form.reset();
        form.hidden = false;
        error.textContent = '';
        success.hidden = true;
        done.hidden = true;
        submit.disabled = false;
        submitting = false;
        dialogController.open(dialog, trigger);
    }

    form.addEventListener('submit', event => {
        event.preventDefault();
        if (submitting) return;
        submitting = true;
        submit.disabled = true;
        error.textContent = '';
        const result = researchService.submitFeedback({
            journey: documentRef.getElementById('feedback-journey').value,
            scores: Object.fromEntries(['conceptClarity', 'trust', 'biddingClarity', 'inspectionPaymentClarity', 'easeOfUse']
                .map(key => [key, Number(documentRef.getElementById(`feedback-${key}`).value)])),
            policyAnswers: Object.fromEntries(['winnerCommitmentClear', 'reservationDepositUnderstandable', 'handoverChoiceAppropriate', 'onPlatformValueSufficient']
                .map(key => [key, documentRef.getElementById(`feedback-${key}`).value])),
            confusing: documentRef.getElementById('feedback-confusing').value,
            preventUse: documentRef.getElementById('feedback-prevent-use').value,
            valuable: documentRef.getElementById('feedback-valuable').value,
            likelyBuyCategory: documentRef.getElementById('feedback-buy-category').value,
            likelySellCategory: documentRef.getElementById('feedback-sell-category').value
        });
        if (!result.ok) {
            error.textContent = result.message;
            submit.disabled = false;
            submitting = false;
            return;
        }
        form.hidden = true;
        success.hidden = false;
        done.hidden = false;
        done.focus();
    });

    documentRef.getElementById('close-usability-feedback').addEventListener('click', () => dialogController.close(dialog));
    done.addEventListener('click', () => dialogController.close(dialog));
    documentRef.getElementById('share-feedback-footer').addEventListener('click', event => openFeedback(event.currentTarget));
    return { openFeedback };
}
