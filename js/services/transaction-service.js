import { readArray, readRecord, removeStoredValue, writeJSON } from '../core/storage.js';
import { AUCTION_RESERVE_OUTCOME, AUCTION_STATUS, CATEGORY, DEFAULT_DEMO_USER_ID, DEPOSIT_OUTCOME, DISPUTE_RESOLUTION, FAILURE_OUTCOME, FULFILMENT_METHOD, INSPECTION_REJECTION_REASON, LEGACY_STATUS, MEETUP_ATTENDANCE_STATUS, MEETUP_NO_SHOW_OUTCOME, PURCHASE_SOURCE, RESERVATION_DEPOSIT, RESERVE_PRICE_MODE, SECOND_CHANCE_OFFER_STATUS, SELLER_CANCELLATION_STAGE, SERVICE_ERROR_CODE, SHIPPING_INSPECTION_WINDOW_MS, SHIPPING_STATUS, SPECIFICATION_FIELDS_BY_SUBCATEGORY, SPECIFICATION_FIELD_LABELS, STORAGE_KEYS, SUBCATEGORY, TRANSACTION_EVENT, TRANSACTION_OUTCOME, TRANSACTION_STATUS as transactionStatus, WINNER_CONFIRMATION_WINDOW_MS } from '../core/constants.js';
import { isValidPurchaseSource, validateInspection, validateMeetup } from '../core/validation.js';
import { demoUsers, getDemoUser, isDemoUserId } from '../data/demo-users.js';
import { isRecord, isStableId, normalizeSpecifications, normalizeTimestamp, uniqueRecords } from '../core/normalization.js';

const validStatuses = new Set(Object.values(transactionStatus));
const transitionRules = new Map([
    [TRANSACTION_EVENT.placeBid, { from: [transactionStatus.auctionActive], to: transactionStatus.auctionActive }],
    [TRANSACTION_EVENT.auctionEnd, { from: [transactionStatus.auctionActive], to: transactionStatus.auctionWon }],
    [TRANSACTION_EVENT.startToken, { from: [transactionStatus.auctionWon], to: transactionStatus.tokenPending }],
    [TRANSACTION_EVENT.simulateToken, { from: [transactionStatus.tokenPending], to: transactionStatus.tokenCompleted }],
    [TRANSACTION_EVENT.simpleCollection, { from: [transactionStatus.tokenCompleted], to: transactionStatus.simpleCollectionRequested }],
    [TRANSACTION_EVENT.acceptSecondChance, { from: [transactionStatus.auctionActive], to: transactionStatus.auctionWon }],
    [TRANSACTION_EVENT.cancelUnstartedPurchase, {
        from: [transactionStatus.auctionWon, transactionStatus.tokenPending, transactionStatus.tokenCompleted],
        to: transactionStatus.cancelled
    }],
    [TRANSACTION_EVENT.sellerWithdrawBeforeBids, { from: [transactionStatus.auctionActive], to: transactionStatus.cancelled }],
    [TRANSACTION_EVENT.sellerCancelAuction, { from: [transactionStatus.auctionActive], to: transactionStatus.cancelled }],
    [TRANSACTION_EVENT.winnerDeclined, { from: [transactionStatus.auctionWon], to: transactionStatus.cancelled }],
    [TRANSACTION_EVENT.buyNow, { from: [transactionStatus.auctionActive], to: transactionStatus.tokenPending }],
    [TRANSACTION_EVENT.meetupRequested, { from: [transactionStatus.tokenCompleted], to: transactionStatus.meetupRequested }],
    [TRANSACTION_EVENT.requestShipping, { from: [transactionStatus.tokenCompleted], to: transactionStatus.shippingRequested }],
    [TRANSACTION_EVENT.shippingDispatched, { from: [transactionStatus.shippingRequested], to: transactionStatus.shippingInTransit }],
    [TRANSACTION_EVENT.shippingDelivered, { from: [transactionStatus.shippingInTransit], to: transactionStatus.shippingDelivered }],
    [TRANSACTION_EVENT.shippingAccept, { from: [transactionStatus.shippingDelivered], to: transactionStatus.completed }],
    [TRANSACTION_EVENT.inspectionStarted, { from: [transactionStatus.meetupRequested], to: transactionStatus.inspectionPending }],
    [TRANSACTION_EVENT.inspectionApproved, { from: [transactionStatus.inspectionPending], to: transactionStatus.itemApproved }],
    [TRANSACTION_EVENT.inspectionRejected, { from: [transactionStatus.inspectionPending], to: transactionStatus.itemRejected }],
    [TRANSACTION_EVENT.paymentPreviewed, { from: [transactionStatus.itemApproved], to: transactionStatus.paymentPreviewed }],
    [TRANSACTION_EVENT.sellerHandover, { from: [transactionStatus.paymentPreviewed, transactionStatus.simpleCollectionRequested], to: transactionStatus.sellerHandoverConfirmed }],
    [TRANSACTION_EVENT.buyerReceipt, { from: [transactionStatus.sellerHandoverConfirmed], to: transactionStatus.buyerReceiptConfirmed }],
    [TRANSACTION_EVENT.completeTransaction, { from: [transactionStatus.buyerReceiptConfirmed], to: transactionStatus.completed }],
    [TRANSACTION_EVENT.disputeCancel, {
        from: [
            transactionStatus.auctionWon,
            transactionStatus.tokenPending,
            transactionStatus.tokenCompleted,
            transactionStatus.simpleCollectionRequested,
            transactionStatus.meetupRequested,
            transactionStatus.inspectionPending,
            transactionStatus.itemApproved,
            transactionStatus.itemRejected,
            transactionStatus.paymentPreviewed,
            transactionStatus.sellerHandoverConfirmed,
            transactionStatus.buyerReceiptConfirmed
        ],
        to: transactionStatus.cancelled
    }],
    [TRANSACTION_EVENT.disputeSellerPayout, {
        from: [
            transactionStatus.auctionWon,
            transactionStatus.tokenPending,
            transactionStatus.tokenCompleted,
            transactionStatus.simpleCollectionRequested,
            transactionStatus.meetupRequested,
            transactionStatus.inspectionPending,
            transactionStatus.itemApproved,
            transactionStatus.itemRejected,
            transactionStatus.paymentPreviewed,
            transactionStatus.sellerHandoverConfirmed,
            transactionStatus.buyerReceiptConfirmed
        ],
        to: transactionStatus.completed
    }],
    [TRANSACTION_EVENT.meetupNoShow, {
        from: [transactionStatus.meetupRequested],
        to: transactionStatus.cancelled
    }]
]);

function nextTransactionStatus(currentStatus, event) {
    const rule = transitionRules.get(event);
    return rule?.from.includes(currentStatus) ? rule.to : null;
}
const buyerEvents = new Set([
    TRANSACTION_EVENT.startToken,
    TRANSACTION_EVENT.simulateToken,
    TRANSACTION_EVENT.simpleCollection,
    TRANSACTION_EVENT.meetupRequested,
    TRANSACTION_EVENT.inspectionStarted,
    TRANSACTION_EVENT.inspectionApproved,
    TRANSACTION_EVENT.inspectionRejected,
    TRANSACTION_EVENT.paymentPreviewed,
    TRANSACTION_EVENT.requestShipping,
    TRANSACTION_EVENT.shippingDelivered,
    TRANSACTION_EVENT.shippingAccept,
    TRANSACTION_EVENT.buyerReceipt,
    TRANSACTION_EVENT.completeTransaction
]);
const sellerEvents = new Set([TRANSACTION_EVENT.sellerHandover, TRANSACTION_EVENT.shippingDispatched]);
const disputePausedEvents = new Set([
    ...buyerEvents,
    TRANSACTION_EVENT.buyNow,
    ...sellerEvents,
    TRANSACTION_EVENT.meetupNoShow,
    TRANSACTION_EVENT.cancelUnstartedPurchase,
    TRANSACTION_EVENT.acceptSecondChance
]);
const resumableBuyerStatuses = new Set([
    transactionStatus.auctionWon,
    transactionStatus.tokenPending,
    transactionStatus.tokenCompleted,
    transactionStatus.simpleCollectionRequested,
    transactionStatus.meetupRequested,
    transactionStatus.shippingRequested,
    transactionStatus.shippingInTransit,
    transactionStatus.shippingDelivered,
    transactionStatus.inspectionPending,
    transactionStatus.itemApproved,
    transactionStatus.paymentPreviewed,
    transactionStatus.sellerHandoverConfirmed,
    transactionStatus.buyerReceiptConfirmed
]);
const statusProgress = new Map([
    [transactionStatus.auctionActive, 0],
    [transactionStatus.auctionWon, 1],
    [transactionStatus.tokenPending, 2],
    [transactionStatus.tokenCompleted, 3],
    [transactionStatus.simpleCollectionRequested, 4],
    [transactionStatus.meetupRequested, 4],
    [SHIPPING_STATUS.requested, 4],
    [SHIPPING_STATUS.inTransit, 5],
    [SHIPPING_STATUS.delivered, 6],
    [transactionStatus.inspectionPending, 5],
    [transactionStatus.itemApproved, 6],
    [transactionStatus.itemRejected, 6],
    [transactionStatus.paymentPreviewed, 7],
    [transactionStatus.sellerHandoverConfirmed, 8],
    [transactionStatus.buyerReceiptConfirmed, 9],
    [transactionStatus.completed, 10],
    [transactionStatus.cancelled, 11]
]);
const legacyMeetupStateKeys = ['status', 'bookingTokenStatus', 'paymentStatus', 'sellerHandoverConfirmed', 'buyerReceiptConfirmed'];
const transactionRecordFields = [
    'status', 'purchaseSource', 'bidHistory', 'buyerUserId', 'sellerUserId', 'winner', 'winningBid', 'reserveOutcome',
    'transactionPrice', 'noShowOutcome', 'noShowUserId', 'tokenOutcome', 'inspectionDeclined', 'relistEligible', 'completedAt',
    'winnerResponseDeadline', 'outcome', 'depositAmount', 'depositOutcome', 'listingSnapshot', 'fulfilmentPath',
    'failedBuyerUserId', 'failureOutcome', 'failureReason', 'mismatchReason', 'sellerCancellationStage',
    'cancelledAt', 'shippingReference', 'shippingRequestedAt', 'shippingDispatchedAt',
    'shippingDeliveredAt', 'shippingInspectionEndsAt'
];

