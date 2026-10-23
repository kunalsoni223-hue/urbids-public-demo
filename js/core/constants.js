export const STORAGE_KEYS = Object.freeze({
    bids: 'urbids-demo-bids',
    autoBids: 'urbids-demo-auto-bids',
    watchlist: 'urbids-demo-watchlist',
    userWatchlists: 'urbids-demo-user-watchlists',
    disputes: 'urbids-demo-disputes',
    ratings: 'urbids-demo-ratings',
    sellerSubmissions: 'urbids-demo-seller-submissions',
    meetups: 'urbids-demo-meetups',
    auctionTransactions: 'urbids-demo-auction-transactions',
    notifications: 'urbids-demo-notifications',
    feedback: 'urbids-demo-feedback',
    userProfiles: 'urbids-demo-user-profiles'
});

export const LISTING_FORMAT = Object.freeze({
    auction: 'auction',
    buyNow: 'buy_now',
    auctionAndBuyNow: 'auction_buy_now'
});

export const RESERVATION_DEPOSIT = Object.freeze({
    none: 0,
    standard: 200,
    highValue: 500,
    standardMaximum: 15000
});

export const TRANSACTION_OUTCOME = Object.freeze({
    winnerDidNotConfirm: 'winner_did_not_confirm',
    buyerCancelledAfterReservation: 'buyer_cancelled_after_reservation',
    buyerNoShow: 'buyer_no_show',
    sellerCancellation: 'seller_cancellation',
    sellerNoShow: 'seller_no_show',
    materialMismatch: 'material_mismatch',
    buyerChangedMind: 'buyer_changed_mind',
    successfulCompletion: 'successful_completion',
    disputeResolution: 'dispute_resolution'
});

export const FAILURE_OUTCOME = Object.freeze({
    sellerNoShow: 'seller_no_show',
    sellerCancelled: 'seller_cancelled',
    materialMismatch: 'material_mismatch',
    listingCorrectionRequired: 'listing_correction_required',
    sellerAvailabilityRequired: 'seller_availability_required',
    eligibleForSecondChance: 'eligible_for_second_chance',
    eligibleForRelist: 'eligible_for_relist',
    blockedPendingReview: 'blocked_pending_review'
});

export const SELLER_CANCELLATION_STAGE = Object.freeze({
    beforeBids: 'before_bids',
    afterBids: 'after_bids',
    afterWinnerAllocation: 'after_winner_allocation',
    afterReservation: 'after_reservation'
});

export const DEPOSIT_OUTCOME = Object.freeze({
    pending: 'pending',
    credited: 'credited',
    forfeited: 'forfeited',
    refundable: 'refundable'
});

export const INSPECTION_REJECTION_REASON = Object.freeze({
    wrongProduct: 'wrong_product',
    undisclosedDefect: 'undisclosed_defect',
    worseCondition: 'materially_worse_condition',
    missingAccessory: 'missing_promised_accessory',
    functionalFailure: 'functional_failure',
    identifierMismatch: 'identifier_mismatch',
    activationLock: 'activation_lock',
    counterfeitOwnership: 'counterfeit_or_ownership_concern',
    otherMaterialMismatch: 'other_material_mismatch',
    changedMind: 'changed_mind'
});

export const INSPECTION_REJECTION_REASON_LABELS = Object.freeze({
    [INSPECTION_REJECTION_REASON.wrongProduct]: 'Wrong product/model/variant',
    [INSPECTION_REJECTION_REASON.undisclosedDefect]: 'Undisclosed functional defect',
    [INSPECTION_REJECTION_REASON.worseCondition]: 'Condition materially worse',
    [INSPECTION_REJECTION_REASON.missingAccessory]: 'Missing promised accessory',
    [INSPECTION_REJECTION_REASON.functionalFailure]: 'Undisclosed functional defect',
    [INSPECTION_REJECTION_REASON.identifierMismatch]: 'Serial/IMEI mismatch',
    [INSPECTION_REJECTION_REASON.activationLock]: 'Activation-lock issue',
    [INSPECTION_REJECTION_REASON.counterfeitOwnership]: 'Suspected counterfeit or ownership concern',
    [INSPECTION_REJECTION_REASON.otherMaterialMismatch]: 'Other material mismatch',
    [INSPECTION_REJECTION_REASON.changedMind]: 'Change of mind'
});

