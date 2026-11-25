import { CATEGORY, CATEGORY_LABELS, CATEGORY_NAV_LABELS, CONDITION_GRADE_LABELS, DISPUTE_RESOLUTION, DISPUTE_RESOLUTION_LABELS, FILTER_ALL, FULFILMENT_METHOD, LISTING_FORMAT, SPECIFICATION_FIELD_LABELS, SUBCATEGORIES_BY_CATEGORY, SUBCATEGORY, SUBCATEGORY_LABELS, TRANSACTION_STATUS, USABILITY_EVENT_TYPE } from '../core/constants.js';
import { formatCurrency, listingImageAlt } from '../core/formatting.js';
import { transactionStatusLabel } from '../services/transaction-service.js';
import { getDiscoveryShelfListings, listingPlaceholderLabel, sortMarketplaceListings } from '../services/listing-service.js';
import { announceGlobalStatus } from './status-announcer.js';

const listingSearchAliases = new Map([
    ['laptop', /\b(macbook|thinkpad)\b/],
    ['laptops', /\b(macbook|thinkpad)\b/],
    ['notebook', /\b(macbook|thinkpad)\b/],
    ['notebooks', /\b(macbook|thinkpad)\b/],
    ['phone', /\b(iphone|galaxy|pixel)\b/],
    ['phones', /\b(iphone|galaxy|pixel)\b/],
    ['smartphone', /\b(iphone|galaxy|pixel)\b/],
    ['smartphones', /\b(iphone|galaxy|pixel)\b/],
    ['smartwatch', /\b(apple watch|series 9)\b/],
    ['headphone', /\b(sony wh|headphone)\b/],
    ['headphones', /\b(sony wh|headphone)\b/],
    ['audio', /\b(sony wh|headphone)\b/],
    ['sneaker', /\b(air max|new balance|990v6)\b/],
    ['sneakers', /\b(air max|new balance|990v6)\b/],
    ['shoe', /\b(air max|new balance|990v6)\b/],
    ['shoes', /\b(air max|new balance|990v6)\b/],
    ['bag', /\b(tabby|tumi|backpack)\b/],
    ['bags', /\b(tabby|tumi|backpack)\b/],
    ['backpack', /\b(tumi|backpack)\b/],
    ['jacket', /\b(dalby|allsaints)\b/],
    ['jackets', /\b(dalby|allsaints)\b/],
    ['sofa', /\b(sofa|couch)\b/],
    ['sofas', /\b(sofa|couch)\b/],
    ['couch', /\b(sofa|couch)\b/],
    ['chair', /\b(chair|armchair)\b/],
    ['chairs', /\b(chair|armchair)\b/],
    ['table', /\b(dining table|coffee table|console table)\b/],
    ['desk', /\b(desk|writing table)\b/],
    ['bookshelf', /\b(bookshelf|bookcase)\b/],
    ['coffee', /\b(coffee|espresso)\b/],
    ['purifier', /\b(air purifier|purifier)\b/],
    ['vacuum', /\b(vacuum|dyson|roomba)\b/],
    ['mixer', /\b(stand mixer|kitchenaid)\b/],
    ['blender', /\b(blender|vitamix|nutribullet)\b/],
    ['book', /\b(novel|box set|hardback|paperback)\b/],
    ['books', /\b(novel|box set|hardback|paperback)\b/],
    ['novel', /\b(novel|trilogy|hardback)\b/],
    ['box set', /\b(box set|slipcase)\b/],
    ['boxset', /\b(box set|slipcase)\b/],
    ['box sets', /\b(box set|slipcase)\b/],
    ['collectible', /\b(collectible|memorabilia|collectibles)\b/],
    ['collectibles', /\b(collectible|memorabilia|collectibles)\b/],
    ['memorabilia', /\b(collectible|memorabilia|collectibles)\b/],
    ['watches', /\b(watch|watches|garmin|galaxy watch)\b/],
    ['designer bag', /\b(tabby|tumi|designer bag|backpack)\b/],
    ['designer bags', /\b(tabby|tumi|designer bag|backpack)\b/],
    ['gaming', /\b(gaming|console|playstation|xbox|nintendo)\b/],
    ['camera', /\b(camera|canon|nikon|sony alpha)\b/],
    ['cameras', /\b(camera|canon|nikon|sony alpha)\b/],
    ['coffee machine', /\b(coffee machine|espresso machine)\b/],
    ['coffee machines', /\b(coffee machine|espresso machine)\b/],
    ['air purifier', /\b(air purifier)\b/]
]);

// Short generic words must match whole words ("book" must not match "MacBook").
const wholeWordSearchTerms = new Set(['sofa', 'sofas', 'couch', 'chair', 'chairs', 'table', 'desk', 'book', 'books', 'novel', 'vacuum', 'mixer', 'blender', 'purifier']);
const localityGroupByName = new Map([
    ['Andheri East', 'western_suburbs'], ['Andheri West', 'western_suburbs'], ['Bandra', 'western_suburbs'],
    ['Bandra East', 'western_suburbs'], ['Bandra West', 'western_suburbs'], ['Borivali West', 'western_suburbs'],
    ['Goregaon East', 'western_suburbs'], ['Juhu', 'western_suburbs'], ['Kandivali West', 'western_suburbs'],
    ['Khar West', 'western_suburbs'], ['Malad West', 'western_suburbs'], ['Santacruz West', 'western_suburbs'],
    ['Versova', 'western_suburbs'], ['Dadar West', 'central_mumbai'], ['Matunga', 'central_mumbai'],
    ['Lower Parel', 'central_mumbai'], ['Colaba', 'south_mumbai'], ['Fort', 'south_mumbai'], ['Worli', 'south_mumbai'],
    ['Chembur', 'eastern_suburbs'], ['Ghatkopar', 'eastern_suburbs'], ['Mulund West', 'eastern_suburbs'],
    ['Powai', 'eastern_suburbs'], ['Thane West', 'thane']
]);
const exploreShortcuts = [
    ['iphone', 'iPhone'], ['laptops', 'Laptops'], ['sneakers', 'Sneakers'], ['coffee_machines', 'Coffee machines'],
    ['sofas', 'Sofas'], ['watches', 'Watches'], ['gaming', 'Gaming'], ['cameras', 'Cameras'],
    ['designer_bags', 'Designer bags'], ['collectibles', 'Collectibles']
];

function getLocalityLabel(location = '') {
    return String(location).split(',')[0].trim() || 'Mumbai';
}

