import { STORAGE_KEYS } from '../core/constants.js';
import { normalizeTimestamp } from '../core/normalization.js';
import { readRecord, removeStoredValue, writeJSON } from '../core/storage.js';
import { isDemoUserId } from '../data/demo-users.js';

// Private maximum bids are kept apart from public bid history and are only ever returned to their owner.
export function loadAutoBids() {
    const autoBids = new Map();
    Object.entries(readRecord(STORAGE_KEYS.autoBids)).forEach(([listingId, entries]) => {
        if (!Array.isArray(entries)) return;
        const seenUsers = new Set();
        const valid = entries.filter(entry => entry
            && typeof entry === 'object'
            && isDemoUserId(entry.userId)
            && !seenUsers.has(entry.userId)
            && seenUsers.add(entry.userId)
            && Number.isSafeInteger(entry.maxAmount)
            && entry.maxAmount > 0).map(entry => ({
            userId: entry.userId,
            maxAmount: entry.maxAmount,
            enabled: entry.enabled !== false,
            priorityAt: normalizeTimestamp(entry.priorityAt) || new Date().toISOString(),
            epoch: Number.isSafeInteger(entry.epoch) && entry.epoch >= 0 ? entry.epoch : 0
        }));
        if (valid.length) autoBids.set(listingId, valid);
    });
    return autoBids;
}

export function saveAutoBids(autoBids) {
    const record = Object.fromEntries(Array.from(autoBids).filter(([, entries]) => entries.length));
    return Object.keys(record).length
        ? writeJSON(STORAGE_KEYS.autoBids, record)
        : removeStoredValue(STORAGE_KEYS.autoBids);
}

function compareEntries(left, right) {
    return right.max - left.max
        || left.priority - right.priority
        || left.userId.localeCompare(right.userId);
}

/**
 * Pure resolution of resulting bids. `bestBids` maps userId to that user's highest actual bid
 * ({ amount, at }); `proxies` are eligible, enabled maxima. Returns at most two ordered steps:
 * the runner-up's resulting bid (if its maximum is above the current price) and the winner's bid.
 */
export function planProxyBids({ currentBid, leaderUserId, bestBids, proxies, minimumNextBid }) {
    const entries = new Map();
    bestBids.forEach((bid, userId) => entries.set(userId, { userId, max: bid.amount, priority: bid.at }));
    proxies.forEach(proxy => {
        const bid = bestBids.get(proxy.userId);
        const proxyAt = Date.parse(proxy.priorityAt);
        if (bid && proxy.maxAmount < bid.amount) return;
        const proxyGoverns = !bid || proxy.maxAmount > bid.amount;
        entries.set(proxy.userId, {
            userId: proxy.userId,
            max: proxy.maxAmount,
            priority: proxyGoverns ? proxyAt : Math.min(bid.at, proxyAt)
        });
    });
    const ranked = Array.from(entries.values()).sort(compareEntries);
    if (ranked.length === 1) {
        const [bidder] = ranked;
        const amount = minimumNextBid(currentBid);
        return bidder.userId !== leaderUserId && bidder.max >= amount
            ? [{ userId: bidder.userId, amount }] : [];
    }
    if (!ranked.length) return [];

    const [winner, runnerUp] = ranked;
    const steps = [];
    let price = currentBid;
    let leader = leaderUserId;
    if (runnerUp.max >= minimumNextBid(price) && (bestBids.get(runnerUp.userId)?.amount ?? 0) < runnerUp.max) {
        steps.push({ userId: runnerUp.userId, amount: runnerUp.max });
        price = runnerUp.max;
        leader = runnerUp.userId;
    }
    if (winner.userId === leader) return steps;

    const needed = minimumNextBid(price);
    if (winner.max >= needed) steps.push({ userId: winner.userId, amount: needed });
    else if (winner.max === price) steps.push({ userId: winner.userId, amount: price, tiePriority: true });
    return steps;
}
