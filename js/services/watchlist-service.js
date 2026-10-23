import { TRANSACTION_STATUS } from '../core/constants.js';

export function createWatchlistService({ listingStates, userService, transactionStore, notificationService, auctionManagement, now = () => Date.now() }) {
    function latestRelist(listing) {
        const listings = Array.from(listingStates.values());
        const sourceIndex = listings.findIndex(other => other.id === listing.id);
        return listings.filter((other, index) =>
            other.id !== listing.id && !other.secondChanceOffer
            && other.sourceListingId === (listing.sourceListingId || listing.id)
            && index > sourceIndex).at(-1) || null;
    }

    function snapshot(listing) {
        return {
            bidCount: listing.bidCount,
            buyNowPrice: listing.buyNowPrice,
            ended: transactionStore.get(listing.id).status !== TRANSACTION_STATUS.auctionActive,
            relistedId: latestRelist(listing)?.id || null
        };
    }

    function sync() {
        userService.getUsers().forEach(user => {
            const previous = userService.getWatchObservations(user.id);
            const next = {};
            const events = [];
            userService.getWatchlist(user.id).forEach(listingId => {
                const listing = listingStates.get(listingId);
                if (!listing || !auctionManagement.isPublicListing(listing)) return;
                const current = snapshot(listing);
                const saved = previous[listingId];
                const flags = Array.isArray(saved?.flags) ? [...saved.flags] : [];
                const add = (flag, key, targetId = listingId) => {
                    if (!flags.includes(flag)) flags.push(flag);
                    events.push({ flag, key, targetId, listingId, title: listing.title });
                };
                if (saved && typeof saved === 'object') {
                    if (current.bidCount > saved.bidCount) {
                        const latestBid = transactionStore.get(listingId).bidHistory.at(-1);
                        if (latestBid?.bidderUserId !== user.id) add('New bid', `bid:${Math.floor(now() / 1800000)}`);
                    }
                    if (current.buyNowPrice !== saved.buyNowPrice) add('Price changed', `price:${current.buyNowPrice}`);
                    if (current.ended && !saved.ended) add('Auction ended', 'ended');
                    if (current.relistedId && current.relistedId !== saved.relistedId) add('Relisted', `relisted:${current.relistedId}`, current.relistedId);
                }
                const remaining = Date.parse(listing.auctionEndsAt) - now();
                if (!current.ended && remaining > 0 && remaining <= 3600000) add('Ending soon', 'ending-soon');
                next[listingId] = { ...current, flags };
            });
            if (JSON.stringify(next) !== JSON.stringify(previous) && !userService.saveWatchObservations(user.id, next)) return;
            events.forEach(event => notificationService.create({
                dedupeKey: `watch:${event.listingId}:${event.key}`,
                recipientUserId: user.id, title: `Watchlist: ${event.flag}`,
                message: `${event.title}: ${event.flag.toLowerCase()}. Open the listing for its current available action.`,
                listingId: event.targetId
            }));
        });
    }

    return {
        sync,
        latestRelist,
        getIndicators(listingId, userId = userService.getCurrentUser().id) {
            const listing = listingStates.get(listingId);
            if (!listing || !userService.getWatchlist(userId).has(listingId)) return [];
            const saved = userService.getWatchObservations(userId)[listingId];
            const flags = Array.isArray(saved?.flags) ? saved.flags.filter(flag =>
                ['New bid', 'Price changed', 'Relisted'].includes(flag)) : [];
            const current = snapshot(listing);
            if (current.ended) flags.push('Auction ended');
            else {
                if (Date.parse(listing.auctionEndsAt) - now() <= 3600000) flags.push('Ending soon');
                if (Number.isSafeInteger(listing.buyNowPrice) && listing.buyNowPrice > listing.currentBid) flags.push('Buy Now available');
            }
            if (current.relistedId && !flags.includes('Relisted')) flags.push('Relisted');
            return flags;
        },
        acknowledge(listingId) {
            const userId = userService.getCurrentUser().id;
            if (!userService.getWatchlist(userId).has(listingId) || !listingStates.has(listingId)) return true;
            const next = userService.getWatchObservations(userId);
            next[listingId] = { ...snapshot(listingStates.get(listingId)), flags: [] };
            return userService.saveWatchObservations(userId, next);
        }
    };
}
