import { LISTING_FORMAT, DISPUTE_REASON_LABELS, DISPUTE_RESOLUTION, DISPUTE_RESOLUTION_LABELS, DISPUTE_STATUS, FAILURE_OUTCOME, MEETUP_ATTENDANCE_STATUS, PURCHASE_SOURCE, SECOND_CHANCE_OFFER_STATUS, SUBMISSION_STATUS, SUBMISSION_STATUS_LABELS, TRANSACTION_EVENT, TRANSACTION_STATUS } from '../core/constants.js';
import { formatCurrency, localDateValue } from '../core/formatting.js';
import { loadSellerSubmissions } from './submission-service.js';
import { getTransactionTimeline, transactionStatusLabel } from './transaction-service.js';

function createGroups() {
    return {
        needsAttention: [],
        activeBids: [],
        wonAuctions: [],
        watchlist: [],
        purchases: [],
        buyerMeetups: [],
        activeListings: [],
        pendingReview: [],
        sellerMeetups: [],
        completedSales: [],
        openIssues: [],
        resolvedIssues: [],
        history: [],
        offers: []
    };
}

const LISTING_FORMAT_LABELS = Object.freeze({
    [LISTING_FORMAT.auction]: 'Auction',
    [LISTING_FORMAT.auctionAndBuyNow]: 'Auction + Buy Now',
    [LISTING_FORMAT.buyNow]: 'Buy Now'
});