export const WINNER_CONFIRMATION_WINDOW_MS = 6 * 60 * 60 * 1000;
export const SECOND_CHANCE_OFFER_DURATION_MS = 12 * 60 * 60 * 1000;

export const USABILITY_EVENT_TYPE = Object.freeze({
    searchUsed: 'search_used',
    filterUsed: 'filter_used',
    listingOpened: 'listing_opened',
    watchlistAdded: 'watchlist_added',
    bidAttempted: 'bid_attempted',
    bidAccepted: 'bid_accepted',
    bidRejected: 'bid_rejected',
    nextBidAttempted: 'next_bid_attempted',
    nextBidAccepted: 'next_bid_accepted',
    maximumBidSet: 'maximum_bid_set',
    maximumBidIncreased: 'maximum_bid_increased',
    immediatelyOutbid: 'immediately_outbid',
    buyNowStarted: 'buy_now_started',
    tokenStepCompleted: 'token_step_completed',
    fulfilmentSelected: 'fulfilment_selected',
    meetupScheduled: 'meetup_scheduled',
    inspectionStarted: 'inspection_started',
    itemApproved: 'item_approved',
    itemRejected: 'item_rejected',
    shippingStarted: 'shipping_started',
    disputeOpened: 'dispute_opened',
    transactionCompleted: 'transaction_completed',
    sellerSubmissionStarted: 'seller_submission_started',
    sellerSubmissionCompleted: 'seller_submission_completed',
    feedbackSubmitted: 'feedback_submitted'
});

export const USABILITY_JOURNEY = Object.freeze({
    buyer: 'buyer',
    seller: 'seller',
    both: 'both'
});

export const USABILITY_INTEREST_CATEGORY = Object.freeze({
    electronics: 'electronics',
    fashion: 'fashion',
    both: 'both',
    neither: 'neither'
});

export const USABILITY_PRODUCT_CATEGORY = Object.freeze({
    electronics: 'electronics',
    furniture: 'furniture',
    homeAppliances: 'home_appliances',
    fashion: 'fashion',
    booksCollectibles: 'books_collectibles',
    other: 'other'
});

export const USABILITY_SCORE_FIELDS = Object.freeze({
    conceptClarity: 'conceptClarity',
    trust: 'trust',
    biddingClarity: 'biddingClarity',
    inspectionPaymentClarity: 'inspectionPaymentClarity',
    easeOfUse: 'easeOfUse'
});

export const DEMO_USER_IDS = Object.freeze({
    kunal: 'demo-user-kunal',
    mira: 'demo-user-mira',
    arjun: 'demo-user-arjun',
    sana: 'demo-user-sana',
    rohan: 'demo-user-rohan'
});

export const DEFAULT_DEMO_USER_ID = DEMO_USER_IDS.kunal;

export const FULFILMENT_METHOD = Object.freeze({
    inPerson: 'in_person',
    shipping: 'shipping',
    both: 'both'
});

export const FULFILMENT_METHOD_LABELS = Object.freeze({
    [FULFILMENT_METHOD.inPerson]: 'In-person collection',
    [FULFILMENT_METHOD.shipping]: 'Shipping (prototype/research only)',
    [FULFILMENT_METHOD.both]: 'Collection or shipping prototype'
});

export const DEFAULT_FULFILMENT_METHOD = FULFILMENT_METHOD.inPerson;

export const SPECIFICATION_FIELD_LABELS = Object.freeze({
    processor: 'Processor',
    ram: 'RAM',
    storage: 'Storage / capacity',
    color: 'Color',
    purchaseYear: 'Purchase year',
    warrantyStatus: 'Warranty status',
    batteryHealth: 'Battery health / cycles',
    includedAccessories: 'Included accessories',
    originalBox: 'Original box available',
    proofOfPurchase: 'Proof of purchase available',
    functionalStatus: 'Functional status',
    serialModelInfo: 'Model / identifier availability (no full serial/IMEI)',
    activationLock: 'Activation lock removed',
    ownershipConcern: 'Ownership concern',
    counterfeitConcern: 'Authenticity concern',
    knownDefects: 'Known defects',
    connectivity: 'Connectivity',
    brand: 'Brand',
    size: 'Size',
    material: 'Material',
    originalPackaging: 'Original packaging',
    signsOfWear: 'Signs of wear',
    authenticityNotes: 'Authenticity notes',
    dimensions: 'Dimensions',
    age: 'Age',
    assemblyRequired: 'Assembly required',
    collectionRequirements: 'Collection requirements',
    accessNotes: 'Access (lift / stairs)',
    model: 'Model',
    capacity: 'Capacity',
    powerRating: 'Power rating',
    serviceHistory: 'Service history',
    originalInvoice: 'Original invoice available',
    author: 'Author',
    edition: 'Edition',
    completeness: 'Completeness / included parts or volumes',
    language: 'Language',
    format: 'Format',
    publicationYear: 'Publication year',
    isbn: 'ISBN',
    coverCondition: 'Cover and page condition',
    annotations: 'Missing pages, markings or annotations'
});

