import { config } from '../config.js';
import {
    AUCTION_DURATION_OPTIONS_HOURS,
    ALL_SUPPORTED_AUCTION_DURATION_OPTIONS_HOURS,
    DEFAULT_AUCTION_DURATION_HOURS,
    CONDITION_GRADE_LABELS,
    DEFAULT_SUBCATEGORY_BY_CATEGORY,
    DEFAULT_DEMO_USER_ID,
    FAILURE_OUTCOME,
    LEGACY_STATUS,
    LISTING_FORMAT,
    SPECIFICATION_FIELDS_BY_SUBCATEGORY,
    SELLER_LISTING_ID_PREFIX,
    RESERVE_PRICE_MODE,
    SECOND_CHANCE_OFFER_STATUS,
    SERVICE_ERROR_CODE,
    STORAGE_KEYS,
    SUBMISSION_STATUS,
} from '../core/constants.js';
import { readArray, readRecord, writeJSON } from '../core/storage.js';
import { isPrototypeUserId, isRecord, isStableId, normalizeBidIncrement, normalizeFulfilmentMethod, normalizeSpecifications, normalizeTimestamp, uniqueRecords } from '../core/normalization.js';
import { isValidSubcategory, validatePilotSellerListing, validateSellerListing } from '../core/validation.js';

const validStatuses = new Set(Object.values(SUBMISSION_STATUS));

export function saveSellerSubmissions(submissions) {
    return writeJSON(STORAGE_KEYS.sellerSubmissions, submissions);
}

