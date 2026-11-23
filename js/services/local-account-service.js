import { STORAGE_KEYS, LOCAL_ACCOUNT_INTEREST, PROFILE_CONSTRAINTS, AVATAR_COLORS, MUMBAI_LOCALITIES } from '../core/constants.js';
import { readArray, readJSON, readRecord, writeJSON, removeStoredValue } from '../core/storage.js';
import { isRecord } from '../core/normalization.js';
import { deriveInitials, validateProfileDetails } from '../core/validation.js';

const ACCOUNT_DATA_VERSION = 1;
const validInterests = new Set(Object.values(LOCAL_ACCOUNT_INTEREST));
const validAvatarColors = new Set(AVATAR_COLORS.map(color => color.id));
const validLocalId = value => typeof value === 'string' && /^local-[A-Za-z0-9_-]{1,180}$/.test(value);

export function createLocalAccountService() {
    const saved = readRecord(STORAGE_KEYS.localUsers);
    const accountsSource = saved.version === ACCOUNT_DATA_VERSION && isRecord(saved.accounts)
        ? saved.accounts
        : Object.fromEntries(Object.entries(saved).filter(([key, value]) => key.startsWith('local-') && isRecord(value)));
    const accounts = new Map();
    Object.entries(accountsSource).forEach(([userId, data]) => {
        const normalized = normalizeAccount(userId, data);
        if (normalized) accounts.set(userId, normalized);
    });

    const legacyCurrentId = saved.version === ACCOUNT_DATA_VERSION
        ? saved.activeUserId
        : readJSON(STORAGE_KEYS.legacyCurrentLocalUser, null, validLocalId);
    let activeUserId = validLocalId(legacyCurrentId) && accounts.has(legacyCurrentId) ? legacyCurrentId : null;
    let lastUserId = validLocalId(saved.lastUserId) && accounts.has(saved.lastUserId)
        ? saved.lastUserId
        : activeUserId || Array.from(accounts.keys()).at(-1) || null;

    function normalizeAccount(userId, data) {
        if (!validLocalId(userId) || !isRecord(data)) return null;
        const profile = validateProfileDetails({
            displayName: data.displayName,
            locality: data.locality,
            avatarColor: validAvatarColors.has(data.avatarColor) ? data.avatarColor : 'default'
        }, MUMBAI_LOCALITIES);
        if (!profile.ok || !validInterests.has(data.interest)) return null;
        const createdAt = typeof data.createdAt === 'string' && Number.isFinite(Date.parse(data.createdAt))
            ? new Date(data.createdAt).toISOString()
            : Number.isFinite(data.createdAt) ? new Date(data.createdAt).toISOString() : new Date().toISOString();
        return Object.freeze({
            id: userId,
            ...profile.value,
            interest: data.interest,
            initials: deriveInitials(profile.value.displayName),
            createdAt,
            memberSince: Number.isInteger(data.memberSince) ? data.memberSince : new Date(createdAt).getFullYear()
        });
    }

    function serialize(accountsToWrite, activeId, lastId) {
        return {
            version: ACCOUNT_DATA_VERSION,
            activeUserId: activeId,
            lastUserId: lastId,
            accounts: Object.fromEntries(accountsToWrite)
        };
    }

    function persist(nextAccounts = accounts, nextActiveId = activeUserId, nextLastId = lastUserId) {
        return writeJSON(STORAGE_KEYS.localUsers, serialize(nextAccounts, nextActiveId, nextLastId));
    }

    if (saved.version !== ACCOUNT_DATA_VERSION || readJSON(STORAGE_KEYS.legacyCurrentLocalUser, null, validLocalId)) {
        const migrated = writeJSON(STORAGE_KEYS.localUsers, serialize(accounts, activeUserId, lastUserId));
        if (migrated) removeStoredValue(STORAGE_KEYS.legacyCurrentLocalUser);
    }

    return {
        getLocalUsers: () => Array.from(accounts.values()),
        getLocalUser: userId => accounts.get(userId) || null,
        hasLocalUsers: () => accounts.size > 0,
        getCurrentLocalUser: () => activeUserId ? accounts.get(activeUserId) || null : null,
        getLastLocalUser: () => lastUserId ? accounts.get(lastUserId) || null : null,
        setCurrentLocalUser(userId) {
            if (userId && (!validLocalId(userId) || !accounts.has(userId))) return false;
            const nextLastUserId = userId || lastUserId;
            if (!persist(accounts, userId || null, nextLastUserId)) return false;
            activeUserId = userId || null;
            lastUserId = nextLastUserId;
            return true;
        },

        createLocalAccount(input) {
            if (!isRecord(input)) return { ok: false, errors: { form: 'Invalid input' } };
            const result = validateProfileDetails(
                {
                    displayName: input.displayName,
                    locality: input.locality,
                    avatarColor: input.avatarColor || 'default'
                },
                MUMBAI_LOCALITIES
            );
            if (!result.ok) return { ok: false, errors: result.errors };
            if (!validInterests.has(input.interest)) return { ok: false, errors: { interest: 'Select Buying, Selling, or Both.' } };
            const avatarColor = input.avatarColor || 'default';
            if (!validAvatarColors.has(avatarColor)) return { ok: false, errors: { avatarColor: 'Choose one of the listed colours.' } };
            const id = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
            const newUser = Object.freeze({
                id,
                ...result.value,
                interest: input.interest,
                initials: deriveInitials(result.value.displayName),
                createdAt: new Date().toISOString(),
                memberSince: new Date().getFullYear()
            });
            const nextAccounts = new Map(accounts);
            nextAccounts.set(id, newUser);
            if (!persist(nextAccounts, id, id)) {
                return { ok: false, errors: { form: 'This browser could not save your account. Check browser storage and try again.' } };
            }
            accounts.set(id, newUser);
            activeUserId = id;
            lastUserId = id;
            return { ok: true, data: newUser };
        },

        deleteLocalAccount(userId) {
            if (!validLocalId(userId) || !accounts.has(userId)) return false;
            const nextAccounts = new Map(accounts);
            nextAccounts.delete(userId);
            const nextActive = activeUserId === userId ? null : activeUserId;
            const nextLast = lastUserId === userId ? Array.from(nextAccounts.keys()).at(-1) || null : lastUserId;
            const autoBids = readRecord(STORAGE_KEYS.autoBids);
            const nextAutoBids = Object.fromEntries(Object.entries(autoBids)
                .map(([listingId, entries]) => [listingId, Array.isArray(entries)
                    ? entries.filter(entry => entry?.userId !== userId) : entries])
                .filter(([, entries]) => Array.isArray(entries) ? entries.length > 0 : true));
            const notifications = readArray(STORAGE_KEYS.notifications);
            const nextNotifications = notifications.filter(item => item?.recipientUserId !== userId);
            const recentlyViewed = readRecord(STORAGE_KEYS.recentlyViewed);
            const nextRecentlyViewed = { ...recentlyViewed };
            delete nextRecentlyViewed[userId];
            if (JSON.stringify(nextAutoBids) !== JSON.stringify(autoBids)
                && !(Object.keys(nextAutoBids).length
                    ? writeJSON(STORAGE_KEYS.autoBids, nextAutoBids)
                    : removeStoredValue(STORAGE_KEYS.autoBids))) return false;
            if (nextNotifications.length !== notifications.length
                && !(nextNotifications.length
                    ? writeJSON(STORAGE_KEYS.notifications, nextNotifications)
                    : removeStoredValue(STORAGE_KEYS.notifications))) return false;
            if (Object.hasOwn(recentlyViewed, userId)
                && !(Object.keys(nextRecentlyViewed).length
                    ? writeJSON(STORAGE_KEYS.recentlyViewed, nextRecentlyViewed)
                    : removeStoredValue(STORAGE_KEYS.recentlyViewed))) return false;
            if (!persist(nextAccounts, nextActive, nextLast)) return false;
            accounts.delete(userId);
            activeUserId = nextActive;
            lastUserId = nextLast;
            return true;
        },

        updateLocalUser(userId, input) {
            if (!validLocalId(userId) || !accounts.has(userId) || !isRecord(input)) {
                return { ok: false, errors: { form: 'Account could not be updated.' } };
            }
            const result = validateProfileDetails(input, MUMBAI_LOCALITIES);
            if (!result.ok) return { ok: false, errors: result.errors };
            const updated = Object.freeze({ ...accounts.get(userId), ...result.value, initials: deriveInitials(result.value.displayName) });
            const nextAccounts = new Map(accounts);
            nextAccounts.set(userId, updated);
            if (!persist(nextAccounts)) return { ok: false, errors: { form: 'This browser could not save the profile.' } };
            accounts.set(userId, updated);
            return { ok: true, data: updated };
        },
        isLocalUserId: validLocalId,
        clearAll() {
            if (!removeStoredValue(STORAGE_KEYS.localUsers) || !removeStoredValue(STORAGE_KEYS.legacyCurrentLocalUser)) return false;
            accounts.clear();
            activeUserId = null;
            lastUserId = null;
            return true;
        }
    };
}
