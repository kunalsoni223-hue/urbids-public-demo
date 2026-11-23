import { CATEGORY, STORAGE_KEYS, SUBCATEGORIES_BY_CATEGORY, USABILITY_EVENT_TYPE, USABILITY_JOURNEY } from '../core/constants.js';
import { readArray, writeJSON } from '../core/storage.js';
import { isStableId, uniqueRecords } from '../core/normalization.js';

const eventTypes = new Set(Object.values(USABILITY_EVENT_TYPE));
const metadataKeys = new Set(['code', 'category', 'subcategory', 'filter', 'fulfilment', 'outcome', 'source', 'questionType', 'shareMethod', 'interest', 'format', 'durationOption', 'bidIncrementOption', 'autoRelistChoice', 'shelf', 'localityGroup', 'shortcutId', 'discoveryMode']);
const discoveryShelves = new Set(['popular', 'ending_soon', 'newly_listed', 'recently_viewed', 'watched_categories']);
const localityGroups = new Set(['all_mumbai', 'western_suburbs', 'central_mumbai', 'south_mumbai', 'eastern_suburbs', 'thane']);
const searchShortcutIds = new Set(['iphone', 'laptops', 'sneakers', 'coffee_machines', 'sofas', 'watches', 'gaming', 'cameras', 'designer_bags', 'collectibles']);
const sensitiveText = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|(?:\+?\d[\s().-]*){10,}|\b(?:street|road|lane|apartment|flat|house|address)\b\s*[#,:-]?\s*\d+|\b(?:card|cvv|cvc|upi|account number|ifsc)\b/i;
const feedbackKeys = ['conceptClarity', 'trust', 'biddingClarity', 'inspectionPaymentClarity', 'easeOfUse'];
const feedbackPolicyKeys = [
    'winnerCommitmentClear',
    'reservationDepositUnderstandable',
    'handoverChoiceAppropriate',
    'onPlatformValueSufficient'
];
const productCategories = new Set(['electronics', 'furniture', 'home_appliances', 'fashion', 'books_collectibles', 'other']);

function cleanMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
    return Object.fromEntries(Object.entries(metadata).filter(([key, value]) => {
        if (!metadataKeys.has(key) || !['string', 'number', 'boolean'].includes(typeof value)) return false;
        if (typeof value === 'string' && !/^[A-Za-z0-9_-]{1,48}$/.test(value)) return false;
        if (key === 'category' && !Object.values(CATEGORY).includes(value)) return false;
        if (key === 'subcategory' && !Object.values(SUBCATEGORIES_BY_CATEGORY).some(values => values.includes(value))) return false;
        if (key === 'interest' && !['buying', 'selling', 'both'].includes(value)) return false;
        if (key === 'shareMethod' && !['native', 'copied'].includes(value)) return false;
        if (key === 'fulfilment' && !['in_person', 'simple_collection', 'shipping', 'both'].includes(value)) return false;
        if (key === 'shelf' && !discoveryShelves.has(value)) return false;
        if (key === 'localityGroup' && !localityGroups.has(value)) return false;
        if (key === 'shortcutId' && !searchShortcutIds.has(value)) return false;
        if (key === 'discoveryMode' && !['for_you', 'ending_soon', 'popular', 'newly_listed'].includes(value)) return false;
        return typeof value !== 'number' || Number.isFinite(value);
    }));
}

function safeFeedbackText(value) {
    const text = typeof value === 'string' ? value.trim().slice(0, 500) : '';
    return sensitiveText.test(text) ? '' : text;
}

export function createPublicResearchService({ userService = null, onEvent = () => {}, now = () => new Date(), random = Math.random } = {}) {
    const events = uniqueRecords(readArray(STORAGE_KEYS.usabilityEvents)).filter(event => (
        event && eventTypes.has(event.type)
        && typeof event.timestamp === 'string' && Number.isFinite(Date.parse(event.timestamp))
        && (event.relatedId == null || isStableId(event.relatedId))
    )).map(event => ({
        id: event.id,
        type: event.type,
        relatedId: isStableId(event.relatedId) ? event.relatedId : null,
        listingId: isStableId(event.listingId) ? event.listingId : null,
        localUserId: typeof event.localUserId === 'string' && /^local-[A-Za-z0-9_-]{1,80}$/.test(event.localUserId) ? event.localUserId : null,
        timestamp: new Date(event.timestamp).toISOString(),
        metadata: cleanMetadata(event.metadata)
    })).slice(-5000);
    const feedback = uniqueRecords(readArray(STORAGE_KEYS.feedback));

    function recordEvent(type, { relatedId = null, metadata = {} } = {}) {
        if (!eventTypes.has(type)) return false;
        const event = {
            id: `public-event-${now().getTime().toString(36)}-${random().toString(36).slice(2, 10)}`,
            type,
            relatedId: isStableId(relatedId) ? relatedId : null,
            listingId: isStableId(relatedId) ? relatedId : null,
            localUserId: /^local-[A-Za-z0-9_-]{1,80}$/.test(userService?.getCurrentUser()?.id || '')
                ? userService.getCurrentUser().id : null,
            timestamp: now().toISOString(),
            metadata: cleanMetadata(metadata)
        };
        events.push(event);
        const next = events.slice(-5000);
        if (!writeJSON(STORAGE_KEYS.usabilityEvents, next)) {
            events.pop();
            return false;
        }
        onEvent(event);
        return true;
    }

    return {
        recordEvent,
        getEvents() {
            return events.map(event => ({ ...event, metadata: { ...event.metadata } }));
        },
        submitFeedback(input) {
            if (!input || !Object.values(USABILITY_JOURNEY).includes(input.journey)
                || !feedbackKeys.every(key => Number.isInteger(input.scores?.[key]) && input.scores[key] >= 1 && input.scores[key] <= 5)
                || !productCategories.has(input.likelyBuyCategory)
                || !productCategories.has(input.likelySellCategory)
                || !feedbackPolicyKeys.every(key => ['yes', 'no', 'unsure'].includes(input.policyAnswers?.[key]))) {
                return { ok: false, message: 'Complete each required response before submitting.' };
            }
            const response = {
                id: `public-feedback-${now().getTime().toString(36)}-${random().toString(36).slice(2, 10)}`,
                journey: input.journey,
                scores: Object.fromEntries(feedbackKeys.map(key => [key, input.scores[key]])),
                policyAnswers: Object.fromEntries(feedbackPolicyKeys.map(key => [key, input.policyAnswers[key]])),
                confusing: safeFeedbackText(input.confusing),
                preventUse: safeFeedbackText(input.preventUse),
                valuable: safeFeedbackText(input.valuable),
                likelyBuyCategory: input.likelyBuyCategory,
                likelySellCategory: input.likelySellCategory,
                createdAt: now().toISOString()
            };
            feedback.push(response);
            if (!writeJSON(STORAGE_KEYS.feedback, feedback)) {
                feedback.pop();
                return { ok: false, message: 'Feedback could not be saved in this browser.' };
            }
            recordEvent(USABILITY_EVENT_TYPE.feedbackSubmitted);
            return { ok: true, data: response };
        }
    };
}
