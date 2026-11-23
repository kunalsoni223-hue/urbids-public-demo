import { FAILURE_OUTCOME, LISTING_FORMAT, NOTIFICATION_TYPE, SPECIFICATION_FIELDS_BY_SUBCATEGORY, STORAGE_KEYS, TRANSACTION_STATUS } from '../core/constants.js';
import { readArray, readRecord, writeJSON } from '../core/storage.js';
import { getSampleListingQuestions } from '../data/sample-listing-questions.js';
import { isPrototypeUserId, isStableId, normalizeTimestamp, uniqueRecords } from '../core/normalization.js';
import { saveSellerSubmissions } from './submission-service.js';

const dismissReasons = new Set(['duplicate', 'already_answered', 'contact_request', 'inappropriate', 'not_relevant']);
const listingDetailFields = new Set([
    'batteryHealth', 'includedAccessories', 'knownDefects', 'proofOfPurchase', 'warrantyStatus', 'functionalStatus',
    'dimensions', 'signsOfWear', 'collectionRequirements', 'serviceHistory', 'edition',
    'completeness', 'annotations', 'size', 'originalPackaging'
]);
const sensitiveTextPatterns = [
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /(?:\+?\d[\s().-]*){10,}/,
    /\b(?:street|road|lane|apartment|flat|house|address)\b\s*[#,:-]?\s*\d+/i,
    /\b(?:email|phone number|contact number|whatsapp|home address|address|payment details?)\b/i,
    /\b(?:card|cvv|cvc|upi|account number|ifsc|payment details?)\b/i
];

function cleanText(value, maximumLength) {
    if (typeof value !== 'string') return '';
    return value.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximumLength);
}

function hasSensitiveText(value) {
    return sensitiveTextPatterns.some(pattern => pattern.test(value));
}

function supportsListingField(listing, field) {
    return listingDetailFields.has(field)
        && (SPECIFICATION_FIELDS_BY_SUBCATEGORY[listing?.subcategory] || []).includes(field);
}

function normalizeQuestion(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)
        || !isStableId(record.id) || !isStableId(record.listingId)
        || !isPrototypeUserId(record.questioningDemoUserId)) return null;
    const question = cleanText(record.question, 300);
    const answer = record.answer == null ? null : cleanText(record.answer, 500);
    const createdAt = normalizeTimestamp(record.createdAt);
    const answeredAt = normalizeTimestamp(record.answeredAt);
    const answeringSellerId = isPrototypeUserId(record.answeringSellerId) ? record.answeringSellerId : null;
    const publicStatus = record.publicStatus === 'dismissed' ? 'dismissed' : 'public';
    if (!question || hasSensitiveText(question) || (answer && hasSensitiveText(answer)) || !createdAt
        || (answer !== null && (!answer || !answeredAt || !answeringSellerId))) return null;
    return {
        id: record.id,
        listingId: record.listingId,
        questioningDemoUserId: record.questioningDemoUserId,
        question,
        createdAt,
        answer,
        answeredAt: answer ? answeredAt : null,
        answeringSellerId: answer ? answeringSellerId : null,
        publicStatus,
        ...(answer && listingDetailFields.has(record.listingDetailField) ? { listingDetailField: record.listingDetailField } : {}),
        prototypeSample: record.prototypeSample === true
    };
}

function activeListing(listing, transactionStore, now) {
    if (!listing || transactionStore.get(listing.id).status !== TRANSACTION_STATUS.auctionActive) return false;
    return listing.listingFormat === LISTING_FORMAT.buyNow || Date.parse(listing.auctionEndsAt) > now;
}

