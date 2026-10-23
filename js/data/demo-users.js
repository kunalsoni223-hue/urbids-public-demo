import { DEMO_USER_IDS } from '../core/constants.js';

export const demoUsers = Object.freeze([
    Object.freeze({
        id: DEMO_USER_IDS.kunal,
        firstName: 'Kunal',
        location: 'Bandra West, Mumbai',
        sellerRating: 4.9,
        completedTransactions: 24,
        memberSince: 2019,
        initials: 'KS'
    }),
    Object.freeze({
        id: DEMO_USER_IDS.mira,
        firstName: 'Mira',
        location: 'Powai, Mumbai',
        sellerRating: 4.8,
        completedTransactions: 18,
        memberSince: 2020,
        initials: 'MR'
    }),
    Object.freeze({
        id: DEMO_USER_IDS.arjun,
        firstName: 'Arjun',
        location: 'Andheri West, Mumbai',
        sellerRating: 4.7,
        completedTransactions: 15,
        memberSince: 2021,
        initials: 'AN'
    }),
    Object.freeze({
        id: DEMO_USER_IDS.sana,
        firstName: 'Sana',
        location: 'Worli, Mumbai',
        sellerRating: 4.9,
        completedTransactions: 21,
        memberSince: 2018,
        initials: 'SI'
    }),
    Object.freeze({
        id: DEMO_USER_IDS.rohan,
        firstName: 'Rohan',
        location: 'Lower Parel, Mumbai',
        sellerRating: 4.6,
        completedTransactions: 11,
        memberSince: 2022,
        initials: 'RK'
    })
]);

const demoUsersById = new Map(demoUsers.map(user => [user.id, user]));

export function getDemoUser(userId) {
    return demoUsersById.get(userId) || null;
}

export function isDemoUserId(userId) {
    return demoUsersById.has(userId);
}