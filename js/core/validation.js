import {
    AUCTION_DURATION_OPTIONS_HOURS,
    CATEGORY,
    CONDITION_GRADE,
    DEFAULT_AUCTION_DURATION_HOURS,
    FULFILMENT_METHOD,
    LISTING_FORMAT,
    SPECIFICATION_FIELDS_BY_SUBCATEGORY,
    RESERVE_PRICE_MODE,
    SUBCATEGORIES_BY_CATEGORY,
    PURCHASE_SOURCE,
    AVATAR_COLORS,
    MUMBAI_LOCALITIES,
    PROFILE_CONSTRAINTS
} from './constants.js';
import { config } from '../config.js';

export function validateBid(amount, minimumBid) {
    return Number.isSafeInteger(amount) && amount >= minimumBid;
}

export function validateBuyNowPrice(price, startingBid) {
    return price === null || (Number.isSafeInteger(price) && price > startingBid);
}

export function isValidSubcategory(category, subcategory) {
    return SUBCATEGORIES_BY_CATEGORY[category]?.includes(subcategory) || false;
}

export function validateSellerListing(submission) {
    const listingFormat = submission.listingFormat
        || (Number.isSafeInteger(submission.buyNowPrice) ? LISTING_FORMAT.auctionAndBuyNow : LISTING_FORMAT.auction);
    const validListingFormat = Object.values(LISTING_FORMAT).includes(listingFormat);
    const validCategory = Object.values(CATEGORY).includes(submission.category);
    const validSubcategory = isValidSubcategory(submission.category, submission.subcategory);
    const validCondition = Object.values(CONDITION_GRADE).includes(submission.condition);
    const validStartingBid = Number.isSafeInteger(submission.startingBid) && submission.startingBid > 0;
    const validBidIncrement = submission.bidIncrement === undefined
        || config.sellerBidIncrements.includes(submission.bidIncrement)
        || submission.bidIncrement === 200 || submission.bidIncrement === 500;
    const validBuyNowPrice = listingFormat === LISTING_FORMAT.auction
        ? submission.buyNowPrice === null
        : Number.isSafeInteger(submission.buyNowPrice) && submission.buyNowPrice > submission.startingBid;
    const validFulfilmentMethod = submission.fulfilmentMethod === undefined
        || Object.values(FULFILMENT_METHOD).includes(submission.fulfilmentMethod);
    const validSpecifications = submission.specifications === undefined
        || (submission.specifications !== null && typeof submission.specifications === 'object' && !Array.isArray(submission.specifications));
    const duration = submission.auctionDurationHours ?? DEFAULT_AUCTION_DURATION_HOURS;
    const validAuctionDuration = AUCTION_DURATION_OPTIONS_HOURS.includes(duration);
    const reserveMode = submission.reservePriceMode ?? RESERVE_PRICE_MODE.none;
    const reservePrice = submission.reservePrice ?? null;
    const validReservePrice = reserveMode === RESERVE_PRICE_MODE.none
        ? reservePrice === null
        : reserveMode === RESERVE_PRICE_MODE.set
            && Number.isSafeInteger(reservePrice)
            && reservePrice > submission.startingBid
            && reservePrice <= config.auctionRules.maximumListingPrice;
    const validPriceLimit = submission.startingBid <= config.auctionRules.maximumListingPrice
        && (submission.buyNowPrice === null || submission.buyNowPrice <= config.auctionRules.maximumListingPrice);
    const requiredText = ['title', 'brandModel', 'description', 'location'];
    const hasRequiredText = requiredText.every(key => typeof submission[key] === 'string' && submission[key].trim().length > 0);

    return {
        valid: validCategory && validSubcategory && validCondition && validListingFormat && validStartingBid && validBidIncrement && validBuyNowPrice && validFulfilmentMethod && validSpecifications && validAuctionDuration && validReservePrice && validPriceLimit && hasRequiredText,
        validBidIncrement,
        validCategory,
        validSubcategory,
        validCondition,
        validListingFormat,
        validStartingBid,
        validBuyNowPrice,
        validFulfilmentMethod,
        validSpecifications,
        validAuctionDuration,
        validReservePrice,
        validPriceLimit,
        hasRequiredText
    };
}

