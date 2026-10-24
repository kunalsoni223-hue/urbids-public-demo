import { DEFAULT_FULFILMENT_METHOD, FULFILMENT_METHOD, SPECIFICATION_FIELD_LABELS } from './constants.js';
import { config } from '../config.js';

export function normalizeBidIncrement(value, currentBid) {
    if (config.sellerBidIncrements.includes(value) || value === 200 || value === 500) return value;
    const price = Number.isSafeInteger(currentBid) && currentBid > 0 ? currentBid : 0;
    return config.bidIncrements.find(rule => rule.maxCurrentBid === undefined || price <= rule.maxCurrentBid).amount;
}

const fulfilmentMethods = new Set(Object.values(FULFILMENT_METHOD));

export function normalizeFulfilmentMethod(value) {
    return fulfilmentMethods.has(value) ? value : DEFAULT_FULFILMENT_METHOD;
}

export function normalizeSpecifications(value) {
    if (!isRecord(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([key, field]) =>
        Object.hasOwn(SPECIFICATION_FIELD_LABELS, key)
        && (typeof field === 'string' || Number.isFinite(field)
            || (key === 'includedAccessories' && Array.isArray(field) && field.every(item => typeof item === 'string')))));
}

export function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isStableId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
}

export function normalizeTimestamp(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

export function normalizeStorageSchemaVersion(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function uniqueRecords(records) {
    const seen = new Set();
    return records.filter(record => {
        if (!isRecord(record) || !isStableId(record.id) || seen.has(record.id)) return false;
        seen.add(record.id);
        return true;
    });
}
