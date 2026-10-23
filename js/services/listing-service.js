import { config } from '../config.js';
import { listings as staticListings } from '../data/sample-listings.js';
import { CATEGORY_LABELS, CONDITION_GRADE_LABELS, DEFAULT_DEMO_USER_ID, LISTING_FORMAT, SELLER_LISTING_ID_PREFIX, SUBCATEGORY_LABELS, SUBMISSION_STATUS, TRANSACTION_STATUS } from '../core/constants.js';
import { getDemoUser, isDemoUserId } from '../data/demo-users.js';
import { validateSellerListing } from '../core/validation.js';
import { normalizeBidIncrement, normalizeFulfilmentMethod, normalizeSpecifications } from '../core/normalization.js';
import { saveSellerSubmissions } from './submission-service.js';

export function getDiscoveryListings(listings, { discovery, watchlist, transactionStore, isPublicListing = () => true, now = Date.now() }) {
    let result = listings.filter(listing => !listing.secondChanceOffer && isPublicListing(listing));
    const active = listing => listing.listingFormat !== LISTING_FORMAT.buyNow
        && transactionStore.get(listing.id).status === TRANSACTION_STATUS.auctionActive
        && Date.parse(listing.auctionEndsAt) > now;
    if (['ending-soon', 'popular', 'price-drops', 'relisted'].includes(discovery)) result = result.filter(active);
    if (discovery === 'price-drops') result = result.filter(listing => Number.isSafeInteger(listing.buyNowPrice) && listing.previousBuyNowPrice > listing.buyNowPrice);
    if (discovery === 'relisted') result = result.filter(listing => listing.relistedFrom);
    if (discovery === 'ending-soon') result.sort((left, right) => Date.parse(left.auctionEndsAt) - Date.parse(right.auctionEndsAt));
    else if (discovery === 'popular') result.sort((left, right) => right.bidCount - left.bidCount);
    else if (['newly-listed', 'relisted', 'price-drops'].includes(discovery)) {
        result.sort((left, right) => (Date.parse(discovery === 'price-drops' ? right.priceChangedAt : right.listedAt) || 0) - (Date.parse(discovery === 'price-drops' ? left.priceChangedAt : left.listedAt) || 0));
    } else if (discovery === 'for-you') {
        const categories = new Set(listings.filter(listing => watchlist.has(listing.id)).map(listing => listing.category));
        const score = listing => (active(listing) ? 1000000 : 0) + (categories.has(listing.category) ? 10000 : 0) + listing.bidCount;
        result.sort((left, right) => score(right) - score(left));
    }
    return result;
}

export function listingPlaceholderLabel(listing) {
    const label = SUBCATEGORY_LABELS[listing.subcategory] || CATEGORY_LABELS[listing.category] || 'Item';
    return `${label} listing`;
}

function withSellerProfile(listing) {
    const seller = getDemoUser(listing.sellerUserId) || getDemoUser(DEFAULT_DEMO_USER_ID);
    return {
        ...listing,
        bidIncrement: normalizeBidIncrement(listing.bidIncrement, listing.currentBid),
        listingFormat: listing.listingFormat || (Number.isSafeInteger(listing.buyNowPrice)
            ? LISTING_FORMAT.auctionAndBuyNow : LISTING_FORMAT.auction),
        location: typeof listing.location === 'string' && listing.location.includes(config.pilotCity)
            ? listing.location : config.pilotCity,
        specifications: normalizeSpecifications(listing.specifications),
        fulfilmentMethod: normalizeFulfilmentMethod(listing.fulfilmentMethod),
        sellerUserId: seller.id,
        sellerProfile: seller,
        sellerName: seller.firstName,
        sellerRating: `${seller.sellerRating.toFixed(1)}/5`
    };
}

export function sellerListingId(submission) {
    return `${SELLER_LISTING_ID_PREFIX}${submission.id}`;
}

