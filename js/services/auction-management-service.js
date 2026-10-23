import { AUCTION_RESERVE_OUTCOME, DEFAULT_AUCTION_DURATION_HOURS, DEFAULT_DEMO_USER_ID, FAILURE_OUTCOME, INSPECTION_REJECTION_REASON, LISTING_FORMAT, RESERVE_PRICE_MODE, SECOND_CHANCE_OFFER_DURATION_MS, SECOND_CHANCE_OFFER_STATUS, SERVICE_ERROR_CODE, SUBMISSION_STATUS, TRANSACTION_OUTCOME, TRANSACTION_STATUS } from '../core/constants.js';
import { validateSellerListing, validateSellerPhotos } from '../core/validation.js';
import { config } from '../config.js';
import { createPublishedSellerListing } from './listing-service.js';
import { loadSellerSubmissions, saveSellerSubmissions } from './submission-service.js';

export function createAuctionManagementService({ listingStates, transactionStore, biddingService, userService, notificationService, photoManager, now = () => Date.now() }) {
    const fail = (message, code = SERVICE_ERROR_CODE.actionNotAllowed) => ({ ok: false, code, message });
    const terminalStatuses = new Set([TRANSACTION_STATUS.cancelled, TRANSACTION_STATUS.itemRejected]);
    const getSubmission = listing => loadSellerSubmissions().find(item => item.id === listing?.sellerSubmissionId);
    const rootId = listing => listing.sourceListingId || listing.id;
    const recoverySourceId = listing => listing.recoverySourceListingId || listing.id;
    const hasApprovedCorrection = listingId => loadSellerSubmissions().some(item => (
        item.correctionOf === listingId && item.status === SUBMISSION_STATUS.published
    ));

    function offerStatus(listing) {
        if (!listing.secondChanceOffer) return null;
        if (transactionStore.get(listing.id).buyerUserId) return SECOND_CHANCE_OFFER_STATUS.accepted;
        if (listing.secondChanceOffer.status === SECOND_CHANCE_OFFER_STATUS.declined) return SECOND_CHANCE_OFFER_STATUS.declined;
        const expiry = Date.parse(listing.secondChanceOffer.expiresAt);
        return !Number.isFinite(expiry) || expiry <= now()
            ? SECOND_CHANCE_OFFER_STATUS.expired
            : SECOND_CHANCE_OFFER_STATUS.pending;
    }

    function hasLiveSuccessor(listing) {
        return Array.from(listingStates.values()).some(other => {
            if (other.id === listing.id || rootId(other) !== rootId(listing)) return false;
            if (other.recoveryOnly && !other.secondChanceOffer) return false;
            const transaction = transactionStore.get(other.id);
            if (other.secondChanceOffer) {
                return offerStatus(other) === SECOND_CHANCE_OFFER_STATUS.pending
                    || (offerStatus(other) === SECOND_CHANCE_OFFER_STATUS.accepted && !terminalStatuses.has(transaction.status));
            }
            return !terminalStatuses.has(transaction.status)
                && (transaction.buyerUserId !== null || transaction.status === TRANSACTION_STATUS.auctionActive);
        });
    }

    function failedOutcome(listing) {
        const transaction = transactionStore.get(listing.id);
        const recovery = transactionStore.get(recoverySourceId(listing));
        return transaction.failureOutcome === FAILURE_OUTCOME.eligibleForSecondChance
            || transaction.failureOutcome === FAILURE_OUTCOME.eligibleForRelist
            || (transaction.status === TRANSACTION_STATUS.auctionWon && !transaction.buyerUserId)
            || (transaction.status === TRANSACTION_STATUS.itemRejected && transaction.outcome !== TRANSACTION_OUTCOME.materialMismatch)
            || (transaction.status === TRANSACTION_STATUS.cancelled && transaction.relistEligible
                && [TRANSACTION_OUTCOME.winnerDidNotConfirm, TRANSACTION_OUTCOME.buyerCancelledAfterReservation,
                    TRANSACTION_OUTCOME.buyerChangedMind, TRANSACTION_OUTCOME.buyerNoShow].includes(transaction.outcome))
            || recovery.failureOutcome === FAILURE_OUTCOME.eligibleForSecondChance
            || recovery.failureOutcome === FAILURE_OUTCOME.eligibleForRelist;
    }

    function eligibleBidders(listingId) {
        const listing = listingStates.get(listingId);
        if (!listing || listing.secondChanceOffer || transactionStore.isPaused(listingId) || hasLiveSuccessor(listing)) return [];
        if (listingId === recoverySourceId(listing) && hasApprovedCorrection(listingId)) return [];
        const transaction = transactionStore.get(recoverySourceId(listing));
        const reserveFailed = transaction.status === TRANSACTION_STATUS.auctionWon
            && transaction.reserveOutcome === AUCTION_RESERVE_OUTCOME.notMet;
        const sellerRecovery = transaction.failureOutcome === FAILURE_OUTCOME.eligibleForSecondChance;
        const earlyFailure = (transaction.status === TRANSACTION_STATUS.cancelled
            && transaction.relistEligible && !transaction.shippingRequestedAt && !transaction.tokenOutcome
            && [TRANSACTION_OUTCOME.winnerDidNotConfirm, TRANSACTION_OUTCOME.buyerCancelledAfterReservation,
                TRANSACTION_OUTCOME.buyerChangedMind].includes(transaction.outcome))
            || (transaction.status === TRANSACTION_STATUS.itemRejected
                && transaction.outcome === TRANSACTION_OUTCOME.buyerChangedMind);
        const buyerNoShow = transaction.status === TRANSACTION_STATUS.cancelled
            && transaction.relistEligible
            && transaction.outcome === TRANSACTION_OUTCOME.buyerNoShow
            && transaction.noShowUserId === transaction.buyerUserId;
        if (!reserveFailed && !earlyFailure && !buyerNoShow && !sellerRecovery) return [];
        const lastBids = new Map();
        const attempted = new Set(Array.from(listingStates.values())
            .filter(other => other.secondChanceOffer && rootId(other) === rootId(listing))
            .map(other => other.secondChanceOffer.buyerUserId));
        transaction.bidHistory.forEach(bid => {
            if (Number.isSafeInteger(bid.amount) && bid.amount > 0
                && userService.getUser(bid.bidderUserId)
                && bid.bidderUserId !== listing.sellerUserId
                && bid.bidderUserId !== transaction.buyerUserId
                && bid.bidderUserId !== transaction.failedBuyerUserId
                && !attempted.has(bid.bidderUserId)) lastBids.set(bid.bidderUserId, bid);
        });
        const anonymous = new Map(biddingService.getBidHistory(listingId).map(row => [row.amount, row.label]));
        return Array.from(lastBids.values()).map(bid => ({
            userId: bid.bidderUserId,
            amount: bid.amount,
            placedAt: bid.placedAt,
            label: anonymous.get(bid.amount) || 'Prior bidder'
        })).sort((left, right) => right.amount - left.amount
            || Date.parse(right.placedAt) - Date.parse(left.placedAt));
    }

    function notifyRelistWhenExhausted(listingId) {
        const listing = listingStates.get(listingId);
        const transaction = transactionStore.get(listingId);
        const corrected = Array.from(listingStates.values()).find(item => (
            item.recoverySourceListingId === listingId && item.recoveryOnly && !item.secondChanceOffer
        ));
        const recoveryListing = corrected || listing;
        if (!listing || transaction.failureOutcome !== FAILURE_OUTCOME.eligibleForSecondChance
            || eligibleBidders(recoveryListing.id).length || hasLiveSuccessor(recoveryListing)) return false;
        const finalized = transactionStore.updateFailureOutcome(listingId, FAILURE_OUTCOME.eligibleForRelist, {
            relistEligible: true,
            admin: true
        });
        if (!finalized) return false;
        const lastOffer = Array.from(listingStates.values())
            .filter(other => other.secondChanceOffer && rootId(other) === rootId(listing))
            .sort((left, right) => Date.parse(right.listedAt) - Date.parse(left.listedAt))[0];
        notificationService.create({
            dedupeKey: `relist-available:${listingId}:${lastOffer?.id || 'no-offers'}`,
            recipientUserId: listing.sellerUserId,
            title: 'Relisting available',
            message: 'No eligible prior bidders remain. Review the price, fulfilment and auction duration before relisting.',
            listingId
        });
        return true;
    }

    function canUnpublish(listingId) {
        const listing = listingStates.get(listingId);
        if (!listing || listing.source !== 'seller_submission' || listing.recoveryOnly || listing.secondChanceOffer
            || transactionStore.isPaused(listingId)) return false;
        const transaction = transactionStore.get(listingId);
        return !transaction.buyerUserId && !transaction.bidHistory.length && listing.bidCount === 0
            && [TRANSACTION_STATUS.auctionActive, TRANSACTION_STATUS.auctionWon].includes(transaction.status);
    }

    function permissions(listingId, userId = userService.getCurrentUser().id) {
        const listing = listingStates.get(listingId);
        if (!listing || listing.sellerUserId !== userId) return {};
        const transaction = transactionStore.get(listingId);
        const active = transaction.status === TRANSACTION_STATUS.auctionActive
            && !biddingService.isAuctionExpired(listingId) && !listing.secondChanceOffer
            && !transactionStore.isPaused(listingId);
        const noBids = listing.bidCount === 0 && transaction.bidHistory.length === 0;
        const editable = active && listing.source === 'seller_submission' && !listing.recoveryOnly;
        return {
            view: true,
            manage: editable,
            edit: editable && noBids,
            lowerBuyNow: editable && Number.isSafeInteger(listing.buyNowPrice) && listing.buyNowPrice > listing.currentBid + 1,
            endEarly: editable && noBids,
            unpublish: canUnpublish(listingId),
            relist: !listing.secondChanceOffer && !(listingId === recoverySourceId(listing) && hasApprovedCorrection(listingId)) && failedOutcome(listing)
                && !transactionStore.isPaused(listingId) && !hasLiveSuccessor(listing)
                && eligibleBidders(listingId).length === 0,
            secondChance: eligibleBidders(listingId).length > 0,
            confirmAvailability: transaction.sellerUserId === userId
                && terminalStatuses.has(transaction.status)
                && [FAILURE_OUTCOME.sellerNoShow, FAILURE_OUTCOME.sellerCancelled,
                    FAILURE_OUTCOME.sellerAvailabilityRequired].includes(transaction.failureOutcome),
            correctListing: transaction.sellerUserId === userId
                && transaction.status === TRANSACTION_STATUS.itemRejected
                && transaction.failureOutcome === FAILURE_OUTCOME.listingCorrectionRequired,
            cancelAuction: active && !listing.recoveryOnly && transaction.bidHistory.length > 0,
            cancelPurchase: transactionStore.canCancelUnstartedPurchase(listingId, userId),
            watcherCount: userService.getUsers().filter(user => userService.getWatchlist(user.id).has(listingId)).length,
            bidCount: listing.bidCount
        };
    }

    function saveSubmission(submission, images = null) {
        const submissions = loadSellerSubmissions();
        const index = submissions.findIndex(item => item.id === submission.id);
        if (index < 0) submissions.push(submission);
        else submissions[index] = submission;
        if (!saveSellerSubmissions(submissions)) return false;
        const previous = listingStates.get(submission.listingId);
        const next = createPublishedSellerListing(submission, images || previous?.images || photoManager.resolveImages(submission));
        if (previous) {
            next.currentBid = previous.currentBid;
            next.bidCount = previous.bidCount;
        }
        listingStates.set(next.id, next);
        return true;
    }

    function instanceFields(listing, fields) {
        const source = getSubmission(listing);
        const timestamp = new Date(now()).toISOString();
        const id = `auction-${now()}-${Math.random().toString(36).slice(2)}`;
        return {
            ...(source || {}),
            id,
            listingId: `seller-${id}`,
            sellerUserId: listing.sellerUserId,
            title: listing.title,
            brandModel: listing.brandModel,
            category: listing.category,
            subcategory: listing.subcategory,
            condition: listing.conditionGrade,
            description: listing.description,
            location: listing.location,
            specifications: listing.specifications,
            fulfilmentMethod: listing.fulfilmentMethod,
            photoCount: source?.photoCount || listing.images?.length || 0,
            sourceListingId: rootId(listing),
            relistedFrom: listing.id,
            recoverySourceListingId: recoverySourceId(listing),
            correctionOf: listing.correctionOf || null,
            recoveryOnly: false,
            secondChanceOffer: null,
            previousBuyNowPrice: null,
            priceChangedAt: null,
            submittedAt: timestamp,
            publishedAt: timestamp,
            status: SUBMISSION_STATUS.published,
            rejectionReason: '',
            startingBid: fields.startingBid,
            bidIncrement: fields.bidIncrement,
            buyNowPrice: fields.buyNowPrice,
            listingFormat: Number.isSafeInteger(fields.buyNowPrice) ? LISTING_FORMAT.auctionAndBuyNow : LISTING_FORMAT.auction,
            reservePriceMode: fields.reservePriceMode,
            reservePrice: fields.reservePrice,
            auctionDurationHours: fields.auctionDurationHours,
            auctionEndsAt: new Date(now() + fields.auctionDurationHours * 3600000).toISOString()
        };
    }

    return {
        permissions,
        canUnpublish,
        eligibleBidders,
        offerStatus,
        getMismatchReason(listingId) {
            return transactionStore.get(listingId).mismatchReason;
        },
        isPublicListing(listing) {
            const outcome = listing.recoveryStatus || transactionStore.get(listing.id).failureOutcome;
            return !listing.secondChanceOffer && !listing.recoveryOnly
                && !Object.values(FAILURE_OUTCOME).includes(outcome);
        },
        syncRecoveryStatus(listingId) {
            const listing = listingStates.get(listingId);
            if (!listing) return false;
            const outcome = transactionStore.get(listingId).failureOutcome;
            if (listing.recoveryStatus === outcome) return true;
            const submission = getSubmission(listing);
            if (!submission) {
                listing.recoveryStatus = outcome;
                return true;
            }
            const submissions = loadSellerSubmissions();
            const saved = submissions.find(item => item.id === submission.id);
            if (!saved) return false;
            if (outcome) saved.recoveryStatus = outcome;
            else delete saved.recoveryStatus;
            if (!saveSellerSubmissions(submissions)) return false;
            listing.recoveryStatus = outcome;
            return true;
        },
        confirmAvailability(listingId, isAvailable) {
            const allowed = permissions(listingId);
            if (!allowed.confirmAvailability) return fail('Seller availability is not awaiting confirmation.');
            const transaction = transactionStore.confirmSellerAvailability(listingId, isAvailable);
            if (!transaction) return fail('This browser could not save the availability decision.', SERVICE_ERROR_CODE.storageFailed);
            this.syncRecoveryStatus(listingId);
            const listing = listingStates.get(listingId);
            if (isAvailable) {
                notificationService.create({
                    dedupeKey: `availability-confirmed:${listingId}`,
                    recipientUserId: listing.sellerUserId,
                    title: 'Availability confirmed',
                    message: 'Review the price, fulfilment and auction duration before offering the item again.',
                    listingId
                });
                notifyRelistWhenExhausted(listingId);
            }
            return { ok: true, data: transaction };
        },
        submitCorrection(listingId, fields, photos = []) {
            const listing = listingStates.get(listingId);
            const allowed = permissions(listingId);
            if (!allowed.correctListing || !listing) return fail('This listing does not require a seller correction.');
            const transaction = transactionStore.get(listingId);
            const source = getSubmission(listing);
            const base = source || {
                id: listing.sellerSubmissionId || `correction-source-${listing.id}`,
                listingId: listing.id,
                sellerUserId: listing.sellerUserId,
                title: listing.title,
                brandModel: listing.brandModel,
                category: listing.category,
                subcategory: listing.subcategory,
                condition: listing.conditionGrade,
                description: listing.description,
                location: listing.location,
                specifications: listing.specifications,
                fulfilmentMethod: listing.fulfilmentMethod,
                estimatedValue: listing.estimatedValue,
                listingFormat: listing.listingFormat,
                startingBid: Number.isSafeInteger(listing.startingBid) ? listing.startingBid : listing.currentBid,
                bidIncrement: listing.bidIncrement,
                buyNowPrice: listing.buyNowPrice,
                reservePriceMode: listing.reservePriceMode || RESERVE_PRICE_MODE.none,
                reservePrice: Number.isSafeInteger(listing.reservePrice) ? listing.reservePrice : null,
                auctionDurationHours: listing.auctionDurationHours || DEFAULT_AUCTION_DURATION_HOURS,
                photoCount: listing.images?.length || 0,
                sourceListingId: rootId(listing)
            };
            const changes = [];
            const correctionId = `correction-${now()}-${Math.random().toString(36).slice(2)}`;
            const next = {
                ...base,
                id: correctionId,
                listingId: `seller-${correctionId}`,
                status: SUBMISSION_STATUS.pendingReview,
                submittedAt: new Date(now()).toISOString(),
                publishedAt: null,
                rejectionReason: '',
                correctionOf: listing.id,
                recoverySourceListingId: recoverySourceId(listing),
                recoveryOnly: true,
                correctionReason: transaction.mismatchReason || INSPECTION_REJECTION_REASON.otherMaterialMismatch,
                sellerAcknowledged: fields.sellerAcknowledged === true,
                correctionChanges: [],
                sourceListingId: rootId(listing),
                relistedFrom: listing.id,
                secondChanceOffer: null,
                auctionEndsAt: ''
            };
            const editableFields = ['title', 'brandModel', 'condition', 'description'];
            editableFields.forEach(field => {
                if (typeof fields[field] === 'string' && fields[field].trim() !== String(base[field] || '').trim()) {
                    next[field] = fields[field].trim();
                    changes.push(field);
                }
            });
            const specs = { ...(base.specifications || {}) };
            const editableSpecificationFields = new Set([
                'functionalStatus', 'knownDefects', 'includedAccessories',
                'serialModelInfo', 'activationLock', 'proofOfPurchase'
            ]);
            Object.entries(fields.specifications || {}).forEach(([key, value]) => {
                const previousValue = Array.isArray(specs[key]) ? specs[key].join(', ') : String(specs[key] || '');
                if (editableSpecificationFields.has(key) && typeof value === 'string'
                    && value.trim() !== previousValue.trim()) {
                    specs[key] = value.trim();
                    changes.push(key);
                }
            });
            next.specifications = specs;
            if (!Array.isArray(photos) || (photos.length && !validateSellerPhotos(photos).valid)) {
                return fail('Choose up to five image files for this browser session.', SERVICE_ERROR_CODE.invalidInput);
            }
            if (photos.length) {
                next.photoCount = photos.length;
                changes.push('photos');
            }
            next.correctionChanges = changes;
            if (!next.sellerAcknowledged || !changes.length || !validateSellerListing(next).valid) {
                return fail('Correct at least one relevant field, acknowledge accuracy, and provide valid listing details.', SERVICE_ERROR_CODE.invalidInput);
            }
            const submissions = loadSellerSubmissions();
            const previousSubmissions = submissions.map(item => ({ ...item }));
            submissions.push(next);
            const original = submissions.find(item => item.listingId === listing.id);
            if (original) {
                original.recoveryStatus = FAILURE_OUTCOME.blockedPendingReview;
                original.correctedListingId = next.listingId;
            }
            if (photos.length) photoManager.rememberFiles(next.id, photos);
            if (!saveSellerSubmissions(submissions)) {
                photoManager.releaseImage(next.id);
                return fail('This browser could not save the corrective version.', SERVICE_ERROR_CODE.storageFailed);
            }
            const marked = transactionStore.updateFailureOutcome(listing.id, FAILURE_OUTCOME.blockedPendingReview, { relistEligible: false });
            if (!marked) {
                saveSellerSubmissions(previousSubmissions);
                return fail('This browser could not record the corrective review status.', SERVICE_ERROR_CODE.storageFailed);
            }
            notificationService.create({
                dedupeKey: `correction-submitted:${next.id}`,
                recipientUserId: next.sellerUserId,
                title: 'Corrected listing submitted',
                message: 'The corrected version is awaiting Admin review. The earlier listing remains unavailable.',
                listingId: listing.id
            });
            notificationService.create({
                dedupeKey: `correction-review:${next.id}`,
                recipientUserId: DEFAULT_DEMO_USER_ID,
                title: 'Corrective review awaiting action',
                message: `A corrected version of ${listing.title} is awaiting review.`,
                listingId: listing.id
            });
            return { ok: true, data: next };
        },
        reviewCorrection(submissionId, approve, reason = '') {
            const submissions = loadSellerSubmissions();
            const previousSubmissions = submissions.map(item => ({ ...item }));
            const submission = submissions.find(item => item.id === submissionId
                && item.status === SUBMISSION_STATUS.pendingReview && item.correctionOf);
            if (!submission || typeof approve !== 'boolean'
                || (!approve && (!reason.trim() || reason.trim().length > 200))) {
                return fail('Corrective review is no longer available or needs a concise rejection reason.', SERVICE_ERROR_CODE.invalidInput);
            }
            const listingId = submission.correctionOf;
            const nextStatus = approve ? SUBMISSION_STATUS.published : SUBMISSION_STATUS.rejected;
            submission.status = nextStatus;
            submission.rejectionReason = approve ? '' : reason.trim();
            submission.publishedAt = approve ? new Date(now()).toISOString() : null;
            if (approve) submission.auctionEndsAt = new Date(now() + (submission.auctionDurationHours || DEFAULT_AUCTION_DURATION_HOURS) * 3600000).toISOString();
            const original = submissions.find(item => item.listingId === listingId);
            if (original) {
                original.recoveryStatus = approve ? FAILURE_OUTCOME.eligibleForSecondChance : FAILURE_OUTCOME.blockedPendingReview;
                original.correctedListingId = submission.listingId;
            }
            if (!saveSellerSubmissions(submissions)) return fail('This browser could not save the review decision.', SERVICE_ERROR_CODE.storageFailed);
            const outcome = transactionStore.updateFailureOutcome(listingId,
                approve ? FAILURE_OUTCOME.eligibleForSecondChance : FAILURE_OUTCOME.blockedPendingReview,
                { relistEligible: approve, failureReason: approve ? '' : reason.trim(), admin: true });
            if (!outcome) {
                saveSellerSubmissions(previousSubmissions);
                return fail('This browser could not save the recovery decision.', SERVICE_ERROR_CODE.storageFailed);
            }
            const resolved = { status: nextStatus, submission, listingId: submission.listingId };
            notificationService.create({
                dedupeKey: `corrective-review:${submission.id}:${nextStatus}`,
                recipientUserId: submission.sellerUserId,
                title: approve ? 'Corrected listing approved' : 'Corrected listing rejected',
                message: approve
                    ? 'The corrected version passed completeness review. Eligible prior bidders are considered before relisting.'
                    : `The corrected version is unavailable.${submission.rejectionReason ? ` ${submission.rejectionReason}` : ''}`,
                listingId: submission.listingId
            });
            return { ok: true, data: resolved };
        },
        cancelAuction(listingId, reason = '') {
            if (!permissions(listingId).manage) return fail('This auction cannot be withdrawn now.');
            const transaction = transactionStore.cancelSellerAuction(listingId, reason);
            if (!transaction) return fail('This browser could not record the seller cancellation.', SERVICE_ERROR_CODE.invalidTransition);
            this.syncRecoveryStatus(listingId);
            return { ok: true, data: transaction };
        },
        getOfferActions(listingId, userId = userService.getCurrentUser().id) {
            const listing = listingStates.get(listingId);
            return listing?.secondChanceOffer?.buyerUserId === userId && offerStatus(listing) === SECOND_CHANCE_OFFER_STATUS.pending
                && transactionStore.canAcceptSecondChance(listingId, userId)
                ? ['accept-offer', 'decline-offer'] : [];
        },
        update(listingId, fields, { lowerOnly = false } = {}) {
            const allowed = permissions(listingId);
            if (lowerOnly ? !allowed.lowerBuyNow : !allowed.edit) return fail('This auction can no longer be edited.');
            const listing = listingStates.get(listingId);
            const submission = getSubmission(listing);
            if (!submission) return fail('Seller record not found.');
            if (!lowerOnly && fields.bidIncrement !== undefined && fields.bidIncrement !== submission.bidIncrement
                && !config.sellerBidIncrements.includes(fields.bidIncrement)) {
                return fail('Choose an available bid increment.', SERVICE_ERROR_CODE.invalidInput);
            }
            const next = lowerOnly ? { ...submission, buyNowPrice: fields.buyNowPrice } : {
                ...submission,
                title: fields.title,
                brandModel: fields.brandModel,
                description: fields.description,
                location: fields.location,
                startingBid: fields.startingBid,
                bidIncrement: fields.bidIncrement ?? submission.bidIncrement,
                buyNowPrice: fields.buyNowPrice,
                reservePriceMode: fields.reservePriceMode,
                reservePrice: fields.reservePrice,
                auctionDurationHours: fields.auctionDurationHours
            };
            if (!validateSellerListing(next).valid) return fail('Enter complete details and valid whole-rupee prices, reserve, and duration.', SERVICE_ERROR_CODE.invalidInput);
            if (lowerOnly && (next.buyNowPrice >= listing.buyNowPrice || next.buyNowPrice <= listing.currentBid)) {
                return fail('The new Buy Now price must be lower than its previous price and above the current bid.');
            }
            if (Number.isSafeInteger(next.buyNowPrice) && Number.isSafeInteger(listing.buyNowPrice) && next.buyNowPrice < listing.buyNowPrice) {
                next.previousBuyNowPrice = listing.buyNowPrice;
                next.priceChangedAt = new Date(now()).toISOString();
            }
            if (!lowerOnly) next.auctionEndsAt = new Date(Date.parse(next.publishedAt) + next.auctionDurationHours * 3600000).toISOString();
            if (Date.parse(next.auctionEndsAt) <= now()) return fail('That duration would already have ended. Choose a longer duration.');
            if (!saveSubmission(next)) return fail('This browser could not save the listing.', SERVICE_ERROR_CODE.storageFailed);
            if (!lowerOnly) listingStates.get(listingId).currentBid = next.startingBid;
            return { ok: true, data: listingStates.get(listingId) };
        },
        endEarly(listingId) {
            if (!permissions(listingId).endEarly) return fail('Only a live seller auction with no bids can end early.');
            const transaction = biddingService.endAuction(listingId);
            return transaction ? { ok: true, data: transaction } : fail('This browser could not end the auction.');
        },
        unpublish(listingId, { admin = false } = {}) {
            if (!(admin ? canUnpublish(listingId) : permissions(listingId).unpublish)) return fail('Cannot unpublish a listing with bids, an offer, an issue, or a buyer.');
            const listing = listingStates.get(listingId);
            const submissions = loadSellerSubmissions();
            const submission = submissions.find(item => item.id === listing.sellerSubmissionId);
            if (!submission) return fail('Seller record not found.');
            submission.status = SUBMISSION_STATUS.unpublished;
            if (!saveSellerSubmissions(submissions)) return fail('This browser could not save the change.');
            const withdrawn = transactionStore.withdrawSellerListing(listingId, { admin });
            if (!withdrawn) {
                submission.status = SUBMISSION_STATUS.published;
                saveSellerSubmissions(submissions);
                return fail('This browser could not record the pre-bid withdrawal.', SERVICE_ERROR_CODE.invalidTransition);
            }
            photoManager.releaseImage(submission.id);
            listingStates.delete(listingId);
            return { ok: true, data: submission };
        },
        relist(listingId, fields) {
            if (!permissions(listingId).relist) return fail('This outcome is not eligible for relisting or another auction/offer is still active.');
            if (!config.sellerBidIncrements.includes(fields.bidIncrement)) {
                return fail('Choose an available bid increment.', SERVICE_ERROR_CODE.invalidInput);
            }
            const listing = listingStates.get(listingId);
            const submission = instanceFields(listing, fields);
            if (!validateSellerListing(submission).valid) return fail('Enter valid starting, Buy Now and reserve prices, and auction duration.');
            photoManager.copyImages(listing.sellerSubmissionId, submission.id);
            if (!saveSubmission(submission, listing.images)) {
                photoManager.releaseImage(submission.id);
                return fail('This browser could not save the relisted auction.');
            }
            return { ok: true, data: listingStates.get(submission.listingId) };
        },
        createOffer(listingId, buyerUserId, price) {
            if (!permissions(listingId).secondChance) return fail('No eligible second-chance bidders are available.');
            const bidder = eligibleBidders(listingId).find(item => item.userId === buyerUserId);
            const nextBidder = eligibleBidders(listingId)[0];
            if (!bidder || !nextBidder || bidder.userId !== nextBidder.userId || price !== bidder.amount) {
                return fail('Offer the next eligible bidder at their final valid bid amount.');
            }
            const listing = listingStates.get(listingId);
            const submission = instanceFields(listing, {
                startingBid: price,
                bidIncrement: listing.bidIncrement,
                buyNowPrice: null,
                reservePriceMode: RESERVE_PRICE_MODE.none,
                reservePrice: null,
                auctionDurationHours: DEFAULT_AUCTION_DURATION_HOURS
            });
            submission.secondChanceOffer = {
                buyerUserId,
                price,
                status: SECOND_CHANCE_OFFER_STATUS.pending,
                expiresAt: new Date(now() + SECOND_CHANCE_OFFER_DURATION_MS).toISOString()
            };
            photoManager.copyImages(listing.sellerSubmissionId, submission.id);
            if (!saveSubmission(submission, listing.images)) {
                photoManager.releaseImage(submission.id);
                return fail('This browser could not save the offer.');
            }
            notificationService.create({
                dedupeKey: `offer:${submission.id}:created`, recipientUserId: buyerUserId,
                title: 'Second-chance offer',
                message: `${listing.correctionOf ? 'Listing details were corrected after the previous transaction. ' : ''}Review the local offer for ${listing.title} and its current disclosures before accepting.`,
                listingId: submission.listingId
            });
            return { ok: true, data: listingStates.get(submission.listingId) };
        },
        respondToOffer(listingId, response) {
            if (!this.getOfferActions(listingId).includes(`${response}-offer`)) return fail('This offer is no longer available to you.');
            const listing = listingStates.get(listingId);
            if (response === 'accept') {
                if (!transactionStore.acceptSecondChance(listingId)) return fail('This browser could not accept the offer.');
            } else {
                const submission = getSubmission(listing);
                if (!submission) return fail('Offer record not found.');
                submission.secondChanceOffer = { ...submission.secondChanceOffer, status: SECOND_CHANCE_OFFER_STATUS.declined };
                if (!saveSubmission(submission)) return fail('This browser could not decline the offer.');
            }
            notificationService.create({
                dedupeKey: `offer:${listingId}:${response}`, recipientUserId: listing.sellerUserId,
                title: response === 'accept' ? 'Offer accepted' : 'Offer declined',
                message: `${listing.title}: the buyer ${response === 'accept' ? 'accepted and has 6 hours to confirm purchase' : 'declined'}.`,
                listingId
            });
            if (response === 'decline') {
                const source = listingStates.get(recoverySourceId(listing));
                if (source) notifyRelistWhenExhausted(source.id);
            }
            return { ok: true, data: listingStates.get(listingId) };
        },
        cancelPurchase(listingId, reason = '') {
            const transaction = transactionStore.cancelUnstartedPurchase(listingId, reason);
            if (!transaction) return fail('This purchase cannot be cancelled at its current stage.');
            this.syncRecoveryStatus(listingId);
            const listing = listingStates.get(listingId);
            [transaction.buyerUserId, transaction.sellerUserId].forEach(recipientUserId => notificationService.create({
                dedupeKey: `cancel-early:${listingId}`, recipientUserId,
                title: 'Purchase cancelled', message: `${listing.title}: the prototype outcome is ${transaction.depositOutcome || 'no deposit was collected'}. No money moved.`, listingId
            }));
            return { ok: true };
        },
        syncOffers() {
            listingStates.forEach(listing => {
                if (offerStatus(listing) !== SECOND_CHANCE_OFFER_STATUS.expired) return;
                [listing.sellerUserId, listing.secondChanceOffer.buyerUserId].forEach(recipientUserId => notificationService.create({
                    dedupeKey: `offer:${listing.id}:expired`, recipientUserId,
                    title: 'Second-chance offer expired', message: `${listing.title}: this local offer has closed.`, listingId: listing.id
                }));
                const source = listingStates.get(recoverySourceId(listing));
                if (source) notifyRelistWhenExhausted(source.id);
            });
            listingStates.forEach(listing => {
                if (listing.recoverySourceListingId || listing.secondChanceOffer) return;
                notifyRelistWhenExhausted(listing.id);
            });
        }
    };
}
