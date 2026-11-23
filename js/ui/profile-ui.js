import { RATING_CONSTRAINTS, SERVICE_ERROR_CODE, USER_TYPE } from '../core/constants.js';

export function createProfileUI({ documentRef = document, userService, ratingService, state, dialogController, onUserChanged, onOpenAccount, onShareFeedback, onCreateAccount }) {
    const profileControl = documentRef.getElementById('profile-control');
    const profileToggle = documentRef.getElementById('profile-control-toggle');
    const ratingDialog = documentRef.getElementById('rating-dialog');
    const ratingForm = documentRef.getElementById('rating-form');
    const ratingCommentInput = documentRef.getElementById('rating-comment');
    ratingCommentInput.maxLength = RATING_CONSTRAINTS.maximumCommentLength;
    let activeRatingTransactionId = null;
    let accountGate = () => true;
    const mobileMenu = documentRef.querySelector('.mobile-menu');
    const mobileMenuToggle = documentRef.getElementById('mobile-menu-toggle');

    function updateHeader() {
        const user = userService.getCurrentUser();
        const reputation = ratingService.getReputation(user.id);
        const isGuest = userService.getCurrentUserType() === USER_TYPE.guest;
        const avatar = documentRef.getElementById('profile-avatar');
        avatar.textContent = user.initials;
        avatar.dataset.avatarColor = user.avatarColor;
        documentRef.getElementById('profile-name').textContent = user.firstName;
        documentRef.getElementById('profile-reputation').textContent = reputation.sellerRating === null
            ? reputation.completedTransactions === 0 ? 'New member' : `No rating · ${reputation.completedTransactions} completed`
            : `★ ${reputation.sellerRating.toFixed(1)} · ${reputation.completedTransactions} completed`;
        documentRef.getElementById('profile-user-summary').textContent = user.location;
        profileToggle.setAttribute('aria-label', isGuest ? 'Open public visitor menu'
            : user.isLocalAccount ? 'Open my browser-local prototype account menu' : `Open fictional demo profile for ${user.firstName}`);
        documentRef.getElementById('mobile-profile-name').textContent = user.firstName;
        documentRef.getElementById('profile-create-account').hidden = !isGuest;
        documentRef.getElementById('profile-continue-browsing').hidden = !isGuest;
        documentRef.getElementById('mobile-create-account').hidden = !isGuest;
        documentRef.getElementById('mobile-continue-browsing').hidden = !isGuest;
        documentRef.getElementById('profile-share-feedback').hidden = isGuest;
        documentRef.getElementById('mobile-share-feedback').hidden = isGuest;
    }

    function openRatingDialog(transactionId, returnFocus = documentRef.activeElement) {
        if (accountGate(() => openRatingDialog(transactionId, returnFocus), returnFocus) === false) return;
        if (!ratingService.canRate(transactionId)) return;
        const transaction = state.transactionStore.get(transactionId);
        const reviewedUserId = ratingService.getCounterparty(transactionId);
        const reviewedUser = userService.getUser(reviewedUserId);
        const listing = state.listingStates.get(transactionId);
        activeRatingTransactionId = transactionId;
        ratingForm.reset();
        documentRef.getElementById('rating-item-name').textContent = listing?.title || transactionId;
        documentRef.getElementById('rating-counterparty').textContent = `Rate ${reviewedUser?.firstName || 'this participant'}`;
        documentRef.getElementById('rating-error').textContent = '';
        dialogController.open(ratingDialog, returnFocus);
    }

    function openAccountSection(trigger) {
        profileControl.open = false;
        const returnTarget = trigger.closest('.mobile-menu') ? mobileMenuToggle : profileToggle;
        mobileMenu.open = false;
        onOpenAccount(trigger.dataset.accountSection, returnTarget);
    }

    function continueBrowsing(trigger) {
        profileControl.open = false;
        mobileMenu.open = false;
        const returnTarget = trigger?.closest('.mobile-menu') ? mobileMenuToggle : profileToggle;
        returnTarget?.focus({ preventScroll: true });
    }

    function shareFeedback(trigger) {
        profileControl.open = false;
        mobileMenu.open = false;
        onShareFeedback(trigger);
    }

    documentRef.querySelectorAll('[data-account-section]').forEach(button => button.addEventListener('click', event => openAccountSection(event.currentTarget)));
    documentRef.getElementById('profile-share-feedback').addEventListener('click', event => shareFeedback(event.currentTarget));
    documentRef.getElementById('mobile-share-feedback').addEventListener('click', event => shareFeedback(event.currentTarget));
    documentRef.getElementById('profile-create-account').addEventListener('click', event => onCreateAccount(event.currentTarget));
    documentRef.getElementById('mobile-create-account').addEventListener('click', event => onCreateAccount(event.currentTarget));
    documentRef.getElementById('profile-continue-browsing').addEventListener('click', event => continueBrowsing(event.currentTarget));
    documentRef.getElementById('mobile-continue-browsing').addEventListener('click', event => continueBrowsing(event.currentTarget));
    ratingForm.addEventListener('submit', event => {
        event.preventDefault();
        const score = Number(documentRef.getElementById('rating-score').value);
        const result = ratingService.submitRating(
            activeRatingTransactionId,
            score,
            documentRef.getElementById('rating-comment').value
        );
        if (!result.ok) {
            documentRef.getElementById('rating-error').textContent = result.code === SERVICE_ERROR_CODE.ratingAlreadySubmitted
                ? 'You have already rated this transaction.'
                : result.code === SERVICE_ERROR_CODE.invalidInput
                    ? `Choose ${RATING_CONSTRAINTS.minimumScore} to ${RATING_CONSTRAINTS.maximumScore} stars and keep the comment within ${RATING_CONSTRAINTS.maximumCommentLength} characters.`
                    : 'Complete this transaction before rating.';
            return;
        }
        dialogController.close(ratingDialog);
        updateHeader();
        onUserChanged();
    });
    documentRef.getElementById('cancel-rating').addEventListener('click', () => dialogController.close(ratingDialog));
    ratingDialog.addEventListener('close', () => { activeRatingTransactionId = null; });

    updateHeader();
    return {
        updateHeader,
        openRatingDialog,
        setAccountGate(handler) { accountGate = handler; }
    };
}