function readMeetups() {
    return uniqueRecords(readArray(STORAGE_KEYS.meetups)).filter(meetup => isStableId(meetup.listingId)).map(meetup => ({
        ...meetup,
        itemTitle: typeof meetup.itemTitle === 'string' ? meetup.itemTitle : 'Item',
        date: typeof meetup.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(meetup.date) ? meetup.date : '',
        time: typeof meetup.time === 'string' && /^\d{2}:\d{2}$/.test(meetup.time) ? meetup.time : '',
        location: typeof meetup.location === 'string' ? meetup.location : '',
        createdAt: normalizeTimestamp(meetup.createdAt),
        inspectedAt: normalizeTimestamp(meetup.inspectedAt),
        inspectionChecks: Array.isArray(meetup.inspectionChecks)
            ? meetup.inspectionChecks.filter(check => typeof check === 'string') : [],
        attendance: Object.fromEntries(Object.entries(isRecord(meetup.attendance) ? meetup.attendance : {})
            .filter(([userId]) => isDemoUserId(userId))
            .map(([userId, attendance]) => [userId, {
                status: Object.values(MEETUP_ATTENDANCE_STATUS).includes(attendance?.status)
                    ? attendance.status : MEETUP_ATTENDANCE_STATUS.pending,
                recordedAt: normalizeTimestamp(attendance?.recordedAt)
            }])),
        noShowReport: isRecord(meetup.noShowReport)
            && isDemoUserId(meetup.noShowReport.missedUserId)
            && isDemoUserId(meetup.noShowReport.reporterUserId)
            ? { ...meetup.noShowReport, reportedAt: normalizeTimestamp(meetup.noShowReport.reportedAt) } : null
    }));
}

function canPerformTransaction({ transaction, listing, event, details, userId, isPaused, getHighestValidBid, now = () => Date.now() }) {
    if (!transaction || !listing || !nextTransactionStatus(transaction.status, event)) return false;
    if (listing.secondChanceOffer && [TRANSACTION_EVENT.placeBid, TRANSACTION_EVENT.buyNow, TRANSACTION_EVENT.auctionEnd].includes(event)) return false;
    if (isPaused && disputePausedEvents.has(event)) return false;
    if (event === TRANSACTION_EVENT.placeBid) {
        return (details.bidderUserId === userId || details.automatic === true) && listing?.sellerUserId !== details.bidderUserId;
    }
    if (buyerEvents.has(event) && transaction.buyerUserId !== userId) return false;
    if (sellerEvents.has(event) && transaction.sellerUserId !== userId) return false;
    if (event === TRANSACTION_EVENT.buyNow
        && (details.buyerUserId !== userId
            || listing.sellerUserId === userId
            || (details.sellerUserId && details.sellerUserId !== listing.sellerUserId))) return false;
    if (event === TRANSACTION_EVENT.acceptSecondChance
        && (details.buyerUserId !== userId
            || listing.secondChanceOffer?.buyerUserId !== userId
            || details.transactionPrice !== listing.secondChanceOffer.price)) return false;
    if (event === TRANSACTION_EVENT.cancelUnstartedPurchase
        && (!transaction.buyerUserId
            || ![transaction.buyerUserId, transaction.sellerUserId].includes(userId))) return false;
    if (event === TRANSACTION_EVENT.sellerCancelAuction
        && (transaction.sellerUserId !== userId
            || !transaction.bidHistory.length
            || typeof details.reason !== 'string'
            || details.reason.trim().length > 200)) return false;
    if (event === TRANSACTION_EVENT.sellerWithdrawBeforeBids
        && ((transaction.sellerUserId !== userId && details.admin !== true) || transaction.bidHistory.length)) return false;
    if (event === TRANSACTION_EVENT.cancelUnstartedPurchase
        && details.reason !== undefined
        && (typeof details.reason !== 'string' || details.reason.trim().length > 200)) return false;
    if (event === TRANSACTION_EVENT.startToken
        && transaction.winnerResponseDeadline
        && Date.parse(transaction.winnerResponseDeadline) <= now()) return false;
    if (event === TRANSACTION_EVENT.winnerDeclined
        && (details.deadlineExpired
            ? !transaction.winnerResponseDeadline || Date.parse(transaction.winnerResponseDeadline) > now()
            : transaction.buyerUserId !== userId)) return false;
    if (event === TRANSACTION_EVENT.auctionEnd) {
        const highestBid = getHighestValidBid(transaction.bidHistory);
        if (details.sellerUserId !== listing.sellerUserId) return false;
        const buyNowReached = details.buyNowReached === true
            && Number.isSafeInteger(listing.buyNowPrice)
            && highestBid?.amount === listing.buyNowPrice;
        if (details.buyNowReached === true && !buyNowReached) return false;
        const hasReserve = listing.reservePriceMode === RESERVE_PRICE_MODE.set
            && Number.isSafeInteger(listing.reservePrice)
            && listing.reservePrice > 0;
        const reserveMet = buyNowReached || highestBid && (!hasReserve || highestBid.amount >= listing.reservePrice);
        const expectedOutcome = !buyNowReached && hasReserve && highestBid
            ? reserveMet ? AUCTION_RESERVE_OUTCOME.met : AUCTION_RESERVE_OUTCOME.notMet
            : null;
        if (details.reserveOutcome !== expectedOutcome
            || (reserveMet
                ? details.buyerUserId !== highestBid.bidderUserId || details.winningBid !== highestBid.amount
                : details.buyerUserId != null || details.winner != null || details.winningBid != null)) return false;
    }
    if (event === TRANSACTION_EVENT.meetupNoShow
        && (details.reporterUserId !== userId
            || ![transaction.buyerUserId, transaction.sellerUserId].includes(userId)
            || ![transaction.buyerUserId, transaction.sellerUserId].includes(details.missedUserId)
            || details.missedUserId === userId
            || !Object.values(MEETUP_NO_SHOW_OUTCOME).includes(details.noShowOutcome)
            || ![MEETUP_NO_SHOW_OUTCOME.tokenRefundable, MEETUP_NO_SHOW_OUTCOME.tokenForfeited].includes(details.tokenOutcome))) return false;
    if (event === TRANSACTION_EVENT.meetupRequested
        && ![FULFILMENT_METHOD.inPerson, FULFILMENT_METHOD.both].includes(listing.fulfilmentMethod)) return false;
    if (event === TRANSACTION_EVENT.simpleCollection) {
        const inspection = getInspectionReview({
            ...listing,
            transactionPrice: transaction.transactionPrice,
            listingSnapshot: transaction.listingSnapshot
        });
        return canSelectSimpleCollection(listing, transaction)
            && (inspection.level !== 'Technical' || details.declinedInspection === true);
    }
    if (event === TRANSACTION_EVENT.requestShipping
        && ![FULFILMENT_METHOD.shipping, FULFILMENT_METHOD.both].includes(listing?.fulfilmentMethod)) return false;
    return true;
}

function createDefaultTransaction() {
    return {
        status: transactionStatus.auctionActive,
        purchaseSource: null,
        reserveOutcome: null,
        bidHistory: [],
        buyerUserId: null,
        sellerUserId: null,
        winner: null,
        winningBid: null,
        transactionPrice: null,
        noShowOutcome: null,
        noShowUserId: null,
        tokenOutcome: null,
        inspectionDeclined: false,
        relistEligible: false,
        failureOutcome: null,
        failureReason: '',
        mismatchReason: null,
        sellerCancellationStage: null,
        completedAt: null,
        cancelledAt: null,
        shippingReference: null,
        shippingRequestedAt: null,
        shippingDispatchedAt: null,
        shippingDeliveredAt: null,
        shippingInspectionEndsAt: null,
        winnerResponseDeadline: null,
        outcome: null,
        depositAmount: 0,
        depositOutcome: null,
        listingSnapshot: null,
        fulfilmentPath: null,
        failedBuyerUserId: null
    };
}

function createListingSnapshot(listing) {
    if (!listing) return null;
    return {
        title: listing.title,
        category: listing.category,
        subcategory: listing.subcategory,
        brandModel: listing.brandModel,
        condition: listing.conditionGrade || listing.condition,
        description: listing.description,
        specifications: normalizeSpecifications(listing.specifications),
        estimatedValue: listing.estimatedValue,
        startingBid: listing.startingBid,
        bidIncrement: listing.bidIncrement,
        buyNowPrice: listing.buyNowPrice,
        listingFormat: listing.listingFormat,
        fulfilmentMethod: listing.fulfilmentMethod,
        accessories: Array.isArray(listing.accessories) ? [...listing.accessories] : [],
        imageCount: Array.isArray(listing.images) ? listing.images.length : listing.image ? 1 : 0,
        sellerUserId: listing.sellerUserId
    };
}