export function createListingEngagementService({
    listingStates, userService, transactionStore, notificationService, submissions = [],
    now = () => new Date(), random = Math.random
}) {
    const saved = uniqueRecords(readArray(STORAGE_KEYS.listingQuestions)).map(normalizeQuestion).filter(Boolean);
    const questions = saved;
    const samples = getSampleListingQuestions(Array.from(listingStates.values()));
    const savedRecentlyViewed = readRecord(STORAGE_KEYS.recentlyViewed);
    const recentlyViewedByUser = new Map(Object.entries(savedRecentlyViewed)
        .filter(([userId, ids]) => isPrototypeUserId(userId) && Array.isArray(ids))
        .map(([userId, ids]) => [userId, ids.filter(id => isStableId(id) && listingStates.has(id)).slice(0, 8)]));

    function persistQuestions(next) {
        return writeJSON(STORAGE_KEYS.listingQuestions, next);
    }

    function persistRecentlyViewed() {
        return writeJSON(STORAGE_KEYS.recentlyViewed, Object.fromEntries(recentlyViewedByUser));
    }

    function listingIsPublic(listing) {
        const outcome = listing && (listing.recoveryStatus || transactionStore.get(listing.id).failureOutcome);
        return Boolean(listing && !listing.secondChanceOffer && listing.publicationStatus !== 'unpublished'
            && listing.publicationStatus !== 'pending_review' && listing.publicationStatus !== 'rejected'
            && !listing.recoveryOnly && !Object.values(FAILURE_OUTCOME).includes(outcome));
    }

    function updateListingField(listing, field, value) {
        if (!supportsListingField(listing, field) || listing.bidCount > 0
            || transactionStore.get(listing.id).status !== TRANSACTION_STATUS.auctionActive) return false;
        const submission = submissions.find(item => item.listingId === listing.id && item.sellerUserId === listing.sellerUserId);
        if (submission) {
            const previousSpecifications = submission.specifications;
            submission.specifications = { ...(submission.specifications || {}), [field]: value };
            if (!saveSellerSubmissions(submissions)) {
                submission.specifications = previousSpecifications;
                return false;
            }
        }
        listing.specifications = { ...(listing.specifications || {}), [field]: value };
        if (field === 'includedAccessories') listing.accessories = Array.isArray(value)
            ? [...value] : value.split(',').map(item => item.trim()).filter(Boolean);
        return true;
    }

    function applySavedListingDetails() {
        questions.forEach(question => {
            if (!question.listingDetailField) return;
            const listing = listingStates.get(question.listingId);
            if (!listing || !question.answer) return;
            listing.specifications = { ...(listing.specifications || {}), [question.listingDetailField]: question.answer };
            if (question.listingDetailField === 'includedAccessories') {
                listing.accessories = question.answer.split(',').map(item => item.trim()).filter(Boolean);
            }
        });
    }

    function createNotification({ dedupeKey, recipientUserId, title, message, listingId }) {
        return notificationService?.create({
            dedupeKey: `listing-question:${dedupeKey}`,
            recipientUserId,
            title,
            message,
            listingId,
            type: NOTIFICATION_TYPE.listingQuestion
        }) || null;
    }

    function store(next) {
        if (!persistQuestions(next)) return false;
        questions.splice(0, questions.length, ...next);
        return true;
    }

    function validViewerQuestion(question, viewerId, listing) {
        return question.publicStatus === 'public'
            && (question.answer || listing?.sellerUserId === viewerId || question.questioningDemoUserId === viewerId);
    }

    applySavedListingDetails();

    return {
        getQuestions(listingId, viewerId = userService.getCurrentUser().id) {
            const listing = listingStates.get(listingId);
            if (!listingIsPublic(listing)) return [];
            return [...samples, ...questions]
                .filter(question => question.listingId === listingId
                    && (question.prototypeSample || (question.questioningDemoUserId !== listing.sellerUserId
                        && (!question.answer || question.answeringSellerId === listing.sellerUserId)))
                    && validViewerQuestion(question, viewerId, listing))
                .sort((left, right) => Number(!left.answer) - Number(!right.answer)
                    || Date.parse(left.createdAt) - Date.parse(right.createdAt))
                .map(question => ({ ...question }));
        },
        askQuestion(listingId, rawQuestion, { questionType = 'general' } = {}) {
            const listing = listingStates.get(listingId);
            const user = userService.getCurrentUser();
            const question = cleanText(rawQuestion, 300);
            if (!listingIsPublic(listing) || typeof rawQuestion !== 'string' || rawQuestion.length > 300
                || !question || hasSensitiveText(question) || question.length > 300
                || listing.sellerUserId === user.id) return { ok: false, code: 'invalid_question' };
            const created = now();
            const record = {
                id: `question-${created.getTime()}-${random().toString(36).slice(2, 10)}`,
                listingId,
                questioningDemoUserId: user.id,
                question,
                createdAt: created.toISOString(),
                answer: null,
                answeredAt: null,
                answeringSellerId: null,
                publicStatus: 'public',
                prototypeSample: false
            };
            if (!store([...questions, record])) return { ok: false, code: 'storage_failed' };
            createNotification({
                dedupeKey: `new:${record.id}`,
                recipientUserId: listing.sellerUserId,
                title: 'New question on your listing',
                message: `A buyer asked about ${listing.title}.`,
                listingId
            });
            return { ok: true, data: { ...record } };
        },
        answerQuestion(questionId, rawAnswer, sellerUserId, listingDetailField = null) {
            const question = questions.find(item => item.id === questionId);
            const listing = question && listingStates.get(question.listingId);
            const answer = cleanText(rawAnswer, 500);
            if (!question || !listing || question.publicStatus !== 'public' || question.answer
                || listing.sellerUserId !== sellerUserId || question.questioningDemoUserId === sellerUserId
                || !isPrototypeUserId(sellerUserId) || typeof rawAnswer !== 'string' || rawAnswer.length > 500
                || !answer || hasSensitiveText(answer) || answer.length > 500) {
                return { ok: false, code: 'invalid_answer' };
            }
            const updated = {
                ...question,
                answer,
                answeredAt: now().toISOString(),
                answeringSellerId: sellerUserId
            };
            if (listingDetailField) {
                if (!supportsListingField(listing, listingDetailField) || listing.bidCount > 0
                    || transactionStore.get(listing.id).status !== TRANSACTION_STATUS.auctionActive) return { ok: false, code: 'listing_locked' };
                updated.listingDetailField = listingDetailField;
            }
            const next = questions.map(item => item.id === questionId ? updated : item);
            if (!store(next)) return { ok: false, code: 'storage_failed' };
            if (listingDetailField && !updateListingField(listing, listingDetailField, answer)) {
                store(questions.map(item => item.id === questionId ? question : item));
                return { ok: false, code: 'storage_failed' };
            }
            createNotification({
                dedupeKey: `answered:${question.id}`,
                recipientUserId: question.questioningDemoUserId,
                title: 'Seller answered your question',
                message: `${listing.title} has a seller-provided answer.`,
                listingId: listing.id
            });
            if (listingDetailField) createNotification({
                dedupeKey: `listing-updated:${question.id}`,
                recipientUserId: question.questioningDemoUserId,
                title: 'Answer added to listing details',
                message: `${listing.title} now includes the seller's answer in its details.`,
                listingId: listing.id
            });
            return { ok: true, data: { ...updated } };
        },
        dismissQuestion(questionId, sellerUserId, reason) {
            const question = questions.find(item => item.id === questionId);
            const listing = question && listingStates.get(question.listingId);
            if (!question || !listing || question.answer || question.publicStatus !== 'public'
                || listing.sellerUserId !== sellerUserId || !dismissReasons.has(reason)) return { ok: false, code: 'invalid_dismissal' };
            const updated = { ...question, publicStatus: 'dismissed' };
            if (!store(questions.map(item => item.id === questionId ? updated : item))) return { ok: false, code: 'storage_failed' };
            createNotification({
                dedupeKey: `dismissed:${question.id}`,
                recipientUserId: question.questioningDemoUserId,
                title: 'Question dismissed',
                message: `The seller dismissed a question: ${({
                    duplicate: 'duplicate', already_answered: 'already covered in the listing',
                    contact_request: 'contact or payment details are not allowed', inappropriate: 'inappropriate',
                    not_relevant: 'not relevant to the item'
                })[reason]}.`,
                listingId: listing.id
            });
            return { ok: true, data: { ...updated } };
        },
        trackViewed(listingId, userId = userService.getCurrentUser().id) {
            const listing = listingStates.get(listingId);
            if (!isPrototypeUserId(userId) || !listingIsPublic(listing) || !activeListing(listing, transactionStore, Date.now())) return false;
            const previous = Array.isArray(recentlyViewedByUser.get(userId))
                ? recentlyViewedByUser.get(userId).filter(id => isStableId(id) && listingStates.has(id)) : [];
            recentlyViewedByUser.set(userId, [listingId, ...previous.filter(id => id !== listingId)].slice(0, 8));
            return persistRecentlyViewed();
        },
        getRecentlyViewed(userId = userService.getCurrentUser().id) {
            return (recentlyViewedByUser.get(userId) || []).map(id => listingStates.get(id))
                .filter(listing => listing && listingIsPublic(listing) && activeListing(listing, transactionStore, Date.now()));
        },
        resetRecentlyViewed(userId) {
            if (!isPrototypeUserId(userId)) return false;
            const previous = recentlyViewedByUser.get(userId);
            recentlyViewedByUser.delete(userId);
            if (persistRecentlyViewed()) return true;
            if (previous) recentlyViewedByUser.set(userId, previous);
            return false;
        },
        getNeedsSellerAction(userId = userService.getCurrentUser().id) {
            return questions.filter(question => !question.answer && question.publicStatus === 'public'
                && listingStates.get(question.listingId)?.sellerUserId === userId)
                .map(question => ({ ...question, listing: listingStates.get(question.listingId) }));
        },
        getAskedQuestions(userId = userService.getCurrentUser().id) {
            return questions.filter(question => question.questioningDemoUserId === userId && question.publicStatus === 'public')
                .map(question => ({ ...question, listing: listingStates.get(question.listingId) }))
                .filter(question => question.listing);
        },
        resetUser(userId) {
            if (!isPrototypeUserId(userId)) return false;
            const previousQuestions = [...questions];
            const next = previousQuestions.filter(question => question.questioningDemoUserId !== userId
                && listingStates.get(question.listingId)?.sellerUserId !== userId);
            const previousRecent = recentlyViewedByUser.get(userId);
            if (next.length !== previousQuestions.length && !store(next)) return false;
            recentlyViewedByUser.delete(userId);
            if (persistRecentlyViewed()) return true;
            if (previousRecent) recentlyViewedByUser.set(userId, previousRecent);
            if (next.length !== previousQuestions.length) store(previousQuestions);
            return false;
        },
        resetAll() {
            questions.splice(0, questions.length);
            recentlyViewedByUser.clear();
        },
        getSimilarListings(listingId, isPublicListing = listingIsPublic) {
            const current = listingStates.get(listingId);
            if (!current) return [];
            const price = current.buyNowPrice || current.currentBid;
            return Array.from(listingStates.values()).filter(listing => listing.id !== listingId
                && isPublicListing(listing) && activeListing(listing, transactionStore, Date.now()))
                .map((listing, index) => {
                    const comparisonPrice = listing.buyNowPrice || listing.currentBid;
                    const priceClose = Number.isFinite(price) && price > 0 && Number.isFinite(comparisonPrice)
                        && comparisonPrice >= price * 0.7 && comparisonPrice <= price * 1.3;
                    const score = (listing.subcategory === current.subcategory ? 100 : 0)
                        + (listing.category === current.category ? 20 : 0) + (priceClose ? 10 : 0);
                    return { listing, score, index };
                }).filter(item => item.score > 0)
                .sort((left, right) => right.score - left.score || left.index - right.index)
                .slice(0, 4).map(item => item.listing);
        },
        getSellerListings(sellerUserId, excludeListingId = null, isPublicListing = listingIsPublic, limit = 4) {
            return Array.from(listingStates.values()).filter(listing => listing.id !== excludeListingId
                && listing.sellerUserId === sellerUserId && isPublicListing(listing)
                && activeListing(listing, transactionStore, Date.now()))
                .slice(0, limit);
        },
        listingIsPublic
    };
}