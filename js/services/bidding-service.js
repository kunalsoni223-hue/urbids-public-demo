import { config } from '../config.js';
import { AUCTION_RESERVE_OUTCOME, DEFAULT_DEMO_USER_ID, LISTING_FORMAT, RESERVE_PRICE_MODE, SERVICE_ERROR_CODE, STORAGE_KEYS, TRANSACTION_EVENT, TRANSACTION_STATUS } from '../core/constants.js';
import { readRecord, removeStoredValue, writeJSON } from '../core/storage.js';
import { formatCurrency } from '../core/formatting.js';
import { normalizeBidIncrement } from '../core/normalization.js';
import { getDemoUser } from '../data/demo-users.js';
import { loadAutoBids, planProxyBids, saveAutoBids } from './proxy-bidding.js';

export function getHighestValidBid(bidHistory) {
    if (!Array.isArray(bidHistory)) return null;
    return bidHistory.reduce((highest, bid) => {
        if (!bid
            || !Number.isSafeInteger(bid.amount)
            || bid.amount <= 0
            || !getDemoUser(bid.bidderUserId)) return highest;
        return !highest || bid.amount > highest.amount
            || (bid.amount === highest.amount && bid.tiePriority === true && highest.tiePriority !== true)
            ? bid : highest;
    }, null);
}

export function restoreBids(listingStates) {
    const initialBidState = new Map(Array.from(listingStates, ([listingId, listing]) => [listingId, {
        currentBid: listing.currentBid,
        bidCount: listing.bidCount,
        auctionEndsAt: listing.auctionEndsAt,
        fulfilmentMethod: listing.fulfilmentMethod
    }]));
    const auctionExtensionCounts = new Map();
    const savedBids = readRecord(STORAGE_KEYS.bids);
    listingStates.forEach(listing => {
        const saved = savedBids[listing.id];
        listing.bidIncrement = normalizeBidIncrement(listing.source === 'seller_submission'
            ? listing.bidIncrement : saved?.bidIncrement ?? (saved ? undefined : listing.bidIncrement),
            saved?.currentBid ?? listing.currentBid);
    });
    Object.entries(savedBids).forEach(([listingId, savedListing]) => {
        const listing = listingStates.get(listingId);
        if (listing?.source === 'seller_submission' && savedListing?.bidCount === 0) return;
        if (!listing
            || !Number.isSafeInteger(savedListing?.currentBid)
            || savedListing.currentBid < listing.currentBid
            || !Number.isSafeInteger(savedListing?.bidCount)
            || savedListing.bidCount < 0) return;
        listing.currentBid = savedListing.currentBid;
        listing.bidCount = savedListing.bidCount;
        const extensionCount = Number.isSafeInteger(savedListing.extensionCount)
            && savedListing.extensionCount >= 0
            && savedListing.extensionCount <= config.auctionRules.maximumLateBidExtensions
            ? savedListing.extensionCount
            : 0;
        const savedEnd = Date.parse(savedListing.auctionEndsAt);
        const originalEnd = Date.parse(initialBidState.get(listingId).auctionEndsAt);
        const cleanDemoSeed = savedListing.cleanDemoSeed === true && listing.source !== 'seller_submission';
        if (Number.isFinite(savedEnd) && ((extensionCount && Number.isFinite(originalEnd) && savedEnd >= originalEnd) || cleanDemoSeed)) {
            listing.auctionEndsAt = new Date(savedEnd).toISOString();
            auctionExtensionCounts.set(listingId, extensionCount);
            const seedEnd = Date.parse(savedListing.seedAuctionEndsAt);
            if (cleanDemoSeed) Object.assign(initialBidState.get(listingId), {
                auctionEndsAt: new Date(Number.isFinite(seedEnd) && seedEnd <= savedEnd
                    ? seedEnd : savedEnd - extensionCount * config.auctionRules.lateBidExtensionMs).toISOString(),
                cleanDemoSeed: true
            });
        }
    });
    return { initialBidState, auctionExtensionCounts };
}

