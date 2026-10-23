import { DISPUTE_REASON, DISPUTE_RESOLUTION, DISPUTE_STATUS, STORAGE_KEYS, TRANSACTION_STATUS } from '../core/constants.js';
import { readArray, writeJSON } from '../core/storage.js';
import { isDemoUserId } from '../data/demo-users.js';
import { isStableId, normalizeTimestamp, uniqueRecords } from '../core/normalization.js';

const validReasons = new Set(Object.values(DISPUTE_REASON));
const validResolutions = new Set(Object.values(DISPUTE_RESOLUTION));

export function createDisputeService({ listingStates, transactionStore, userService, notificationService = null, now = () => new Date(), random = Math.random }) {
    const disputes = uniqueRecords(readArray(STORAGE_KEYS.disputes)).filter(dispute => (
        dispute
        && typeof dispute === 'object'
        && !Array.isArray(dispute)
        && typeof dispute.id === 'string'
        && isStableId(dispute.listingId)
        && isDemoUserId(dispute.buyerUserId)
        && isDemoUserId(dispute.sellerUserId)
        && isDemoUserId(dispute.reportingUserId)
        && dispute.buyerUserId !== dispute.sellerUserId
        && [dispute.buyerUserId, dispute.sellerUserId].includes(dispute.reportingUserId)
        && validReasons.has(dispute.reason)
        && Object.values(DISPUTE_STATUS).includes(dispute.status)
        && (dispute.status === DISPUTE_STATUS.open || validResolutions.has(dispute.resolution))
    )).map(dispute => ({
        ...dispute,
        transactionId: dispute.listingId,
        description: typeof dispute.description === 'string' ? dispute.description.slice(0, 500) : '',
        evidenceNote: typeof dispute.evidenceNote === 'string' ? dispute.evidenceNote.slice(0, 300) : '',
        resolution: dispute.status === DISPUTE_STATUS.open ? null : dispute.resolution,
        createdAt: normalizeTimestamp(dispute.createdAt),
        resolvedAt: normalizeTimestamp(dispute.resolvedAt)
    }));

    function getOpenForListing(listingId) {
        return disputes.find(dispute => dispute.listingId === listingId && dispute.status === DISPUTE_STATUS.open) || null;
    }

    function canReport(listingId, userId = userService.getCurrentUser().id) {
        const transaction = transactionStore.get(listingId);
        const shippingDeadline = Date.parse(transaction.shippingInspectionEndsAt);
        const shippingWindowOpen = transaction.status !== TRANSACTION_STATUS.shippingDelivered
            || (Number.isFinite(shippingDeadline) && shippingDeadline >= now().getTime());
        return Boolean(listingStates.has(listingId)
            && transaction.buyerUserId
            && transaction.sellerUserId
            && transaction.status !== TRANSACTION_STATUS.completed
            && transaction.status !== TRANSACTION_STATUS.cancelled
            && transaction.status !== TRANSACTION_STATUS.unavailable
            && shippingWindowOpen
            && [transaction.buyerUserId, transaction.sellerUserId].includes(userId)
            && !getOpenForListing(listingId));
    }

    function persist() {
        return writeJSON(STORAGE_KEYS.disputes, disputes);
    }

    function removeMatching(predicate) {
        const previous = [...disputes];
        const next = disputes.filter(dispute => !predicate(dispute));
        if (next.length === disputes.length) return true;
        disputes.splice(0, disputes.length, ...next);
        const saved = next.length ? persist() : writeJSON(STORAGE_KEYS.disputes, []);
        if (saved) return true;
        disputes.splice(0, disputes.length, ...previous);
        return false;
    }

    return {
        canReport,
        hasOpenDispute(listingId) {
            return Boolean(getOpenForListing(listingId));
        },
        getOpenForListing,
        getLatestForListing(listingId) {
            const matching = disputes.filter(dispute => dispute.listingId === listingId);
            return matching[matching.length - 1] || null;
        },
        getForUser(userId) {
            return disputes.filter(dispute => dispute.buyerUserId === userId || dispute.sellerUserId === userId);
        },
        removeForUser(userId) {
            if (!isDemoUserId(userId)) return false;
            return removeMatching(dispute => dispute.buyerUserId === userId || dispute.sellerUserId === userId);
        },
        removeForListing(listingId) {
            return removeMatching(dispute => dispute.listingId === listingId);
        },
        getAll() {
            return [...disputes];
        },
        openDispute(listingId, { reason, description, evidenceNote = '' } = {}) {
            const currentUserId = userService.getCurrentUser().id;
            const transaction = transactionStore.get(listingId);
            const cleanDescription = typeof description === 'string' ? description.trim() : '';
            const cleanEvidenceNote = typeof evidenceNote === 'string' ? evidenceNote.trim() : '';
            if (!canReport(listingId, currentUserId)
                || !validReasons.has(reason)
                || !cleanDescription
                || cleanDescription.length > 500
                || cleanEvidenceNote.length > 300) return null;

            const createdAt = now();
            const dispute = {
                id: `dispute-${createdAt.getTime()}-${random().toString(36).slice(2)}`,
                transactionId: listingId,
                listingId,
                reportingUserId: currentUserId,
                buyerUserId: transaction.buyerUserId,
                sellerUserId: transaction.sellerUserId,
                reason,
                description: cleanDescription,
                evidenceNote: cleanEvidenceNote,
                status: DISPUTE_STATUS.open,
                resolution: null,
                createdAt: createdAt.toISOString(),
                resolvedAt: null
            };
            disputes.push(dispute);
            if (!persist()) {
                disputes.pop();
                return null;
            }
            notificationService?.notifyDisputeOpened(dispute, listingStates.get(listingId)?.title);
            return { ...dispute };
        },
        resolveDispute(disputeId, resolution) {
            if (!validResolutions.has(resolution)) return null;
            const dispute = disputes.find(item => item.id === disputeId && item.status === DISPUTE_STATUS.open);
            if (!dispute) return null;

            const previous = { ...dispute };
            dispute.status = DISPUTE_STATUS.resolved;
            dispute.resolution = resolution;
            dispute.resolvedAt = now().toISOString();
            if (!persist()) {
                Object.assign(dispute, previous);
                return null;
            }

            const transaction = transactionStore.resolveDispute(dispute.listingId, resolution);
            if (!transaction) {
                Object.assign(dispute, previous);
                persist();
                return null;
            }
            notificationService?.notifyDisputeResolved(dispute, listingStates.get(dispute.listingId)?.title);
            return { dispute: { ...dispute }, transaction };
        }
    };
}