export function loadSellerSubmissions() {
    const saved = readArray(STORAGE_KEYS.sellerSubmissions);
    const submissions = uniqueRecords(saved);
    const savedBids = readRecord(STORAGE_KEYS.bids);
    let changed = saved.length !== submissions.length;

    submissions.forEach(submission => {
        const before = JSON.stringify(submission);
        submission.listingId = `${SELLER_LISTING_ID_PREFIX}${submission.id}`;
        submission.bidIncrement = normalizeBidIncrement(submission.bidIncrement,
            savedBids[submission.listingId]?.currentBid ?? submission.startingBid);
        ['title', 'brandModel', 'description', 'location', 'sellerName', 'rejectionReason'].forEach(field => {
            if (typeof submission[field] !== 'string') submission[field] = '';
        });
        ['sourceListingId', 'relistedFrom', 'correctionOf', 'recoverySourceListingId', 'correctedListingId'].forEach(field => {
            submission[field] = isStableId(submission[field]) ? submission[field] : null;
        });
        if ('scenarioId' in submission) {
            delete submission.scenarioId;
            changed = true;
        }
        submission.correctionReason = typeof submission.correctionReason === 'string' ? submission.correctionReason.slice(0, 200) : '';
        submission.correctionChanges = Array.isArray(submission.correctionChanges)
            ? submission.correctionChanges.filter(field => typeof field === 'string').slice(0, 20) : [];
        submission.recoveryStatus = Object.values(FAILURE_OUTCOME).includes(submission.recoveryStatus)
            ? submission.recoveryStatus : null;
        submission.sellerAcknowledged = submission.sellerAcknowledged === true;
        submission.meetAndInspectAvailable = submission.meetAndInspectAvailable !== false;
        submission.recoveryOnly = submission.recoveryOnly === true;
        ['submittedAt', 'priceChangedAt'].forEach(field => {
            submission[field] = normalizeTimestamp(submission[field]);
        });
        submission.previousBuyNowPrice = Number.isSafeInteger(submission.previousBuyNowPrice)
            && submission.previousBuyNowPrice > 0 ? submission.previousBuyNowPrice : null;
        submission.estimatedValue = Number.isSafeInteger(submission.estimatedValue) && submission.estimatedValue > 0
            ? submission.estimatedValue : null;
        if (!Object.values(LISTING_FORMAT).includes(submission.listingFormat)) {
            submission.listingFormat = Number.isSafeInteger(submission.buyNowPrice)
                ? LISTING_FORMAT.auctionAndBuyNow : LISTING_FORMAT.auction;
            changed = true;
        }
        if (submission.buyNowPrice === undefined) submission.buyNowPrice = null;
        if (submission.relistedFrom && submission.buyNowPrice === null
            && submission.listingFormat !== LISTING_FORMAT.auction) {
            submission.listingFormat = LISTING_FORMAT.auction;
        }
        submission.photoCount = Number.isInteger(submission.photoCount) && submission.photoCount >= 0
            && submission.photoCount <= 10 ? submission.photoCount : null;
        submission.sellerAcknowledged = submission.sellerAcknowledged === true;
        submission.autoRelistLimit = [1, 3].includes(submission.autoRelistLimit) ? submission.autoRelistLimit : 0;
        submission.autoRelistCount = Number.isSafeInteger(submission.autoRelistCount) && submission.autoRelistCount >= 0
            ? submission.autoRelistCount : 0;
        submission.sellerReference = typeof submission.sellerReference === 'string'
            ? submission.sellerReference.replace(/<[^>]*>/g, '').slice(0, 40) : '';
        submission.conditionLabel = ['Like new', 'Excellent', 'Good', 'Fair', 'Defective'].includes(submission.conditionLabel)
            ? submission.conditionLabel : CONDITION_GRADE_LABELS[submission.condition] || '';
        if (submission.secondChanceOffer != null) {
            const offer = isRecord(submission.secondChanceOffer) ? submission.secondChanceOffer : {};
            const validOffer = isPrototypeUserId(offer.buyerUserId) && offer.buyerUserId !== submission.sellerUserId
                && Number.isSafeInteger(offer.price) && offer.price > 0 && normalizeTimestamp(offer.expiresAt)
                && Object.values(SECOND_CHANCE_OFFER_STATUS).includes(offer.status);
            // Keep corrupt private offers private and non-actionable.
            submission.secondChanceOffer = {
                buyerUserId: isPrototypeUserId(offer.buyerUserId) ? offer.buyerUserId : null,
                price: validOffer ? offer.price : null,
                status: validOffer ? offer.status : SECOND_CHANCE_OFFER_STATUS.expired,
                expiresAt: validOffer ? offer.expiresAt : null
            };
        } else submission.secondChanceOffer = null;
        if (!ALL_SUPPORTED_AUCTION_DURATION_OPTIONS_HOURS.includes(submission.auctionDurationHours)) {
            submission.auctionDurationHours = DEFAULT_AUCTION_DURATION_HOURS;
            changed = true;
        }
        const validReserve = submission.reservePriceMode === RESERVE_PRICE_MODE.set
            && Number.isSafeInteger(submission.reservePrice)
            && submission.reservePrice > submission.startingBid
            && submission.reservePrice <= config.auctionRules.maximumListingPrice;
        const reservePriceMode = validReserve ? RESERVE_PRICE_MODE.set : RESERVE_PRICE_MODE.none;
        const reservePrice = validReserve ? submission.reservePrice : null;
        if (submission.reservePriceMode !== reservePriceMode || submission.reservePrice !== reservePrice) {
            submission.reservePriceMode = reservePriceMode;
            submission.reservePrice = reservePrice;
            changed = true;
        }
        const fulfilmentMethod = normalizeFulfilmentMethod(submission.fulfilmentMethod);
        if (submission.fulfilmentMethod !== fulfilmentMethod) {
            submission.fulfilmentMethod = fulfilmentMethod;
            changed = true;
        }
        const specifications = normalizeSpecifications(submission.specifications);
        if (JSON.stringify(submission.specifications) !== JSON.stringify(specifications)) {
            submission.specifications = specifications;
            changed = true;
        }
        if (!isValidSubcategory(submission.category, submission.subcategory)) {
            const defaultSubcategory = DEFAULT_SUBCATEGORY_BY_CATEGORY[submission.category];
            if (defaultSubcategory) {
                submission.subcategory = defaultSubcategory;
                changed = true;
            }
        }
        if (!isPrototypeUserId(submission.sellerUserId)) {
            submission.sellerUserId = DEFAULT_DEMO_USER_ID;
            changed = true;
        }
        if (submission.status === LEGACY_STATUS.approvedSubmission || !submission.status || !validStatuses.has(submission.status)) {
            submission.status = SUBMISSION_STATUS.pendingReview;
            changed = true;
        }
        changed = changed || before !== JSON.stringify(submission);
    });

    if (changed) saveSellerSubmissions(submissions);
    return submissions;
}

