import { DEFAULT_DEMO_USER_ID, MUMBAI_LOCALITIES, SERVICE_ERROR_CODE, STORAGE_KEYS, USER_TYPE } from '../core/constants.js';
import { readArray, readRecord, removeStoredValue, writeJSON } from '../core/storage.js';
import { demoUsers, isDemoUserId } from '../data/demo-users.js';
import { isPrototypeUserId, isRecord, isStableId } from '../core/normalization.js';
import { deriveInitials, validateProfileDetails } from '../core/validation.js';
import { config } from '../config.js';

const visitorUser = Object.freeze({
    id: 'prototype-visitor',
    firstName: 'Visitor',
    location: `${config.pilotCity}`,
    sellerRating: null,
    completedTransactions: 0,
    memberSince: null,
    initials: 'V',
    avatarColor: 'default',
    isGuest: true
});

export function createUserService(listingStates, localAccountService) {
    const savedWatchlists = readRecord(STORAGE_KEYS.userWatchlists);
    const observations = Object.fromEntries(Object.entries(isRecord(savedWatchlists._observations) ? savedWatchlists._observations : {})
        .filter(([userId]) => isPrototypeUserId(userId))
        .map(([userId, records]) => [userId, Object.fromEntries(Object.entries(isRecord(records) ? records : {})
            .filter(([listingId, record]) => listingStates.has(listingId) && isRecord(record))
            .map(([listingId, record]) => [listingId, {
                bidCount: Number.isSafeInteger(record.bidCount) && record.bidCount >= 0 ? record.bidCount : listingStates.get(listingId).bidCount,
                buyNowPrice: Number.isSafeInteger(record.buyNowPrice) && record.buyNowPrice > 0 ? record.buyNowPrice : null,
                ended: record.ended === true,
                relistedId: isStableId(record.relistedId) ? record.relistedId : null,
                flags: Array.isArray(record.flags) ? [...new Set(record.flags.filter(flag =>
                    ['New bid', 'Price changed', 'Relisted', 'Auction ended', 'Ending soon'].includes(flag)))] : []
            }]))]));
    const watchlists = new Map([...demoUsers.map(user => {
        const saved = Array.isArray(savedWatchlists[user.id])
            ? savedWatchlists[user.id]
            : user.id === DEFAULT_DEMO_USER_ID
                ? readArray(STORAGE_KEYS.watchlist)
                : [];
        return [user.id, new Set(saved.filter(listingId => listingStates.has(listingId)))];
    }), ...localAccountService.getLocalUsers().map(user => [
        user.id,
        new Set((Array.isArray(savedWatchlists[user.id]) ? savedWatchlists[user.id] : [])
            .filter(listingId => listingStates.has(listingId)))
    ])]);

    const localitySuffix = `, ${config.pilotCity}`;
    const baseLocality = user => user.location.replace(localitySuffix, '');
    const profileOverrides = new Map();
    Object.entries(readRecord(STORAGE_KEYS.userProfiles)).forEach(([userId, saved]) => {
        const base = demoUsers.find(user => user.id === userId);
        const result = base && isRecord(saved)
            ? validateProfileDetails({ avatarColor: 'default', ...saved }, [baseLocality(base), ...MUMBAI_LOCALITIES]) : null;
        if (result?.ok) profileOverrides.set(userId, result.value);
    });

    const withProfile = user => {
        const override = profileOverrides.get(user.id);
        if (!override) return { ...user, avatarColor: 'default' };
        return {
            ...user,
            firstName: override.displayName,
            location: `${override.locality}${localitySuffix}`,
            initials: deriveInitials(override.displayName),
            avatarColor: override.avatarColor
        };
    };

    function getUserById(userId) {
        if (isDemoUserId(userId)) {
            const user = demoUsers.find(candidate => candidate.id === userId);
            return user ? withProfile(user) : null;
        } else if (localAccountService.isLocalUserId(userId)) {
            const localUser = localAccountService.getLocalUser(userId);
            if (!localUser) return null;
            return {
                id: localUser.id,
                firstName: localUser.displayName,
                location: `${localUser.locality}${localitySuffix}`,
                sellerRating: null,
                completedTransactions: 0,
                memberSince: localUser.memberSince,
                initials: localUser.initials,
                avatarColor: localUser.avatarColor,
                isNewMember: true,
                isLocalAccount: true
            };
        }
        return null;
    }

    const persistProfiles = () => (profileOverrides.size
        ? writeJSON(STORAGE_KEYS.userProfiles, Object.fromEntries(profileOverrides))
        : removeStoredValue(STORAGE_KEYS.userProfiles));

    function persistWatchlists() {
        return writeJSON(STORAGE_KEYS.userWatchlists, {
            ...Object.fromEntries(Array.from(watchlists, ([userId, listingIds]) => [userId, Array.from(listingIds)])),
            _observations: observations
        });
    }

    if (!Object.hasOwn(savedWatchlists, DEFAULT_DEMO_USER_ID)) persistWatchlists();

    return {
        getUsers() {
            return demoUsers.map(withProfile);
        },
        getBaseUser(userId) {
            return demoUsers.find(user => user.id === userId) || null;
        },
        getLocalityOptions(userId) {
            if (localAccountService.isLocalUserId(userId)) return [...MUMBAI_LOCALITIES];
            const base = demoUsers.find(user => user.id === userId);
            if (!base) return [...MUMBAI_LOCALITIES];
            return base && !MUMBAI_LOCALITIES.includes(baseLocality(base)) ? [baseLocality(base), ...MUMBAI_LOCALITIES] : [...MUMBAI_LOCALITIES];
        },
        updateProfile(userId, details) {
            if (localAccountService.isLocalUserId(userId)) {
                const result = localAccountService.updateLocalUser(userId, details);
                return result.ok
                    ? { ok: true, data: getUserById(userId) }
                    : { ok: false, code: SERVICE_ERROR_CODE.invalidInput, errors: result.errors };
            }
            const base = demoUsers.find(user => user.id === userId);
            if (!base) return { ok: false, code: SERVICE_ERROR_CODE.invalidInput, errors: {} };
            const result = validateProfileDetails(details, this.getLocalityOptions(userId));
            if (!result.ok) return { ok: false, code: SERVICE_ERROR_CODE.invalidInput, errors: result.errors };
            const previous = profileOverrides.get(userId);
            profileOverrides.set(userId, result.value);
            if (!persistProfiles()) {
                if (previous) profileOverrides.set(userId, previous);
                else profileOverrides.delete(userId);
                return { ok: false, code: SERVICE_ERROR_CODE.storageFailed, errors: {} };
            }
            return { ok: true, data: getUserById(userId) };
        },
        resetProfile(userId) {
            if (!profileOverrides.has(userId)) return true;
            const previous = profileOverrides.get(userId);
            profileOverrides.delete(userId);
            if (persistProfiles()) return true;
            profileOverrides.set(userId, previous);
            return false;
        },
        getWatchObservations(userId) {
            const saved = observations[userId];
            return saved && typeof saved === 'object' && !Array.isArray(saved) ? { ...saved } : {};
        },
        saveWatchObservations(userId, next) {
            if (!isPrototypeUserId(userId)) return false;
            const previous = observations[userId];
            observations[userId] = next;
            if (persistWatchlists()) return true;
            observations[userId] = previous;
            return false;
        },
        getUser: getUserById,
        getCurrentUser() {
            const localUser = localAccountService.getCurrentLocalUser();
            return localUser ? getUserById(localUser.id) : visitorUser;
            },
            getCurrentUserId() {
                return this.getCurrentUser().id;
        },
        isListingOwner(listingId, userId = this.getCurrentUserId()) {
            return listingStates.get(listingId)?.sellerUserId === userId;
        },
        switchToLocalUser(userId) {
            if (!localAccountService.setCurrentLocalUser(userId)) return false;
            if (!watchlists.has(userId)) watchlists.set(userId, new Set());
            return true;
        },
        leaveLocalUser() {
            return localAccountService.setCurrentLocalUser(null);
        },
        returnToLocalUser() {
            const user = localAccountService.getLastLocalUser();
            return user ? this.switchToLocalUser(user.id) : false;
        },
        getCurrentUserType() {
            if (localAccountService.getCurrentLocalUser()) return USER_TYPE.local;
            return USER_TYPE.guest;
        },
        getWatchlist(userId = this.getCurrentUserId()) {
            return new Set(watchlists.get(userId) || []);
        },
        saveWatchlist(userId, nextWatchlist) {
            if (!isPrototypeUserId(userId)) return false;
            if (!watchlists.has(userId)) watchlists.set(userId, new Set());
            if (!watchlists.has(userId)) return false;
            const previous = watchlists.get(userId);
            watchlists.set(userId, new Set(nextWatchlist));
            const previousObservations = observations[userId];
            observations[userId] = Object.fromEntries(Object.entries(this.getWatchObservations(userId))
                .filter(([listingId]) => nextWatchlist.has(listingId) && previous.has(listingId)));
            if (persistWatchlists()) return true;
            watchlists.set(userId, previous);
            observations[userId] = previousObservations;
            return false;
        },
        resetWatchlist(userId) {
            if (!isPrototypeUserId(userId) || !this.saveWatchlist(userId, new Set())) return false;
            return userId !== DEFAULT_DEMO_USER_ID || removeStoredValue(STORAGE_KEYS.watchlist);
        },
        removeLocalWatchlist(userId) {
            if (!localAccountService.isLocalUserId(userId)) return false;
            const previous = watchlists.get(userId);
            watchlists.delete(userId);
            const previousObservations = observations[userId];
            delete observations[userId];
            if (persistWatchlists()) return true;
            if (previous) watchlists.set(userId, previous);
            if (previousObservations) observations[userId] = previousObservations;
            return false;
        }
    };
}