export function getSellerPriceGuidance({ subcategory, condition, startingBid, buyNowPrice }, catalogue = staticListings) {
    const categoryMatches = catalogue.filter(listing => listing.subcategory === subcategory);
    const conditionMatches = categoryMatches.filter(listing => listing.conditionGrade === condition);
    const referenceListings = conditionMatches.length ? conditionMatches : categoryMatches;
    const samplePrices = referenceListings
        .map(listing => Number.isSafeInteger(listing.currentBid) ? listing.currentBid : listing.startingBid)
        .filter(price => Number.isSafeInteger(price) && price > 0)
        .sort((left, right) => left - right);
    if (!samplePrices.length) return { low: null, high: null, warning: 'No matching sample listings; compare against similar recent sales.' };

    const middle = Math.floor(samplePrices.length / 2);
    const referencePrice = samplePrices.length % 2
        ? samplePrices[middle]
        : Math.round((samplePrices[middle - 1] + samplePrices[middle]) / 2);
    const low = Math.round(referencePrice * 0.75);
    const high = Math.round(referencePrice * 1.25);
    const warnings = [];
    if (Number.isSafeInteger(startingBid) && startingBid > high) warnings.push('Starting bid is above the sample range and may limit early interest.');
    if (Number.isSafeInteger(buyNowPrice) && buyNowPrice > referencePrice * 1.5) warnings.push('Buy Now is well above the sample midpoint.');
    return {
        low,
        high,
        sampleCount: samplePrices.length,
        conditionMatched: conditionMatches.length > 0,
        warning: warnings.join(' ')
    };
}

function normalizePublishedSubmission(submission, now) {
    let didNormalize = false;
    const stableListingId = sellerListingId(submission);
    if (submission.listingId !== stableListingId) {
        submission.listingId = stableListingId;
        didNormalize = true;
    }

    if (!Number.isFinite(Date.parse(submission.publishedAt))) {
        submission.publishedAt = now.toISOString();
        didNormalize = true;
    }

    if (!Number.isFinite(Date.parse(submission.auctionEndsAt))) {
        submission.auctionEndsAt = new Date(Date.parse(submission.publishedAt) + submission.auctionDurationHours * 60 * 60 * 1000).toISOString();
        didNormalize = true;
    }

    return didNormalize;
}

function isPublishableSubmission(submission) {
    return isDemoUserId(submission.sellerUserId) && validateSellerListing(submission).valid;
}