export function loadSellerDraft(userId) {
    if (!isPrototypeUserId(userId)) return null;
    const drafts = readRecord(STORAGE_KEYS.sellerDrafts);
    const draft = drafts[userId];
    return isRecord(draft) ? { ...draft, values: isRecord(draft.values) ? draft.values : {} } : null;
}

export function saveSellerDraft(userId, values, now = new Date()) {
    if (!isPrototypeUserId(userId) || !isRecord(values)) return { ok: false, code: SERVICE_ERROR_CODE.invalidInput };
    const drafts = readRecord(STORAGE_KEYS.sellerDrafts);
    const draft = { userId, values, updatedAt: now.toISOString() };
    drafts[userId] = draft;
    if (!writeJSON(STORAGE_KEYS.sellerDrafts, drafts)) return { ok: false, code: SERVICE_ERROR_CODE.storageFailed };
    return { ok: true, draft };
}

export function deleteSellerDraft(userId) {
    if (!isPrototypeUserId(userId)) return { ok: false, code: SERVICE_ERROR_CODE.invalidInput };
    const drafts = readRecord(STORAGE_KEYS.sellerDrafts);
    if (!Object.hasOwn(drafts, userId)) return { ok: true };
    delete drafts[userId];
    if (!writeJSON(STORAGE_KEYS.sellerDrafts, drafts)) return { ok: false, code: SERVICE_ERROR_CODE.storageFailed };
    return { ok: true };
}

export function createSellerSubmission(fields, now = new Date(), random = Math.random) {
    const validation = validateSellerListing(fields);
    validation.validBidIncrement = config.sellerBidIncrements.includes(fields.bidIncrement);
    validation.valid = validation.valid && validation.validBidIncrement;
    if (!validation.valid) return { ok: false, code: SERVICE_ERROR_CODE.invalidInput, validation };
    const pilotValidation = fields.pilotMode
        ? validatePilotSellerListing(fields, fields.photoCount)
        : { valid: true };
    if (!pilotValidation.valid) return { ok: false, code: SERVICE_ERROR_CODE.invalidInput, validation: pilotValidation };

    const id = `${now.getTime()}-${random().toString(36).slice(2)}`;
    if (!isPrototypeUserId(fields.sellerUserId)) return { ok: false, code: SERVICE_ERROR_CODE.invalidInput };
    const submission = {
        id,
        listingId: `${SELLER_LISTING_ID_PREFIX}${id}`,
        title: fields.title.trim(),
        brandModel: fields.brandModel.trim(),
        category: fields.category,
        subcategory: fields.subcategory,
        sellerUserId: fields.sellerUserId,
        sellerName: typeof fields.sellerName === 'string' ? fields.sellerName.trim().slice(0, 60) : '',
        fulfilmentMethod: normalizeFulfilmentMethod(fields.fulfilmentMethod),
        meetAndInspectAvailable: fields.meetAndInspectAvailable !== false,
        specifications: { ...normalizeSpecifications(fields.specifications) },
        photoCount: Number.isSafeInteger(fields.photoCount) && fields.photoCount >= 0 && fields.photoCount <= 10
            ? fields.photoCount
            : 0,
        condition: fields.condition,
        conditionLabel: ['Like new', 'Excellent', 'Good', 'Fair', 'Defective'].includes(fields.conditionLabel)
            ? fields.conditionLabel : CONDITION_GRADE_LABELS[fields.condition] || '',
        description: fields.description.trim(),
        location: fields.location.trim(),
        estimatedValue: Number.isSafeInteger(fields.estimatedValue) ? fields.estimatedValue : null,
        listingFormat: fields.listingFormat || (Number.isSafeInteger(fields.buyNowPrice)
            ? LISTING_FORMAT.auctionAndBuyNow : LISTING_FORMAT.auction),
        startingBid: fields.startingBid,
        bidIncrement: fields.bidIncrement,
        buyNowPrice: fields.buyNowPrice,
        auctionDurationHours: fields.auctionDurationHours,
        sellerAcknowledged: fields.sellerAcknowledged === true,
        autoRelistLimit: [1, 3].includes(fields.autoRelistLimit) ? fields.autoRelistLimit : 0,
        autoRelistCount: 0,
        sellerReference: typeof fields.sellerReference === 'string' ? fields.sellerReference.replace(/<[^>]*>/g, '').slice(0, 40) : '',
        reservePriceMode: fields.reservePriceMode,
        reservePrice: fields.reservePrice,
        status: SUBMISSION_STATUS.pendingReview,
        rejectionReason: '',
        submittedAt: now.toISOString()
    };
    const submissions = loadSellerSubmissions();
    submissions.push(submission);
    if (!saveSellerSubmissions(submissions)) return { ok: false, code: SERVICE_ERROR_CODE.storageFailed };
    return { ok: true, data: submission, submission };
}

