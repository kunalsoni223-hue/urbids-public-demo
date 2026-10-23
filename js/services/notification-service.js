import { DISPUTE_RESOLUTION_LABELS, NOTIFICATION_TYPE, STORAGE_KEYS, SUBMISSION_STATUS, TRANSACTION_EVENT } from '../core/constants.js';
import { readArray, removeStoredValue, writeJSON } from '../core/storage.js';
import { isDemoUserId } from '../data/demo-users.js';
import { isStableId, normalizeTimestamp, uniqueRecords } from '../core/normalization.js';

const validNotificationTypes = new Set(Object.values(NOTIFICATION_TYPE));
const notificationPriority = new Map([
    [NOTIFICATION_TYPE.outbid, 0],
    [NOTIFICATION_TYPE.autoBid, 0],
    [NOTIFICATION_TYPE.auctionWon, 1],
    [NOTIFICATION_TYPE.buyNow, 2],
    [NOTIFICATION_TYPE.meetupRequested, 3],
    [NOTIFICATION_TYPE.shippingUpdate, 4],
    [NOTIFICATION_TYPE.disputeOpened, 5],
    [NOTIFICATION_TYPE.disputeResolved, 6],
    [NOTIFICATION_TYPE.ratingReceived, 7],
    [NOTIFICATION_TYPE.listingPublished, 8],
    [NOTIFICATION_TYPE.listingRejected, 9]
]);

function isValidNotification(notification) {
    return notification
        && typeof notification === 'object'
        && !Array.isArray(notification)
        && typeof notification.id === 'string'
        && typeof notification.dedupeKey === 'string'
        && isDemoUserId(notification.recipientUserId)
        && typeof notification.title === 'string'
        && typeof notification.message === 'string'
        && normalizeTimestamp(notification.createdAt);
}