export function createBiddingService(listingStates, transactionStore, userService = {
    getCurrentUser: () => getDemoUser(DEFAULT_DEMO_USER_ID),
    isListingOwner: listingId => listingStates.get(listingId)?.sellerUserId === DEFAULT_DEMO_USER_ID
}, now = () => Date.now(), notificationService = null, initialBidState = new Map(), auctionExtensionCounts = new Map()) {
    function isCurrentUserListingOwner(listingId) {
        const currentUser = userService.getCurrentUser();
        return userService.isListingOwner
            ? userService.isListingOwner(listingId, currentUser.id)
            : listingStates.get(listingId)?.sellerUserId === currentUser.id;
    }

    function persistBids() {
        const savedBids = Object.fromEntries(Array.from(listingStates, ([listingId, listing]) => [listingId, {
            currentBid: listing.currentBid,
            bidCount: listing.bidCount,
            bidIncrement: listing.bidIncrement,
            auctionEndsAt: listing.auctionEndsAt,
            extensionCount: auctionExtensionCounts.get(listingId) || 0,
            cleanDemoSeed: initialBidState.get(listingId)?.cleanDemoSeed === true,
            seedAuctionEndsAt: initialBidState.get(listingId)?.cleanDemoSeed
                ? initialBidState.get(listingId).auctionEndsAt : undefined
        }]));
        return writeJSON(STORAGE_KEYS.bids, savedBids);
    }

    function minimumNextBid(listing) {
        return listing.currentBid + normalizeBidIncrement(listing.bidIncrement, listing.currentBid);
    }

    function bidRules(listingId) {
        const listing = listingStates.get(listingId);
        if (!listing) return null;
        const increment = normalizeBidIncrement(listing.bidIncrement, listing.currentBid);
        return { increment, minimumBid: listing.currentBid + increment, maximumBid: bidCeiling,
            maximumStep: listing.currentBid + Math.floor((bidCeiling - listing.currentBid) / increment) * increment };
    }

    const autoBids = loadAutoBids();
    const bidCeiling = config.auctionRules.maximumListingPrice;

    function isBiddingOpen(listingId) {
        const listing = listingStates.get(listingId);
        if (!listing || listing.secondChanceOffer || listing.listingFormat === LISTING_FORMAT.buyNow) return false;
        const endTime = Date.parse(listing.auctionEndsAt);
        return !(Number.isFinite(endTime) && endTime <= now())
            && transactionStore.get(listingId).status === TRANSACTION_STATUS.auctionActive;
    }

    function nextStamp(listingId) {
        const known = [
            ...transactionStore.get(listingId).bidHistory.map(bid => Date.parse(bid.placedAt)),
            ...(autoBids.get(listingId) || []).map(entry => Date.parse(entry.priorityAt))
        ].filter(Number.isFinite);
        return Math.max(now(), known.length ? Math.max(...known) + 1 : 0);
    }

    function leaderOf(listingId) {
        return getHighestValidBid(transactionStore.get(listingId).bidHistory)?.bidderUserId ?? null;
    }

    function ownBestBid(listingId, userId) {
        return transactionStore.get(listingId).bidHistory
            .filter(bid => bid.bidderUserId === userId && Number.isSafeInteger(bid.amount))
            .reduce((best, bid) => Math.max(best, bid.amount), 0);
    }

    function commitBid(listingId, bidder, amount, { automatic = false, tiePriority = false, allowExtension = true } = {}) {
        const listing = listingStates.get(listingId);
        const previousBid = listing.currentBid;
        const previousBidCount = listing.bidCount;
        const previousIncrement = listing.bidIncrement;
        const previousAuctionEndsAt = listing.auctionEndsAt;
        const previousExtensionCount = auctionExtensionCounts.get(listingId) || 0;
        const auctionEnd = Date.parse(listing.auctionEndsAt);
        const lateBidExtended = allowExtension
            && Number.isFinite(auctionEnd)
            && auctionEnd - now() <= config.auctionRules.lateBidWindowMs
            && previousExtensionCount < config.auctionRules.maximumLateBidExtensions;
        const placedAt = new Date(nextStamp(listingId)).toISOString();
        const restore = () => {
            listing.currentBid = previousBid;
            listing.bidCount = previousBidCount;
            listing.bidIncrement = previousIncrement;
            listing.auctionEndsAt = previousAuctionEndsAt;
            auctionExtensionCounts.set(listingId, previousExtensionCount);
        };
        listing.bidIncrement = normalizeBidIncrement(listing.bidIncrement, previousBid);
        listing.currentBid = amount;
        listing.bidCount += 1;
        if (lateBidExtended) {
            listing.auctionEndsAt = new Date(auctionEnd + config.auctionRules.lateBidExtensionMs).toISOString();
            auctionExtensionCounts.set(listingId, previousExtensionCount + 1);
        }
        if (!persistBids()) {
            restore();
            return { ok: false };
        }
        const transaction = transactionStore.transition(listingId, TRANSACTION_EVENT.placeBid, {
            listingId,
            bidderUserId: bidder.id,
            bidderDisplayName: bidder.firstName,
            amount,
            auctionExtended: lateBidExtended,
            placedAt,
            automatic,
            tiePriority
        });
        if (!transaction) {
            restore();
            persistBids();
            return { ok: false };
        }
        return { ok: true, transaction, lateBidExtended };
    }

    // Resolves private maxima into the minimal set of resulting public bids.
    function settleAutoBids(listingId, allowExtension) {
        const placed = [];
        const listing = listingStates.get(listingId);
        if (!listing || !isBiddingOpen(listingId)) return placed;
        const proxies = (autoBids.get(listingId) || []).filter(entry => entry.enabled
            && getDemoUser(entry.userId)
            && entry.userId !== listing.sellerUserId);
        if (!proxies.length) return placed;
        const history = transactionStore.get(listingId).bidHistory;
        const bestBids = new Map();
        history.forEach(bid => {
            if (!Number.isSafeInteger(bid.amount) || bid.amount <= 0 || !getDemoUser(bid.bidderUserId)) return;
            const best = bestBids.get(bid.bidderUserId);
            if (!best || bid.amount > best.amount) bestBids.set(bid.bidderUserId, { amount: bid.amount, at: Date.parse(bid.placedAt) || 0 });
        });
        const { increment } = bidRules(listingId);
        const steps = planProxyBids({
            currentBid: listing.currentBid,
            leaderUserId: leaderOf(listingId),
            bestBids,
            proxies: proxies.map(entry => ({
                ...entry,
                // Round only the resolution limit, never the stored private maximum.
                maxAmount: listing.currentBid + Math.floor((entry.maxAmount - listing.currentBid) / increment) * increment
            })),
            minimumNextBid: currentBid => currentBid + increment
        });
        let canExtend = allowExtension;
        for (const step of steps) {
            if (step.amount > bidCeiling) break;
            const result = commitBid(listingId, getDemoUser(step.userId), step.amount, {
                automatic: true,
                tiePriority: step.tiePriority === true,
                allowExtension: canExtend
            });
            if (!result.ok) break;
            if (result.lateBidExtended) canExtend = false;
            placed.push({ ...step, extended: result.lateBidExtended });
        }
        return placed;
    }

    function notifyAutoBidOutcomes(listingId, { actorUserId, previousLeaderId, placed }) {
        const listing = listingStates.get(listingId);
        if (!notificationService || !listing) return;
        const history = transactionStore.get(listingId).bidHistory;
        const finalLeaderId = leaderOf(listingId);
        const entries = (autoBids.get(listingId) || []).filter(entry => entry.enabled);
        entries.forEach(entry => {
            const own = placed.find(step => step.userId === entry.userId);
            const base = { listing, recipientUserId: entry.userId, epoch: entry.epoch };
            if (entry.userId === finalLeaderId) {
                if (own && minimumNextBid(listing) > entry.maxAmount) {
                    notificationService.notifyAutoBid({ ...base, kind: 'reached', title: 'Maximum reached',
                        message: `No further valid step fits your maximum on ${listing.title}. You are leading at ${formatCurrency(listing.currentBid)}.` });
                } else if (own) {
                    notificationService.notifyAutoBid({ ...base, kind: 'placed', title: 'Still leading through automatic bidding',
                        message: `You are leading on ${listing.title} at ${formatCurrency(own.amount)}.` });
                } else if (previousLeaderId === entry.userId && entry.userId !== actorUserId) {
                    notificationService.notifyAutoBid({ ...base, kind: 'leading', title: 'Still leading',
                        message: `You are still leading on ${listing.title} at ${formatCurrency(listing.currentBid)}.` });
                }
            } else if (entry.maxAmount < minimumNextBid(listing)) {
                notificationService.notifyAutoBid({ ...base, kind: 'exceeded', title: 'Outbid above your maximum',
                    message: `A bid on ${listing.title} went above your automatic maximum.` });
            }
        });
        if (previousLeaderId && previousLeaderId !== finalLeaderId && previousLeaderId !== actorUserId
            && !entries.some(entry => entry.userId === previousLeaderId)) {
            notificationService.notifyOutbid({
                listing,
                previousHighestBid: { bidderUserId: previousLeaderId },
                bid: history[history.length - 1]
            });
        }
    }

    function updateAutoBids(listingId, nextEntries) {
        const previous = autoBids.get(listingId);
        if (nextEntries.length) autoBids.set(listingId, nextEntries);
        else autoBids.delete(listingId);
        if (saveAutoBids(autoBids)) return true;
        if (previous) autoBids.set(listingId, previous);
        else autoBids.delete(listingId);
        return false;
    }

    function resolveWinner(listingId) {
        const transaction = transactionStore.get(listingId);
        const listing = listingStates.get(listingId);
        const highestBid = getHighestValidBid(transaction.bidHistory);
        if (!highestBid) return null;
        return {
            buyerUserId: highestBid.bidderUserId,
            winner: highestBid.bidderDisplayName,
            winningBid: highestBid.amount,
            sellerUserId: listing.sellerUserId
        };
    }

    return {
        minimumNextBid,
        getBidRules: bidRules,
        getBidFeedback(listingId, userId = userService.getCurrentUser().id) {
            const transaction = transactionStore.get(listingId);
            if (transaction.status !== TRANSACTION_STATUS.auctionActive) return '';
            const ownBids = transaction.bidHistory.filter(bid => bid.bidderUserId === userId);
            if (!ownBids.length) return '';
            return getHighestValidBid(transaction.bidHistory)?.bidderUserId === userId
                ? 'Your bid is leading' : 'You have been outbid';
        },
        getBidHistory(listingId) {
            const labels = new Map();
            const userId = userService.getCurrentUser().id;
            const history = transactionStore.get(listingId).bidHistory.filter(bid =>
                Number.isSafeInteger(bid.amount) && bid.amount > 0 && getDemoUser(bid.bidderUserId));
            history.forEach(bid => {
                if (!labels.has(bid.bidderUserId)) labels.set(bid.bidderUserId, `Bidder ${String.fromCharCode(65 + labels.size)}`);
            });
            return history.map(bid => ({
                amount: bid.amount,
                placedAt: bid.placedAt,
                auto: bid.auto === true,
                label: bid.bidderUserId === userId ? 'You' : labels.get(bid.bidderUserId)
            })).reverse();
        },
        hasListingActivity(listingId) {
            const listing = listingStates.get(listingId);
            const baseline = initialBidState.get(listingId);
            if (!listing || !baseline) return false;
            const transaction = transactionStore.get(listingId);
            return transaction.bidHistory.length > 0
                || transaction.status !== TRANSACTION_STATUS.auctionActive
                || listing.currentBid !== baseline.currentBid
                || listing.bidCount !== baseline.bidCount;
        },
        isAuctionExpired(listingId) {
            const listing = listingStates.get(listingId);
            if (listing?.listingFormat === LISTING_FORMAT.buyNow) return false;
            const endTime = listing ? Date.parse(listing.auctionEndsAt) : NaN;
            return Number.isFinite(endTime) && endTime <= now();
        },
        canBid(listingId) {
            const listing = listingStates.get(listingId);
            return Boolean(listing
                && !listing.secondChanceOffer
                && listing.listingFormat !== LISTING_FORMAT.buyNow
                && minimumNextBid(listing) <= bidCeiling
                && !this.isAuctionExpired(listingId)
                && !isCurrentUserListingOwner(listingId)
                && transactionStore.get(listingId).status === TRANSACTION_STATUS.auctionActive);
        },
        isBuyNowPriceAvailable(listingId) {
            const listing = listingStates.get(listingId);
            return Boolean(listing
                && !listing.secondChanceOffer
                && listing.buyNowPrice !== null
                && listing.currentBid < listing.buyNowPrice
                && !this.isAuctionExpired(listingId)
                && transactionStore.get(listingId).status === TRANSACTION_STATUS.auctionActive);
        },
        isBuyNowAvailable(listingId) {
            return this.isBuyNowPriceAvailable(listingId) && !isCurrentUserListingOwner(listingId);
        },
        placeBid(listingId, amount) {
            const listing = listingStates.get(listingId);
            if (!listing) return { ok: false, code: SERVICE_ERROR_CODE.listingNotFound };
            if (this.isAuctionExpired(listingId)) {
                this.endAuction(listingId);
                return { ok: false, code: SERVICE_ERROR_CODE.auctionClosed };
            }
            if (isCurrentUserListingOwner(listingId)) return { ok: false, code: SERVICE_ERROR_CODE.ownListing };
            if (!this.canBid(listingId)) return { ok: false, code: SERVICE_ERROR_CODE.auctionClosed };

            const { minimumBid, increment } = bidRules(listingId);
            if (amount !== minimumBid) {
                return { ok: false, code: SERVICE_ERROR_CODE.bidTooLow, minimumBid, increment };
            }
            if (amount > bidCeiling) return { ok: false, code: SERVICE_ERROR_CODE.bidTooHigh, minimumBid, maximumBid: bidCeiling };

            const previousLeaderId = leaderOf(listingId);
            const currentUser = userService.getCurrentUser();
            const committed = commitBid(listingId, currentUser, amount);
            if (!committed.ok) return { ok: false, code: SERVICE_ERROR_CODE.storageFailed, minimumBid };
            const placed = settleAutoBids(listingId, !committed.lateBidExtended);
            notifyAutoBidOutcomes(listingId, { actorUserId: currentUser.id, previousLeaderId, placed });
            const leading = leaderOf(listingId) === currentUser.id;
            notificationService?.notifyBidResult({ listing, recipientUserId: currentUser.id,
                amount, placedAt: committed.transaction.bidHistory.at(-1)?.placedAt, leading });

            return {
                ok: true,
                data: {
                    listing,
                    transaction: transactionStore.get(listingId),
                    minimumBid,
                    auctionExtended: committed.lateBidExtended || placed.some(step => step.extended),
                    leading,
                    currentBid: listing.currentBid
                }
            };
        },
        proposeBid(listingId, baseAmount, direction) {
            const listing = listingStates.get(listingId);
            if (!listing || ![-1, 1].includes(direction)) return null;
            const { minimumBid, increment, maximumStep } = bidRules(listingId);
            if (minimumBid > maximumStep) {
                return { ok: false, code: SERVICE_ERROR_CODE.bidTooHigh, maximumBid: bidCeiling };
            }
            const validBase = Number.isSafeInteger(baseAmount) && baseAmount >= minimumBid
                && (baseAmount - listing.currentBid) % increment === 0;
            const base = validBase ? baseAmount : minimumBid;
            const amount = Math.max(minimumBid, Math.min(maximumStep, base + direction * increment));
            return { ok: true, amount, minimumBid, increment };
        },
        getAutoBid(listingId) {
            const listing = listingStates.get(listingId);
            const userId = userService.getCurrentUser().id;
            if (!listing || isCurrentUserListingOwner(listingId)) return null;
            const entry = (autoBids.get(listingId) || []).find(item => item.userId === userId);
            const leading = leaderOf(listingId) === userId;
            const committedBid = ownBestBid(listingId, userId);
            const open = isBiddingOpen(listingId);
            const exceeded = entry && !leading && entry.maxAmount < minimumNextBid(listing);
            return {
                maxAmount: entry?.maxAmount ?? null,
                enabled: entry?.enabled === true,
                status: !entry ? 'none'
                    : !open ? 'stopped'
                        : !entry.enabled ? 'disabled'
                            : exceeded ? 'exceeded' : 'active',
                committedBid,
                leading,
                minimumMaximum: Math.max(committedBid, leading ? 1 : minimumNextBid(listing)),
                maximumAllowed: bidCeiling,
                canConfigure: this.canBid(listingId)
            };
        },
        setAutoBid(listingId, maxAmount) {
            const listing = listingStates.get(listingId);
            if (!listing) return { ok: false, code: SERVICE_ERROR_CODE.listingNotFound };
            if (this.isAuctionExpired(listingId)) {
                this.endAuction(listingId);
                return { ok: false, code: SERVICE_ERROR_CODE.auctionClosed };
            }
            if (isCurrentUserListingOwner(listingId)) return { ok: false, code: SERVICE_ERROR_CODE.ownListing };
            if (!this.canBid(listingId)) return { ok: false, code: SERVICE_ERROR_CODE.auctionClosed };
            if (!Number.isSafeInteger(maxAmount) || maxAmount <= 0) return { ok: false, code: SERVICE_ERROR_CODE.invalidInput };
            if (maxAmount > bidCeiling) return { ok: false, code: SERVICE_ERROR_CODE.bidTooHigh, maximumBid: bidCeiling };

            const user = userService.getCurrentUser();
            const status = this.getAutoBid(listingId);
            if (maxAmount < status.minimumMaximum) {
                return { ok: false, code: SERVICE_ERROR_CODE.bidTooLow, minimumBid: status.minimumMaximum };
            }
            const entries = autoBids.get(listingId) || [];
            const existing = entries.find(item => item.userId === user.id);
            const priorityAt = new Date(nextStamp(listingId)).toISOString();
            const entry = existing
                ? {
                    ...existing,
                    maxAmount,
                    enabled: true,
                    priorityAt: !existing.enabled || maxAmount > existing.maxAmount ? priorityAt : existing.priorityAt,
                    epoch: existing.epoch + 1
                }
                : { userId: user.id, maxAmount, enabled: true, priorityAt, epoch: 1 };
            if (!updateAutoBids(listingId, [...entries.filter(item => item.userId !== user.id), entry])) {
                return { ok: false, code: SERVICE_ERROR_CODE.storageFailed };
            }
            const previousLeaderId = leaderOf(listingId);
            const placed = settleAutoBids(listingId, true);
            notifyAutoBidOutcomes(listingId, { actorUserId: user.id, previousLeaderId, placed });
            return {
                ok: true,
                data: { leading: leaderOf(listingId) === user.id, currentBid: listing.currentBid, bidsPlaced: placed.length }
            };
        },
        disableAutoBid(listingId) {
            const user = userService.getCurrentUser();
            const entries = autoBids.get(listingId) || [];
            const existing = entries.find(item => item.userId === user.id);
            if (!existing) return { ok: false, code: SERVICE_ERROR_CODE.invalidInput };
            if (!isBiddingOpen(listingId)) return { ok: false, code: SERVICE_ERROR_CODE.auctionClosed };
            const disabled = { ...existing, enabled: false, epoch: existing.epoch + 1 };
            if (!updateAutoBids(listingId, entries.map(item => item === existing ? disabled : item))) {
                return { ok: false, code: SERVICE_ERROR_CODE.storageFailed };
            }
            return { ok: true };
        },
        endAuction(listingId) {
            const listing = listingStates.get(listingId);
            if (!listing || listing.secondChanceOffer || transactionStore.get(listingId).status !== TRANSACTION_STATUS.auctionActive) return null;
            const highestBid = getHighestValidBid(transactionStore.get(listingId).bidHistory);
            const hasReserve = listing.reservePriceMode === RESERVE_PRICE_MODE.set
                && Number.isSafeInteger(listing.reservePrice)
                && listing.reservePrice > 0;
            const reserveMet = highestBid && (!hasReserve || highestBid.amount >= listing.reservePrice);
            const winner = reserveMet ? resolveWinner(listingId) : null;
            return transactionStore.transition(listingId, TRANSACTION_EVENT.auctionEnd, {
                ...(winner || {
                buyerUserId: null,
                winner: null,
                winningBid: null,
                sellerUserId: listing.sellerUserId
                }),
                reserveOutcome: hasReserve && highestBid
                    ? reserveMet ? AUCTION_RESERVE_OUTCOME.met : AUCTION_RESERVE_OUTCOME.notMet
                    : null
            });
        },
        closeExpiredAuctions() {
            const closed = [];
            listingStates.forEach((listing, listingId) => {
                if (transactionStore.get(listingId).status !== TRANSACTION_STATUS.auctionActive
                    || !this.isAuctionExpired(listingId)) return;
                const transaction = this.endAuction(listingId);
                if (transaction) closed.push({ listing, transaction });
            });
            return closed;
        }
    };
}