function getLocalityGroup(locality) {
    return locality === FILTER_ALL ? 'all_mumbai' : localityGroupByName.get(locality) || 'all_mumbai';
}

function includesSearchTerm(text, term) {
    return wholeWordSearchTerms.has(term)
        ? new RegExp(`\\b${term}\\b`).test(text)
        : text.includes(term);
}

function matchesListingSearch(listing, query) {
    if (!query) return true;
    const normalizedQuery = query.replace(/&/g, ' ').replace(/\s+/g, ' ').trim();
    if (normalizedQuery === 'books collectibles') return listing.category === CATEGORY.books;
    const accessories = Array.isArray(listing.accessories) ? listing.accessories : [];
    const listingIdentity = `${listing.title} ${listing.brandModel || ''}`.toLowerCase();
    const specificationText = Object.entries(listing.specifications || {}).flatMap(([key, value]) => [
        SPECIFICATION_FIELD_LABELS[key], ...(Array.isArray(value) ? value : [value])
    ]);
    const searchableText = [
        listing.title,
        listing.brandModel,
        listing.description,
        CATEGORY_LABELS[listing.category],
        CATEGORY_NAV_LABELS[listing.category],
        SUBCATEGORY_LABELS[listing.subcategory],
        listing.category,
        listing.conditionLabel,
        listing.location,
        ...accessories,
        ...specificationText
    ].filter(Boolean).join(' ').toLowerCase();

    const phraseAlias = normalizedQuery.includes(' ') ? listingSearchAliases.get(normalizedQuery) : null;
    if (phraseAlias) return searchableText.includes(normalizedQuery) || phraseAlias.test(listingIdentity);

    return normalizedQuery.split(/\s+/).filter(Boolean).every(term => {
        const alias = listingSearchAliases.get(term);
        return includesSearchTerm(searchableText, term) || Boolean(alias?.test(listingIdentity));
    });
}

function createButton(documentRef, label, className, action) {
    const button = documentRef.createElement('button');
    button.type = 'button';
    button.className = className;
    button.dataset.action = action;
    button.textContent = label;
    return button;
}