export function createPublishedSellerListing(submission, imageUrl = null) {
    const endsAt = submission.listingFormat === LISTING_FORMAT.buyNow
        ? new Date('9999-12-31T23:59:59.999Z')
        : new Date(submission.auctionEndsAt);
    const specifications = normalizeSpecifications(submission.specifications);
    const images = (Array.isArray(imageUrl) ? imageUrl : imageUrl ? [imageUrl] : [])
        .filter(url => typeof url === 'string' && url.length > 0);

    return withSellerProfile({
        id: sellerListingId(submission),
        source: 'seller_submission',
        sellerSubmissionId: submission.id,
        sourceListingId: typeof submission.sourceListingId === 'string' ? submission.sourceListingId : null,
        relistedFrom: typeof submission.relistedFrom === 'string' ? submission.relistedFrom : null,
        secondChanceOffer: submission.secondChanceOffer && typeof submission.secondChanceOffer === 'object'
            ? { ...submission.secondChanceOffer } : null,
        recoverySourceListingId: typeof submission.recoverySourceListingId === 'string' ? submission.recoverySourceListingId : null,
        correctionOf: typeof submission.correctionOf === 'string' ? submission.correctionOf : null,
        correctionReason: typeof submission.correctionReason === 'string' ? submission.correctionReason : '',
        correctionChanges: Array.isArray(submission.correctionChanges) ? [...submission.correctionChanges] : [],
        recoveryOnly: submission.recoveryOnly === true,
        recoveryStatus: submission.recoveryStatus || null,
        previousBuyNowPrice: Number.isSafeInteger(submission.previousBuyNowPrice) ? submission.previousBuyNowPrice : null,
        priceChangedAt: typeof submission.priceChangedAt === 'string' ? submission.priceChangedAt : null,
        publicationStatus: SUBMISSION_STATUS.published,
        sellerUserId: submission.sellerUserId,
        specifications,
        fulfilmentMethod: submission.fulfilmentMethod,
        listingFormat: submission.listingFormat || (Number.isSafeInteger(submission.buyNowPrice)
            ? LISTING_FORMAT.auctionAndBuyNow : LISTING_FORMAT.auction),
        title: submission.title,
        brandModel: submission.brandModel,
        category: submission.category,
        subcategory: submission.subcategory,
        image: images[0] || null,
        images,
        imageAlt: `${submission.title} photo`,
        conditionGrade: submission.condition,
        conditionLabel: CONDITION_GRADE_LABELS[submission.condition] || submission.condition,
        description: submission.description,
        accessories: Array.isArray(specifications.includedAccessories)
            ? specifications.includedAccessories
            : typeof specifications.includedAccessories === 'string'
                ? specifications.includedAccessories.split(',').map(item => item.trim()).filter(Boolean)
                : [],
        location: config.pilotCity,
        estimatedValue: Number.isSafeInteger(submission.estimatedValue) ? submission.estimatedValue : null,
        startingBid: submission.startingBid,
        bidIncrement: submission.bidIncrement,
        auctionDurationHours: submission.auctionDurationHours,
        reservePriceMode: submission.reservePriceMode,
        reservePrice: submission.reservePrice,
        currentBid: submission.startingBid,
        bidCount: 0,
        listedAt: submission.publishedAt || submission.submittedAt,
        buyNowPrice: Number.isSafeInteger(submission.buyNowPrice) ? submission.buyNowPrice : null,
        auctionEndsAt: endsAt.toISOString(),
        auctionEndLabel: `Ends ${endsAt.toLocaleDateString(config.locale, { day: 'numeric', month: 'short' })}`
    });
}

export function loadListingStates(submissions, resolveImage = () => null, now = new Date()) {
    const listingStates = new Map(staticListings.map(listing => [listing.id, withSellerProfile(listing)]));
    let didNormalize = false;

    submissions.forEach(submission => {
        if (!submission || typeof submission !== 'object') return;
        if (submission.status === SUBMISSION_STATUS.published && typeof submission.id === 'string') {
            didNormalize = normalizePublishedSubmission(submission, now) || didNormalize;
        }
    });

    if (didNormalize) saveSellerSubmissions(submissions);

    const publishedListings = new Map();
    submissions.forEach(submission => {
        if (!submission || submission.status !== SUBMISSION_STATUS.published || typeof submission.id !== 'string' || !submission.id || !isPublishableSubmission(submission)) return;
        const resolvedImages = resolveImage(submission);
        const sampleSource = staticListings.find(listing => listing.id === submission.sourceListingId);
        const images = (Array.isArray(resolvedImages) ? resolvedImages.length > 0 : Boolean(resolvedImages))
            ? resolvedImages : sampleSource?.images || sampleSource?.image || null;
        const listing = createPublishedSellerListing(submission, images);
        publishedListings.set(listing.id, listing);
    });

    publishedListings.forEach((listing, listingId) => listingStates.set(listingId, listing));
    return { listingStates, submissions };
}

export function applySubmissionTransition(listingStates, result, { resolveImage = () => null, releaseImage = () => {} } = {}) {
    if (!result) return;
    if (result.status === SUBMISSION_STATUS.published) {
        listingStates.set(result.listingId, createPublishedSellerListing(result.submission, resolveImage(result.submission)));
    } else if (result.status === SUBMISSION_STATUS.unpublished) {
        releaseImage(result.submission.id);
        listingStates.delete(result.listingId);
    } else if (result.status === SUBMISSION_STATUS.rejected) {
        releaseImage(result.submission.id);
    }
}

export function removeSellerListingsForSubmissions(listingStates, submissions, releaseImage = () => {}) {
    submissions.forEach(submission => {
        if (!submission || typeof submission.id !== 'string') return;
        releaseImage(submission.id);
        listingStates.delete(sellerListingId(submission));
    });
}