export function getInspectionReview(listing) {
    if (!listing) return null;
    const reviewedListing = listing.listingSnapshot || listing;
    const value = Number.isSafeInteger(listing.transactionPrice) ? listing.transactionPrice
        : Number.isSafeInteger(reviewedListing.estimatedValue) ? reviewedListing.estimatedValue
            : reviewedListing.startingBid;
    const specs = normalizeSpecifications(reviewedListing.specifications);
    const isElectronics = reviewedListing.category === CATEGORY.electronics;
    const technicalRisk = isElectronics && ([SUBCATEGORY.smartphones, SUBCATEGORY.laptops].includes(reviewedListing.subcategory)
        || (reviewedListing.subcategory === SUBCATEGORY.wearables && value >= 15000)
        || (reviewedListing.subcategory === SUBCATEGORY.audio && value >= 20000)
        || Boolean(specs.functionalStatus && !/fully functional|working|no defects/i.test(specs.functionalStatus))
        || !specs.proofOfPurchase || specs.proofOfPurchase === 'No'
        || !specs.serialModelInfo || /unclear|unknown|ambiguous|no/i.test(specs.serialModelInfo)
        || specs.activationLock === 'No'
        || ['ownershipConcern', 'counterfeitConcern'].some(key => specs[key] && specs[key] !== 'No'));
    const category = reviewedListing.category;
    const level = isElectronics
        ? (technicalRisk ? 'Technical'
            : [SUBCATEGORY.wearables, SUBCATEGORY.audio].includes(reviewedListing.subcategory) || value >= 5000 ? 'Basic' : 'None')
        : category === CATEGORY.furniture ? 'Basic'
            : category === CATEGORY.homeAppliances ? (value >= 20000 ? 'Technical' : 'Basic')
                : 'None';
    const checksBySubcategory = {
        [SUBCATEGORY.sofas]: ['Dimensions, upholstery and frame match the listing', 'Seat firmness, stains, tears and odours are checked visually', 'Confirm the lift, stairs and doorway access for collection'],
        [SUBCATEGORY.chairs]: ['Dimensions and materials match the listing', 'Frame, joints and upholstery are checked visually', 'Visible wear matches the description'],
        [SUBCATEGORY.tables]: ['Dimensions and materials match the listing', 'Surface marks, legs and joints are checked visually', 'Confirm disassembly and access for collection'],
        [SUBCATEGORY.storage]: ['Dimensions and materials match the listing', 'Shelves, doors and joints are checked visually', 'Confirm disassembly and access for collection'],
        [SUBCATEGORY.officeFurniture]: ['Dimensions and materials match the listing', 'Moving parts and adjustments work', 'Visible wear matches the description'],
        [SUBCATEGORY.kitchenAppliances]: ['Model and listed accessories match the listing', 'Seller demonstrates the appliance powering on and operating', 'Visible wear and listed defects match the description'],
        [SUBCATEGORY.cleaningAppliances]: ['Model and listed accessories match the listing', 'Seller demonstrates suction or operation', 'Visible wear and listed defects match the description'],
        [SUBCATEGORY.airTreatment]: ['Model, filter and accessories match the listing', 'Seller demonstrates fan and controls', 'Visible wear and listed defects match the description'],
        [SUBCATEGORY.coffeeMachines]: ['Model and listed accessories match the listing', 'Seller demonstrates heating, pump and brewing', 'Visible wear, leaks and listed defects match the description'],
        [SUBCATEGORY.smallAppliances]: ['Model and listed accessories match the listing', 'Seller demonstrates the appliance powering on and operating', 'Visible wear and listed defects match the description'],
        [SUBCATEGORY.books]: ['Title, edition and format match the listing', 'Covers and pages match the stated condition'],
        [SUBCATEGORY.boxSets]: ['All volumes in the set are present', 'Slipcase, covers and pages match the stated condition'],
        [SUBCATEGORY.collectibles]: ['Item and edition match the listing', 'Condition and any missing parts match the description'],
        [SUBCATEGORY.smartphones]: ['Model and visible device details match the listing', 'Screen, buttons, cameras and speakers work', 'Charging and battery behavior match the description', 'Physical condition and included accessories match the listing'],
        [SUBCATEGORY.laptops]: ['Model, processor and memory match the listing', 'Display, keyboard, trackpad and ports work', 'Charging and battery behavior match the description', 'Physical condition and included accessories match the listing'],
        [SUBCATEGORY.audio]: ['Model and connectivity match the listing', 'Playback, controls and microphone work where applicable', 'Charging and included accessories match the listing', 'Physical condition matches the listing'],
        [SUBCATEGORY.wearables]: ['Model and visible device details match the listing', 'Display, controls and listed features work', 'Charging and battery behavior match the description', 'Physical condition and included accessories match the listing'],
        [SUBCATEGORY.sneakers]: ['Size and fit match the listing', 'Sole, stitching and materials match the description', 'Visible wear and included accessories match the listing'],
        [SUBCATEGORY.bags]: ['Size, material and hardware match the listing', 'Seams, closures and straps are checked', 'Visible wear and included accessories match the listing'],
        [SUBCATEGORY.clothing]: ['Size, material and fit match the listing', 'Seams, closures and fabric are checked', 'Visible wear and included accessories match the listing'],
        [SUBCATEGORY.accessories]: ['Materials and dimensions match the listing', 'Fastenings and moving parts are checked', 'Visible wear and included accessories match the listing'],
        [SUBCATEGORY.otherFashion]: ['Materials and visible details match the listing', 'Construction and condition are checked', 'Included accessories match the listing'],
        [SUBCATEGORY.fashion]: ['Materials and visible details match the listing', 'Construction and condition are checked', 'Included accessories match the listing']
    };
    const declaredChecks = (SPECIFICATION_FIELDS_BY_SUBCATEGORY[reviewedListing.subcategory] || [])
        .filter(key => key !== 'knownDefects' && specs[key] !== undefined && specs[key] !== null && specs[key] !== '')
        .map(key => {
            if (key === 'serialModelInfo') {
                return 'Confirm the model/variant; check any full identifier privately in person';
            }
            const value = Array.isArray(specs[key]) ? specs[key].join(', ') : String(specs[key]);
            return `Confirm listed ${SPECIFICATION_FIELD_LABELS[key]?.toLowerCase() || key} (${value}) matches the item`;
        });
    return {
        level,
        transferBlocked: ['ownershipConcern', 'counterfeitConcern'].some(key => specs[key] && specs[key] !== 'No')
            || specs.activationLock === 'No',
        snapshotTitle: reviewedListing.title || 'Item',
        guidance: isElectronics
            ? `${level} inspection. Compare the item with the saved listing details. Do not share full IMEI or serial numbers in this demo.`
            : category === CATEGORY.furniture ? 'Basic visual inspection. Check dimensions, wear and collection access against the listing.'
                : category === CATEGORY.homeAppliances ? `${level} inspection. Ask the seller to demonstrate the appliance operating before accepting it.`
                    : category === CATEGORY.books ? 'No formal inspection. Confirm the stated condition when collecting.'
                        : 'Check the fashion item against its listing and condition grade.',
        declaredDetails: specs.knownDefects
            ? `Seller-declared defects: ${specs.knownDefects}. Review these explicitly. Seller-provided details are not independently verified.`
            : 'Compare the item with seller-provided details. These statements are not independently verified.',
        checks: [...(checksBySubcategory[reviewedListing.subcategory] || ['Visible details, condition and included accessories match the listing']), ...declaredChecks]
    };
}

function canSelectSimpleCollection(listing, transaction) {
    if (!listing || !transaction
        || ![FULFILMENT_METHOD.inPerson, FULFILMENT_METHOD.both].includes(listing.fulfilmentMethod)) return false;
    const specifications = normalizeSpecifications(transaction.listingSnapshot?.specifications || listing.specifications);
    const isElectronics = (transaction.listingSnapshot?.category || listing.category) === CATEGORY.electronics;
    const disclosuresComplete = Boolean(
        (transaction.listingSnapshot?.brandModel || listing.brandModel)
        && (transaction.listingSnapshot?.condition || listing.conditionGrade)
        && (isElectronics
            ? specifications.functionalStatus && specifications.knownDefects && specifications.serialModelInfo
            : true)
    );
    const inspection = getInspectionReview({
        ...listing,
        transactionPrice: transaction.transactionPrice,
        listingSnapshot: transaction.listingSnapshot
    });
    const value = Number.isSafeInteger(transaction.transactionPrice)
        ? transaction.transactionPrice
        : Number.isSafeInteger(listing.estimatedValue) ? listing.estimatedValue : null;
    return disclosuresComplete && !inspection.transferBlocked
        && (inspection.level === 'Technical'
            || (Number.isSafeInteger(value) && value < 10000
                && ![SUBCATEGORY.smartphones, SUBCATEGORY.laptops].includes(listing.subcategory)));
}

function statusFromLegacyMeetup(meetup) {
    if (!meetup) return null;
    if (meetup.buyerReceiptConfirmed || meetup.status === LEGACY_STATUS.demoComplete) return transactionStatus.completed;
    if (meetup.sellerHandoverConfirmed) return transactionStatus.sellerHandoverConfirmed;
    if (meetup.status === LEGACY_STATUS.inspectionRejected) return transactionStatus.itemRejected;
    if (meetup.status === LEGACY_STATUS.inspectionApproved) {
        return meetup.paymentStatus === LEGACY_STATUS.paymentNotProcessed
            ? transactionStatus.paymentPreviewed
            : transactionStatus.itemApproved;
    }
    if (meetup.status === LEGACY_STATUS.demoRequest) {
        return meetup.bookingTokenStatus === LEGACY_STATUS.tokenSimulated
            ? transactionStatus.meetupRequested
            : transactionStatus.tokenCompleted;
    }
    return null;
}