export function validatePilotSellerListing(submission, photoCount) {
    const specifications = submission.specifications || {};
    const electronicListing = submission.category === CATEGORY.electronics;
    const eligibleSubcategory = isValidSubcategory(submission.category, submission.subcategory);
    const eligibleValue = Number.isSafeInteger(submission.estimatedValue)
        && submission.estimatedValue > 0
        && submission.estimatedValue <= config.auctionRules.maximumListingPrice;
    const categoryFields = SPECIFICATION_FIELDS_BY_SUBCATEGORY[submission.subcategory] || [];
    const completeDisclosures = !electronicListing || (['functionalStatus', 'knownDefects', 'proofOfPurchase', 'serialModelInfo']
        .filter(key => categoryFields.includes(key))
        .every(key => typeof specifications[key] === 'string' && specifications[key].trim().length > 0)
        && (![ 'smartphones', 'laptops' ].includes(submission.subcategory)
            || (typeof specifications.activationLock === 'string' && specifications.activationLock.trim().length > 0)));
    return {
        valid: eligibleSubcategory && eligibleValue && completeDisclosures && Number.isInteger(photoCount) && photoCount > 0,
        eligibleSubcategory,
        eligibleValue,
        completeDisclosures,
        hasPhotos: Number.isInteger(photoCount) && photoCount > 0
    };
}

export function validateMeetup(date, time, now = new Date()) {
    if (!date || !time) return false;
    const scheduledAt = new Date(`${date}T${time}`);
    return !Number.isNaN(scheduledAt.getTime()) && scheduledAt > now;
}

export function validateInspection(checks) {
    return Array.isArray(checks) && checks.length > 0 && checks.every(check => check === true);
}

export function validateSellerPhotos(files, maximumCount = 5) {
    if (files.length > maximumCount) return { valid: false, reason: 'too_many' };
    if (files.some(file => !file.type.startsWith('image/'))) return { valid: false, reason: 'not_images' };
    return { valid: true };
}

export function isRenderableSellerSubmission(submission) {
    return submission
        && typeof submission.id === 'string'
        && submission.id.length > 0
        && typeof submission.title === 'string'
        && Number.isSafeInteger(submission.startingBid)
        && submission.startingBid > 0;
}

export function isValidPurchaseSource(purchaseSource) {
    return Object.values(PURCHASE_SOURCE).includes(purchaseSource);
}
export function deriveInitials(displayName) {
    const words = displayName.split(' ').filter(Boolean);
    const letters = words.length > 1 ? words[0][0] + words.at(-1)[0] : displayName.slice(0, 2);
    return letters.toUpperCase();
}

export function validateProfileDetails({ displayName, locality, avatarColor }, allowedLocalities = MUMBAI_LOCALITIES) {
    const errors = {};
    const cleanName = String(displayName ?? '')
        .replace(/<[^>]*>/g, '')
        .replace(/[<>&"`\u0000-\u001f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!cleanName) errors.displayName = 'Enter a display name.';
    else if (cleanName.length > PROFILE_CONSTRAINTS.maximumDisplayNameLength) {
        errors.displayName = `Use ${PROFILE_CONSTRAINTS.maximumDisplayNameLength} characters or fewer.`;
    }
    if (!allowedLocalities.includes(locality)) errors.locality = 'Choose a Mumbai locality from the list.';
    if (!AVATAR_COLORS.some(color => color.id === avatarColor)) errors.avatarColor = 'Choose one of the listed colours.';
    return Object.keys(errors).length
        ? { ok: false, errors }
        : { ok: true, value: { displayName: cleanName, locality, avatarColor } };
}
