import { DEMO_USER_IDS } from '../core/constants.js';

// Fictional prototype content: reviewers, products and transactions are invented and not linked to real listings.
// `role` is the role the reviewed user had in the fictional transaction.
const review = (reviewedUserId, number, role, score, comment, productTitle, reviewerName, date) => Object.freeze({
    id: `sample-review-${reviewedUserId.replace('demo-user-', '')}-${number}`,
    reviewedUserId, role, score, comment, productTitle, reviewerName, date, sample: true
});

const { kunal, mira, arjun, sana, rohan } = DEMO_USER_IDS;

export const sampleReviews = Object.freeze([
    review(kunal, 1, 'seller', 5, 'Item matched the listing and the handover was straightforward.', 'Mirrorless camera body', 'Neha P.', '2026-08-18'),
    review(kunal, 2, 'seller', 5, 'Payment and collection were completed without issues.', 'Acoustic guitar', 'Dev R.', '2026-07-30'),
    review(kunal, 3, 'seller', 4, 'Clear communication. Arranging the meetup took a little longer than expected.', 'Desk lamp set', 'Isha M.', '2026-07-11'),
    review(kunal, 4, 'buyer', 5, 'Turned up on time and paid promptly.', 'Vintage film camera', 'Farah K.', '2026-06-25'),
    review(kunal, 5, 'seller', 4, 'Product condition was accurate, although one accessory was missing from the first message.', 'Bluetooth speaker', 'Aman T.', '2026-06-02'),
    review(kunal, 6, 'seller', 5, 'Well packed and as described.', 'Hardcover book set', 'Rhea S.', '2026-05-14'),
    review(mira, 1, 'seller', 5, 'Condition was as described and the meetup was easy to arrange.', 'Leather satchel', 'Karan J.', '2026-08-22'),
    review(mira, 2, 'seller', 4, 'Good item. Replies were a bit slow but everything went smoothly in the end.', 'Stand mixer', 'Pooja D.', '2026-08-03'),
    review(mira, 3, 'buyer', 5, 'Prompt payment and a friendly handover.', 'Ceramic dinner set', 'Vikram N.', '2026-07-19'),
    review(mira, 4, 'seller', 5, 'Item matched the listing.', 'Running shoes', 'Anita B.', '2026-07-01'),
    review(mira, 5, 'seller', 3, 'Item was fine but had a few more scuffs than the photos suggested.', 'Travel suitcase', 'Sameer L.', '2026-06-12'),
    review(mira, 6, 'buyer', 4, 'Easy to deal with. Asked to move the meetup time once.', 'Wall clock', 'Tara G.', '2026-05-27'),
    review(arjun, 1, 'seller', 5, 'Straightforward handover and the item worked as described.', 'Gaming headset', 'Meera C.', '2026-08-26'),
    review(arjun, 2, 'seller', 4, 'Clear communication and fair pricing.', 'Mechanical keyboard', 'Rahul V.', '2026-08-05'),
    review(arjun, 3, 'buyer', 5, 'Collected on time and paid as agreed.', 'Tablet stand', 'Divya H.', '2026-07-16'),
    review(arjun, 4, 'seller', 4, 'Product condition was accurate, although the charger was not the original.', 'Compact keyboard', 'Nikhil A.', '2026-06-29'),
    review(arjun, 5, 'seller', 2, 'Item was as listed, but the handover was rescheduled twice.', 'Monitor arm', 'Sonal F.', '2026-06-08'),
    review(sana, 1, 'seller', 5, 'Everything matched the listing and she was easy to coordinate with.', 'Silk scarf collection', 'Kabir O.', '2026-08-29'),
    review(sana, 2, 'seller', 5, 'Payment and collection were completed without issues.', 'Brass table lamp', 'Lata E.', '2026-08-09'),
    review(sana, 3, 'buyer', 5, 'Quick to respond and on time for the meetup.', 'Fountain pen', 'Yash W.', '2026-07-24'),
    review(sana, 4, 'seller', 4, 'Good condition overall. Packaging was basic.', 'Art print set', 'Zoya Q.', '2026-07-05'),
    review(sana, 5, 'seller', 5, 'Item was exactly as described.', 'Wooden side table', 'Harsh U.', '2026-06-18'),
    review(sana, 6, 'buyer', 4, 'Pleasant to deal with. Needed a reminder about the meetup time.', 'Cookware set', 'Mitali Y.', '2026-05-31'),
    review(rohan, 1, 'seller', 4, 'Item matched the listing and the handover was straightforward.', 'Portable projector', 'Ira X.', '2026-08-14'),
    review(rohan, 2, 'seller', 5, 'Clear communication and a quick handover.', 'Road bike helmet', 'Jay Z.', '2026-07-27'),
    review(rohan, 3, 'buyer', 4, 'Paid on time. Took a while to agree on a location.', 'Backpack', 'Naina I.', '2026-07-08'),
    review(rohan, 4, 'seller', 3, 'Working item, but the listing could have mentioned the missing remote.', 'Soundbar', 'Omkar R.', '2026-06-20'),
    review(rohan, 5, 'seller', 5, 'Smooth transaction from start to finish.', 'Board game bundle', 'Pari S.', '2026-06-01')
]);
