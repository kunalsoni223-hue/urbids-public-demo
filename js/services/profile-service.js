import { MEETUP_NO_SHOW_OUTCOME, TRANSACTION_STATUS } from '../core/constants.js';

const ratingScores = [5, 4, 3, 2, 1];

export function createProfileService({ listingStates, transactionStore, userService, ratingService, disputeService, biddingService, auctionManagement }) {
    function getReviewSummary(userId, role = 'all') {
        const all = ratingService.getPublicReviews(userId);
        const reviews = role === 'all' ? all : all.filter(review => review.role === role);
        const reputation = ratingService.getReputation(userId);
        return {
            average: reputation.sellerRating,
            completedTransactions: reputation.completedTransactions,
            totalReviewCount: all.length,
            reviewCount: reviews.length,
            distribution: ratingScores.map(stars => ({ stars, count: reviews.filter(review => review.score === stars).length })),
            reviews,
            isSample: reputation.completedTransactions > all.length
        };
    }

    // Only resolved, factual seller no-shows are public; open disputes and unverified reports stay private.
    function resolvedSellerNoShows(userId) {
        return Array.from(listingStates.keys()).filter(listingId => {
            const transaction = transactionStore.get(listingId);
            return transaction.sellerUserId === userId
                && transaction.noShowUserId === userId
                && Object.values(MEETUP_NO_SHOW_OUTCOME).includes(transaction.noShowOutcome)
                && !disputeService.hasOpenDispute(listingId);
        }).length;
    }

    function getPublicProfile(userId) {
        const user = userService.getUser(userId);
        if (!user) return null;
        const reputation = ratingService.getReputation(userId);
        const activeListings = Array.from(listingStates.values()).filter(listing => listing.sellerUserId === userId
            && auctionManagement.isPublicListing(listing)
            && !listing.secondChanceOffer
            && transactionStore.get(listing.id).status === TRANSACTION_STATUS.auctionActive
            && !biddingService.isAuctionExpired(listing.id))
            .map(listing => ({ id: listing.id, title: listing.title, currentBid: listing.currentBid, buyNowPrice: listing.buyNowPrice, auctionEndsAt: listing.auctionEndsAt, listingFormat: listing.listingFormat }));
        return {
            id: user.id,
            displayName: user.firstName,
            initials: user.initials,
            avatarColor: user.avatarColor,
            location: user.location,
            memberSince: user.memberSince,
            rating: reputation.sellerRating,
            completedTransactions: reputation.completedTransactions,
            resolvedNoShows: resolvedSellerNoShows(userId),
            activeListings
        };
    }

    return { getPublicProfile, getReviewSummary };
}
