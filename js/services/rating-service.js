import { DEFAULT_DEMO_USER_ID, RATING_CONSTRAINTS, SERVICE_ERROR_CODE, STORAGE_KEYS, TRANSACTION_STATUS } from '../core/constants.js';
import { readArray, writeJSON } from '../core/storage.js';
import { getDemoUser, isDemoUserId } from '../data/demo-users.js';
import { sampleReviews } from '../data/sample-reviews.js';
import { isStableId, normalizeTimestamp, uniqueRecords } from '../core/normalization.js';

export function createRatingService({ listingStates, transactionStore, userService, notificationService = null, now = () => new Date() }) {
    const seenRatingDirections = new Set();
    const ratings = uniqueRecords(readArray(STORAGE_KEYS.ratings)).filter(rating => (
        rating
        && typeof rating === 'object'
        && !Array.isArray(rating)
        && typeof rating.id === 'string'
        && isStableId(rating.transactionId)
        && isDemoUserId(rating.reviewerUserId)
        && isDemoUserId(rating.reviewedUserId)
        && rating.reviewerUserId !== rating.reviewedUserId
        && Number.isInteger(rating.score)
        && rating.score >= RATING_CONSTRAINTS.minimumScore
        && rating.score <= RATING_CONSTRAINTS.maximumScore
    )).filter(rating => {
        const direction = `${rating.transactionId}:${rating.reviewerUserId}`;
        if (seenRatingDirections.has(direction)) return false;
        seenRatingDirections.add(direction);
        return true;
    }).map(rating => ({
        ...rating,
        listingId: rating.transactionId,
        comment: typeof rating.comment === 'string' ? rating.comment.slice(0, RATING_CONSTRAINTS.maximumCommentLength) : '',
        createdAt: normalizeTimestamp(rating.createdAt)
    }));

    function reviewedUserFor(transaction, reviewerUserId) {
        if (reviewerUserId === transaction.buyerUserId) return transaction.sellerUserId;
        if (reviewerUserId === transaction.sellerUserId) return transaction.buyerUserId;
        return null;
    }

    function getReceivedRatings(userId) {
        return ratings.filter(rating => rating.reviewedUserId === userId);
    }

    function getReputation(userId) {
        const user = userService.getUser(userId) || getDemoUser(DEFAULT_DEMO_USER_ID);
        const received = getReceivedRatings(user.id);
        const completedTransactions = Array.from(listingStates.keys()).filter(listingId => {
            const transaction = transactionStore.get(listingId);
            return transaction.status === TRANSACTION_STATUS.completed
                && [transaction.buyerUserId, transaction.sellerUserId].includes(user.id);
        }).length;
        const ratingWeight = user.completedTransactions;
        const totalRatingWeight = ratingWeight + received.length;
        const averageRating = totalRatingWeight
            ? (user.sellerRating * ratingWeight + received.reduce((total, rating) => total + rating.score, 0)) / totalRatingWeight
            : user.sellerRating;

        return {
            ...user,
            sellerRating: Math.round(averageRating * 10) / 10,
            completedTransactions: user.completedTransactions + completedTransactions,
            noShowCount: 0,
            receivedRatingCount: received.length
        };
    }

    // Seeded sample reviews are static and never counted again in the derived reputation.
    function getPublicReviews(userId) {
        const submitted = getReceivedRatings(userId).map(rating => ({
            id: rating.id,
            score: rating.score,
            comment: rating.comment,
            role: transactionStore.get(rating.transactionId).sellerUserId === userId ? 'seller' : 'buyer',
            productTitle: listingStates.get(rating.transactionId)?.title || 'Completed transaction',
            reviewerName: userService.getUser(rating.reviewerUserId)?.firstName || 'Demo user',
            date: rating.createdAt,
            sample: false
        }));
        const seeded = sampleReviews.filter(review => review.reviewedUserId === userId).map(({ reviewedUserId, ...review }) => review);
        return [...submitted, ...seeded].sort((left, right) => Date.parse(right.date) - Date.parse(left.date));
    }

    function removeMatching(predicate) {
        const next = ratings.filter(rating => !predicate(rating));
        if (next.length === ratings.length) return true;
        const saved = writeJSON(STORAGE_KEYS.ratings, next);
        if (!saved) return false;
        ratings.splice(0, ratings.length, ...next);
        return true;
    }

    return {
        canRate(transactionId, reviewerUserId = userService.getCurrentUser().id) {
            const transaction = transactionStore.get(transactionId);
            const reviewedUserId = reviewedUserFor(transaction, reviewerUserId);
            return transaction.status === TRANSACTION_STATUS.completed
                && isDemoUserId(reviewerUserId)
                && isDemoUserId(reviewedUserId)
                && reviewedUserId !== reviewerUserId
                && !ratings.some(rating => rating.transactionId === transactionId && rating.reviewerUserId === reviewerUserId);
        },
            getCounterparty(transactionId, reviewerUserId = userService.getCurrentUser().id) {
                return reviewedUserFor(transactionStore.get(transactionId), reviewerUserId);
            },
        submitRating(transactionId, score, comment = '') {
            const reviewerUserId = userService.getCurrentUser().id;
            const transaction = transactionStore.get(transactionId);
            const reviewedUserId = reviewedUserFor(transaction, reviewerUserId);
            const cleanComment = typeof comment === 'string' ? comment.trim() : '';
            if (!this.canRate(transactionId, reviewerUserId)) {
                const duplicate = ratings.some(rating => rating.transactionId === transactionId && rating.reviewerUserId === reviewerUserId);
                return {
                    ok: false,
                    code: duplicate ? SERVICE_ERROR_CODE.ratingAlreadySubmitted : SERVICE_ERROR_CODE.ratingNotAllowed
                };
            }
            if (!Number.isInteger(score)
                || score < RATING_CONSTRAINTS.minimumScore
                || score > RATING_CONSTRAINTS.maximumScore
                || cleanComment.length > RATING_CONSTRAINTS.maximumCommentLength) {
                return { ok: false, code: SERVICE_ERROR_CODE.invalidInput };
            }

            const createdAt = now();
            const rating = {
                id: `rating-${transactionId}-${reviewerUserId}`,
                transactionId,
                listingId: transactionId,
                reviewerUserId,
                reviewedUserId,
                score,
                comment: cleanComment,
                createdAt: createdAt.toISOString()
            };
            ratings.push(rating);
            if (!writeJSON(STORAGE_KEYS.ratings, ratings)) {
                ratings.pop();
                return { ok: false, code: SERVICE_ERROR_CODE.storageFailed };
            }
            notificationService?.notifyRatingReceived(rating, listingStates.get(transactionId)?.title);
            return { ok: true, data: { ...rating } };
        },
        getRating(transactionId, reviewerUserId) {
            return ratings.find(rating => rating.transactionId === transactionId && rating.reviewerUserId === reviewerUserId) || null;
        },
        getReceivedRatings,
        getPublicReviews,
        getRatingsForTransaction(transactionId) {
            return ratings.filter(rating => rating.transactionId === transactionId);
        },
        removeForUser(userId) {
            if (!isDemoUserId(userId)) return false;
            return removeMatching(rating => rating.reviewerUserId === userId || rating.reviewedUserId === userId);
        },
        getReputation
    };
}