const furnitureFields = Object.freeze([
    'dimensions', 'material', 'color', 'age', 'assemblyRequired', 'signsOfWear', 'knownDefects',
    'collectionRequirements', 'accessNotes'
]);
const applianceFields = Object.freeze([
    'model', 'capacity', 'purchaseYear', 'warrantyStatus', 'powerRating', 'includedAccessories',
    'serviceHistory', 'knownDefects', 'originalInvoice'
]);
const bookFields = Object.freeze([
    'author', 'edition', 'completeness', 'language', 'format', 'publicationYear', 'isbn', 'coverCondition', 'annotations'
]);

const electronicsPhoneFields = Object.freeze([
    'storage', 'color', 'purchaseYear', 'warrantyStatus', 'batteryHealth', 'includedAccessories',
    'originalBox', 'functionalStatus', 'knownDefects', 'serialModelInfo', 'activationLock', 'proofOfPurchase',
    'ownershipConcern', 'counterfeitConcern'
]);
const electronicsLaptopFields = Object.freeze([
    'processor', 'ram', 'storage', 'color', 'purchaseYear', 'warrantyStatus', 'batteryHealth',
    'includedAccessories', 'originalBox', 'functionalStatus', 'knownDefects', 'serialModelInfo', 'activationLock', 'proofOfPurchase',
    'ownershipConcern', 'counterfeitConcern'
]);
const fashionFields = Object.freeze([
    'brand', 'size', 'color', 'material', 'purchaseYear', 'proofOfPurchase', 'originalPackaging',
    'signsOfWear', 'authenticityNotes'
]);

export const SUBMISSION_STATUS = Object.freeze({
    pendingReview: 'pending_review',
    published: 'published',
    rejected: 'rejected',
    unpublished: 'unpublished'
});

export const AUCTION_STATUS = Object.freeze({
    active: 'active',
    ended: 'ended'
});

export const SECOND_CHANCE_OFFER_STATUS = Object.freeze({
    pending: 'pending',
    declined: 'declined',
    accepted: 'accepted',
    expired: 'expired'
});

export const DEFAULT_AUCTION_DURATION_HOURS = 72;
export const AUCTION_DURATION_OPTIONS_HOURS = Object.freeze([24, 48, 72, 168]);

export const RESERVE_PRICE_MODE = Object.freeze({
	none: 'none',
	set: 'set'
});

export const AUCTION_RESERVE_OUTCOME = Object.freeze({
	met: 'met',
	notMet: 'not_met'
});

export const TRANSACTION_STATUS = Object.freeze({
    auctionActive: 'auction_active',
    unavailable: 'transaction_unavailable',
    auctionWon: 'auction_won',
    tokenPending: 'token_pending',
    tokenCompleted: 'token_completed',
    simpleCollectionRequested: 'simple_collection_requested',
    meetupRequested: 'meetup_requested',
    shippingRequested: 'shipping_requested',
    shippingInTransit: 'shipping_in_transit',
    shippingDelivered: 'shipping_delivered',
    inspectionPending: 'inspection_pending',
    itemApproved: 'item_approved',
    itemRejected: 'item_rejected',
    paymentPreviewed: 'payment_previewed',
    sellerHandoverConfirmed: 'seller_handover_confirmed',
    buyerReceiptConfirmed: 'buyer_receipt_confirmed',
    completed: 'transaction_completed',
    cancelled: 'transaction_cancelled'
});

export const SHIPPING_STATUS = Object.freeze({
    requested: TRANSACTION_STATUS.shippingRequested,
    inTransit: TRANSACTION_STATUS.shippingInTransit,
    delivered: TRANSACTION_STATUS.shippingDelivered
});

export const SHIPPING_INSPECTION_WINDOW_MS = 24 * 60 * 60 * 1000;

