import {
    DISPUTE_REASON_LABELS,
    USABILITY_EVENT_TYPE
} from '../core/constants.js';

export function createDisputeUI({ documentRef = document, disputeService, state, dialogController, recordEvent = () => {}, onChanged = () => {} }) {
    const reportDialog = documentRef.getElementById('report-issue-dialog');
    const reportForm = documentRef.getElementById('report-issue-form');
    const reportReason = documentRef.getElementById('dispute-reason');
    const reportError = documentRef.getElementById('report-issue-error');
    let activeListingId = null;

    reportReason.replaceChildren(
        new Option('Choose a reason', ''),
        ...Object.entries(DISPUTE_REASON_LABELS).map(([value, label]) => new Option(label, value))
    );

    function openReport(listingId, sourceDialog) {
        if (!disputeService.canReport(listingId)) return;
        const listing = state.listingStates.get(listingId);
        if (!listing) return;
        activeListingId = listingId;
        reportForm.reset();
        reportForm.hidden = false;
        reportError.textContent = '';
        documentRef.getElementById('report-issue-item').textContent = listing.title;
        documentRef.getElementById('report-issue-success').hidden = true;
        documentRef.getElementById('report-issue-done').hidden = true;
        if (sourceDialog?.open) dialogController.transition(sourceDialog, reportDialog);
        else dialogController.open(reportDialog);
    }

    reportForm.addEventListener('submit', event => {
        event.preventDefault();
        reportError.textContent = '';
        const dispute = disputeService.openDispute(activeListingId, {
            reason: reportReason.value,
            description: documentRef.getElementById('dispute-description').value,
            evidenceNote: documentRef.getElementById('dispute-evidence-note').value
        });
        if (!dispute) {
            reportError.textContent = 'Choose a reason and describe the issue to submit it.';
            return;
        }
        reportForm.hidden = true;
        const success = documentRef.getElementById('report-issue-success');
        success.textContent = 'Transaction paused while this issue is reviewed.';
        success.hidden = false;
        documentRef.getElementById('report-issue-done').hidden = false;
        recordEvent(USABILITY_EVENT_TYPE.disputeOpened, { relatedId: dispute.listingId });
        onChanged();
    });
    documentRef.getElementById('cancel-report-issue').addEventListener('click', () => dialogController.close(reportDialog));
    documentRef.getElementById('report-issue-done').addEventListener('click', () => dialogController.close(reportDialog));
    reportDialog.addEventListener('close', () => { activeListingId = null; });

    return { openReport };
}