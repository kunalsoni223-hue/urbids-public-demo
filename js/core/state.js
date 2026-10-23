export function createAppState(listingStates, transactionStore, userService, disputeService, ratingService) {
    return Object.freeze({ listingStates, transactionStore, userService, disputeService, ratingService });
}