function normalizeTransaction(saved, meetup, listingId, listing, getHighestValidBid, now = () => Date.now()) {
    const legacyStatus = saved?.transactionStatus;
    const hasKnownLegacyAuctionStatus = saved?.auctionStatus === AUCTION_STATUS.active || saved?.auctionStatus === AUCTION_STATUS.ended;
    const savedStatus = validStatuses.has(saved?.status)
        ? saved.status
        : validStatuses.has(legacyStatus)
            ? legacyStatus
            : saved?.auctionStatus === AUCTION_STATUS.ended
                ? transactionStatus.auctionWon
                : saved && !hasKnownLegacyAuctionStatus
                    ? transactionStatus.unavailable
                    : transactionStatus.auctionActive;
    const meetupStatus = statusFromLegacyMeetup(meetup);
    const meetupIsAhead = meetupStatus
        && savedStatus !== transactionStatus.itemRejected
        && (statusProgress.get(meetupStatus) > statusProgress.get(savedStatus)
            || meetupStatus === transactionStatus.itemRejected);
    const status = meetupIsAhead ? meetupStatus : savedStatus;
    const bidHistory = Array.isArray(saved?.bidHistory)
        ? saved.bidHistory.filter(bid => isRecord(bid) && Number.isSafeInteger(bid.amount) && bid.amount > 0
            && (isDemoUserId(bid.bidderUserId) || bid.bidderUserId == null)).map(bid => {
            const bidderUserId = isDemoUserId(bid.bidderUserId) ? bid.bidderUserId : DEFAULT_DEMO_USER_ID;
            const bidder = getDemoUser(bidderUserId);
            const savedName = bid.bidderDisplayName || bid.bidder;
            const bidderDisplayName = typeof savedName === 'string' && savedName !== 'You (demo)'
                ? savedName
                : bidder.firstName;
            return {
                ...bid,
                listingId,
                bidderUserId,
                bidderDisplayName,
                bidder: bidderDisplayName,
                placedAt: normalizeTimestamp(bid.placedAt)
            };
        })
        : [];
    const highestBid = getHighestValidBid(bidHistory);
    const noWinner = status === transactionStatus.auctionWon
        && (saved?.reserveOutcome === AUCTION_RESERVE_OUTCOME.notMet
            || (!highestBid && !meetup && saved?.winningBid == null
                && saved?.highestBid == null && saved?.transactionPrice == null
                && (saved?.status === transactionStatus.auctionWon || !saved?.winner)));
    const purchaseSource = noWinner ? null : isValidPurchaseSource(saved?.purchaseSource)
        ? saved.purchaseSource
        : isValidPurchaseSource(meetup?.purchaseSource)
            ? meetup.purchaseSource
            : status === transactionStatus.auctionWon
                ? PURCHASE_SOURCE.auctionWinner
                : null;
    const savedWinner = typeof saved?.winner === 'string' ? saved.winner : saved?.highestBidder;
    const matchingUser = demoUsers.find(user => user.firstName === savedWinner);
    const buyerUserId = noWinner ? null : isDemoUserId(saved?.buyerUserId)
        ? saved.buyerUserId
        : status === transactionStatus.auctionActive
            ? null
            : highestBid?.bidderUserId
                || (matchingUser && savedWinner !== 'You (demo)' ? matchingUser.id : null)
                || (purchaseSource || savedWinner ? DEFAULT_DEMO_USER_ID : null);
    const winner = noWinner ? null : buyerUserId
        ? getDemoUser(buyerUserId).firstName
        : typeof savedWinner === 'string' && savedWinner !== 'You (demo)' ? savedWinner : null;
    const sellerUserId = isDemoUserId(saved?.sellerUserId)
        ? saved.sellerUserId
        : listing?.sellerUserId || null;

    return {
        status,
        purchaseSource,
        reserveOutcome: Object.values(AUCTION_RESERVE_OUTCOME).includes(saved?.reserveOutcome) ? saved.reserveOutcome : null,
        bidHistory,
        buyerUserId,
        sellerUserId,
        winner,
        winningBid: noWinner ? null : Number.isSafeInteger(saved?.winningBid) && saved.winningBid > 0
            ? saved.winningBid
            : Number.isSafeInteger(saved?.highestBid) && saved.highestBid > 0
                ? saved.highestBid
                : null,
        transactionPrice: noWinner ? null : Number.isSafeInteger(saved?.transactionPrice) && saved.transactionPrice > 0
            ? saved.transactionPrice
            : Number.isSafeInteger(meetup?.transactionPrice) && meetup.transactionPrice > 0
                ? meetup.transactionPrice
                : Number.isSafeInteger(meetup?.buyNowPrice) && meetup.buyNowPrice > 0
                    ? meetup.buyNowPrice
                    : null,
        noShowOutcome: Object.values(MEETUP_NO_SHOW_OUTCOME).includes(saved?.noShowOutcome) ? saved.noShowOutcome : null,
        noShowUserId: isDemoUserId(saved?.noShowUserId) ? saved.noShowUserId : null,
        tokenOutcome: Object.values(MEETUP_NO_SHOW_OUTCOME).includes(saved?.tokenOutcome) ? saved.tokenOutcome : null,
        relistEligible: saved?.relistEligible === true,
        completedAt: normalizeTimestamp(saved?.completedAt),
        cancelledAt: normalizeTimestamp(saved?.cancelledAt),
        shippingReference: typeof saved?.shippingReference === 'string' ? saved.shippingReference : null,
        shippingRequestedAt: normalizeTimestamp(saved?.shippingRequestedAt),
        shippingDispatchedAt: normalizeTimestamp(saved?.shippingDispatchedAt),
        shippingDeliveredAt: normalizeTimestamp(saved?.shippingDeliveredAt),
        shippingInspectionEndsAt: normalizeTimestamp(saved?.shippingInspectionEndsAt),
        winnerResponseDeadline: normalizeTimestamp(saved?.winnerResponseDeadline)
            || (status === transactionStatus.auctionWon && buyerUserId
                ? new Date(now() + WINNER_CONFIRMATION_WINDOW_MS).toISOString() : null),
        outcome: Object.values(TRANSACTION_OUTCOME).includes(saved?.outcome) ? saved.outcome : null,
        failureOutcome: Object.values(FAILURE_OUTCOME).includes(saved?.failureOutcome) ? saved.failureOutcome : null,
        failureReason: typeof saved?.failureReason === 'string' ? saved.failureReason.slice(0, 200) : '',
        mismatchReason: Object.values(INSPECTION_REJECTION_REASON).includes(saved?.mismatchReason)
            && saved.mismatchReason !== INSPECTION_REJECTION_REASON.changedMind ? saved.mismatchReason : null,
        sellerCancellationStage: Object.values(SELLER_CANCELLATION_STAGE).includes(saved?.sellerCancellationStage)
            ? saved.sellerCancellationStage : null,
        depositAmount: Number.isSafeInteger(saved?.depositAmount) && saved.depositAmount >= 0
            ? saved.depositAmount
            : [transactionStatus.tokenCompleted, transactionStatus.simpleCollectionRequested, transactionStatus.meetupRequested, transactionStatus.shippingRequested,
                transactionStatus.shippingInTransit, transactionStatus.shippingDelivered, transactionStatus.inspectionPending,
                transactionStatus.itemApproved, transactionStatus.itemRejected, transactionStatus.paymentPreviewed,
                transactionStatus.sellerHandoverConfirmed, transactionStatus.buyerReceiptConfirmed, transactionStatus.completed]
                .includes(status) ? RESERVATION_DEPOSIT.standard : 0,
        depositOutcome: Object.values(DEPOSIT_OUTCOME).includes(saved?.depositOutcome) ? saved.depositOutcome : null,
        inspectionDeclined: saved?.inspectionDeclined === true,
        listingSnapshot: isRecord(saved?.listingSnapshot) ? saved.listingSnapshot : null,
        fulfilmentPath: ['simple_collection', 'public_meetup', 'protected_shipping'].includes(saved?.fulfilmentPath)
            ? saved.fulfilmentPath
            : [transactionStatus.meetupRequested, transactionStatus.inspectionPending].includes(status) ? 'public_meetup'
                : [SHIPPING_STATUS.requested, SHIPPING_STATUS.inTransit, SHIPPING_STATUS.delivered].includes(status) ? 'protected_shipping' : null,
        failedBuyerUserId: isDemoUserId(saved?.failedBuyerUserId) ? saved.failedBuyerUserId : null
    };
}

function isCanonicalTransaction(saved, normalized) {
    return saved
        && transactionRecordFields.every(field => field === 'bidHistory'
            ? JSON.stringify(saved.bidHistory || []) === JSON.stringify(normalized.bidHistory)
            : field === 'listingSnapshot'
                ? JSON.stringify(saved.listingSnapshot || null) === JSON.stringify(normalized.listingSnapshot)
            : saved[field] === normalized[field])
        && Object.keys(saved).every(field => transactionRecordFields.includes(field));
}

function persistTransactions(transactions) {
    const records = Object.fromEntries(transactions);
    return Object.keys(records).length
        ? writeJSON(STORAGE_KEYS.auctionTransactions, records)
        : removeStoredValue(STORAGE_KEYS.auctionTransactions);
}

function migrateMeetupRecords(meetups, transactions) {
    let changed = false;
    meetups.forEach(meetup => {
        if (!meetup || typeof meetup !== 'object' || Array.isArray(meetup)) return;
        legacyMeetupStateKeys.forEach(key => {
            if (Object.hasOwn(meetup, key)) {
                delete meetup[key];
                changed = true;
            }
        });
        const transaction = transactions.get(meetup.listingId);
        const attendance = meetup.attendance && typeof meetup.attendance === 'object' && !Array.isArray(meetup.attendance)
            ? meetup.attendance
            : {};
        [transaction?.buyerUserId, transaction?.sellerUserId].filter(isDemoUserId).forEach(userId => {
            if (!attendance[userId] || !Object.values(MEETUP_ATTENDANCE_STATUS).includes(attendance[userId].status)) {
                attendance[userId] = { status: MEETUP_ATTENDANCE_STATUS.pending, recordedAt: null };
                changed = true;
            }
        });
        if (meetup.attendance !== attendance) {
            meetup.attendance = attendance;
            changed = true;
        }
        if (!Object.hasOwn(meetup, 'noShowReport')) {
            meetup.noShowReport = null;
            changed = true;
        }
    });
    if (changed) writeJSON(STORAGE_KEYS.meetups, meetups);
}

