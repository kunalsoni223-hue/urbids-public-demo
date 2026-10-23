import { config } from './js/config.js';
import { setStorageProblemHandler } from './js/core/storage.js';
import { loadListingStates } from './js/services/listing-service.js';
import { createBiddingService, getHighestValidBid, restoreBids } from './js/services/bidding-service.js';
import { createTransactionStore } from './js/services/transaction-service.js';
import { loadSellerSubmissions } from './js/services/submission-service.js';
import { createAppState } from './js/core/state.js';
import { createUserService } from './js/services/user-service.js';
import { createDialogController } from './js/ui/dialog.js';
import { createMarketplaceUI } from './js/ui/marketplace-ui.js';
import { createListingDialogUI } from './js/ui/listing-dialog-ui.js';
import { createSellerPhotoManager, createSellerUI } from './js/ui/seller-ui.js';
import { createTransactionUI } from './js/ui/transaction-ui.js';
import { createProfileUI } from './js/ui/profile-ui.js';
import { createAccountUI } from './js/ui/account-ui.js';
import { createProfileService } from './js/services/profile-service.js';
import { createDisputeService } from './js/services/dispute-service.js';
import { createDisputeUI } from './js/ui/dispute-ui.js';
import { createRatingService } from './js/services/rating-service.js';
import { createNotificationService } from './js/services/notification-service.js';
import { createNotificationUI } from './js/ui/notification-ui.js';
import { createActivityService } from './js/services/activity-service.js';
import { createPublicInfoUI } from './js/ui/public-info-ui.js';
import { createPublicFeedbackUI } from './js/ui/public-feedback-ui.js';
import { createAuctionManagementService } from './js/services/auction-management-service.js';
import { createWatchlistService } from './js/services/watchlist-service.js';
import { createAuctionManagementUI } from './js/ui/auction-management-ui.js';

const documentRef = document;
setStorageProblemHandler(() => {
    const status = documentRef.getElementById('storage-status');
    if (!status) return;
    status.hidden = false;
    status.textContent = 'Some saved data could not be read or saved. Changes may not survive a refresh. Check browser storage permissions before continuing.';
});
documentRef.getElementById('brand-name').textContent = config.brandName;
documentRef.getElementById('hero-tagline').textContent = config.tagline;
documentRef.getElementById('pilot-city').textContent = config.pilotCity;
documentRef.title = `${config.brandName} | Quality pre-owned marketplace`;

const dialogController = createDialogController(documentRef);
const sellerPhotoManager = createSellerPhotoManager({ documentRef });
const submissions = loadSellerSubmissions();
const { listingStates } = loadListingStates(submissions, sellerPhotoManager.resolveImages);
const userService = createUserService(listingStates);
let notificationUI;
const notificationService = createNotificationService({ onChange: () => notificationUI?.render() });
const { initialBidState, auctionExtensionCounts } = restoreBids(listingStates);
let disputeService;
const transactionStore = createTransactionStore({
    listingStates,
    getCurrentUser: userService.getCurrentUser,
    isTransactionPaused: listingId => disputeService?.hasOpenDispute(listingId) || false,
    notificationService,
    getHighestValidBid
});
disputeService = createDisputeService({ listingStates, transactionStore, userService, notificationService });
const ratingService = createRatingService({ listingStates, transactionStore, userService, notificationService });
const state = createAppState(listingStates, transactionStore, userService, disputeService, ratingService);
const biddingService = createBiddingService(listingStates, transactionStore, userService, undefined, notificationService, initialBidState, auctionExtensionCounts);
const auctionManagement = createAuctionManagementService({ listingStates, transactionStore, biddingService, userService, notificationService, photoManager: sellerPhotoManager });
const watchlistService = createWatchlistService({ listingStates, userService, transactionStore, notificationService, auctionManagement });
const activityService = createActivityService({ listingStates, transactionStore, userService, disputeService, ratingService, biddingService, auctionManagement, watchlistService, notificationService });
const profileService = createProfileService({ listingStates, transactionStore, userService, ratingService, disputeService, biddingService, auctionManagement });
const recordEvent = () => {};

let marketplaceUI;
let sellerUI;
let profileUI;
let accountUI;
let disputeUI;
marketplaceUI = createMarketplaceUI({
    documentRef,
    state,
    biddingService,
    activityService,
    auctionManagement,
    watchlistService,
    recordEvent,
    disputeService,
});

const listingDialogUI = createListingDialogUI({
    documentRef,
    state,
    biddingService,
    activityService,
    auctionManagement,
    watchlistService,
    recordEvent,
    dialogController,
    renderListings: () => marketplaceUI.renderListings()
});

notificationUI = createNotificationUI({
    documentRef,
    notificationService,
    userService,
    activityService,
    dialogController,
    onNavigate: notification => {
        if (listingStates.has(notification.listingId)) listingDialogUI.showProductDetails(notification.listingId);
        else documentRef.getElementById('sell').scrollIntoView({
            behavior: documentRef.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
        });
    }
});