export const DISPUTE_STATUS = Object.freeze({
    open: 'open',
    resolved: 'resolved'
});

export const DISPUTE_REASON = Object.freeze({
    itemNotAsDescribed: 'item_not_as_described',
    undisclosedDefect: 'undisclosed_defect',
    wrongModelOrVariant: 'wrong_model_or_variant',
    suspectedCounterfeit: 'suspected_counterfeit',
    sellerDidNotAttend: 'seller_did_not_attend',
    buyerDidNotAttend: 'buyer_did_not_attend',
    other: 'other'
});

export const DISPUTE_REASON_LABELS = Object.freeze({
    [DISPUTE_REASON.itemNotAsDescribed]: 'Item not as described',
    [DISPUTE_REASON.undisclosedDefect]: 'Undisclosed defect',
    [DISPUTE_REASON.wrongModelOrVariant]: 'Wrong model or variant',
    [DISPUTE_REASON.suspectedCounterfeit]: 'Suspected counterfeit',
    [DISPUTE_REASON.sellerDidNotAttend]: 'Seller did not attend meetup',
    [DISPUTE_REASON.buyerDidNotAttend]: 'Buyer did not attend meetup',
    [DISPUTE_REASON.other]: 'Other'
});

export const DISPUTE_RESOLUTION = Object.freeze({
    buyerRefund: 'buyer_refund',
    sellerPayout: 'seller_payout',
    tokenRefundOnly: 'token_refund_only',
    cancelTransaction: 'cancel_transaction',
    noAction: 'no_action'
});

export const DISPUTE_RESOLUTION_LABELS = Object.freeze({
    [DISPUTE_RESOLUTION.buyerRefund]: 'Buyer refund',
    [DISPUTE_RESOLUTION.sellerPayout]: 'Seller payout',
    [DISPUTE_RESOLUTION.tokenRefundOnly]: 'Token refund only',
    [DISPUTE_RESOLUTION.cancelTransaction]: 'Cancel transaction',
    [DISPUTE_RESOLUTION.noAction]: 'No action / close dispute'
});

export const MEETUP_ATTENDANCE_STATUS = Object.freeze({
    pending: 'pending',
    arrived: 'arrived',
    noShow: 'no_show'
});

export const MEETUP_NO_SHOW_OUTCOME = Object.freeze({
    sellerNoShow: 'seller_no_show',
    buyerNoShow: 'buyer_no_show',
    tokenRefundable: 'token_refundable',
    tokenForfeited: 'token_forfeited'
});

export const CATEGORY = Object.freeze({
    electronics: 'electronics',
    fashion: 'fashion',
    furniture: 'furniture',
    homeAppliances: 'home_appliances',
    books: 'books_collectibles'
});

export const CATEGORY_LABELS = Object.freeze({
    [CATEGORY.electronics]: 'Electronics',
    [CATEGORY.fashion]: 'Fashion',
    [CATEGORY.furniture]: 'Furniture',
    [CATEGORY.homeAppliances]: 'Home appliances',
    [CATEGORY.books]: 'Books and collectibles'
});

// Compact navigation groups; research/demo categories are shown only outside pilot mode.
export const CATEGORY_NAV_LABELS = Object.freeze({
    [CATEGORY.electronics]: 'Electronics',
    [CATEGORY.furniture]: 'Furniture',
    [CATEGORY.homeAppliances]: 'Home',
    [CATEGORY.fashion]: 'Fashion',
    [CATEGORY.books]: 'Books'
});

export const SUBCATEGORY = Object.freeze({
    smartphones: 'smartphones',
    laptops: 'laptops',
    audio: 'audio',
    wearables: 'wearables',
    sneakers: 'sneakers',
    bags: 'bags',
    fashion: 'fashion',
    clothing: 'clothing',
    accessories: 'accessories',
    otherElectronics: 'other_electronics',
    otherFashion: 'other_fashion',
    sofas: 'sofas',
    chairs: 'chairs',
    tables: 'tables',
    storage: 'storage',
    officeFurniture: 'office_furniture',
    kitchenAppliances: 'kitchen_appliances',
    cleaningAppliances: 'cleaning_appliances',
    airTreatment: 'air_treatment',
    coffeeMachines: 'coffee_machines',
    smallAppliances: 'small_appliances',
    books: 'books',
    boxSets: 'box_sets',
    collectibles: 'collectibles'
});