export function getSubmissionQualityChecklist(submission) {
    if (!submission || typeof submission !== 'object' || Array.isArray(submission)) return [];
    const specifications = normalizeSpecifications(submission.specifications);
    const declaredCount = (SPECIFICATION_FIELDS_BY_SUBCATEGORY[submission.subcategory] || [])
        .filter(key => specifications[key] !== undefined && specifications[key] !== null && String(specifications[key]).trim() !== '').length;
    const descriptionLength = typeof submission.description === 'string' ? submission.description.trim().length : 0;
    const photoCount = Number.isSafeInteger(submission.photoCount) ? submission.photoCount : null;
    return [
        { label: 'Title and brand/model are entered', complete: Boolean(submission.title && submission.brandModel) },
        { label: descriptionLength >= 80 ? `Description has useful detail (${descriptionLength} characters)` : 'Description may need more detail', complete: descriptionLength >= 80 },
        { label: photoCount === null ? 'Photo count not recorded for this saved listing' : `${photoCount} product photo${photoCount === 1 ? '' : 's'} selected`, complete: photoCount > 0 },
        { label: declaredCount ? `${declaredCount} product detail${declaredCount === 1 ? '' : 's'} provided` : 'No optional product details provided', complete: declaredCount > 0 },
        { label: specifications.knownDefects ? 'Seller-declared defects are noted' : 'No known-defect details supplied', complete: Boolean(specifications.knownDefects) }
    ];
}

export function resetSellerRecoveryForListing(listingId) {
    if (!isStableId(listingId)) return { ok: false, code: SERVICE_ERROR_CODE.invalidInput };
    const submissions = loadSellerSubmissions();
    const removed = submissions.filter(submission => (
        submission.correctionOf === listingId || submission.recoverySourceListingId === listingId
    ));
    const next = submissions.filter(submission => !removed.includes(submission));
    const original = next.find(submission => submission.listingId === listingId);
    if (original) {
        delete original.recoveryStatus;
        delete original.correctedListingId;
    }
    if ((!removed.length && !original) || saveSellerSubmissions(next)) return { ok: true, data: removed };
    return { ok: false, code: SERVICE_ERROR_CODE.storageFailed };
}