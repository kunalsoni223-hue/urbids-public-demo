import { AUCTION_DURATION_OPTIONS_HOURS, DEFAULT_AUCTION_DURATION_HOURS } from './core/constants.js';

export const config = {
    prototypeVersion: 'usability-readiness-1',
    researchContactEmail: '',
    brandName: 'Urbids',
    tagline: 'Your marketplace for pre-owned goods',
    currency: 'INR',
    locale: 'en-IN',
    pilotCity: 'Mumbai',
    auctionDurationHours: DEFAULT_AUCTION_DURATION_HOURS,
    auctionRules: {
        defaultDurationHours: DEFAULT_AUCTION_DURATION_HOURS,
        sellerDurationOptionsHours: AUCTION_DURATION_OPTIONS_HOURS,
        lateBidWindowMs: 2 * 60 * 1000,
        lateBidExtensionMs: 2 * 60 * 1000,
        maximumLateBidExtensions: 3,
        maximumListingPrice: 10000000
    },
    sellerBidIncrements: [1, 10, 100, 1000],
    bidIncrements: [
        { maxCurrentBid: 9999, amount: 100 },
        { maxCurrentBid: 30000, amount: 200 },
        { amount: 500 }
    ]
};