const transactionUI = createTransactionUI({
    documentRef,
    config,
    state,
    biddingService,
    userService,
    disputeService,
    recordEvent,
    dialogController,
    renderListings: () => marketplaceUI.renderListings()
});

function refreshMarketplace() {
    transactionStore.expireWinnerConfirmations();
    marketplaceUI.renderListings();
    sellerUI?.renderSubmissions();
    accountUI?.render();
    notificationUI.render();
}

const auctionManagementUI = createAuctionManagementUI({
    documentRef, auctionManagement, listingStates, dialogController,
    recordEvent,
    onChanged: refreshMarketplace,
    onOpenListing: listingDialogUI.showProductDetails
});

function performPrimaryAction(listingId, selectedAction = activityService.getPrimaryAction(listingId)) {
    if (!selectedAction) return;
    const current = activityService.getPrimaryAction(listingId);
    if (!current || current.action !== selectedAction.action) {
        listingDialogUI.showProductDetails(listingId);
        return;
    }
    switch (current.action) {
        case 'bid': listingDialogUI.openBidDialog(listingId); break;
        case 'continue-buyer': transactionUI.resumeTransaction(listingId); break;
        case 'view-meetup': transactionUI.openMeetupSummary(listingId); break;
        case 'seller-handover': transactionUI.openSellerHandover(listingId); break;
        case 'continue-shipping': transactionUI.openShippingFlow(listingId); break;
        case 'manage': auctionManagementUI.open(listingId); break;
        case 'relist': auctionManagementUI.open(listingId, 'relist'); break;
        case 'second-chance': auctionManagementUI.open(listingId, 'secondChance'); break;
        case 'confirm-availability': auctionManagementUI.open(listingId, 'confirmAvailability'); break;
        case 'correct-listing': auctionManagementUI.open(listingId, 'correctListing'); break;
        case 'accept-offer': listingDialogUI.showProductDetails(listingId); break;
        case 'rate-seller':
        case 'rate-buyer': profileUI.openRatingDialog(listingId); break;
        case 'view-relist': listingDialogUI.showProductDetails(current.targetListingId); break;
        default: listingDialogUI.showProductDetails(listingId);
    }
}
listingDialogUI.setPrimaryActionHandler(performPrimaryAction);

listingDialogUI.setBuyNowHandler(transactionUI.openBuyNow);
marketplaceUI.setActionHandlers({
    openDetails: listingDialogUI.showProductDetails,
    openBid: listingDialogUI.openBidDialog,
    openBuyNow: transactionUI.openBuyNow,
    resumeTransaction: transactionUI.resumeTransaction,
    primary: performPrimaryAction
});

sellerUI = createSellerUI({
    documentRef,
    dialogController,
    photoManager: sellerPhotoManager,
    userService,
    recordEvent
});

profileUI = createProfileUI({
    documentRef,
    userService,
    ratingService,
    state,
    dialogController,
    onUserChanged: () => {
        transactionStore.expireWinnerConfirmations();
        marketplaceUI.renderListings();
        documentRef.addEventListener('visibilitychange', () => {
            if (documentRef.visibilityState === 'visible') refreshMarketplace();
        });
        documentRef.defaultView.addEventListener('focus', refreshMarketplace);
        sellerUI.renderSubmissions();
        accountUI.render();
        notificationUI.render();
    },
    onOpenAccount: (section, trigger) => accountUI.openAccount(section, trigger),
    onShareFeedback: () => feedbackUI.openFeedback()
});

accountUI = createAccountUI({
    documentRef,
    state,
    activityService,
    profileService,
    onAction: (listingId, row) => performPrimaryAction(listingId, { action: row.action }),
    onOpenListing: listingDialogUI.showProductDetails,
    onResumeBuyer: transactionUI.resumeTransaction,
    onRecordMeetupAttendance: transactionUI.recordMeetupAttendance,
    onReportMeetupNoShow: meetupId => {
        return transactionUI.reportMeetupNoShow(meetupId);
    },
    onProfileChanged: () => {
        profileUI.updateHeader();
        marketplaceUI.renderListings();
        notificationUI.render();
    }
});
listingDialogUI.setSellerProfileHandler((userId, listingId) => {
    dialogController.close(documentRef.getElementById('product-details-dialog'), { restoreFocus: false });
    accountUI.openPublicProfile(userId, { listingId });
});

disputeUI = createDisputeUI({
    documentRef,
    disputeService,
    state,
    dialogController,
    recordEvent,
    onChanged: () => {
        marketplaceUI.renderListings();
        accountUI.render();
    }
});
listingDialogUI.setReportIssueHandler(disputeUI.openReport);
transactionUI.setReportIssueHandler(disputeUI.openReport);

const feedbackUI = createPublicFeedbackUI({ documentRef, dialogController });
createPublicInfoUI({ documentRef, dialogController, openFeedback: feedbackUI.openFeedback });

marketplaceUI.renderListings();
sellerUI.renderSubmissions();
accountUI.openFromLocation();