export const SUBCATEGORY_LABELS = Object.freeze({
    [SUBCATEGORY.sofas]: 'Sofas',
    [SUBCATEGORY.chairs]: 'Chairs',
    [SUBCATEGORY.tables]: 'Tables',
    [SUBCATEGORY.storage]: 'Storage',
    [SUBCATEGORY.officeFurniture]: 'Office furniture',
    [SUBCATEGORY.kitchenAppliances]: 'Kitchen appliances',
    [SUBCATEGORY.cleaningAppliances]: 'Cleaning appliances',
    [SUBCATEGORY.airTreatment]: 'Air treatment',
    [SUBCATEGORY.coffeeMachines]: 'Coffee machines',
    [SUBCATEGORY.smallAppliances]: 'Small appliances',
    [SUBCATEGORY.books]: 'Books',
    [SUBCATEGORY.boxSets]: 'Box sets',
    [SUBCATEGORY.collectibles]: 'Collectibles',
    [SUBCATEGORY.smartphones]: 'Smartphones',
    [SUBCATEGORY.laptops]: 'Laptops',
    [SUBCATEGORY.audio]: 'Premium audio',
    [SUBCATEGORY.wearables]: 'Smartwatches',
    [SUBCATEGORY.sneakers]: 'Sneakers',
    [SUBCATEGORY.bags]: 'Bags',
    [SUBCATEGORY.fashion]: 'Fashion (general)',
    [SUBCATEGORY.clothing]: 'Clothing',
    [SUBCATEGORY.accessories]: 'Accessories',
    [SUBCATEGORY.otherElectronics]: 'Other Electronics',
    [SUBCATEGORY.otherFashion]: 'Other Fashion'
});

export const SPECIFICATION_FIELDS_BY_SUBCATEGORY = Object.freeze({
    [SUBCATEGORY.smartphones]: electronicsPhoneFields,
    [SUBCATEGORY.laptops]: electronicsLaptopFields,
    [SUBCATEGORY.audio]: Object.freeze([
        'connectivity', 'color', 'purchaseYear', 'warrantyStatus', 'batteryHealth', 'includedAccessories',
        'originalBox', 'functionalStatus', 'proofOfPurchase', 'knownDefects', 'serialModelInfo',
        'ownershipConcern', 'counterfeitConcern'
    ]),
    [SUBCATEGORY.wearables]: Object.freeze([
        'storage', 'color', 'purchaseYear', 'warrantyStatus', 'batteryHealth', 'includedAccessories',
        'originalBox', 'functionalStatus', 'proofOfPurchase', 'knownDefects', 'serialModelInfo', 'activationLock',
        'ownershipConcern', 'counterfeitConcern'
    ]),
    [SUBCATEGORY.otherElectronics]: Object.freeze([
        'storage', 'color', 'purchaseYear', 'warrantyStatus', 'includedAccessories', 'originalBox',
        'proofOfPurchase', 'knownDefects'
    ]),
    [SUBCATEGORY.sneakers]: fashionFields,
    [SUBCATEGORY.bags]: fashionFields,
    [SUBCATEGORY.clothing]: fashionFields,
    [SUBCATEGORY.accessories]: fashionFields,
    [SUBCATEGORY.otherFashion]: fashionFields,
    [SUBCATEGORY.fashion]: fashionFields,
    [SUBCATEGORY.sofas]: furnitureFields,
    [SUBCATEGORY.chairs]: furnitureFields,
    [SUBCATEGORY.tables]: furnitureFields,
    [SUBCATEGORY.storage]: furnitureFields,
    [SUBCATEGORY.officeFurniture]: furnitureFields,
    [SUBCATEGORY.kitchenAppliances]: applianceFields,
    [SUBCATEGORY.cleaningAppliances]: applianceFields,
    [SUBCATEGORY.airTreatment]: applianceFields,
    [SUBCATEGORY.coffeeMachines]: applianceFields,
    [SUBCATEGORY.smallAppliances]: applianceFields,
    [SUBCATEGORY.books]: bookFields,
    [SUBCATEGORY.boxSets]: bookFields,
    [SUBCATEGORY.collectibles]: Object.freeze([
        'model', 'edition', 'completeness', 'age', 'material', 'signsOfWear', 'knownDefects'
    ])
});