export function createActivityService({ listingStates, transactionStore, userService, disputeService, ratingService, biddingService, auctionManagement, watchlistService, notificationService }) {
    function getPrimaryAction(listingId, userId = userService.getCurrentUser().id) {
        const listing = listingStates.get(listingId);
        if (!listing) return null;
        const transaction = transactionStore.get(listingId);
        const action = (type, label) => ({ action: type, actionLabel: label });
        if (transactionStore.isPaused(listingId)) return action('view', 'View issue');
        if (auctionManagement.permissions(listingId, userId).confirmAvailability) {
            return action('confirm-availability', 'Confirm item availability');
        }
        if (auctionManagement.permissions(listingId, userId).correctListing) {
            return action('correct-listing', 'Correct listing details');
        }
        if (transaction.buyerUserId === userId && transaction.status === TRANSACTION_STATUS.auctionWon) {
            return action('continue-buyer', 'Confirm purchase');
        }
        if (transaction.buyerUserId === userId && transaction.status === TRANSACTION_STATUS.tokenCompleted) {
            return action('continue-buyer', 'Choose handover');
        }
        if (transaction.fulfilmentPath === 'simple_collection'
            && [TRANSACTION_STATUS.simpleCollectionRequested, TRANSACTION_STATUS.sellerHandoverConfirmed].includes(transaction.status)) {
            if (transaction.sellerUserId === userId) {
                return transaction.status === TRANSACTION_STATUS.simpleCollectionRequested
                    ? action('seller-handover', 'Confirm handover') : action('view', 'Waiting for buyer receipt');
            }
            return action('continue-buyer', 'Confirm receipt');
        }
        if (ratingService.canRate(listingId, userId)) {
            return action(transaction.buyerUserId === userId ? 'rate-seller' : 'rate-buyer',
                transaction.buyerUserId === userId ? 'Rate seller' : 'Rate buyer');
        }
        if (auctionManagement.getOfferActions(listingId, userId).length) return action('accept-offer', 'Review second-chance offer');
        if (transactionStore.canPerform(listingId, TRANSACTION_EVENT.sellerHandover, {}, userId)) return action('seller-handover', 'Confirm handover');
        if (transactionStore.canContinueShipping(listingId, userId)) {
            return action('continue-shipping', transaction.status === TRANSACTION_STATUS.shippingRequested ? 'Simulate dispatch' : 'View shipping');
        }
        if (transactionStore.canResumeBuyer(listingId, userId)) {
            const meetup = transactionStore.getLatestMeetup(listingId);
            if ([TRANSACTION_STATUS.meetupRequested, TRANSACTION_STATUS.inspectionPending].includes(transaction.status)
                && meetup && !transactionStore.canStartInspection(meetup.id)) return action('view-meetup', 'View meetup');
            const label = transaction.status === TRANSACTION_STATUS.meetupRequested
                ? meetup && transactionStore.canStartInspection(meetup.id) ? 'Start inspection' : 'View meetup'
                : transaction.status === TRANSACTION_STATUS.inspectionPending ? 'Start inspection'
                    : 'Continue purchase';
            return action('continue-buyer', label);
        }
        if (transaction.sellerUserId === userId && transaction.status === TRANSACTION_STATUS.meetupRequested
            && transactionStore.getLatestMeetup(listingId)) return action('view-meetup', 'View meetup');
        const allowed = auctionManagement.permissions(listingId, userId);
        if (allowed.secondChance) return action('second-chance', 'Offer next eligible bidder');
        if (allowed.relist) return action('relist', 'Relist');
        if (allowed.manage || allowed.edit || allowed.lowerBuyNow || allowed.endEarly || allowed.secondChance || allowed.cancelPurchase) return action('manage', 'Manage auction');
        if (listing.sellerUserId === userId) return action('view', 'View listing');
        if (biddingService.canBid(listingId)) return action('bid', 'Place bid');
        const relisted = watchlistService.latestRelist(listing);
        if (relisted) return { ...action('view-relist', 'View relisted auction'), targetListingId: relisted.id };
        return action('view', 'View listing');
    }
    function transactionActivityStatus(listing, transaction) {
        if (transactionStore.isPaused(listing.id)) return 'Transaction paused while this issue is reviewed.';
        const dispute = disputeService.getLatestForListing(listing.id);
        if (dispute?.resolution && dispute.resolution !== DISPUTE_RESOLUTION.noAction) {
            return `Issue resolved · ${DISPUTE_RESOLUTION_LABELS[dispute.resolution]}`;
        }
        return transactionStatusLabel(transaction);
    }

    function createActivityRow(listing, status, actionLabel = '', action = null) {
        return { listing, status, actionLabel, action };
    }

    function createMeetupRow(meetup, transaction, userId) {
        const listing = listingStates.get(meetup.listingId) || { id: meetup.listingId, title: meetup.itemTitle };
        const attendanceStatus = (participantId) => {
            const status = meetup.attendance?.[participantId]?.status || MEETUP_ATTENDANCE_STATUS.pending;
            const participant = userService.getUser(participantId);
            if (status === MEETUP_ATTENDANCE_STATUS.arrived) return `${participant?.firstName || 'Participant'} arrived`;
            if (status === MEETUP_ATTENDANCE_STATUS.noShow) return `${participant?.firstName || 'Participant'} did not attend`;
            return `${participant?.firstName || 'Participant'} pending`;
        };
        const scheduledAt = new Date(`${meetup.date}T${meetup.time}`).getTime();
        const paused = transactionStore.isPaused(meetup.listingId);
        const date = meetup.date === localDateValue()
            ? 'today'
            : Number.isFinite(scheduledAt)
                ? new Date(scheduledAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
                : 'time unavailable';
        const status = paused
            ? 'Transaction paused while this issue is reviewed.'
            : meetup.noShowReport
                ? transactionStatusLabel(transaction)
                : `Meetup ${date} · ${meetup.time} · ${meetup.location.split(',')[0]} · ${attendanceStatus(transaction.buyerUserId)} · ${attendanceStatus(transaction.sellerUserId)}`;
        const actions = [];

        if (transactionStore.canRecordMeetupAttendance(meetup.id, MEETUP_ATTENDANCE_STATUS.arrived)) {
            actions.push({ type: 'record-arrived', label: 'I arrived' });
            actions.push({ type: 'record-no-show', label: 'Could not attend' });
        } else if (transactionStore.canReportMeetupNoShow(meetup.id)) {
            actions.push({
                type: 'report-no-show',
                label: userId === transaction.buyerUserId ? 'Report seller no-show' : 'Report buyer no-show'
            });
        }
        if (transactionStore.canStartInspection(meetup.id) && transaction.status === TRANSACTION_STATUS.meetupRequested) {
            actions.push({ type: 'continue-inspection', label: 'Continue inspection' });
        }

        return {
            listing,
            meetup,
            status,
            actions
        };
    }

    function getForUser(userId) {
        const groups = createGroups();
        const user = userService.getUser(userId);
        if (!user) return { user: null, groups };

        const listings = Array.from(listingStates.values());
        const transactions = listings.map(listing => [listing, transactionStore.get(listing.id)]);
        const userBids = transactions.filter(([, transaction]) => transaction.status === TRANSACTION_STATUS.auctionActive
            && transaction.bidHistory.some(bid => bid.bidderUserId === userId));
        const wins = transactions.filter(([, transaction]) => transaction.purchaseSource === PURCHASE_SOURCE.auctionWinner
            && transaction.buyerUserId === userId);
        const purchases = transactions.filter(([, transaction]) => transaction.buyerUserId === userId
            && (transaction.purchaseSource === PURCHASE_SOURCE.buyNow || transaction.status === TRANSACTION_STATUS.completed));
        const activeListings = listings.filter(listing => listing.sellerUserId === userId
            && transactionStore.get(listing.id).status !== TRANSACTION_STATUS.completed);
        const submissions = loadSellerSubmissions().filter(submission => submission.sellerUserId === userId);
        const completedSales = transactions.filter(([, transaction]) => transaction.sellerUserId === userId
            && transaction.status === TRANSACTION_STATUS.completed);
        const userMeetups = transactionStore.getMeetupsForUser(userId);
        listings.filter(listing => listing.secondChanceOffer
            && [listing.sellerUserId, listing.secondChanceOffer.buyerUserId].includes(userId)).forEach(listing => {
            const offer = listing.secondChanceOffer;
            const status = auctionManagement.offerStatus(listing);
            groups.offers.push(createActivityRow(listing,
                `${status === SECOND_CHANCE_OFFER_STATUS.pending ? 'Offer available' : `Offer ${status}`}${Number.isSafeInteger(offer.price) ? ` · ${formatCurrency(offer.price)}` : ''}${offer.expiresAt ? ` · Expires ${new Date(offer.expiresAt).toLocaleString()}` : ''}`,
                'View offer', 'view'));
        });

        userBids.forEach(([listing, transaction]) => {
            const ownBids = transaction.bidHistory.filter(bid => bid.bidderUserId === userId);
            const highestOwnBid = Math.max(...ownBids.map(bid => bid.amount));
            groups.activeBids.push(createActivityRow(listing, `Your bid ${formatCurrency(highestOwnBid)} · ${biddingService.getBidFeedback(listing.id, userId)}`, 'View', 'view'));
        });
        wins.forEach(([listing, transaction]) => {
            const paused = transactionStore.isPaused(listing.id);
            const canContinue = transactionStore.canResumeBuyer(listing.id, userId);
            groups.wonAuctions.push(createActivityRow(
                listing,
                transactionActivityStatus(listing, transaction),
                paused ? 'Paused' : canContinue ? 'Continue' : 'View',
                canContinue && !paused ? 'continue-buyer' : 'view'
            ));
        });
        userService.getWatchlist(userId).forEach(listingId => {
            const listing = listingStates.get(listingId);
            if (listing) groups.watchlist.push(createActivityRow(listing, watchlistService.getIndicators(listingId, userId).join(' · ') || 'Saved item', 'View', 'view'));
        });
        purchases.forEach(([listing, transaction]) => {
            const paused = transactionStore.isPaused(listing.id);
            let actionLabel = 'Continue';
            let action = 'continue-buyer';
            if (paused) {
                actionLabel = 'Paused';
                action = 'view';
            } else if (transaction.status === TRANSACTION_STATUS.completed) {
                const rating = ratingService.getRating(listing.id, userId);
                actionLabel = ratingService.canRate(listing.id, userId)
                    ? 'Rate seller'
                    : rating ? `Rated ${rating.score}★` : 'View';
                action = actionLabel === 'Rate seller' ? 'rate-seller' : rating ? null : 'view';
            } else if (!transactionStore.canResumeBuyer(listing.id, userId)
                || [TRANSACTION_STATUS.cancelled, TRANSACTION_STATUS.itemRejected].includes(transaction.status)) {
                actionLabel = 'View';
                action = 'view';
            }
            groups.purchases.push(createActivityRow(listing, transactionActivityStatus(listing, transaction), actionLabel, action));
        });
        userMeetups.forEach(meetup => {
            const transaction = transactionStore.get(meetup.listingId);
            if (transaction.status !== TRANSACTION_STATUS.meetupRequested) return;
            if (transaction.buyerUserId === userId) groups.buyerMeetups.push(createMeetupRow(meetup, transaction, userId));
            if (transaction.sellerUserId === userId) groups.sellerMeetups.push(createMeetupRow(meetup, transaction, userId));
        });
        activeListings.forEach(listing => {
            const transaction = transactionStore.get(listing.id);
            const paused = transactionStore.isPaused(listing.id);
            const canConfirmHandover = transactionStore.canPerform(listing.id, TRANSACTION_EVENT.sellerHandover, {}, userId);
            const canContinueShipping = transactionStore.canContinueShipping(listing.id, userId);
            groups.activeListings.push(createActivityRow(
                listing,
                paused ? 'Transaction paused while this issue is reviewed.' : transactionStatusLabel(transaction),
                paused ? 'Paused' : canConfirmHandover ? 'Seller handover' : canContinueShipping ? 'Continue shipping' : 'View',
                paused ? 'view' : canConfirmHandover ? 'seller-handover' : canContinueShipping ? 'continue-shipping' : 'view'
            ));
        });
        submissions.filter(submission => submission.status === SUBMISSION_STATUS.pendingReview)
            .forEach(submission => groups.pendingReview.push(createActivityRow(submission, SUBMISSION_STATUS_LABELS[submission.status])));
        completedSales.forEach(([listing, transaction]) => {
            const canRateBuyer = ratingService.canRate(listing.id, userId);
            const rating = ratingService.getRating(listing.id, userId);
            groups.completedSales.push(createActivityRow(
                listing,
                transactionActivityStatus(listing, transaction),
                canRateBuyer ? 'Rate buyer' : rating ? `Rated ${rating.score}★` : 'View',
                canRateBuyer ? 'rate-buyer' : rating ? null : 'view'
            ));
        });

        transactions.forEach(([listing, transaction]) => {
            const meetup = transactionStore.getLatestMeetup(listing.id);
            const latestDispute = disputeService.getLatestForListing(listing.id);
            const terminal = [TRANSACTION_STATUS.completed, TRANSACTION_STATUS.cancelled, TRANSACTION_STATUS.itemRejected].includes(transaction.status);
            const resolvedIssue = latestDispute?.status === DISPUTE_STATUS.resolved;
            if (transactionStore.isPaused(listing.id) || (!terminal && !resolvedIssue)) return;
            const isBuyer = transaction.buyerUserId === userId;
            const isSeller = transaction.sellerUserId === userId;
            if (!isBuyer && !isSeller) return;
            const counterpartyId = isBuyer ? transaction.sellerUserId : transaction.buyerUserId;
            const completed = transaction.status === TRANSACTION_STATUS.completed;
            const cancelled = [TRANSACTION_STATUS.cancelled, TRANSACTION_STATUS.itemRejected].includes(transaction.status);
            const dateValue = transaction.completedAt
                || transaction.cancelledAt
                || meetup?.noShowReport?.reportedAt
                || latestDispute?.resolvedAt
                || latestDispute?.createdAt
                || meetup?.createdAt;
            const rating = ratingService.getRating(listing.id, userId);
            const row = createActivityRow(listing, '', 'View transaction', 'view');
            groups.history.push(Object.assign(row, {
                role: isBuyer ? 'Buyer' : 'Seller',
                amount: completed || transaction.transactionPrice || transaction.winningBid
                    ? transaction.transactionPrice ?? transaction.winningBid ?? listing.currentBid : null,
                outcome: latestDispute?.resolution && resolvedIssue
                    ? `Issue resolved · ${DISPUTE_RESOLUTION_LABELS[latestDispute.resolution]}`
                    : transactionStatusLabel(transaction),
                counterparty: userService.getUser(counterpartyId)?.firstName || 'Demo user',
                dateValue: Number.isFinite(Date.parse(dateValue)) ? dateValue : null,
                ratingStatus: completed ? rating ? `Rated ${rating.score}★` : 'Rating pending' : 'Not applicable',
                kinds: [
                    ...(completed && isBuyer ? ['purchases'] : []),
                    ...(completed && isSeller ? ['sales'] : []),
                    ...(cancelled ? ['cancelled'] : []),
                    ...(resolvedIssue ? ['resolved'] : [])
                ]
            }));
        });

        disputeService.getForUser(userId).forEach(dispute => {
            const listing = listingStates.get(dispute.listingId) || { id: dispute.listingId, title: dispute.listingId };
            const isOpen = dispute.status === DISPUTE_STATUS.open;
            const reason = DISPUTE_REASON_LABELS[dispute.reason] || 'Other';
            const status = isOpen
                ? `Transaction paused · ${reason}`
                : `Resolved · ${DISPUTE_RESOLUTION_LABELS[dispute.resolution] || 'No action'}`;
            groups[isOpen ? 'openIssues' : 'resolvedIssues'].push(createActivityRow(
                listing,
                status,
                listingStates.has(dispute.listingId) ? 'View' : '',
                listingStates.has(dispute.listingId) ? 'view' : null
            ));
        });

        ['activeBids', 'wonAuctions', 'watchlist', 'purchases', 'activeListings', 'completedSales', 'offers'].forEach(group => {
            groups[group].forEach(row => Object.assign(row, getPrimaryAction(row.listing.id, userId)));
        });
        groups.offers.forEach(row => {
            if (row.action === 'accept-offer') Object.assign(row, {
                action: 'view',
                actionLabel: row.listing.correctionOf ? 'Review corrected disclosures' : 'Review second-chance offer'
            });
        });
        const addAttention = (rows, predicate = () => true) => rows.forEach(row => {
            if (predicate(row) && !groups.needsAttention.some(item => item.listing.id === row.listing.id)) {
                groups.needsAttention.push(row);
            }
        });
        addAttention(groups.activeBids, row => row.status.includes('outbid') && !biddingService.isAuctionExpired(row.listing.id));
        addAttention(groups.wonAuctions, row => row.action === 'continue-buyer');
        addAttention(groups.offers, row => row.listing.secondChanceOffer?.buyerUserId === userId && ['Review corrected disclosures', 'Review second-chance offer'].includes(row.actionLabel));
        addAttention(groups.buyerMeetups, row => row.actions.length > 0);
        addAttention(groups.purchases, row => row.action === 'continue-buyer' || row.action === 'rate-seller');
        addAttention(groups.activeListings, row => ['seller-handover', 'continue-shipping', 'confirm-availability', 'correct-listing'].includes(row.action));
        addAttention(groups.sellerMeetups, row => row.actions.length > 0);
        addAttention(groups.openIssues);
        addAttention(groups.completedSales, row => row.action === 'rate-buyer');
        // Optional seller actions (relist, second-chance offers) stay in Selling; only blocking ones need attention.
        transactions.forEach(([listing, transaction]) => {
            if (transaction.sellerUserId !== userId || !listingStates.has(listing.id)) return;
            const primary = getPrimaryAction(listing.id, userId);
            if (!['confirm-availability', 'correct-listing'].includes(primary?.action)) return;
            if (groups.needsAttention.some(row => row.listing.id === listing.id)) return;
            groups.needsAttention.push(createActivityRow(
                listing,
                primary.action === 'correct-listing'
                    ? 'Listing correction required before any offer or relisting.'
                    : 'Confirm whether the item is still available before offering it again.',
                primary.actionLabel,
                primary.action
            ));
        });
        const sellerListings = listings.filter(listing => listing.sellerUserId === userId);
        const sold = transactions.filter(([listing, transaction]) => listing.sellerUserId === userId && transaction.status === TRANSACTION_STATUS.completed).length;
        const lineages = new Map();
        sellerListings.forEach(listing => {
            const root = listing.sourceListingId || listing.id;
            if (!lineages.has(root)) lineages.set(root, []);
            lineages.get(root).push(listing);
        });
        let soldProducts = 0;
        let concludedProducts = 0;
        lineages.forEach(instances => {
            const completed = instances.some(listing => transactionStore.get(listing.id).status === TRANSACTION_STATUS.completed);
            const ongoing = instances.some(listing => {
                const transaction = transactionStore.get(listing.id);
                if (listing.secondChanceOffer && auctionManagement.offerStatus(listing) === SECOND_CHANCE_OFFER_STATUS.pending) return true;
                if (listing.secondChanceOffer && auctionManagement.offerStatus(listing) !== SECOND_CHANCE_OFFER_STATUS.accepted) return false;
                return transaction.status === TRANSACTION_STATUS.auctionActive
                    || (transaction.buyerUserId && ![TRANSACTION_STATUS.completed, TRANSACTION_STATUS.cancelled, TRANSACTION_STATUS.itemRejected].includes(transaction.status));
            });
            if (completed) soldProducts += 1;
            if (completed || !ongoing) concludedProducts += 1;
        });
        const reputation = ratingService.getReputation(userId);
        const sellerSummary = {
            activeListings: sellerListings.filter(listing => !listing.secondChanceOffer && transactionStore.get(listing.id).status === TRANSACTION_STATUS.auctionActive && !biddingService.isAuctionExpired(listing.id)).length,
            soldItems: sold,
            sellThroughRate: concludedProducts ? Math.round(soldProducts / concludedProducts * 100) : 0,
            averageRating: reputation.sellerRating,
            openDisputes: disputeService.getForUser(userId).filter(dispute => dispute.sellerUserId === userId && dispute.status === DISPUTE_STATUS.open).length
        };

        const live = listing => transactionStore.get(listing.id).status === TRANSACTION_STATUS.auctionActive
            && !biddingService.isAuctionExpired(listing.id);
        const withCard = row => Object.assign(row, {
            currentBid: row.listing.currentBid,
            bidCount: row.listing.bidCount,
            endsAt: row.listing.auctionEndsAt,
            live: live(row.listing),
            format: LISTING_FORMAT_LABELS[row.listing.listingFormat] || 'Auction'
        });
        const withTimeline = row => {
            const transaction = transactionStore.get(row.listing.id);
            const listing = listingStates.get(row.listing.id);
            row.timeline = listing && transaction.purchaseSource
                ? getTransactionTimeline(transaction, listing.fulfilmentMethod, { issueOpen: transactionStore.isPaused(listing.id) }) : [];
            return row;
        };
        const uniqueByListing = rows => rows.filter((row, index) => rows.findIndex(other => other.listing.id === row.listing.id) === index);

        const activeBids = groups.activeBids.map(row => {
            const leading = biddingService.getBidFeedback(row.listing.id, userId) === 'Your bid is leading';
            const auto = userId === userService.getCurrentUser().id ? biddingService.getAutoBid(row.listing.id) : null;
            const canBid = biddingService.canBid(row.listing.id);
            const privateMax = auto?.enabled ? auto.maxAmount : null;
            return withCard(Object.assign(row, {
                leading,
                privateMax,
                action: !leading && canBid ? 'bid' : 'view',
                actionLabel: leading ? 'View listing' : canBid ? (privateMax ? 'Increase maximum' : 'Place next bid') : 'View listing'
            }));
        });
        const buying = {
            activeBids,
            purchases: uniqueByListing([...groups.wonAuctions, ...groups.purchases]).map(withTimeline),
            offers: groups.offers.filter(row => row.listing.secondChanceOffer?.buyerUserId === userId)
        };

        const blockingSellerActions = ['confirm-availability', 'correct-listing', 'seller-handover', 'continue-shipping'];
        const optionalSellerActions = ['accept-offer', 'second-chance', 'relist'];
        const terminalStatuses = [TRANSACTION_STATUS.completed, TRANSACTION_STATUS.cancelled, TRANSACTION_STATUS.itemRejected];
        const hasSellerAction = row => blockingSellerActions.includes(row.action)
            || (!live(row.listing) && optionalSellerActions.includes(row.action));
        const needsSellerAction = [
            ...groups.activeListings.filter(hasSellerAction),
            ...groups.sellerMeetups.filter(row => row.actions.length),
            ...groups.openIssues.filter(row => listingStates.get(row.listing.id)?.sellerUserId === userId)
        ];
        const needsActionIds = new Set(needsSellerAction.map(row => row.listing.id));
        const remaining = groups.activeListings.filter(row => !needsActionIds.has(row.listing.id));
        const addWatchers = row => {
            row.watcherCount = auctionManagement.permissions(row.listing.id, userId).watcherCount ?? 0;
            return row;
        };
        const selling = {
            needsAction: uniqueByListing(needsSellerAction).map(row => row.actions ? row : withTimeline(withCard(row))),
            active: remaining.filter(row => live(row.listing)).map(row => addWatchers(withCard(withTimeline(row)))),
            inProgress: remaining.filter(row => {
                const transaction = transactionStore.get(row.listing.id);
                return !live(row.listing) && transaction.buyerUserId && !terminalStatuses.includes(transaction.status);
            }).map(row => addWatchers(withCard(withTimeline(row)))),
            inReview: groups.pendingReview,
            sold: groups.completedSales.map(withTimeline)
        };
        sellerSummary.activeListings = selling.active.length;

        // Ended listings with no buyer and no seller action are concluded; terminal transactions are already in history.
        const inProgressIds = new Set(selling.inProgress.map(row => row.listing.id));
        remaining.filter(row => !live(row.listing) && !inProgressIds.has(row.listing.id)
            && !terminalStatuses.includes(transactionStore.get(row.listing.id).status)
            && !groups.history.some(item => item.listing.id === row.listing.id)).forEach(row => {
            groups.history.push(Object.assign(createActivityRow(row.listing, '', 'View listing', 'view'), {
                role: 'Seller',
                amount: null,
                outcome: row.listing.bidCount ? 'Ended without a sale' : 'Ended with no bids',
                counterparty: 'None',
                dateValue: Number.isFinite(Date.parse(row.listing.auctionEndsAt)) ? row.listing.auctionEndsAt : null,
                ratingStatus: 'Not applicable',
                kinds: []
            }));
        });
        selling.needsAction.forEach(row => {
            if (!row.actions) addWatchers(row);
        });

        const watchlist = groups.watchlist.map(row => withCard(Object.assign(row, {
            indicators: watchlistService.getIndicators(row.listing.id, userId)
        })));

        const timestamp = Date.now();
        const upcoming = [];
        const addUpcoming = (label, listing, at, detail) => upcoming.push({ label, listing, at: Number.isFinite(Date.parse(at)) ? at : null, detail });
        activeBids.filter(row => row.live).forEach(row => addUpcoming('Auction ending', row.listing, row.endsAt, row.leading ? 'You are leading' : 'You have been outbid'));
        groups.activeListings.filter(row => live(row.listing)).forEach(row => addUpcoming('Your auction ends', row.listing, row.listing.auctionEndsAt, `${row.listing.bidCount} bids`));
        [...groups.buyerMeetups, ...groups.sellerMeetups].forEach(row => addUpcoming('Meetup scheduled', row.listing, `${row.meetup.date}T${row.meetup.time}`, row.meetup.location.split(',')[0]));
        groups.offers.filter(row => row.listing.secondChanceOffer?.buyerUserId === userId
            && auctionManagement.offerStatus(row.listing) === SECOND_CHANCE_OFFER_STATUS.pending)
            .forEach(row => addUpcoming('Offer expires', row.listing, row.listing.secondChanceOffer.expiresAt, 'Second-chance offer'));
        transactions.forEach(([listing, transaction]) => {
            if (transaction.buyerUserId === userId && transaction.status === TRANSACTION_STATUS.auctionWon) {
                addUpcoming('Confirm purchase by', listing, transaction.winnerResponseDeadline, 'Winner confirmation deadline');
            }
            if ([transaction.buyerUserId, transaction.sellerUserId].includes(userId)
                && [TRANSACTION_STATUS.shippingRequested, TRANSACTION_STATUS.shippingInTransit].includes(transaction.status)) {
                addUpcoming('Shipping update', listing, null, transactionStatusLabel(transaction));
            }
        });
        const dated = upcoming.filter(item => !item.at || Date.parse(item.at) >= timestamp);
        dated.sort((left, right) => (left.at ? Date.parse(left.at) : Infinity) - (right.at ? Date.parse(right.at) : Infinity));

        const recent = (notificationService?.getForUser(userId) || [])
            .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
            .slice(0, 4);
        const overview = { needsAttention: groups.needsAttention, upcoming: dated.slice(0, 6), recent };
        const history = groups.history.sort((left, right) => (Date.parse(right.dateValue) || 0) - (Date.parse(left.dateValue) || 0));
        return { user, groups, sellerSummary, overview, buying, selling, watchlist, history };
    }

    return { getForUser, getPrimaryAction };
}