export function createTransactionStore({
    listingStates = new Map(),
    getCurrentUser = () => getDemoUser(DEFAULT_DEMO_USER_ID),
    isTransactionPaused = () => false,
    notificationService = null,
    getHighestValidBid,
    now = () => Date.now()
} = {}) {
    if (typeof getHighestValidBid !== 'function') {
        throw new TypeError('Transaction store requires the bidding service highest-bid resolver');
    }
    const savedTransactions = readRecord(STORAGE_KEYS.auctionTransactions);
    const meetups = readMeetups();
    const transactions = new Map();
    let needsMigration = false;

    const listingIds = new Set([
        ...Object.keys(savedTransactions).filter(isStableId),
        ...meetups.filter(meetup => meetup && typeof meetup.listingId === 'string').map(meetup => meetup.listingId)
    ]);

    listingIds.forEach(listingId => {
        const matchingMeetups = meetups.filter(meetup => meetup?.listingId === listingId);
        const meetup = matchingMeetups[matchingMeetups.length - 1] || null;
        const saved = savedTransactions[listingId];
        const normalized = normalizeTransaction(saved, meetup, listingId, listingStates.get(listingId), getHighestValidBid, now);
        if (saved || statusFromLegacyMeetup(meetup)) transactions.set(listingId, normalized);
        if (saved && !isCanonicalTransaction(saved, normalized)) needsMigration = true;
        if (!saved && statusFromLegacyMeetup(meetup)) needsMigration = true;
    });

    const migrationSaved = !needsMigration || persistTransactions(transactions);
    if (migrationSaved) migrateMeetupRecords(meetups, transactions);

    return {
        expireWinnerConfirmations() {
            const expired = [];
            transactions.forEach((transaction, listingId) => {
                if (transaction.status !== transactionStatus.auctionWon
                    || !transaction.buyerUserId
                    || !transaction.winnerResponseDeadline
                    || Date.parse(transaction.winnerResponseDeadline) > now()) return;
                const updated = this.transition(listingId, TRANSACTION_EVENT.winnerDeclined, { deadlineExpired: true });
                if (updated) expired.push(listingId);
            });
            return expired;
        },
        declineWinner(listingId) {
            return this.transition(listingId, TRANSACTION_EVENT.winnerDeclined);
        },
        canCancelUnstartedPurchase(listingId, userId = getCurrentUser()?.id) {
            const transaction = this.get(listingId);
            return Boolean(transaction.buyerUserId)
                && [transaction.buyerUserId, transaction.sellerUserId].includes(userId)
                && [transactionStatus.auctionWon, transactionStatus.tokenPending, transactionStatus.tokenCompleted].includes(transaction.status)
                && !this.isPaused(listingId);
        },
        cancelUnstartedPurchase(listingId, reason = '') {
            if (!this.canCancelUnstartedPurchase(listingId)) return null;
            return this.transition(listingId, TRANSACTION_EVENT.cancelUnstartedPurchase, { reason });
        },
        cancelSellerAuction(listingId, reason = '') {
            return this.transition(listingId, TRANSACTION_EVENT.sellerCancelAuction, { reason });
        },
        withdrawSellerListing(listingId, { admin = false } = {}) {
            return this.transition(listingId, TRANSACTION_EVENT.sellerWithdrawBeforeBids, { admin });
        },
        confirmSellerAvailability(listingId, isAvailable) {
            const current = this.get(listingId);
            if (current.sellerUserId !== getCurrentUser()?.id
                || ![transactionStatus.cancelled, transactionStatus.itemRejected].includes(current.status)
                || ![FAILURE_OUTCOME.sellerNoShow, FAILURE_OUTCOME.sellerCancelled,
                    FAILURE_OUTCOME.sellerAvailabilityRequired].includes(current.failureOutcome)
                || typeof isAvailable !== 'boolean') return null;
            return this.updateFailureOutcome(listingId, isAvailable
                ? FAILURE_OUTCOME.eligibleForSecondChance
                : FAILURE_OUTCOME.blockedPendingReview, { relistEligible: isAvailable });
        },
        updateFailureOutcome(listingId, failureOutcome, { relistEligible, failureReason = '', admin = false } = {}) {
            const current = this.get(listingId);
            if (!Object.values(FAILURE_OUTCOME).includes(failureOutcome)
                || ![transactionStatus.cancelled, transactionStatus.itemRejected].includes(current.status)
                || (!admin && current.sellerUserId !== getCurrentUser()?.id)
                || typeof failureReason !== 'string' || failureReason.length > 200) return null;
            const next = {
                ...current,
                failureOutcome,
                failureReason: failureReason.trim(),
                relistEligible: typeof relistEligible === 'boolean'
                    ? relistEligible : [FAILURE_OUTCOME.eligibleForSecondChance, FAILURE_OUTCOME.eligibleForRelist].includes(failureOutcome)
            };
            const updated = new Map(transactions);
            updated.set(listingId, next);
            if (!persistTransactions(updated)) return null;
            transactions.set(listingId, next);
            return { ...next };
        },
        canAcceptSecondChance(listingId, userId = getCurrentUser()?.id) {
            const listing = listingStates.get(listingId);
            const offer = listing?.secondChanceOffer;
            if (!offer || offer.status !== SECOND_CHANCE_OFFER_STATUS.pending || offer.buyerUserId !== userId
                || !isDemoUserId(offer.buyerUserId) || offer.buyerUserId === listing.sellerUserId
                || !Number.isSafeInteger(offer.price) || offer.price <= 0
                || !Number.isFinite(Date.parse(offer.expiresAt)) || Date.parse(offer.expiresAt) <= Date.now()
                || this.get(listingId).status !== transactionStatus.auctionActive
                || this.isPaused(listingId) || this.isPaused(listing.relistedFrom)) return false;
            const source = this.get(listing.recoverySourceListingId || listing.relistedFrom);
            const lastBid = source.bidHistory.filter(bid => bid.bidderUserId === offer.buyerUserId
                && Number.isSafeInteger(bid.amount) && bid.amount > 0).at(-1);
            const eligibleSource = source.failureOutcome === FAILURE_OUTCOME.eligibleForSecondChance
                || (source.status === transactionStatus.auctionWon && source.reserveOutcome === AUCTION_RESERVE_OUTCOME.notMet)
                || (source.status === transactionStatus.cancelled && source.relistEligible
                    && !source.shippingRequestedAt && !source.tokenOutcome
                    && [TRANSACTION_OUTCOME.winnerDidNotConfirm, TRANSACTION_OUTCOME.buyerCancelledAfterReservation,
                        TRANSACTION_OUTCOME.buyerChangedMind].includes(source.outcome))
                || (source.status === transactionStatus.cancelled && source.relistEligible
                    && source.outcome === TRANSACTION_OUTCOME.buyerNoShow
                    && source.noShowUserId === source.buyerUserId)
                || (source.status === transactionStatus.itemRejected
                    && source.outcome === TRANSACTION_OUTCOME.buyerChangedMind);
            if (!eligibleSource || !lastBid || offer.price > lastBid.amount || source.buyerUserId === offer.buyerUserId) return false;
            const root = listing.sourceListingId || listing.id;
            return !Array.from(listingStates.values()).some(other => {
                if (other.id === listingId || (other.sourceListingId || other.id) !== root) return false;
                if (other.recoveryOnly && !other.secondChanceOffer) return false;
                const transaction = this.get(other.id);
                return (transaction.buyerUserId && ![transactionStatus.cancelled, transactionStatus.itemRejected].includes(transaction.status))
                    || (!other.secondChanceOffer && transaction.status === transactionStatus.auctionActive)
                    || (other.secondChanceOffer?.status === SECOND_CHANCE_OFFER_STATUS.pending && Date.parse(other.secondChanceOffer.expiresAt) > Date.now()
                        && !transaction.buyerUserId);
            });
        },
        acceptSecondChance(listingId) {
            if (!this.canAcceptSecondChance(listingId)) return null;
            const listing = listingStates.get(listingId);
            const offer = listing.secondChanceOffer;
            return this.transition(listingId, TRANSACTION_EVENT.acceptSecondChance, {
                buyerUserId: offer.buyerUserId,
                transactionPrice: offer.price
            });
        },
        get(listingId) {
            const saved = transactions.get(listingId);
            return saved
                ? { ...createDefaultTransaction(), sellerUserId: listingStates.get(listingId)?.sellerUserId || null, ...saved }
                : { ...createDefaultTransaction(), sellerUserId: listingStates.get(listingId)?.sellerUserId || null };
        },
            getInspectionReview(listingId) {
                const transaction = this.get(listingId);
                return getInspectionReview({
                    ...listingStates.get(listingId),
                    transactionPrice: transaction.transactionPrice,
                    listingSnapshot: transaction.listingSnapshot
                });
            },
        canPerform(listingId, event, details = {}, userId = getCurrentUser()?.id || DEFAULT_DEMO_USER_ID) {
            return canPerformTransaction({
                transaction: this.get(listingId),
                listing: listingStates.get(listingId),
                event,
                details,
                userId,
                isPaused: isTransactionPaused(listingId),
                getHighestValidBid,
                now
            });
        },
        isParticipant(listingId, userId = getCurrentUser()?.id) {
            const transaction = this.get(listingId);
            return [transaction.buyerUserId, transaction.sellerUserId].includes(userId);
        },
        isBuyer(listingId, userId = getCurrentUser()?.id) {
            return this.get(listingId).buyerUserId === userId;
        },
        isSeller(listingId, userId = getCurrentUser()?.id) {
            return this.get(listingId).sellerUserId === userId;
        },
        canResumeBuyer(listingId, userId = getCurrentUser()?.id) {
            const transaction = this.get(listingId);
            return transaction.buyerUserId === userId
                && resumableBuyerStatuses.has(transaction.status)
                && !this.isPaused(listingId);
        },
        canOpenShipping(listingId, userId = getCurrentUser()?.id) {
            const transaction = this.get(listingId);
            const listing = listingStates.get(listingId);
            const shippingAvailable = [FULFILMENT_METHOD.shipping, FULFILMENT_METHOD.both].includes(listing?.fulfilmentMethod);
            const shippingStarted = Object.values(SHIPPING_STATUS).includes(transaction.status)
                || (transaction.status === transactionStatus.completed && Boolean(transaction.shippingReference));
            return shippingAvailable
                && this.isParticipant(listingId, userId)
                && (transaction.status === transactionStatus.tokenCompleted || shippingStarted);
        },
        canSelectSimpleCollection(listingId) {
            const listing = listingStates.get(listingId);
            return canSelectSimpleCollection(listing, this.get(listingId));
        },
        requestSimpleCollection(listingId, { declinedInspection = false } = {}) {
            if (!this.canSelectSimpleCollection(listingId)) return null;
            return this.transition(listingId, TRANSACTION_EVENT.simpleCollection, { declinedInspection });
        },
        recordSimpleCollectionHandover(listingId, isBuyerReceipt) {
            const transaction = this.get(listingId);
            const event = isBuyerReceipt ? TRANSACTION_EVENT.buyerReceipt : TRANSACTION_EVENT.sellerHandover;
            const handover = this.transition(listingId, event);
            if (!handover || !isBuyerReceipt) return handover;
            return this.transition(listingId, TRANSACTION_EVENT.completeTransaction) || handover;
        },
        canContinueShipping(listingId, userId = getCurrentUser()?.id) {
            return this.isSeller(listingId, userId)
                && Object.values(SHIPPING_STATUS).includes(this.get(listingId).status)
                && !this.isPaused(listingId);
        },
        isPaused(listingId) {
            return isTransactionPaused(listingId);
        },
        canRecordMeetupAttendance(meetupId, attendanceStatus) {
            if (![MEETUP_ATTENDANCE_STATUS.arrived, MEETUP_ATTENDANCE_STATUS.noShow].includes(attendanceStatus)) return false;
            const meetup = this.getMeetup(meetupId);
            if (!meetup) return false;
            const transaction = this.get(meetup.listingId);
            const userId = getCurrentUser()?.id;
            const scheduledAt = new Date(`${meetup.date}T${meetup.time}`).getTime();
            const currentAttendance = meetup.attendance?.[userId]?.status || MEETUP_ATTENDANCE_STATUS.pending;
            return !this.isPaused(meetup.listingId)
                && transaction.status === transactionStatus.meetupRequested
                && this.isParticipant(meetup.listingId, userId)
                && Number.isFinite(scheduledAt)
                && scheduledAt <= Date.now()
                && currentAttendance === MEETUP_ATTENDANCE_STATUS.pending;
        },
        canReportMeetupNoShow(meetupId) {
            const meetup = this.getMeetup(meetupId);
            if (!meetup) return false;
            const transaction = this.get(meetup.listingId);
            const userId = getCurrentUser()?.id;
            const scheduledAt = new Date(`${meetup.date}T${meetup.time}`).getTime();
            const ownAttendance = meetup.attendance?.[userId]?.status || MEETUP_ATTENDANCE_STATUS.pending;
            return !this.isPaused(meetup.listingId)
                && transaction.status === transactionStatus.meetupRequested
                && this.isParticipant(meetup.listingId, userId)
                && Number.isFinite(scheduledAt)
                && scheduledAt <= Date.now()
                && ownAttendance !== MEETUP_ATTENDANCE_STATUS.pending
                && !meetup.noShowReport;
        },
        canStartInspection(meetupId) {
            const meetup = this.getMeetup(meetupId);
            if (!meetup) return false;
            const transaction = this.get(meetup.listingId);
            return !this.isPaused(meetup.listingId)
                && this.isBuyer(meetup.listingId)
                && [transactionStatus.meetupRequested, transactionStatus.inspectionPending].includes(transaction.status)
                && meetup.attendance?.[transaction.buyerUserId]?.status === MEETUP_ATTENDANCE_STATUS.arrived
                && meetup.attendance?.[transaction.sellerUserId]?.status === MEETUP_ATTENDANCE_STATUS.arrived;
        },
        transition(listingId, event, details = {}) {
            const current = this.get(listingId);
            const currentUserId = getCurrentUser()?.id || DEFAULT_DEMO_USER_ID;
            if (event === TRANSACTION_EVENT.acceptSecondChance
                && !this.canAcceptSecondChance(listingId, currentUserId)) return null;
            if (!canPerformTransaction({
                transaction: current,
                listing: listingStates.get(listingId),
                event,
                details,
                userId: currentUserId,
                isPaused: isTransactionPaused(listingId),
                getHighestValidBid,
                now
            })) return null;
            const nextStatus = nextTransactionStatus(current.status, event);
            if (nextStatus === null) return null;
            let next = null;

            if (event === TRANSACTION_EVENT.placeBid && Number.isSafeInteger(details.amount) && details.amount > 0) {
                next = {
                    ...current,
                    bidHistory: [...current.bidHistory, {
                        listingId,
                        bidderUserId: details.bidderUserId,
                        bidderDisplayName: details.bidderDisplayName || getCurrentUser()?.firstName || 'Kunal',
                        bidder: details.bidderDisplayName || getCurrentUser()?.firstName || 'Kunal',
                        amount: details.amount,
                        auctionExtended: details.auctionExtended === true,
                        ...(details.automatic === true ? { auto: true } : {}),
                        ...(details.tiePriority === true ? { tiePriority: true } : {}),
                        placedAt: details.placedAt || new Date().toISOString()
                    }]
                };
            } else if (event === TRANSACTION_EVENT.auctionEnd) {
                const highestBid = getHighestValidBid(current.bidHistory);
                const reserveNotMet = !details.buyNowReached && details.reserveOutcome === AUCTION_RESERVE_OUTCOME.notMet;
                const buyerUserId = highestBid && !reserveNotMet ? details.buyerUserId : null;
                next = {
                    ...current,
                    status: nextStatus,
                    purchaseSource: highestBid && !reserveNotMet ? PURCHASE_SOURCE.auctionWinner : null,
                    reserveOutcome: details.reserveOutcome,
                    buyerUserId,
                    sellerUserId: listingStates.get(listingId)?.sellerUserId || current.sellerUserId,
                    winner: highestBid && !reserveNotMet ? details.winner : null,
                    winningBid: highestBid && !reserveNotMet ? details.winningBid : null,
                    transactionPrice: highestBid && !reserveNotMet ? details.winningBid : null,
                    winnerResponseDeadline: buyerUserId ? new Date(now() + WINNER_CONFIRMATION_WINDOW_MS).toISOString() : null,
                    listingSnapshot: buyerUserId ? createListingSnapshot(listingStates.get(listingId)) : null
                };
            } else if (event === TRANSACTION_EVENT.startToken) {
                next = { ...current, status: nextStatus };
            } else if (event === TRANSACTION_EVENT.simpleCollection) {
                next = {
                    ...current,
                    status: nextStatus,
                    fulfilmentPath: 'simple_collection',
                    inspectionDeclined: details.declinedInspection === true
                };
            } else if (event === TRANSACTION_EVENT.simulateToken) {
                const price = current.transactionPrice;
                const depositAmount = price < 5000 ? RESERVATION_DEPOSIT.none
                    : price <= RESERVATION_DEPOSIT.standardMaximum ? RESERVATION_DEPOSIT.standard : RESERVATION_DEPOSIT.highValue;
                next = {
                    ...current, status: nextStatus, depositAmount,
                    depositOutcome: depositAmount ? DEPOSIT_OUTCOME.pending : null
                };
            } else if (event === TRANSACTION_EVENT.acceptSecondChance) {
                const listing = listingStates.get(listingId);
                const buyer = getDemoUser(details.buyerUserId);
                if (!buyer || !listing?.secondChanceOffer) return null;
                next = {
                    ...createDefaultTransaction(),
                    status: nextStatus,
                    purchaseSource: PURCHASE_SOURCE.auctionWinner,
                    buyerUserId: buyer.id,
                    sellerUserId: listing.sellerUserId,
                    winner: buyer.firstName,
                    winningBid: details.transactionPrice,
                    transactionPrice: details.transactionPrice,
                    winnerResponseDeadline: new Date(now() + WINNER_CONFIRMATION_WINDOW_MS).toISOString(),
                    listingSnapshot: createListingSnapshot(listing)
                };
            } else if (event === TRANSACTION_EVENT.cancelUnstartedPurchase) {
                const buyerCancelled = currentUserId === current.buyerUserId;
                const sellerCancelled = currentUserId === current.sellerUserId;
                next = {
                    ...current, status: nextStatus, relistEligible: buyerCancelled, cancelledAt: new Date(now()).toISOString(),
                    outcome: buyerCancelled
                        ? current.depositAmount > 0 ? TRANSACTION_OUTCOME.buyerCancelledAfterReservation : TRANSACTION_OUTCOME.buyerChangedMind
                        : TRANSACTION_OUTCOME.sellerCancellation,
                    failureOutcome: sellerCancelled ? FAILURE_OUTCOME.sellerCancelled
                        : buyerCancelled ? FAILURE_OUTCOME.sellerAvailabilityRequired : null,
                    failureReason: typeof details.reason === 'string' ? details.reason.trim().slice(0, 200) : '',
                    sellerCancellationStage: sellerCancelled
                        ? current.status === transactionStatus.tokenCompleted
                            ? SELLER_CANCELLATION_STAGE.afterReservation
                            : SELLER_CANCELLATION_STAGE.afterWinnerAllocation
                        : null,
                    depositOutcome: current.depositAmount > 0
                        ? buyerCancelled ? DEPOSIT_OUTCOME.forfeited : DEPOSIT_OUTCOME.refundable
                        : null,
                    failedBuyerUserId: buyerCancelled ? current.buyerUserId : null
                };
            } else if (event === TRANSACTION_EVENT.sellerCancelAuction) {
                next = {
                    ...current,
                    status: nextStatus,
                    relistEligible: false,
                    cancelledAt: new Date(now()).toISOString(),
                    outcome: TRANSACTION_OUTCOME.sellerCancellation,
                    failureOutcome: FAILURE_OUTCOME.sellerCancelled,
                    failureReason: details.reason.trim().slice(0, 200),
                    sellerCancellationStage: SELLER_CANCELLATION_STAGE.afterBids
                };
            } else if (event === TRANSACTION_EVENT.sellerWithdrawBeforeBids) {
                next = {
                    ...current,
                    status: nextStatus,
                    cancelledAt: new Date(now()).toISOString(),
                    outcome: TRANSACTION_OUTCOME.sellerCancellation,
                    failureReason: typeof details.reason === 'string' ? details.reason.trim().slice(0, 200) : '',
                    sellerCancellationStage: SELLER_CANCELLATION_STAGE.beforeBids
                };
            } else if (event === TRANSACTION_EVENT.winnerDeclined) {
                next = {
                    ...current, status: nextStatus, relistEligible: false, cancelledAt: new Date(now()).toISOString(),
                    outcome: TRANSACTION_OUTCOME.winnerDidNotConfirm,
                    failureOutcome: FAILURE_OUTCOME.sellerAvailabilityRequired,
                    failedBuyerUserId: current.buyerUserId
                };
            } else if (event === TRANSACTION_EVENT.buyNow && Number.isSafeInteger(details.transactionPrice) && details.transactionPrice > 0) {
                next = {
                    ...current,
                    status: nextStatus,
                    purchaseSource: PURCHASE_SOURCE.buyNow,
                    buyerUserId: details.buyerUserId,
                    sellerUserId: listingStates.get(listingId)?.sellerUserId || current.sellerUserId,
                    transactionPrice: details.transactionPrice,
                    listingSnapshot: createListingSnapshot(listingStates.get(listingId))
                };
            } else if (event === TRANSACTION_EVENT.meetupNoShow) {
                const sellerNoShow = details.missedUserId === current.sellerUserId;
                next = {
                    ...current,
                    status: nextStatus,
                    noShowOutcome: details.noShowOutcome,
                    noShowUserId: details.missedUserId,
                    tokenOutcome: details.tokenOutcome,
                    relistEligible: !sellerNoShow,
                    cancelledAt: details.reportedAt || new Date().toISOString(),
                    outcome: sellerNoShow ? TRANSACTION_OUTCOME.sellerNoShow : TRANSACTION_OUTCOME.buyerNoShow,
                    failureOutcome: sellerNoShow ? FAILURE_OUTCOME.sellerNoShow : FAILURE_OUTCOME.sellerAvailabilityRequired,
                    depositOutcome: current.depositAmount > 0
                        ? sellerNoShow ? DEPOSIT_OUTCOME.refundable : DEPOSIT_OUTCOME.forfeited
                        : null
                };
            } else if (event === TRANSACTION_EVENT.meetupRequested) {
                next = { ...current, status: nextStatus, fulfilmentPath: 'public_meetup' };
            } else if (event === TRANSACTION_EVENT.requestShipping) {
                next = {
                    ...current,
                    status: nextStatus,
                    shippingReference: details.shippingReference,
                    shippingRequestedAt: details.shippingRequestedAt,
                    fulfilmentPath: 'protected_shipping'
                };
            } else if (event === TRANSACTION_EVENT.shippingDispatched) {
                next = { ...current, status: nextStatus, shippingDispatchedAt: details.shippingDispatchedAt };
            } else if (event === TRANSACTION_EVENT.shippingDelivered) {
                next = {
                    ...current,
                    status: nextStatus,
                    shippingDeliveredAt: details.shippingDeliveredAt,
                    shippingInspectionEndsAt: details.shippingInspectionEndsAt
                };
            } else {
                next = {
                    ...current,
                    status: nextStatus,
                    ...(event === TRANSACTION_EVENT.disputeCancel
                        ? {
                            outcome: TRANSACTION_OUTCOME.disputeResolution,
                            depositOutcome: details.resolution === DISPUTE_RESOLUTION.buyerRefund
                                || details.resolution === DISPUTE_RESOLUTION.tokenRefundOnly
                                ? DEPOSIT_OUTCOME.refundable
                                : current.depositOutcome
                        }
                        : {}),
                    ...(event === TRANSACTION_EVENT.inspectionRejected
                        ? {
                            outcome: details.rejectionReason === INSPECTION_REJECTION_REASON.changedMind
                                ? TRANSACTION_OUTCOME.buyerChangedMind : TRANSACTION_OUTCOME.materialMismatch,
                            failureOutcome: details.rejectionReason === INSPECTION_REJECTION_REASON.changedMind
                                ? FAILURE_OUTCOME.sellerAvailabilityRequired : FAILURE_OUTCOME.listingCorrectionRequired,
                            mismatchReason: details.rejectionReason === INSPECTION_REJECTION_REASON.changedMind
                                ? null : details.rejectionReason,
                            failureReason: details.rejectionReason === INSPECTION_REJECTION_REASON.otherMaterialMismatch
                                ? details.mismatchDescription.trim().slice(0, 200) : '',
                            depositOutcome: current.depositAmount
                                ? details.rejectionReason === INSPECTION_REJECTION_REASON.changedMind
                                    ? DEPOSIT_OUTCOME.forfeited : DEPOSIT_OUTCOME.refundable
                                : null,
                            relistEligible: false,
                            failedBuyerUserId: details.rejectionReason === INSPECTION_REJECTION_REASON.changedMind
                                ? current.buyerUserId : null
                        }
                        : {}),
                    ...([TRANSACTION_EVENT.completeTransaction, TRANSACTION_EVENT.disputeSellerPayout, TRANSACTION_EVENT.shippingAccept].includes(event)
                        ? { outcome: TRANSACTION_OUTCOME.successfulCompletion, depositOutcome: current.depositAmount ? DEPOSIT_OUTCOME.credited : null }
                        : {}),
                    ...([TRANSACTION_EVENT.completeTransaction, TRANSACTION_EVENT.disputeSellerPayout, TRANSACTION_EVENT.shippingAccept].includes(event)
                        ? { completedAt: new Date(now()).toISOString() }
                        : {})
                };
            }

            if (!next) return null;
            const updated = new Map(transactions);
            updated.set(listingId, next);
            if (!persistTransactions(updated)) return null;
            transactions.set(listingId, next);
            const listing = listingStates.get(listingId);
            if (event === TRANSACTION_EVENT.auctionEnd) notificationService?.notifyAuctionWon({ listing, transaction: next });
            if (event === TRANSACTION_EVENT.acceptSecondChance) notificationService?.notifyAuctionWon({ listing, transaction: next });
            if (event === TRANSACTION_EVENT.winnerDeclined) {
                notificationService?.create({
                    dedupeKey: `winner-expired:${listingId}:${next.failedBuyerUserId}`,
                    recipientUserId: next.sellerUserId,
                    title: 'Winner did not confirm',
                    message: 'Confirm whether the item is still available before offering it again.',
                    listingId
                });
            }
            if (event === TRANSACTION_EVENT.meetupNoShow && next.noShowUserId === next.sellerUserId) {
                notificationService?.create({
                    dedupeKey: `seller-no-show:${listingId}:buyer`,
                    recipientUserId: next.buyerUserId,
                    title: 'Seller no-show resolved',
                    message: `${listing?.title || 'The item'} transaction was cancelled. The simulated deposit is refundable; no buyer penalty was recorded.`,
                    listingId
                });
                notificationService?.create({
                    dedupeKey: `seller-no-show:${listingId}:seller`,
                    recipientUserId: next.sellerUserId,
                    title: 'Confirm item availability',
                    message: 'The transaction was cancelled. Confirm whether the item is still available before offering it again.',
                    listingId
                });
            }
            if (event === TRANSACTION_EVENT.meetupNoShow && next.noShowUserId !== next.sellerUserId) {
                notificationService?.create({
                    dedupeKey: `buyer-no-show:${listingId}:seller`,
                    recipientUserId: next.sellerUserId,
                    title: 'Confirm item availability',
                    message: 'The transaction was cancelled. Confirm whether the item is still available before offering it again.',
                    listingId
                });
            }
            if (event === TRANSACTION_EVENT.sellerCancelAuction
                || (event === TRANSACTION_EVENT.cancelUnstartedPurchase && next.outcome === TRANSACTION_OUTCOME.sellerCancellation)) {
                const recipients = new Set([next.buyerUserId, ...next.bidHistory.map(bid => bid.bidderUserId)]);
                recipients.delete(next.sellerUserId);
                recipients.forEach(recipientUserId => notificationService?.create({
                    dedupeKey: `seller-cancelled:${listingId}:${recipientUserId}`,
                    recipientUserId,
                    title: 'Seller cancellation recorded',
                    message: `${listing?.title || 'The item'} transaction was cancelled. No buyer reliability outcome was recorded.`,
                    listingId
                }));
                notificationService?.create({
                    dedupeKey: `seller-cancelled:${listingId}:availability`,
                    recipientUserId: next.sellerUserId,
                    title: 'Confirm item availability',
                    message: 'The transaction was cancelled. Confirm whether the item is still available before offering it again.',
                    listingId
                });
            }
            if (event === TRANSACTION_EVENT.cancelUnstartedPurchase
                && next.failureOutcome === FAILURE_OUTCOME.sellerAvailabilityRequired
                && next.outcome !== TRANSACTION_OUTCOME.sellerCancellation) {
                notificationService?.create({
                    dedupeKey: `buyer-cancelled:${listingId}:seller`,
                    recipientUserId: next.sellerUserId,
                    title: 'Confirm item availability',
                    message: 'The transaction ended. Confirm whether the item is still available before offering it again.',
                    listingId
                });
            }
            if (event === TRANSACTION_EVENT.inspectionRejected
                && next.failureOutcome === FAILURE_OUTCOME.listingCorrectionRequired) {
                notificationService?.create({
                    dedupeKey: `material-mismatch:${listingId}:buyer`,
                    recipientUserId: next.buyerUserId,
                    title: 'Material mismatch resolved',
                    message: 'The transaction was cancelled and the simulated reservation deposit is refundable. No buyer penalty was recorded.',
                    listingId
                });
                notificationService?.create({
                    dedupeKey: `material-mismatch:${listingId}:seller`,
                    recipientUserId: next.sellerUserId,
                    title: 'Listing correction required',
                    message: 'The listing is unavailable for offers or relisting until you submit a corrected version for review.',
                    listingId
                });
            }
            if (event === TRANSACTION_EVENT.inspectionRejected
                && next.failureOutcome === FAILURE_OUTCOME.sellerAvailabilityRequired) {
                notificationService?.create({
                    dedupeKey: `change-of-mind:${listingId}:seller`,
                    recipientUserId: next.sellerUserId,
                    title: 'Confirm item availability',
                    message: 'The buyer no longer wants the accurately described item. Confirm whether it is still available before offering it again.',
                    listingId
                });
            }
            if (event === TRANSACTION_EVENT.buyNow) notificationService?.notifyBuyNow({ listing, transaction: next });
            if ([TRANSACTION_EVENT.requestShipping, TRANSACTION_EVENT.shippingDispatched, TRANSACTION_EVENT.shippingDelivered, TRANSACTION_EVENT.shippingAccept].includes(event)) {
                notificationService?.notifyShippingUpdate({
                listing,
                transaction: next,
                event,
                actorUserId: currentUserId
                });
            }
            return { ...next };
        },
        requestMeetup(listingId, details) {
            const current = this.get(listingId);
            if (!details || typeof details !== 'object'
                || current.status !== transactionStatus.tokenCompleted
                || !validateMeetup(details.date, details.time)
                || typeof details.location !== 'string'
                || !details.location.trim()) return null;

            const meetup = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                listingId,
                itemTitle: details.itemTitle,
                transactionPrice: current.transactionPrice,
                buyNowPrice: current.purchaseSource === PURCHASE_SOURCE.buyNow ? current.transactionPrice : null,
                purchaseSource: current.purchaseSource,
                date: details.date,
                time: details.time,
                location: details.location.trim(),
                attendance: {
                    [current.buyerUserId]: { status: MEETUP_ATTENDANCE_STATUS.pending, recordedAt: null },
                    [current.sellerUserId]: { status: MEETUP_ATTENDANCE_STATUS.pending, recordedAt: null }
                },
                noShowReport: null,
                createdAt: new Date().toISOString()
            };
            const meetups = readMeetups();
            if (!writeJSON(STORAGE_KEYS.meetups, [...meetups, meetup])) return null;
            if (!this.transition(listingId, TRANSACTION_EVENT.meetupRequested)) {
                if (meetups.length) writeJSON(STORAGE_KEYS.meetups, meetups);
                else removeStoredValue(STORAGE_KEYS.meetups);
                return null;
            }
            const transaction = this.get(listingId);
            notificationService?.notifyMeetupRequested({ meetup, transaction });
            return { meetup, transaction };
        },
        getMeetup(meetupId) {
            return readMeetups().find(meetup => meetup.id === meetupId) || null;
        },
        getLatestMeetup(listingId) {
            const matches = readMeetups().filter(meetup => meetup.listingId === listingId);
            return matches[matches.length - 1] || null;
        },
        getMeetupsForUser(userId) {
            return readMeetups().filter(meetup => {
                const transaction = this.get(meetup?.listingId);
                return transaction.buyerUserId === userId || transaction.sellerUserId === userId;
            });
        },
        recordMeetupAttendance(meetupId, attendanceStatus) {
            if (!this.canRecordMeetupAttendance(meetupId, attendanceStatus)) return null;
            const meetups = readMeetups();
            const meetup = meetups.find(item => item?.id === meetupId);
            if (!meetup) return null;
            const transaction = this.get(meetup.listingId);
            const userId = getCurrentUser()?.id;
            const recordedAt = new Date();
            const attendance = meetup.attendance && typeof meetup.attendance === 'object' ? meetup.attendance : {};
            meetup.attendance = {
                ...attendance,
                [userId]: { status: attendanceStatus, recordedAt: recordedAt.toISOString() }
            };
            if (!writeJSON(STORAGE_KEYS.meetups, meetups)) return null;
            if (!transactions.has(meetup.listingId)) transactions.set(meetup.listingId, transaction);
            return { ok: true, meetup, transaction };
        },
        reportMeetupNoShow(meetupId) {
            if (!this.canReportMeetupNoShow(meetupId)) return null;
            const meetups = readMeetups();
            const meetup = meetups.find(item => item?.id === meetupId);
            if (!meetup) return null;
            const transaction = this.get(meetup.listingId);
            const reporterUserId = getCurrentUser()?.id;
            const reportedAt = new Date();
            const attendance = meetup.attendance && typeof meetup.attendance === 'object' ? meetup.attendance : {};
            const missedUserId = reporterUserId === transaction.buyerUserId ? transaction.sellerUserId : transaction.buyerUserId;
            if (attendance[missedUserId]?.status === MEETUP_ATTENDANCE_STATUS.arrived) {
                return { ok: false, code: SERVICE_ERROR_CODE.attendanceConflict, meetup, reporterUserId, missedUserId };
            }
            const noShowOutcome = missedUserId === transaction.sellerUserId
                ? MEETUP_NO_SHOW_OUTCOME.sellerNoShow
                : MEETUP_NO_SHOW_OUTCOME.buyerNoShow;
            const tokenOutcome = missedUserId === transaction.sellerUserId
                ? MEETUP_NO_SHOW_OUTCOME.tokenRefundable
                : MEETUP_NO_SHOW_OUTCOME.tokenForfeited;
            const previousMeetups = meetups.map(item => item && typeof item === 'object' ? { ...item } : item);
            meetup.noShowReport = { reporterUserId, missedUserId, noShowOutcome, tokenOutcome, reportedAt: reportedAt.toISOString() };
            if (!writeJSON(STORAGE_KEYS.meetups, meetups)) return { ok: false, code: SERVICE_ERROR_CODE.storageFailed };
            const cancelledTransaction = this.transition(meetup.listingId, TRANSACTION_EVENT.meetupNoShow, {
                reporterUserId,
                missedUserId,
                noShowOutcome,
                tokenOutcome,
                reportedAt: reportedAt.toISOString()
            });
            if (!cancelledTransaction) {
                writeJSON(STORAGE_KEYS.meetups, previousMeetups);
                return { ok: false, code: SERVICE_ERROR_CODE.storageFailed };
            }
            return { ok: true, meetup, transaction: cancelledTransaction };
        },
        startInspection(meetupId) {
            if (!this.canStartInspection(meetupId)) return null;
            const meetup = this.getMeetup(meetupId);
            if (!meetup) return null;
            const transaction = this.transition(meetup.listingId, TRANSACTION_EVENT.inspectionStarted);
            return transaction ? { meetup, transaction } : null;
        },
        recordInspection(meetupId, checks, isApproved, rejectionReason = null, mismatchDescription = '') {
            const meetups = readMeetups();
            const meetup = meetups.find(item => item?.id === meetupId);
            if (!meetup) return null;
            if (typeof isApproved !== 'boolean'
                || !Array.isArray(checks)
                || checks.some(check => !check || typeof check !== 'object')) {
                return { ok: false, code: SERVICE_ERROR_CODE.invalidInput };
            }
            if (isApproved && !validateInspection(checks.map(check => check.checked))) {
                return { ok: false, code: SERVICE_ERROR_CODE.invalidInput };
            }
            if (!isApproved && (!Object.values(INSPECTION_REJECTION_REASON).includes(rejectionReason)
                || (rejectionReason === INSPECTION_REJECTION_REASON.otherMaterialMismatch
                    && (typeof mismatchDescription !== 'string' || !mismatchDescription.trim() || mismatchDescription.trim().length > 200)))) {
                return { ok: false, code: SERVICE_ERROR_CODE.invalidInput };
            }
            const previousMeetups = meetups.map(item => item && typeof item === 'object' ? { ...item } : item);
            meetup.inspectionChecks = checks.filter(check => check.checked).map(check => check.value);
            meetup.inspectedAt = new Date().toISOString();
            if (!writeJSON(STORAGE_KEYS.meetups, meetups)) return { ok: false, code: SERVICE_ERROR_CODE.storageFailed };
            const transaction = this.transition(meetup.listingId, isApproved
                ? TRANSACTION_EVENT.inspectionApproved
                : TRANSACTION_EVENT.inspectionRejected, {
                    rejectionReason,
                    mismatchDescription: typeof mismatchDescription === 'string' ? mismatchDescription.trim() : ''
                });
            if (!transaction) {
                writeJSON(STORAGE_KEYS.meetups, previousMeetups);
                return { ok: false, code: SERVICE_ERROR_CODE.invalidTransition };
            }
            return { ok: true, meetup, transaction };
        },
        previewPayment(meetupId) {
            const meetup = this.getMeetup(meetupId);
            if (!meetup) return null;
            const transaction = this.transition(meetup.listingId, TRANSACTION_EVENT.paymentPreviewed);
            return transaction ? { meetup, transaction } : null;
        },
        recordHandover(meetupId, isBuyerReceipt) {
            const meetup = this.getMeetup(meetupId);
            if (!meetup) return null;
            const transaction = this.transition(meetup.listingId, isBuyerReceipt
                ? TRANSACTION_EVENT.buyerReceipt
                : TRANSACTION_EVENT.sellerHandover);
            if (!transaction) return null;
            if (!isBuyerReceipt) return { meetup, transaction };
            const completedTransaction = this.transition(meetup.listingId, TRANSACTION_EVENT.completeTransaction);
            return { meetup, transaction: completedTransaction || transaction, completed: Boolean(completedTransaction) };
        },
        requestShipping(listingId) {
            const requestedAt = new Date();
            return this.transition(listingId, TRANSACTION_EVENT.requestShipping, {
                shippingReference: `DEMO-${requestedAt.getTime().toString().slice(-8)}`,
                shippingRequestedAt: requestedAt.toISOString()
            });
        },
        dispatchShipping(listingId) {
            return this.transition(listingId, TRANSACTION_EVENT.shippingDispatched, {
                shippingDispatchedAt: new Date().toISOString()
            });
        },
        deliverShipping(listingId) {
            const deliveredAt = new Date();
            return this.transition(listingId, TRANSACTION_EVENT.shippingDelivered, {
                shippingDeliveredAt: deliveredAt.toISOString(),
                shippingInspectionEndsAt: new Date(deliveredAt.getTime() + SHIPPING_INSPECTION_WINDOW_MS).toISOString()
            });
        },
        acceptShipping(listingId) {
            return this.transition(listingId, TRANSACTION_EVENT.shippingAccept);
        },
        reset(listingId, { allowPaused = false } = {}) {
            if (!allowPaused && isTransactionPaused(listingId)) return false;
            const meetups = readMeetups();
            const remainingMeetups = meetups.filter(meetup => meetup?.listingId !== listingId);
            const meetupsChanged = remainingMeetups.length !== meetups.length;
            if (meetupsChanged) {
                const savedMeetups = remainingMeetups.length
                    ? writeJSON(STORAGE_KEYS.meetups, remainingMeetups)
                    : removeStoredValue(STORAGE_KEYS.meetups);
                if (!savedMeetups) return false;
            }
            if (!transactions.has(listingId)) return true;
            const updated = new Map(transactions);
            updated.delete(listingId);
            if (!persistTransactions(updated)) {
                if (meetupsChanged) writeJSON(STORAGE_KEYS.meetups, meetups);
                return false;
            }
            transactions.delete(listingId);
            return true;
        },
        resolveDispute(listingId, resolution) {
            if (resolution === DISPUTE_RESOLUTION.noAction) return this.get(listingId);
            const event = resolution === DISPUTE_RESOLUTION.sellerPayout
                ? TRANSACTION_EVENT.disputeSellerPayout
                : [
                    DISPUTE_RESOLUTION.buyerRefund,
                    DISPUTE_RESOLUTION.tokenRefundOnly,
                    DISPUTE_RESOLUTION.cancelTransaction
                ].includes(resolution)
                    ? TRANSACTION_EVENT.disputeCancel
                    : null;
            return event ? this.transition(listingId, event, { resolution }) : null;
        }
    };
}