export const SUBCATEGORIES_BY_CATEGORY = Object.freeze({
    [CATEGORY.electronics]: Object.freeze([
        SUBCATEGORY.smartphones,
        SUBCATEGORY.laptops,
        SUBCATEGORY.audio,
        SUBCATEGORY.wearables,
        SUBCATEGORY.otherElectronics
    ]),
    [CATEGORY.fashion]: Object.freeze([
        SUBCATEGORY.sneakers,
        SUBCATEGORY.bags,
        SUBCATEGORY.clothing,
        SUBCATEGORY.accessories,
        SUBCATEGORY.otherFashion
    ]),
    [CATEGORY.furniture]: Object.freeze([
        SUBCATEGORY.sofas, SUBCATEGORY.chairs, SUBCATEGORY.tables, SUBCATEGORY.storage, SUBCATEGORY.officeFurniture
    ]),
    [CATEGORY.homeAppliances]: Object.freeze([
        SUBCATEGORY.kitchenAppliances, SUBCATEGORY.cleaningAppliances, SUBCATEGORY.airTreatment,
        SUBCATEGORY.coffeeMachines, SUBCATEGORY.smallAppliances
    ]),
    [CATEGORY.books]: Object.freeze([SUBCATEGORY.books, SUBCATEGORY.boxSets, SUBCATEGORY.collectibles])
});

export const DEFAULT_SUBCATEGORY_BY_CATEGORY = Object.freeze({
    [CATEGORY.electronics]: SUBCATEGORY.otherElectronics,
    [CATEGORY.fashion]: SUBCATEGORY.otherFashion,
    [CATEGORY.furniture]: SUBCATEGORY.storage,
    [CATEGORY.homeAppliances]: SUBCATEGORY.smallAppliances,
    [CATEGORY.books]: SUBCATEGORY.books
});

export const CONDITION_GRADE = Object.freeze({
    likeNew: 'A+',
    excellent: 'A',
    good: 'B',
    fair: 'C'
});

export const CONDITION_GRADE_LABELS = Object.freeze({
    [CONDITION_GRADE.likeNew]: 'Like New',
    [CONDITION_GRADE.excellent]: 'Excellent',
    [CONDITION_GRADE.good]: 'Good',
    [CONDITION_GRADE.fair]: 'Fair'
});

export const CONDITION_GRADE_GUIDANCE = Object.freeze({
	[CONDITION_GRADE.likeNew]: 'Minimal or no visible wear',
	[CONDITION_GRADE.excellent]: 'Light cosmetic wear',
	[CONDITION_GRADE.good]: 'Visible normal wear; fully functional',
	[CONDITION_GRADE.fair]: 'Heavy signs of wear; defects clearly described'
});

export const FILTER_ALL = 'all';

export const NOTIFICATION_TYPE = Object.freeze({
    generic: 'generic',
    outbid: 'outbid',
    autoBid: 'auto_bid',
    auctionWon: 'auction_outcome',
    buyNow: 'purchase_update',
    meetupRequested: 'meetup_update',
    shippingUpdate: 'shipping_update',
    disputeOpened: 'dispute_opened',
    disputeResolved: 'dispute_resolved',
    ratingReceived: 'rating_received',
    listingPublished: 'listing_published',
    listingRejected: 'listing_rejected'
});

export const RATING_CONSTRAINTS = Object.freeze({
    minimumScore: 1,
    maximumScore: 5,
    maximumCommentLength: 240
});

export const PROFILE_CONSTRAINTS = Object.freeze({ maximumDisplayNameLength: 24 });

export const AVATAR_COLORS = Object.freeze([
    Object.freeze({ id: 'default', label: 'Default' }),
    Object.freeze({ id: 'teal', label: 'Teal' }),
    Object.freeze({ id: 'plum', label: 'Plum' }),
    Object.freeze({ id: 'amber', label: 'Amber' }),
    Object.freeze({ id: 'slate', label: 'Slate' })
]);

export const MUMBAI_LOCALITIES = Object.freeze([
    'Andheri West', 'Bandra West', 'Borivali West', 'Colaba', 'Dadar', 'Ghatkopar', 'Goregaon East',
    'Juhu', 'Kandivali West', 'Lower Parel', 'Malad West', 'Matunga', 'Powai', 'Santacruz West',
    'Versova', 'Vile Parle', 'Worli'
]);