export function createNotificationService({ now = () => new Date(), random = Math.random, onChange = () => {} } = {}) {
    const seenEvents = new Set();
    const notifications = uniqueRecords(readArray(STORAGE_KEYS.notifications)).filter(isValidNotification).reduce((valid, notification) => {
        const eventKey = JSON.stringify([notification.recipientUserId, notification.dedupeKey]);
        if (seenEvents.has(eventKey)) return valid;
        seenEvents.add(eventKey);
        valid.push({
            ...notification,
            type: validNotificationTypes.has(notification.type) ? notification.type : NOTIFICATION_TYPE.generic,
            listingId: isStableId(notification.listingId) ? notification.listingId : null,
            readAt: normalizeTimestamp(notification.readAt)
        });
        return valid;
    }, []).slice(-300);

    function persist(next) {
        return writeJSON(STORAGE_KEYS.notifications, next);
    }

    function removeMatching(predicate) {
        const next = notifications.filter(item => !predicate(item));
        if (next.length === notifications.length) return true;
        const saved = next.length ? persist(next) : removeStoredValue(STORAGE_KEYS.notifications);
        if (!saved) return false;
        notifications.splice(0, notifications.length, ...next);
        onChange();
        return true;
    }

    return {
        create({ dedupeKey, recipientUserId, title, message, listingId = null, type = NOTIFICATION_TYPE.generic } = {}) {
            if (typeof dedupeKey !== 'string' || !dedupeKey.trim()
                || !isDemoUserId(recipientUserId)
                || typeof title !== 'string' || !title.trim()
                || typeof message !== 'string' || !message.trim()
                || !validNotificationTypes.has(type)) return null;
            const existing = notifications.find(item => item.dedupeKey === dedupeKey && item.recipientUserId === recipientUserId);
            if (existing) return { ...existing };
            const created = now();
            const createdAt = created.toISOString();
            const notification = {
                id: `notification-${created.getTime()}-${random().toString(36).slice(2)}`,
                dedupeKey,
                type,
                recipientUserId,
                title: title.trim(),
                message: message.trim(),
                listingId: typeof listingId === 'string' ? listingId : null,
                createdAt,
                readAt: null
            };
            const next = [...notifications, notification].slice(-300);
            if (!persist(next)) return null;
            notifications.splice(0, notifications.length, ...next);
            onChange();
            return { ...notification };
        },
        notifyOutbid({ listing, previousHighestBid, bid }) {
            if (!listing || !previousHighestBid || !bid || previousHighestBid.bidderUserId === bid.bidderUserId) return null;
            return this.create({
                dedupeKey: `outbid:${listing.id}:${bid.bidderUserId}:${bid.amount}`,
                recipientUserId: previousHighestBid.bidderUserId,
                type: NOTIFICATION_TYPE.outbid,
                title: 'You were outbid',
                message: `A higher bid was placed on ${listing.title}.`,
                listingId: listing.id
            });
        },
        notifyBidResult({ listing, recipientUserId, amount, placedAt, leading }) {
            return this.create({
                dedupeKey: `next-bid:${listing.id}:${recipientUserId}:${amount}:${placedAt}`,
                recipientUserId,
                type: leading ? NOTIFICATION_TYPE.generic : NOTIFICATION_TYPE.outbid,
                title: leading ? 'Bid accepted' : 'Immediately outbid',
                message: leading ? `You are leading on ${listing.title}.`
                    : `Your bid on ${listing.title} was accepted. Another buyer's automatic bid is ahead.`,
                listingId: listing.id
            });
        },
        notifyAutoBid({ listing, recipientUserId, kind, epoch, title, message }) {
            if (!listing || !kind) return null;
            return this.create({
                dedupeKey: `auto-bid:${listing.id}:${recipientUserId}:${epoch}:${kind}`,
                recipientUserId,
                type: kind === 'exceeded' ? NOTIFICATION_TYPE.outbid : NOTIFICATION_TYPE.autoBid,
                title,
                message,
                listingId: listing.id
            });
        },
        notifyAuctionWon({ listing, transaction }) {
            if (!listing || !transaction?.buyerUserId) return null;
            const wonWithAutoBid = Array.isArray(transaction.bidHistory)
                && transaction.bidHistory.some(bid => bid.auto === true
                    && bid.bidderUserId === transaction.buyerUserId && bid.amount === transaction.winningBid);
            return this.create({
                dedupeKey: `auction-won:${listing.id}:${transaction.winningBid}`,
                recipientUserId: transaction.buyerUserId,
                type: NOTIFICATION_TYPE.auctionWon,
                title: 'Confirm your purchase within 6 hours',
                message: `You won ${listing.title}${wonWithAutoBid ? ' through automatic bidding' : ''}. Confirm by ${new Date(transaction.winnerResponseDeadline).toLocaleString()} to continue.`,
                listingId: listing.id
            });
        },
        notifyBuyNow({ listing, transaction }) {
            if (!listing || !transaction?.buyerUserId || !transaction.sellerUserId) return null;
            return this.create({
                dedupeKey: `buy-now:${listing.id}:${transaction.buyerUserId}`,
                recipientUserId: transaction.sellerUserId,
                type: NOTIFICATION_TYPE.buyNow,
                title: 'Buy Now selection',
                message: `${listing.title} has a buyer.`,
                listingId: listing.id
            });
        },
        notifyMeetupRequested({ meetup, transaction }) {
            if (!meetup || !transaction?.sellerUserId) return null;
            return this.create({
                dedupeKey: `meetup-request:${meetup.id}`,
                recipientUserId: transaction.sellerUserId,
                type: NOTIFICATION_TYPE.meetupRequested,
                title: 'Meetup request saved',
                message: `${meetup.itemTitle}: ${meetup.date} at ${meetup.time}. Saved locally; no message was sent.`,
                listingId: meetup.listingId
            });
        },
        notifyShippingUpdate({ listing, transaction, event, actorUserId }) {
            if (!listing || !transaction?.shippingReference) return null;
            const recipientUserId = actorUserId === transaction.buyerUserId
                ? transaction.sellerUserId
                : transaction.buyerUserId;
            const updates = {
                [TRANSACTION_EVENT.requestShipping]: { stage: 'requested', message: 'The buyer requested simulated shipping.' },
                [TRANSACTION_EVENT.shippingDispatched]: { stage: 'dispatched', message: 'The seller simulated dispatch.' },
                [TRANSACTION_EVENT.shippingDelivered]: { stage: 'delivered', message: 'Delivery was simulated. The buyer has 24 hours to inspect.' },
                [TRANSACTION_EVENT.shippingAccept]: { stage: 'accepted', message: 'The buyer accepted the item.' }
            };
            const update = updates[event];
            if (!update || !recipientUserId) return null;
            return this.create({
                dedupeKey: `shipping:${transaction.shippingReference}:${update.stage}`,
                recipientUserId,
                type: NOTIFICATION_TYPE.shippingUpdate,
                title: 'Shipping demo update',
                message: `${listing.title}: ${update.message}`,
                listingId: listing.id
            });
        },
        notifyDisputeOpened(dispute, listingTitle) {
            if (!dispute) return [];
            return [dispute.buyerUserId, dispute.sellerUserId].filter(isDemoUserId).map(recipientUserId => this.create({
                dedupeKey: `dispute-opened:${dispute.id}:${recipientUserId}`,
                recipientUserId,
                type: NOTIFICATION_TYPE.disputeOpened,
                title: 'Transaction issue reported',
                message: `${listingTitle || 'A listing'} is paused while the issue is reviewed.`,
                listingId: dispute.listingId
            })).filter(Boolean);
        },
        notifyDisputeResolved(dispute, listingTitle) {
            if (!dispute) return [];
            const resolution = DISPUTE_RESOLUTION_LABELS[dispute.resolution] || 'No action';
            return [dispute.buyerUserId, dispute.sellerUserId].filter(isDemoUserId).map(recipientUserId => this.create({
                dedupeKey: `dispute-resolved:${dispute.id}:${recipientUserId}`,
                recipientUserId,
                type: NOTIFICATION_TYPE.disputeResolved,
                title: 'Issue review updated',
                message: `The issue for ${listingTitle || 'a listing'} was resolved: ${resolution}.`,
                listingId: dispute.listingId
            })).filter(Boolean);
        },
        notifyRatingReceived(rating, listingTitle) {
            if (!rating?.id || !isDemoUserId(rating.reviewedUserId) || !rating.listingId) return null;
            return this.create({
                dedupeKey: `rating-received:${rating.id}`,
                recipientUserId: rating.reviewedUserId,
                type: NOTIFICATION_TYPE.ratingReceived,
                title: 'New rating received',
                message: `${listingTitle || 'A transaction'} received a new rating.`,
                listingId: rating.listingId
            });
        },
        notifySubmissionReview(submission, listingId) {
            if (!submission?.sellerUserId || ![SUBMISSION_STATUS.published, SUBMISSION_STATUS.rejected].includes(submission.status)) return null;
            const published = submission.status === SUBMISSION_STATUS.published;
            return this.create({
                dedupeKey: `listing-review:${submission.id}:${submission.status}:${submission.publishedAt || submission.rejectionReason || ''}`,
                recipientUserId: submission.sellerUserId,
                type: published ? NOTIFICATION_TYPE.listingPublished : NOTIFICATION_TYPE.listingRejected,
                title: published ? 'Listing published' : 'Listing review update',
                message: published
                    ? `${submission.title} is now listed in the marketplace.`
                    : `${submission.title} was not approved${submission.rejectionReason ? `: ${submission.rejectionReason}` : '.'}`,
                listingId
            });
        },
        getForUser(userId) {
            return notifications
                .filter(item => item.recipientUserId === userId)
                .sort((left, right) => Number(Boolean(left.readAt)) - Number(Boolean(right.readAt))
                    || (notificationPriority.get(left.type) ?? 99) - (notificationPriority.get(right.type) ?? 99)
                    || Date.parse(right.createdAt) - Date.parse(left.createdAt))
                .map(item => ({ ...item }));
        },
        getUnreadCount(userId) {
            return notifications.filter(item => item.recipientUserId === userId && !item.readAt).length;
        },
        removeForUser(userId) {
            if (!isDemoUserId(userId)) return false;
            return removeMatching(item => item.recipientUserId === userId);
        },
        removeForListing(listingId) {
            return removeMatching(item => item.listingId === listingId);
        },
        markRead(notificationId, userId) {
            const notification = notifications.find(item => item.id === notificationId && item.recipientUserId === userId);
            if (!notification) return false;
            if (notification.readAt) return true;
            const next = notifications.map(item => item === notification ? { ...item, readAt: now().toISOString() } : item);
            if (!persist(next)) return false;
            notifications.splice(0, notifications.length, ...next);
            return true;
        },
        markAllRead(userId) {
            if (!isDemoUserId(userId)) return false;
            const readAt = now().toISOString();
            const next = notifications.map(item => item.recipientUserId === userId && !item.readAt ? { ...item, readAt } : item);
            if (!persist(next)) return false;
            notifications.splice(0, notifications.length, ...next);
            return true;
        }
    };
}