export function transactionStatusLabel(transaction) {
    if (transaction.status === transactionStatus.auctionWon && !transaction.buyerUserId) {
        return transaction.reserveOutcome === AUCTION_RESERVE_OUTCOME.notMet ? 'Auction ended' : 'No bids';
    }
    const labels = {
        [transactionStatus.unavailable]: 'Status unavailable',
        [transactionStatus.cancelled]: 'Cancelled',
        [transactionStatus.auctionWon]: 'Won · Reservation required',
        [transactionStatus.tokenPending]: 'Reservation required',
        [transactionStatus.tokenCompleted]: 'Reserved',
        [transactionStatus.simpleCollectionRequested]: 'Simple collection · Receipt needed',
        [transactionStatus.meetupRequested]: 'Meetup scheduled',
        [SHIPPING_STATUS.requested]: 'Shipping requested',
        [SHIPPING_STATUS.inTransit]: 'Shipping in transit',
        [SHIPPING_STATUS.delivered]: 'Delivered · Inspection ready',
        [transactionStatus.inspectionPending]: 'Inspection ready',
        [transactionStatus.itemApproved]: 'Inspection passed · Payment pending',
        [transactionStatus.itemRejected]: 'Transaction ended',
        [transactionStatus.paymentPreviewed]: 'Seller handover',
        [transactionStatus.sellerHandoverConfirmed]: 'Handover confirmed · Buyer receipt pending',
        [transactionStatus.buyerReceiptConfirmed]: 'Handover confirmed · Completing',
        [transactionStatus.completed]: 'Complete'
    };
    return labels[transaction.status] || 'Auction active';
}