export function createMarketplaceUI({ documentRef = document, state, biddingService, activityService, auctionManagement, watchlistService, engagementService, getEvents = () => [], recordEvent = () => {}, onPublicCountChanged = () => {} }) {
    const listingContainer = documentRef.getElementById('listing-container');
    const publicListingCount = documentRef.getElementById('public-listing-count');
    const filteredListingCount = documentRef.getElementById('filtered-listing-count');
    const filterSummaryCount = documentRef.getElementById('filter-summary-count');
    const listingSearchInput = documentRef.getElementById('listing-search-input');
    const noListingsMessage = documentRef.getElementById('no-listings-message');
    const activeConstraints = documentRef.getElementById('active-listing-constraints');
    const clearFiltersButton = documentRef.getElementById('clear-listing-filters');
    const browseAllButton = documentRef.getElementById('browse-all-listings');
    const loadMoreButton = documentRef.getElementById('load-more-listings');
    const discoveryShelvesContainer = documentRef.getElementById('discovery-shelves');
    const exploreMoreSection = documentRef.getElementById('explore-more-section');
    const exploreMoreContainer = documentRef.getElementById('explore-more-shortcuts');
    const localityFilter = documentRef.getElementById('locality-filter');
    const conditionFilter = documentRef.getElementById('condition-filter');
    const maximumBidFilter = documentRef.getElementById('maximum-bid-filter');
    const watchlistOnlyFilter = documentRef.getElementById('watchlist-only-filter');
    const buyNowOnlyFilter = documentRef.getElementById('buy-now-only-filter');
    const listingSort = documentRef.getElementById('listing-sort');
    const filterPanel = documentRef.getElementById('listing-filter-panel');
    const headerSearch = documentRef.getElementById('header-search');
    const mobileSearchToggle = documentRef.getElementById('mobile-search-toggle');
    const navigation = documentRef.querySelector('.navigation');
    const watchlistToggleButtons = [
        documentRef.getElementById('header-watchlist-toggle'),
        documentRef.getElementById('mobile-watchlist-toggle')
    ];
    const { listingStates, transactionStore, userService, disputeService } = state;
    let activeCategory = FILTER_ALL;
    let activeSearchTerm = '';
    let activeCondition = FILTER_ALL;
    let activeMaximumBid = null;
    let watchlistOnly = false;
    let buyNowOnly = false;
    let activeLocality = FILTER_ALL;
    let visibleListingLimit = 12;
    const listingPageSize = 12;
    const announcedDeadlineThresholds = new Set();
    let activeSubcategory = null;
    let actions = {};
    let lastIntelligenceSync = 0;
    const shelfSignatures = new Map();
    const shelfObserver = documentRef.defaultView?.IntersectionObserver
        ? new documentRef.defaultView.IntersectionObserver(entries => entries.forEach(entry => {
            if (!entry.isIntersecting || entry.intersectionRatio < 0.25) return;
            const shelf = entry.target;
            const kind = shelf.dataset.shelf;
            const signature = shelf.dataset.signature;
            if (shelfSignatures.get(kind) !== signature) {
                shelfSignatures.set(kind, signature);
                recordEvent(USABILITY_EVENT_TYPE.discoveryShelfViewed, { metadata: { shelf: kind, source: 'discovery_shelf' } });
            }
            shelfObserver.unobserve(shelf);
        }), { threshold: 0.25 }) : null;

    const categoryFilters = documentRef.querySelector('.category-nav-list');
    const categoryNavigation = [
        ['All', FILTER_ALL],
        ...Object.entries(CATEGORY_NAV_LABELS).map(([category, label]) => [label, category])
    ];
    const subcategoriesByCategory = new Map(Object.entries(SUBCATEGORIES_BY_CATEGORY).map(([category, values]) => [
        category,
        category === CATEGORY.fashion ? [...values, SUBCATEGORY.fashion] : values
    ]));
    const subcategoryNavigation = documentRef.createElement('div');
    subcategoryNavigation.className = 'container category-subnav';
    subcategoryNavigation.hidden = true;
    categoryFilters.parentElement.append(subcategoryNavigation);

    const categoryButtons = categoryNavigation.map(([label, category], index) => {
        const button = createButton(documentRef, label, 'category-nav-button', 'filter-category');
        button.dataset.categoryFilter = category;
        button.dataset.topLevelCategory = 'true';
        button.setAttribute('aria-pressed', String(index === 0));
        return button;
    });
    categoryFilters.replaceChildren(...categoryButtons);

    function renderSubcategoryNavigation(category) {
        const allSubcategories = subcategoriesByCategory.get(category);
        const subcategories = allSubcategories;
        if (!subcategories) {
            subcategoryNavigation.replaceChildren();
            subcategoryNavigation.hidden = true;
            return;
        }

        const label = documentRef.createElement('span');
        label.className = 'category-subnav-label';
        label.textContent = categoryNavigation.find(([, value]) => value === category)?.[0] || '';
        const allButton = createButton(documentRef, `All ${label.textContent}`, 'subcategory-nav-button', 'filter-category');
        allButton.dataset.categoryFilter = category;
        subcategoryNavigation.replaceChildren(label, allButton, ...subcategories.map(subcategory => {
            const subcategoryLabel = SUBCATEGORY_LABELS[subcategory];
            const button = createButton(documentRef, subcategoryLabel, 'subcategory-nav-button', 'filter-category');
            button.dataset.categoryFilter = category;
            button.dataset.subcategory = subcategory;
            button.setAttribute('aria-label', `Browse ${subcategoryLabel} in ${label.textContent}`);
            return button;
        }));
        subcategoryNavigation.hidden = false;
    }

    renderSubcategoryNavigation(activeCategory);

    conditionFilter.replaceChildren(
        new Option('All conditions', FILTER_ALL),
        ...Object.entries(CONDITION_GRADE_LABELS).map(([grade, label]) => new Option(label, grade))
    );

    if (globalThis.matchMedia?.('(max-width: 700px)').matches) filterPanel.open = false;

    function closeExpiredAuctions() {
        return biddingService.closeExpiredAuctions().length > 0;
    }
    function formatAuctionEndLabel(value, now = Date.now()) {
        const endAt = Date.parse(value);
        if (!Number.isFinite(endAt) || endAt <= now) return 'Auction ended';
        const remaining = endAt - now;
        const time = new Date(endAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
        if (remaining < 24 * 60 * 60 * 1000) {
            const totalMinutes = Math.ceil(remaining / 60000);
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;
            return `Ends in ${hours ? `${hours}h ` : ''}${minutes}m`;
        }
        const endDate = new Date(endAt);
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return endDate.toDateString() === tomorrow.toDateString()
            ? `Ends tomorrow · ${time}`
            : `Ends ${endDate.toLocaleDateString('en-IN', { weekday: 'short' })} · ${time}`;
    }

    function marketSignals(listing) {
        const bidFeedback = biddingService.getBidFeedback(listing.id);
        const signals = [bidFeedback === 'No bids' && listing.bidCount > 0 ? '' : bidFeedback,
            ...watchlistService.getIndicators(listing.id)].filter(Boolean);
        if (listing.relistedFrom) signals.push('Relisted');
        if (Number.isSafeInteger(listing.previousBuyNowPrice)
            && Number.isSafeInteger(listing.buyNowPrice)
            && listing.previousBuyNowPrice > listing.buyNowPrice) signals.push('Price reduced');
        return [...new Set(signals)].join(' · ');
    }

    function updateCountdowns() {
        if (transactionStore.expireWinnerConfirmations().length) {
            renderListings();
            return;
        }
        if (Date.now() - lastIntelligenceSync > 30000) {
            lastIntelligenceSync = Date.now();
            auctionManagement.syncOffers();
            watchlistService.sync();
            listingContainer.querySelectorAll('.listing-card').forEach(card => {
                const listing = listingStates.get(card.dataset.listingId);
                if (listing) card.querySelector('.market-signals').textContent = marketSignals(listing);
            });
        }
        if (closeExpiredAuctions()) {
            renderListings();
            return;
        }
        const now = Date.now();
        if (listingSort.value === 'ending-soon' && Array.from(listingContainer.querySelectorAll('[data-auction-ends]'))
            .some(countdown => Date.parse(countdown.dataset.auctionEnds) <= now)) {
            renderListings(false);
        }
        documentRef.querySelectorAll('#listing-container [data-auction-ends], #discovery-shelves [data-auction-ends]').forEach(countdown => {
            const endTime = Date.parse(countdown.dataset.auctionEnds);
            const isValid = Number.isFinite(endTime);
            const remaining = endTime - now;
            countdown.textContent = countdown.dataset.auctionClosed === 'true' ? 'Auction ended' : formatAuctionEndLabel(countdown.dataset.auctionEnds);
            countdown.classList.toggle('is-ended', countdown.dataset.auctionClosed === 'true' || (isValid && remaining <= 0));
            countdown.classList.toggle('is-urgent', countdown.dataset.auctionClosed !== 'true' && isValid && remaining > 0 && remaining < 10 * 60 * 1000);
            countdown.classList.toggle('is-unavailable', !isValid);
            const card = countdown.closest('.listing-card');
            const listingId = card?.dataset.listingId;
            const thresholdKey = `${listingId}:${countdown.dataset.auctionEnds}:two-minutes`;
            if (isValid && remaining > 0 && remaining <= 2 * 60 * 1000
                && card?.matches(':focus-within') && !announcedDeadlineThresholds.has(thresholdKey)) {
                announcedDeadlineThresholds.add(thresholdKey);
                announceGlobalStatus('An auction you are viewing has two minutes remaining.', documentRef);
            }
        });
    }

    function updateDiscoveryState() {
        categoryFilters.querySelectorAll('[data-category-filter]').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.categoryFilter === activeCategory));
        });
        subcategoryNavigation.querySelectorAll('[data-category-filter]').forEach(button => {
            button.setAttribute('aria-pressed', String(
                button.dataset.subcategory
                    ? button.dataset.subcategory === activeSubcategory
                    : activeSubcategory === null
            ));
        });
    }

    function updateWatchlistToggleState() {
        watchlistToggleButtons.forEach(button => {
            button.setAttribute('aria-pressed', String(watchlistOnlyFilter.checked));
        });
    }

    updateWatchlistToggleState();

    function focusAction(listingId, action) {
        const card = listingContainer.querySelector(`.listing-card[data-listing-id="${listingId}"]`);
        const target = card?.querySelector(`button[data-action="${action}"]`);
        const focusTarget = target && !target.disabled && !target.hidden
            ? target
            : card?.querySelector('button[data-action="details"]');
        focusTarget?.focus({ preventScroll: true });
    }

    function toggleListingWatch(listingId, focusAfterUpdate = () => focusAction(listingId, 'watch')) {
        const resumeWatch = () => {
            const currentUser = userService.getCurrentUser();
            const watchlist = userService.getWatchlist(currentUser.id);
            const wasWatching = watchlist.has(listingId);
            if (wasWatching) watchlist.delete(listingId);
            else watchlist.add(listingId);
            if (!userService.saveWatchlist(currentUser.id, watchlist)) {
                announceGlobalStatus('This browser could not save your Watchlist change.', documentRef);
                return;
            }
            recordEvent(wasWatching ? USABILITY_EVENT_TYPE.watchlistRemoved : USABILITY_EVENT_TYPE.watchlistAdded, { relatedId: listingId });
            renderListings();
            focusAfterUpdate();
        };
        if (actions.requireAccount?.(resumeWatch, focusAfterUpdate) === false) return;
        resumeWatch();
    }

    function openDiscoveryListing(listing, card) {
        recordEvent(USABILITY_EVENT_TYPE.discoveryListingOpened, {
            relatedId: listing.id,
            metadata: { source: 'discovery_shelf', category: listing.category, subcategory: listing.subcategory }
        });
        if (card.dataset.shelfType === 'recently-viewed') {
            recordEvent(USABILITY_EVENT_TYPE.recentlyViewedOpened, {
                relatedId: listing.id,
                metadata: { source: 'recently_viewed', category: listing.category, subcategory: listing.subcategory }
            });
        }
        actions.openDetails?.(listing.id, () => {
            const currentCard = [...discoveryShelvesContainer.querySelectorAll('.listing-card-compact')]
                .find(item => item.dataset.listingId === listing.id);
            (currentCard || card).focus({ preventScroll: true });
        });
    }

    function createListingCard(listing, prioritizeImage = false, compact = false) {
        const watchlist = userService.getWatchlist();
        const card = documentRef.createElement('article');
        card.className = `listing-card${compact ? ' listing-card-compact' : ''}`;
        card.tabIndex = 0;
        card.setAttribute('aria-label', `View ${listing.title} details`);
        card.dataset.listingId = listing.id;
        card.dataset.category = listing.category;
        card.dataset.condition = listing.conditionGrade;

        const media = documentRef.createElement('div');
        media.className = 'listing-media';
        media.dataset.action = 'details';
        const cardImages = Array.isArray(listing.images) && listing.images.length
            ? listing.images.filter(imageUrl => typeof imageUrl === 'string' && imageUrl.length > 0)
            : listing.image ? [listing.image] : [];
        media.dataset.galleryIndex = '0';
        let image;
        if (cardImages.length) {
            image = documentRef.createElement('img');
            image.className = 'listing-image';
            image.src = cardImages[0];
            image.width = 800;
            image.height = 600;
            image.loading = prioritizeImage ? 'eager' : 'lazy';
            if (prioritizeImage) image.setAttribute('fetchpriority', 'high');
            image.decoding = 'async';
            image.alt = listingImageAlt(listing);
            const imageFallback = documentRef.createElement('div');
            imageFallback.className = `seller-listing-placeholder seller-listing-placeholder-${listing.category}`;
            imageFallback.setAttribute('role', 'img');
            imageFallback.setAttribute('aria-label', `${listing.title} photo unavailable`);
            imageFallback.textContent = 'Photo unavailable';
            imageFallback.hidden = true;
            image.addEventListener('error', () => {
                image.hidden = true;
                imageFallback.hidden = false;
            });
            image.addEventListener('load', () => {
                image.hidden = false;
                imageFallback.hidden = true;
            });
            media.append(image, imageFallback);
        } else {
            image = documentRef.createElement('div');
            image.className = `listing-image seller-listing-placeholder seller-listing-placeholder-${listing.category}`;
            image.setAttribute('role', 'img');
            image.setAttribute('aria-label', listing.imageAlt || `${listing.title} photo unavailable`);
            image.textContent = listingPlaceholderLabel(listing);
            media.append(image);
        }

        if (!compact && cardImages.length > 1) {
            const galleryControls = documentRef.createElement('div');
            galleryControls.className = 'listing-gallery-controls';
            galleryControls.setAttribute('role', 'group');
            galleryControls.setAttribute('aria-label', `Photos of ${listing.title}`);
            const previous = createButton(documentRef, '', 'listing-gallery-arrow', 'gallery-previous');
            previous.setAttribute('aria-label', `Previous photo of ${listing.title}`);
            const next = createButton(documentRef, '', 'listing-gallery-arrow', 'gallery-next');
            next.setAttribute('aria-label', `Next photo of ${listing.title}`);
            galleryControls.append(previous, next);
            media.append(galleryControls);
        }

        if (listing.source === 'seller_submission') {
            const communityLabel = documentRef.createElement('span');
            communityLabel.className = 'community-listing-label';
            communityLabel.textContent = 'Community';
            media.append(communityLabel);
        }

        const conditionBadge = documentRef.createElement('span');
        conditionBadge.className = 'condition-badge';
        conditionBadge.textContent = listing.conditionLabel || CONDITION_GRADE_LABELS[listing.conditionGrade] || 'Condition declared';
        media.append(conditionBadge);

        const watchButton = createButton(documentRef, watchlist.has(listing.id) ? 'Saved' : 'Save', 'watch-button card-watch-button', 'watch');
        watchButton.setAttribute('aria-label', watchlist.has(listing.id) ? 'Saved, remove from Watchlist' : 'Save to Watchlist');
        watchButton.setAttribute('aria-pressed', String(watchlist.has(listing.id)));
        media.append(watchButton);

        const content = documentRef.createElement('div');
        content.className = 'listing-content';
        const title = documentRef.createElement('h3');
        title.append(createButton(documentRef, listing.title, 'listing-title-button', 'details'));
        const meta = documentRef.createElement('div');
        meta.className = 'listing-meta';
        meta.textContent = getLocalityLabel(listing.location);
        const fulfilment = documentRef.createElement('span');
        fulfilment.className = 'listing-fulfilment';
            if (!compact && [FULFILMENT_METHOD.shipping, FULFILMENT_METHOD.both].includes(listing.fulfilmentMethod)) {
                fulfilment.textContent = 'Prototype shipping';
                meta.append(' · ', fulfilment);
            }
        const format = documentRef.createElement('span');
        format.className = 'listing-fulfilment';
        format.textContent = listing.listingFormat === LISTING_FORMAT.buyNow ? 'Buy Now'
            : listing.listingFormat === LISTING_FORMAT.auction ? 'Auction'
                : 'Auction + Buy Now';
        if (!compact) meta.append(' · ', format);

        const priceBlock = documentRef.createElement('div');
        priceBlock.className = 'listing-price-block';
        const priceLabel = documentRef.createElement('span');
        priceLabel.className = 'listing-price-label';
        const buyNowOnly = listing.listingFormat === LISTING_FORMAT.buyNow;
        priceLabel.textContent = buyNowOnly ? 'Buy Now' : listing.bidCount > 0 ? 'Current bid' : 'Starting at';
        const price = documentRef.createElement('p');
        price.className = 'price';
        price.dataset.currentBid = String(listing.currentBid);
        price.textContent = formatCurrency(buyNowOnly ? listing.buyNowPrice : listing.currentBid);
        priceBlock.append(priceLabel, price);
        const priceOptions = documentRef.createElement('div');
        priceOptions.className = 'listing-price-options';
        if (!buyNowOnly && listing.buyNowPrice !== null) {
            const buyNow = documentRef.createElement('span');
            buyNow.textContent = biddingService.isBuyNowPriceAvailable(listing.id)
                ? `Buy Now ${formatCurrency(listing.buyNowPrice)}`
                : `Buy Now unavailable · ${formatCurrency(listing.buyNowPrice)}`;
            priceOptions.append(buyNow);
        }
        const transaction = transactionStore.get(listing.id);
        if (priceOptions.childElementCount) priceBlock.append(priceOptions);

        const bidInfo = documentRef.createElement('div');
        bidInfo.className = 'listing-bid-info';
        const bidCount = documentRef.createElement('span');
        bidCount.textContent = listing.bidCount === 1 ? '1 bid' : `${listing.bidCount} bids`;
        const countdown = documentRef.createElement('span');
        countdown.className = 'listing-countdown';
        countdown.dataset.auctionEnds = listing.auctionEndsAt;
        countdown.textContent = formatAuctionEndLabel(listing.auctionEndsAt);
        bidInfo.append(bidCount, countdown);
        bidInfo.hidden = buyNowOnly;

        countdown.dataset.auctionClosed = String(transaction.status !== TRANSACTION_STATUS.auctionActive);
        const status = documentRef.createElement('p');
        status.className = 'listing-transaction-status';
        status.dataset.active = String(transaction.status === TRANSACTION_STATUS.auctionActive);
        const latestDispute = disputeService.getLatestForListing(listing.id);
        status.textContent = listing.listingFormat === LISTING_FORMAT.buyNow
            && transaction.status === TRANSACTION_STATUS.auctionActive
            ? 'Available at fixed price'
            : transactionStore.isPaused(listing.id)
            ? 'Transaction paused while this issue is reviewed.'
            : latestDispute?.resolution && latestDispute.resolution !== DISPUTE_RESOLUTION.noAction
                ? `Issue resolved · ${DISPUTE_RESOLUTION_LABELS[latestDispute.resolution]}`
                : transactionStatusLabel(transaction);
        status.hidden = transaction.status === TRANSACTION_STATUS.auctionActive && !transactionStore.isPaused(listing.id);

        const bidButton = createButton(documentRef, 'Place a bid', 'bid-button', 'bid');
        bidButton.disabled = !biddingService.canBid(listing.id);
        bidButton.hidden = !biddingService.canBid(listing.id);
        const buyNowButton = listing.buyNowPrice === null
            ? null
            : createButton(documentRef, `Buy Now ${formatCurrency(listing.buyNowPrice)}`, 'buy-now-button', 'buy-now');
        if (buyNowButton) {
            buyNowButton.dataset.buyNowPrice = String(listing.buyNowPrice);
            buyNowButton.disabled = !biddingService.isBuyNowAvailable(listing.id);
            buyNowButton.hidden = !biddingService.isBuyNowAvailable(listing.id);
        }

        const listingActions = documentRef.createElement('div');
        listingActions.className = 'listing-actions';
        listingActions.append(bidButton);
        if (buyNowButton) listingActions.append(buyNowButton);
        const primary = activityService.getPrimaryAction(listing.id);
        if (primary && primary.action !== 'bid') {
            listingActions.append(createButton(documentRef, primary.actionLabel, 'bid-button', 'primary'));
        }
        const signals = documentRef.createElement('p');
        signals.className = 'market-signals';
        signals.textContent = marketSignals(listing);

        if (compact) {
            status.remove();
            signals.remove();
            listingActions.remove();
            card.addEventListener('click', event => {
                if (event.target.closest('button')) return;
                openDiscoveryListing(listing, card);
            });
            card.addEventListener('keydown', event => {
                if (!['Enter', ' '].includes(event.key) || event.target !== card) return;
                event.preventDefault();
                openDiscoveryListing(listing, card);
            });
            title.querySelector('button')?.addEventListener('click', event => {
                event.stopPropagation();
                openDiscoveryListing(listing, card);
            });
            watchButton.addEventListener('click', event => {
                event.stopPropagation();
                toggleListingWatch(listing.id, () => [...discoveryShelvesContainer.querySelectorAll('.listing-card-compact')]
                    .find(item => item.dataset.listingId === listing.id)?.querySelector('.card-watch-button')?.focus({ preventScroll: true }));
            });
        }
        content.append(title, meta, priceBlock, bidInfo, signals, status, listingActions);
        card.append(media, content);
        return card;
    }

    function renderLocalityOptions(catalogue) {
        const selected = activeLocality;
        const localities = [...new Set(catalogue.map(listing => getLocalityLabel(listing.location)))].sort((a, b) => a.localeCompare(b));
        localityFilter.replaceChildren(new Option('All Mumbai', FILTER_ALL), ...localities.map(locality => new Option(locality, locality)));
        activeLocality = localities.includes(selected) ? selected : FILTER_ALL;
        localityFilter.value = activeLocality;
    }

    function matchesActiveFilters(listing, watchlist) {
        return (activeCategory === FILTER_ALL || listing.category === activeCategory)
            && (activeSubcategory === null || listing.subcategory === activeSubcategory)
            && (activeCondition === FILTER_ALL || listing.conditionGrade === activeCondition)
            && matchesListingSearch(listing, activeSearchTerm)
            && (activeMaximumBid === null || listing.currentBid <= activeMaximumBid)
            && (!watchlistOnly || watchlist.has(listing.id))
            && (!buyNowOnly || biddingService.isBuyNowAvailable(listing.id))
            && (activeLocality === FILTER_ALL || getLocalityLabel(listing.location) === activeLocality);
    }

    function hasActiveFilters() {
        return Boolean(activeSearchTerm || activeCategory !== FILTER_ALL || activeSubcategory
            || activeCondition !== FILTER_ALL || activeMaximumBid !== null || watchlistOnly
            || buyNowOnly || activeLocality !== FILTER_ALL);
    }

    function describeActiveFilters() {
        const constraints = [];
        if (activeSearchTerm) constraints.push(`Search: “${listingSearchInput.value.trim()}”`);
        if (activeCategory !== FILTER_ALL) constraints.push(categoryNavigation.find(([, value]) => value === activeCategory)?.[0] || activeCategory);
        if (activeSubcategory) constraints.push(SUBCATEGORY_LABELS[activeSubcategory] || activeSubcategory);
        if (activeLocality !== FILTER_ALL) constraints.push(activeLocality);
        if (activeCondition !== FILTER_ALL) constraints.push(CONDITION_GRADE_LABELS[activeCondition]);
        if (activeMaximumBid !== null) constraints.push(`Max bid ${formatCurrency(activeMaximumBid)}`);
        if (watchlistOnly) constraints.push('Watchlist');
        if (buyNowOnly) constraints.push('Buy Now available');
        return constraints.join(' · ');
    }

    function getWatchAndViewSignals() {
        const watchersByListing = new Map();
        const setWatch = (listingId, userId, watching) => {
            if (!listingId || !userId) return;
            if (!watchersByListing.has(listingId)) watchersByListing.set(listingId, new Set());
            const watchers = watchersByListing.get(listingId);
            if (watching) watchers.add(userId);
            else watchers.delete(userId);
        };
        (userService.getUsers() || []).forEach(user => {
            userService.getWatchlist(user.id).forEach(id => setWatch(id, user.id, true));
        });
        const currentUserId = userService.getCurrentUser()?.id;
        userService.getWatchlist(currentUserId).forEach(id => setWatch(id, currentUserId, true));
        getEvents().forEach(event => {
            if (![USABILITY_EVENT_TYPE.watchlistAdded, USABILITY_EVENT_TYPE.watchlistRemoved].includes(event.type)) return;
            const userId = event.localUserId || event.demoUserId;
            if (userId) setWatch(event.relatedId, userId, event.type === USABILITY_EVENT_TYPE.watchlistAdded);
        });
        const watchCounts = new Map(Array.from(watchersByListing, ([id, watchers]) => [id, watchers.size]));
        const viewCounts = new Map();
        getEvents().forEach(event => {
            if (event.type !== USABILITY_EVENT_TYPE.listingOpened) return;
            const listingId = event.listingId || event.relatedId;
            if (listingId) viewCounts.set(listingId, (viewCounts.get(listingId) || 0) + 1);
        });
        return { watchCounts, viewCounts };
    }

    function renderDiscoveryShelves(catalogue, watchlist) {
        discoveryShelvesContainer.querySelectorAll('.discovery-shelf').forEach(shelf => shelfObserver?.unobserve(shelf));
        discoveryShelvesContainer.replaceChildren();
        if (hasActiveFilters()) return;

        const recentlyViewed = engagementService?.getRecentlyViewed().slice(0, 6) || [];
        const watchedCategories = new Set([...watchlist].map(id => listingStates.get(id)?.category).filter(Boolean));
        const signals = getWatchAndViewSignals();
        const shelfKinds = [];
        if (recentlyViewed.length) shelfKinds.push(['recently-viewed', 'Recently viewed', { recentlyViewedIds: recentlyViewed.map(listing => listing.id) }]);
        else if (watchedCategories.size) shelfKinds.push(['watched-categories', 'More from categories you save', { watchedCategories }]);
        else shelfKinds.push(['popular', 'Popular right now', signals]);

        shelfKinds.push(['ending-soon', 'Ending soon', {}], ['newly-listed', 'Newly listed', {}]);
        if (!recentlyViewed.length && !watchedCategories.size) shelfKinds.push(['popular', 'Popular right now', signals]);

        const usedIds = new Set();
        let visibleShelfCount = 0;
        for (const [kind, title, extras] of shelfKinds) {
            if (visibleShelfCount >= 3) break;
            const items = getDiscoveryShelfListings(catalogue, {
                shelf: kind, transactionStore, isPublicListing: auctionManagement.isPublicListing,
                ...extras, now: Date.now(), limit: 6
            }).filter(listing => !usedIds.has(listing.id));
            if (!items.length) continue;
            items.forEach(item => usedIds.add(item.id));
            const shelf = documentRef.createElement('section');
            shelf.className = 'discovery-shelf';
            shelf.dataset.shelf = kind;
            shelf.setAttribute('aria-label', title);
            const heading = documentRef.createElement('h2');
            heading.textContent = title;
            const cards = documentRef.createElement('div');
            cards.className = 'discovery-shelf-listings';
            cards.setAttribute('role', 'list');
            cards.replaceChildren(...items.map(listing => {
                const card = createListingCard(listing, false, true);
                card.dataset.shelfType = kind;
                card.setAttribute('role', 'listitem');
                return card;
            }));
            shelf.append(heading, cards);
            discoveryShelvesContainer.append(shelf);
            const signature = items.map(item => item.id).join(',');
            shelf.dataset.signature = signature;
            visibleShelfCount += 1;
            if (shelfObserver) shelfObserver.observe(shelf);
            else if (shelfSignatures.get(kind) !== signature) {
                shelfSignatures.set(kind, signature);
                recordEvent(USABILITY_EVENT_TYPE.discoveryShelfViewed, { metadata: { shelf: kind, source: 'discovery_shelf' } });
            }
        }
    }

    function renderExploreMore(catalogue) {
        const shortcuts = exploreShortcuts.filter(([, label]) => catalogue.some(listing => matchesListingSearch(listing, label.toLowerCase())));
        exploreMoreContainer.replaceChildren(...shortcuts.map(([id, label]) => {
            const button = createButton(documentRef, label, 'explore-more-button', 'explore-more');
            button.dataset.shortcutId = id;
            button.dataset.searchTerm = label;
            return button;
        }));
    }

    function applyFilters(resetVisibleCount = true) {
        if (resetVisibleCount) visibleListingLimit = listingPageSize;
        renderListings(false);
    }

    function resetAllFilters(render = true) {
        activeCategory = FILTER_ALL;
        activeSubcategory = null;
        activeSearchTerm = '';
        activeCondition = FILTER_ALL;
        activeMaximumBid = null;
        watchlistOnly = false;
        buyNowOnly = false;
        activeLocality = FILTER_ALL;
        listingSearchInput.value = '';
        conditionFilter.value = FILTER_ALL;
        maximumBidFilter.value = '';
        watchlistOnlyFilter.checked = false;
        buyNowOnlyFilter.checked = false;
        listingSort.value = 'featured';
        renderSubcategoryNavigation(activeCategory);
        visibleListingLimit = listingPageSize;
        if (render) renderListings(false);
    }

    function renderListings(syncLifecycle = true) {
        if (syncLifecycle) {
            transactionStore.expireWinnerConfirmations();
            listingStates.forEach((listing, listingId) => auctionManagement.syncRecoveryStatus(listingId));
            closeExpiredAuctions();
            auctionManagement.syncOffers();
            watchlistService.sync();
        }
        renderSubcategoryNavigation(activeCategory);
        const catalogue = Array.from(listingStates.values()).filter(auctionManagement.isPublicListing);
        renderLocalityOptions(catalogue);
        const watchlist = userService.getWatchlist();
        const matchingListings = sortMarketplaceListings(
            catalogue.filter(listing => matchesActiveFilters(listing, watchlist)),
            { sort: listingSort.value, transactionStore, isPublicListing: auctionManagement.isPublicListing }
        );
        const visibleListings = matchingListings.slice(0, visibleListingLimit);
        listingContainer.replaceChildren(...visibleListings.map((listing, index) => createListingCard(listing, index === 0)));
        publicListingCount.textContent = String(catalogue.length);
        filteredListingCount.textContent = String(matchingListings.length);
        filterSummaryCount.textContent = hasActiveFilters() ? `${matchingListings.length} matching finds` : 'All finds';
        noListingsMessage.hidden = matchingListings.length > 0;
        activeConstraints.textContent = describeActiveFilters();
        loadMoreButton.hidden = matchingListings.length <= visibleListingLimit;
        exploreMoreSection.hidden = matchingListings.length > visibleListings.length;
        onPublicCountChanged(catalogue.length);
        updateDiscoveryState();
        updateWatchlistToggleState();
        renderDiscoveryShelves(catalogue, watchlist);
        if (!exploreMoreSection.hidden) renderExploreMore(catalogue);
        if (syncLifecycle) updateCountdowns();
    }

    function renderRecentlyViewed() {
        renderDiscoveryShelves(Array.from(listingStates.values()).filter(auctionManagement.isPublicListing), userService.getWatchlist());
    }

    function bindEvents() {
        categoryFilters.addEventListener('click', event => {
            const button = event.target.closest('[data-category-filter]');
            if (!button) return;
            activeCategory = button.dataset.categoryFilter;
            activeSubcategory = null;
            recordEvent(USABILITY_EVENT_TYPE.filterUsed, { metadata: { filter: button.dataset.categoryFilter, category: activeCategory } });
            if (activeCategory !== FILTER_ALL) recordEvent(USABILITY_EVENT_TYPE.categorySelected, {
                metadata: { category: activeCategory, source: 'category_navigation' }
            });
            renderSubcategoryNavigation(activeCategory);
            applyFilters();
            announceGlobalStatus('Listing filters updated.', documentRef);
        });

        subcategoryNavigation.addEventListener('click', event => {
            const button = event.target.closest('[data-category-filter]');
            if (!button) return;
            activeCategory = button.dataset.categoryFilter;
            activeSubcategory = button.dataset.subcategory || null;
            recordEvent(USABILITY_EVENT_TYPE.categorySelected, {
                metadata: { category: activeCategory, subcategory: activeSubcategory, source: 'category_navigation' }
            });
            recordEvent(USABILITY_EVENT_TYPE.filterUsed, {
                metadata: { filter: activeSubcategory || activeCategory, category: activeCategory, subcategory: activeSubcategory }
            });
            applyFilters();
            announceGlobalStatus('Listing filters updated.', documentRef);
        });

        clearFiltersButton.addEventListener('click', () => {
            activeLocality = FILTER_ALL;
            activeCondition = FILTER_ALL;
            activeMaximumBid = null;
            watchlistOnly = false;
            buyNowOnly = false;
            localityFilter.value = FILTER_ALL;
            conditionFilter.value = FILTER_ALL;
            maximumBidFilter.value = '';
            watchlistOnlyFilter.checked = false;
            buyNowOnlyFilter.checked = false;
            applyFilters();
            announceGlobalStatus('Listing filters cleared.', documentRef);
            if (noListingsMessage.hidden) listingContainer.querySelector('.listing-card')?.focus({ preventScroll: true });
            else listingSearchInput.focus({ preventScroll: true });
        });

        browseAllButton.addEventListener('click', () => {
            resetAllFilters();
            documentRef.getElementById('listings').scrollIntoView({ block: 'start' });
            listingContainer.querySelector('.listing-card')?.focus({ preventScroll: true });
        });

        const setMobileSearchOpen = isOpen => {
            headerSearch.classList.toggle('is-open', isOpen);
            navigation.classList.toggle('search-open', isOpen);
            mobileSearchToggle.setAttribute('aria-expanded', String(isOpen));
            mobileSearchToggle.setAttribute('aria-label', isOpen ? 'Search, close' : 'Search, open');
        };
        mobileSearchToggle.addEventListener('click', () => {
            const isOpen = mobileSearchToggle.getAttribute('aria-expanded') !== 'true';
            setMobileSearchOpen(isOpen);
            if (isOpen) listingSearchInput.focus();
        });
        listingSearchInput.addEventListener('keydown', event => {
            if (event.key !== 'Escape' || mobileSearchToggle.getAttribute('aria-expanded') !== 'true') return;
            event.preventDefault();
            setMobileSearchOpen(false);
            mobileSearchToggle.focus();
        });

        const toggleWatchlistOnly = () => {
            watchlistOnlyFilter.checked = !watchlistOnlyFilter.checked;
            watchlistOnlyFilter.dispatchEvent(new Event('change', { bubbles: true }));
        };
        documentRef.getElementById('header-watchlist-toggle').addEventListener('click', toggleWatchlistOnly);
        documentRef.getElementById('mobile-watchlist-toggle').addEventListener('click', toggleWatchlistOnly);

        listingSearchInput.addEventListener('input', () => {
            activeSearchTerm = listingSearchInput.value.trim().toLowerCase();
            if (activeSearchTerm) recordEvent(USABILITY_EVENT_TYPE.searchUsed, { metadata: { source: 'search' } });
            applyFilters();
        });
        conditionFilter.addEventListener('change', () => {
            activeCondition = conditionFilter.value;
            recordEvent(USABILITY_EVENT_TYPE.filterUsed, { metadata: { filter: 'condition' } });
            applyFilters();
            announceGlobalStatus('Listing filters updated.', documentRef);
        });
        maximumBidFilter.addEventListener('input', () => {
            const value = maximumBidFilter.value;
            activeMaximumBid = value === '' ? null : Number(value);
            if (value !== '') recordEvent(USABILITY_EVENT_TYPE.filterUsed, { metadata: { filter: 'maximum-bid' } });
            applyFilters();
        });
        maximumBidFilter.addEventListener('change', () => announceGlobalStatus('Listing filters updated.', documentRef));
        watchlistOnlyFilter.addEventListener('change', () => {
            watchlistOnly = watchlistOnlyFilter.checked;
            recordEvent(USABILITY_EVENT_TYPE.filterUsed, { metadata: { filter: 'watchlist' } });
            applyFilters();
            announceGlobalStatus('Listing filters updated.', documentRef);
        });
        buyNowOnlyFilter.addEventListener('change', () => {
            buyNowOnly = buyNowOnlyFilter.checked;
            recordEvent(USABILITY_EVENT_TYPE.filterUsed, { metadata: { filter: 'buy-now' } });
            applyFilters();
            announceGlobalStatus('Listing filters updated.', documentRef);
        });
        localityFilter.addEventListener('change', () => {
            activeLocality = localityFilter.value;
            recordEvent(USABILITY_EVENT_TYPE.localityFilterSelected, {
                metadata: { localityGroup: getLocalityGroup(activeLocality), source: 'locality_filter' }
            });
            applyFilters();
            announceGlobalStatus('Approximate locality filter updated.', documentRef);
        });
        loadMoreButton.addEventListener('click', () => {
            const previousLimit = visibleListingLimit;
            visibleListingLimit += listingPageSize;
            renderListings(false);
            const total = Number(filteredListingCount.textContent);
            const loaded = Math.max(0, Math.min(visibleListingLimit, total) - previousLimit);
            recordEvent(USABILITY_EVENT_TYPE.loadMoreUsed, { metadata: { source: 'catalogue' } });
            announceGlobalStatus(`${loaded} more listings loaded.`, documentRef);
            if (loadMoreButton.hidden) listingContainer.querySelector('.listing-card:last-child')?.focus({ preventScroll: true });
            else loadMoreButton.focus({ preventScroll: true });
        });
        exploreMoreContainer.addEventListener('click', event => {
            const button = event.target.closest('[data-shortcut-id]');
            if (!button) return;
            resetAllFilters(false);
            activeSearchTerm = button.dataset.searchTerm.toLowerCase();
            listingSearchInput.value = button.dataset.searchTerm;
            recordEvent(USABILITY_EVENT_TYPE.exploreMoreSelected, {
                metadata: { shortcutId: button.dataset.shortcutId, source: 'explore_more' }
            });
            applyFilters();
            documentRef.getElementById('listings').scrollIntoView({ block: 'start' });
            listingContainer.querySelector('.listing-card')?.focus({ preventScroll: true });
        });
        listingSort.addEventListener('change', () => {
            recordEvent(USABILITY_EVENT_TYPE.filterUsed, { metadata: { filter: 'sort' } });
            recordEvent(USABILITY_EVENT_TYPE.discoveryModeSelected, { metadata: { code: listingSort.value, source: 'discovery_controls' } });
            applyFilters();
            announceGlobalStatus('Listing filters updated.', documentRef);
        });

        listingContainer.addEventListener('click', event => {
            const button = event.target.closest('button[data-action]');
            const card = event.target.closest('.listing-card');
            if (!card) return;
            const listingId = card?.dataset.listingId;
            if (!listingId) return;

            if (!button) {
                const returnFocus = () => focusAction(listingId, 'details');
                actions.openDetails?.(listingId, returnFocus);
                return;
            }

            if (button.dataset.action === 'gallery-previous' || button.dataset.action === 'gallery-next') {
                const listing = listingStates.get(listingId);
                const images = Array.isArray(listing?.images) && listing.images.length
                    ? listing.images.filter(imageUrl => typeof imageUrl === 'string' && imageUrl.length > 0)
                    : listing?.image ? [listing.image] : [];
                if (images.length < 2) return;

                const media = card.querySelector('.listing-media');
                const currentIndex = Number(media.dataset.galleryIndex) || 0;
                const direction = button.dataset.action === 'gallery-next' ? 1 : -1;
                const nextIndex = (currentIndex + direction + images.length) % images.length;
                const image = media.querySelector('img.listing-image');
                image.src = images[nextIndex];
                image.alt = nextIndex === 0 ? listingImageAlt(listing) : `${listing.title} photo ${nextIndex + 1}`;
                media.dataset.galleryIndex = String(nextIndex);
                return;
            }

            if (button.dataset.action === 'watch') {
                toggleListingWatch(listingId);
                return;
            }

            const returnFocus = () => focusAction(listingId, button.dataset.action);
            if (button.dataset.action === 'details') actions.openDetails?.(listingId, returnFocus);
            else if (button.dataset.action === 'bid') actions.openBid?.(listingId, returnFocus);
            else if (button.dataset.action === 'buy-now') actions.openBuyNow?.(listingId, returnFocus);
            else if (button.dataset.action === 'primary') actions.primary?.(listingId);
        });

        listingContainer.addEventListener('keydown', event => {
            const card = event.target.closest('.listing-card');
            if (card !== event.target || !['Enter', ' '].includes(event.key)) return;
            event.preventDefault();
            actions.openDetails?.(card.dataset.listingId, () => focusAction(card.dataset.listingId, 'details'));
        });

        window.setInterval(updateCountdowns, 1000);
        documentRef.addEventListener('visibilitychange', () => {
            if (documentRef.visibilityState === 'visible') updateCountdowns();
        });
    }

    bindEvents();

    return {
        renderListings,
        renderRecentlyViewed,
        focusAction,
        setActionHandlers(nextActions) {
            actions = nextActions;
        }
    };
}