export const SERVICE_ERROR_CODE = Object.freeze({
    listingNotFound: 'LISTING_NOT_FOUND',
    auctionClosed: 'AUCTION_CLOSED',
    ownListing: 'OWN_LISTING',
    bidTooLow: 'BID_TOO_LOW',
    bidTooHigh: 'BID_TOO_HIGH',
    autoBidNotAllowed: 'AUTO_BID_NOT_ALLOWED',
    invalidTransition: 'INVALID_TRANSITION',
    notTransactionParticipant: 'NOT_TRANSACTION_PARTICIPANT',
    disputeOpen: 'DISPUTE_OPEN',
    ratingNotAllowed: 'RATING_NOT_ALLOWED',
    ratingAlreadySubmitted: 'RATING_ALREADY_SUBMITTED',
    meetupNotReady: 'MEETUP_NOT_READY',
    shippingNotAvailable: 'SHIPPING_NOT_AVAILABLE',
    attendanceConflict: 'ATTENDANCE_CONFLICT',
    actionNotAllowed: 'ACTION_NOT_ALLOWED',
    invalidInput: 'INVALID_INPUT',
    storageFailed: 'STORAGE_FAILED'
});

export const REJECTION_REASON = Object.freeze({
    incompleteInformation: 'incomplete_information',
    poorQuality: 'poor_quality',
    missingSpecifications: 'missing_specifications',
    conditionMismatch: 'condition_mismatch',
    prohibitedItem: 'prohibited_item',
    pricingClarification: 'pricing_clarification',
    other: 'other'
});

export const REJECTION_REASON_LABELS = Object.freeze({
    [REJECTION_REASON.incompleteInformation]: 'Incomplete information',
    [REJECTION_REASON.poorQuality]: 'Photos or description need improvement',
    [REJECTION_REASON.missingSpecifications]: 'Product details are missing or unclear',
    [REJECTION_REASON.conditionMismatch]: 'Condition description needs clarification',
    [REJECTION_REASON.prohibitedItem]: 'Prohibited or unsupported item',
    [REJECTION_REASON.pricingClarification]: 'Pricing requires clarification',
    [REJECTION_REASON.other]: 'Other'
});

export const SUBMISSION_STATUS_LABELS = Object.freeze({
    [SUBMISSION_STATUS.pendingReview]: 'Pending review',
    [SUBMISSION_STATUS.published]: 'Published',
    [SUBMISSION_STATUS.rejected]: 'Rejected',
    [SUBMISSION_STATUS.unpublished]: 'Unpublished'
});

export const TRANSACTION_EVENT = Object.freeze({
    placeBid: 'place_bid',
    auctionEnd: 'auction_end',
    startToken: 'start_token',
    simulateToken: 'simulate_token',
    simpleCollection: 'simple_collection',
    winnerDeclined: 'winner_declined',
    acceptSecondChance: 'accept_second_chance',
    cancelUnstartedPurchase: 'cancel_unstarted_purchase',
    sellerWithdrawBeforeBids: 'seller_withdraw_before_bids',
    sellerCancelAuction: 'seller_cancel_auction',
    buyNow: 'buy_now',
    meetupRequested: TRANSACTION_STATUS.meetupRequested,
    requestShipping: 'request_shipping',
    shippingDispatched: 'shipping_dispatched',
    shippingDelivered: TRANSACTION_STATUS.shippingDelivered,
    shippingAccept: 'shipping_accept',
    inspectionStarted: 'inspection_started',
    inspectionApproved: 'inspection_approved',
    inspectionRejected: 'inspection_rejected',
    paymentPreviewed: TRANSACTION_STATUS.paymentPreviewed,
    sellerHandover: 'seller_handover',
    buyerReceipt: 'buyer_receipt',
    completeTransaction: 'complete_transaction',
    disputeCancel: 'dispute_cancel',
    disputeSellerPayout: 'dispute_seller_payout',
    meetupNoShow: 'meetup_no_show'
});

export const LEGACY_STATUS = Object.freeze({
    approvedSubmission: 'approved',
    inspectionApproved: 'inspection_approved',
    inspectionRejected: 'inspection_rejected',
    demoRequest: 'demo_request',
    demoComplete: 'demo_complete',
    tokenSimulated: 'simulated_completed',
    paymentNotProcessed: 'not_processed_demo',
    auctionActive: AUCTION_STATUS.active,
    auctionEnded: AUCTION_STATUS.ended
});

export const PURCHASE_SOURCE = Object.freeze({
    auctionWinner: 'auction_winner',
    buyNow: 'buy_now'
});

export const SELLER_LISTING_ID_PREFIX = 'seller-';