export function getTransactionTimeline(transaction, fulfilmentMethod, { issueOpen = false } = {}) {
    if (!transaction?.purchaseSource) return [];

    const status = transaction.status;
    const shipping = fulfilmentMethod === FULFILMENT_METHOD.shipping
        || Boolean(transaction.shippingReference)
        || [SHIPPING_STATUS.requested, SHIPPING_STATUS.inTransit, SHIPPING_STATUS.delivered].includes(status);
    if (fulfilmentMethod === FULFILMENT_METHOD.both && !shipping
        && [transactionStatus.auctionWon, transactionStatus.tokenPending, transactionStatus.tokenCompleted].includes(status)) {
        const stages = ['Won / Buy Now', 'Reservation', 'Choose meetup or shipping'];
        const currentIndex = status === transactionStatus.tokenCompleted ? 2 : 1;
        const timeline = stages.map((label, index) => ({
            label,
            state: index < currentIndex ? 'complete'
                : index === currentIndex ? issueOpen ? 'paused' : 'current'
                    : 'future'
        }));
        if (issueOpen) timeline.push({ label: 'Issue open', state: 'current' });
        return timeline;
    }
    if (transaction.fulfilmentPath === 'simple_collection'
        && [transactionStatus.simpleCollectionRequested, transactionStatus.sellerHandoverConfirmed, transactionStatus.buyerReceiptConfirmed,
            transactionStatus.completed, transactionStatus.cancelled].includes(status)) {
        const handoverConfirmed = [transactionStatus.sellerHandoverConfirmed, transactionStatus.buyerReceiptConfirmed, transactionStatus.completed].includes(status);
        const timeline = [
            { label: 'Won / Buy Now', state: 'complete' },
            { label: 'Reservation', state: 'complete' },
            { label: 'Simple collection', state: handoverConfirmed ? 'complete' : issueOpen ? 'paused' : 'current' },
            { label: 'Confirm receipt', state: status === transactionStatus.buyerReceiptConfirmed ? 'complete' : 'future' }
        ];
        if (status === transactionStatus.completed) timeline[3].state = 'complete';
        if (status === transactionStatus.cancelled) timeline.push({ label: 'Cancelled', state: 'current' });
        return timeline;
    }
    const stages = shipping
        ? ['Won / Buy Now', 'Reservation', 'Shipping', 'Delivered', 'Inspection', 'Complete']
        : ['Won / Buy Now', 'Reservation', 'Meetup', 'Inspection', 'Payment', 'Handover', 'Complete'];
    const currentIndex = status === transactionStatus.auctionWon || status === transactionStatus.tokenPending ? 1
        : status === transactionStatus.tokenCompleted ? 2
            : shipping
                ? status === SHIPPING_STATUS.requested || status === SHIPPING_STATUS.inTransit ? 2
                    : status === SHIPPING_STATUS.delivered ? 4
                        : status === transactionStatus.completed ? stages.length : 2
                : status === transactionStatus.meetupRequested ? 2
                    : status === transactionStatus.inspectionPending ? 3
                        : status === transactionStatus.itemApproved ? 4
                            : status === transactionStatus.paymentPreviewed
                                || status === transactionStatus.sellerHandoverConfirmed
                                || status === transactionStatus.buyerReceiptConfirmed ? 5
                                    : status === transactionStatus.completed ? stages.length : 1;
    const rejected = status === transactionStatus.itemRejected;
    const cancelled = status === transactionStatus.cancelled;
    const failedLabel = rejected ? 'Buyer rejected' : cancelled ? 'Cancelled' : '';
    const terminalStageCount = rejected ? (shipping ? 5 : 4)
        : cancelled ? transaction.noShowOutcome ? 3 : 1
            : stages.length;
    const visibleStages = rejected || cancelled ? stages.slice(0, terminalStageCount) : stages;
    const completedIndex = status === transactionStatus.completed ? stages.length - 1
        : rejected || cancelled ? visibleStages.length - 1
            : currentIndex - 1;
    const timeline = visibleStages.map((label, index) => ({
        label,
        state: index <= completedIndex ? 'complete'
            : index === currentIndex ? issueOpen ? 'paused' : 'current'
                : 'future'
    }));

    if (rejected || cancelled) {
        timeline.push({ label: failedLabel, state: 'current' });
    } else if (issueOpen) {
        timeline.push({ label: 'Issue open', state: 'current' });
    }
    return timeline;
}