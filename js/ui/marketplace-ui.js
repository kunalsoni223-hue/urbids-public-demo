import { CATEGORY, CATEGORY_NAV_LABELS, CONDITION_GRADE_LABELS, DISPUTE_RESOLUTION, DISPUTE_RESOLUTION_LABELS, FILTER_ALL, FULFILMENT_METHOD, LISTING_FORMAT, SUBCATEGORIES_BY_CATEGORY, SUBCATEGORY, SUBCATEGORY_LABELS, TRANSACTION_STATUS, USABILITY_EVENT_TYPE } from '../core/constants.js';
import { formatCurrency, formatTimeRemaining } from '../core/formatting.js';
import { transactionStatusLabel } from '../services/transaction-service.js';
import { getDiscoveryListings, listingPlaceholderLabel } from '../services/listing-service.js';
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
    ['coffee machine', /\b(coffee machine|espresso machine)\b/],
    ['air purifier', /\b(air purifier)\b/]
]);

// Short generic words must match whole words ("book" must not match "MacBook").
const wholeWordSearchTerms = new Set(['sofa', 'sofas', 'couch', 'chair', 'chairs', 'table', 'desk', 'book', 'books', 'novel', 'vacuum', 'mixer', 'blender', 'purifier']);

function includesSearchTerm(text, term) {
    return wholeWordSearchTerms.has(term)
        ? new RegExp(`\\b${term}\\b`).test(text)
        : text.includes(term);
}

function matchesListingSearch(listing, query) {
    if (!query) return true;
    const accessories = Array.isArray(listing.accessories) ? listing.accessories : [];
    const listingIdentity = `${listing.title} ${listing.brandModel || ''}`.toLowerCase();
    const searchableText = [
        listing.title,
        listing.brandModel,
        listing.description,
        listing.category,
        listing.conditionLabel,
        listing.location,
        ...accessories
    ].filter(Boolean).join(' ').toLowerCase();

    const phraseAlias = query.includes(' ') ? listingSearchAliases.get(query) : null;
    if (phraseAlias) return searchableText.includes(query) || phraseAlias.test(listingIdentity);

    return query.split(/\s+/).filter(Boolean).every(term => {
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

export function createMarketplaceUI({ documentRef = document, state, biddingService, activityService, auctionManagement, watchlistService, recordEvent = () => {}, onPublicCountChanged = () => {} }) {
    const listingContainer = documentRef.getElementById('listing-container');
    const publicListingCount = documentRef.getElementById('public-listing-count');
    const filteredListingCount = documentRef.getElementById('filtered-listing-count');
    const filterSummaryCount = documentRef.getElementById('filter-summary-count');
    const listingSearchInput = documentRef.getElementById('listing-search-input');
    const noListingsMessage = documentRef.getElementById('no-listings-message');
    const clearFiltersButton = documentRef.getElementById('clear-listing-filters');
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
    const listingCity = documentRef.getElementById('pilot-city')?.textContent.trim().toLowerCase() || '';
    const { listingStates, transactionStore, userService, disputeService } = state;
    let activeCategory = FILTER_ALL;
    const announcedDeadlineThresholds = new Set();
    let activeSearchTerm = '';
    let activeCondition = FILTER_ALL;
    let activeMaximumBid = null;
    let watchlistOnly = false;
    let buyNowOnly = false;
    let nearYouOnly = false;
    let activeDiscovery = 'for-you';
    let activeSubcategory = null;
    let actions = {};
    let lastIntelligenceSync = 0;

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
        ...Object.entries(CONDITION_GRADE_LABELS).map(([grade, label]) => new Option(`${grade} - ${label}`, grade))
    );

    if (globalThis.matchMedia?.('(max-width: 700px)').matches) filterPanel.open = false;

    function closeExpiredAuctions() {
        return biddingService.closeExpiredAuctions().length > 0;
    }

    function marketSignals(listing) {
        const signals = [biddingService.getBidFeedback(listing.id), ...watchlistService.getIndicators(listing.id)].filter(Boolean);
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
        listingContainer.querySelectorAll('[data-auction-ends]').forEach(countdown => {
            const endTime = Date.parse(countdown.dataset.auctionEnds);
            const isValid = Number.isFinite(endTime);
            const remaining = endTime - now;
            countdown.textContent = countdown.dataset.auctionClosed === 'true' ? 'Ended' : formatTimeRemaining(countdown.dataset.auctionEnds, now);
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
        documentRef.querySelectorAll('.discovery-tab').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.discovery === activeDiscovery));
        });
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

    function createListingCard(listing, prioritizeImage = false) {
        const watchlist = userService.getWatchlist();
        const card = documentRef.createElement('article');
        card.className = 'listing-card';
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
            image.alt = listing.imageAlt;
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

        if (cardImages.length > 1) {
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
        conditionBadge.textContent = `${listing.conditionGrade} ${listing.conditionLabel}`;
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
        meta.textContent = listing.location;
        const fulfilment = documentRef.createElement('span');
        fulfilment.className = 'listing-fulfilment';
        fulfilment.textContent = listing.fulfilmentMethod === FULFILMENT_METHOD.shipping
            ? 'Shipping · prototype'
            : listing.fulfilmentMethod === FULFILMENT_METHOD.both
                ? 'Collection or shipping · prototype'
                : 'Local collection';
        meta.append(' · ', fulfilment);
        const format = documentRef.createElement('span');
        format.className = 'listing-fulfilment';
        format.textContent = listing.listingFormat === LISTING_FORMAT.buyNow ? 'Buy Now'
            : listing.listingFormat === LISTING_FORMAT.auction ? 'Auction'
                : 'Auction + Buy Now';
        meta.append(' · ', format);

        const priceBlock = documentRef.createElement('div');
        priceBlock.className = 'listing-price-block';
        const priceLabel = documentRef.createElement('span');
        priceLabel.className = 'listing-price-label';
        const buyNowOnly = listing.listingFormat === LISTING_FORMAT.buyNow;
        priceLabel.textContent = buyNowOnly ? 'Buy Now' : 'Current bid';
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
        if (!buyNowOnly && transaction.status === TRANSACTION_STATUS.auctionActive && !biddingService.isAuctionExpired(listing.id)) {
            const minimumBid = documentRef.createElement('span');
            minimumBid.textContent = `Minimum next bid ${formatCurrency(biddingService.minimumNextBid(listing))}`;
            priceOptions.append(minimumBid);
        }
        if (priceOptions.childElementCount) priceBlock.append(priceOptions);

        const bidInfo = documentRef.createElement('div');
        bidInfo.className = 'listing-bid-info';
        const bidCount = documentRef.createElement('span');
        bidCount.textContent = `${listing.bidCount} bids`;
        const countdown = documentRef.createElement('span');
        countdown.className = 'listing-countdown';
        countdown.dataset.auctionEnds = listing.auctionEndsAt;
        countdown.textContent = formatTimeRemaining(listing.auctionEndsAt);
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

        content.append(title, meta, priceBlock, bidInfo, signals, status, listingActions);
        card.append(media, content);
        return card;
    }

    function applyFilters() {
        let visibleCount = 0;
        const watchlist = userService.getWatchlist();
        listingContainer.querySelectorAll('.listing-card').forEach(card => {
            const listing = listingStates.get(card.dataset.listingId);
            const matchesCategory = activeCategory === FILTER_ALL || listing.category === activeCategory;
            const matchesSubcategory = activeSubcategory === null || listing.subcategory === activeSubcategory;
            const matchesCondition = activeCondition === FILTER_ALL || listing.conditionGrade === activeCondition;
            const matchesSearch = matchesListingSearch(listing, activeSearchTerm);
            const matchesMaximumBid = activeMaximumBid === null || listing.currentBid <= activeMaximumBid;
            const matchesWatchlist = !watchlistOnly || watchlist.has(listing.id);
            const matchesBuyNow = !buyNowOnly || biddingService.isBuyNowAvailable(listing.id);
            const matchesLocation = !nearYouOnly || listing.location.toLowerCase().includes(listingCity);
            card.hidden = !(matchesCategory && matchesSubcategory && matchesCondition && matchesSearch && matchesMaximumBid && matchesWatchlist && matchesBuyNow && matchesLocation);
            if (!card.hidden) visibleCount += 1;
        });

        noListingsMessage.hidden = visibleCount > 0;
        filteredListingCount.textContent = String(visibleCount);
        const availableCount = listingStates.size;
        filterSummaryCount.textContent = visibleCount === availableCount
            ? 'All finds'
            : `${visibleCount} of ${listingStates.size} finds`;
        updateDiscoveryState();
        updateWatchlistToggleState();
    }

    function selectDiscovery(discovery) {
        nearYouOnly = false;
        buyNowOnly = false;
        buyNowOnlyFilter.checked = false;
        if (discovery === 'for-you') {
            activeCategory = FILTER_ALL;
            activeSubcategory = null;
            renderSubcategoryNavigation(activeCategory);
            activeSearchTerm = '';
            activeCondition = FILTER_ALL;
            activeMaximumBid = null;
            watchlistOnly = false;
            buyNowOnly = false;
            nearYouOnly = false;
            listingSearchInput.value = '';
            conditionFilter.value = FILTER_ALL;
            maximumBidFilter.value = '';
            watchlistOnlyFilter.checked = false;
            buyNowOnlyFilter.checked = false;
            listingSort.value = 'featured';
        } else if (discovery === 'ending-soon') {
            buyNowOnly = false;
            buyNowOnlyFilter.checked = false;
            nearYouOnly = false;
            listingSort.value = 'ending-soon';
        } else if (discovery === 'popular') {
            buyNowOnly = false;
            buyNowOnlyFilter.checked = false;
            nearYouOnly = false;
            listingSort.value = 'featured';
        } else if (discovery === 'newly-listed') {
            buyNowOnly = false;
            buyNowOnlyFilter.checked = false;
            nearYouOnly = false;
            listingSort.value = 'featured';
        } else if (discovery === 'buy-now') {
            nearYouOnly = false;
            listingSort.value = 'featured';
            buyNowOnly = true;
            buyNowOnlyFilter.checked = true;
        } else if (discovery === 'near-you') {
            buyNowOnly = false;
            buyNowOnlyFilter.checked = false;
            listingSort.value = 'featured';
            nearYouOnly = true;
        } else if (discovery === 'price-drops' || discovery === 'relisted') {
            listingSort.value = 'featured';
        } else {
            return;
        }

        activeDiscovery = discovery;
        renderListings();
    }

    function renderListings() {
        transactionStore.expireWinnerConfirmations();
        listingStates.forEach((listing, listingId) => auctionManagement.syncRecoveryStatus(listingId));
        closeExpiredAuctions();
        auctionManagement.syncOffers();
        watchlistService.sync();
        renderSubcategoryNavigation(activeCategory);
        const catalogue = Array.from(listingStates.values());
        const sortedListings = getDiscoveryListings(catalogue, {
            discovery: activeDiscovery, watchlist: userService.getWatchlist(), transactionStore,
            isPublicListing: auctionManagement.isPublicListing
        });
        if (listingSort.value === 'ending-soon') {
            sortedListings.sort((first, second) => Date.parse(first.auctionEndsAt) - Date.parse(second.auctionEndsAt));
        } else if (activeDiscovery === 'popular') {
            sortedListings.sort((first, second) => second.bidCount - first.bidCount);
        } else if (activeDiscovery === 'newly-listed') {
            sortedListings.sort((first, second) => (Date.parse(second.listedAt) || 0) - (Date.parse(first.listedAt) || 0));
        }
        listingContainer.replaceChildren(...sortedListings.map((listing, index) => createListingCard(listing, index === 0)));
        publicListingCount.textContent = String(catalogue.filter(auctionManagement.isPublicListing).length);
        onPublicCountChanged(sortedListings.length);
        applyFilters();
        updateCountdowns();
    }

    function bindEvents() {
        categoryFilters.addEventListener('click', event => {
            const button = event.target.closest('[data-category-filter]');
            if (!button) return;
            activeCategory = button.dataset.categoryFilter;
            activeSubcategory = null;
            recordEvent(USABILITY_EVENT_TYPE.filterUsed, { metadata: { filter: button.dataset.categoryFilter, category: activeCategory } });
            renderSubcategoryNavigation(activeCategory);
            applyFilters();
            announceGlobalStatus('Listing filters updated.', documentRef);
        });

        subcategoryNavigation.addEventListener('click', event => {
            const button = event.target.closest('[data-category-filter]');
            if (!button) return;
            activeCategory = button.dataset.categoryFilter;
            activeSubcategory = button.dataset.subcategory || null;
            recordEvent(USABILITY_EVENT_TYPE.filterUsed, {
                metadata: { filter: activeSubcategory || activeCategory, category: activeCategory, subcategory: activeSubcategory }
            });
            applyFilters();
            announceGlobalStatus('Listing filters updated.', documentRef);
        });

        documentRef.querySelectorAll('[data-discovery]').forEach(button => {
            button.addEventListener('click', () => {
                recordEvent(USABILITY_EVENT_TYPE.filterUsed, { metadata: { filter: button.dataset.discovery } });
                selectDiscovery(button.dataset.discovery);
                announceGlobalStatus('Listing filters updated.', documentRef);
            });
        });

        clearFiltersButton.addEventListener('click', () => {
            selectDiscovery('for-you');
            announceGlobalStatus('Listing filters cleared.', documentRef);
            listingContainer.querySelector('.listing-card')?.focus();
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
        listingSearchInput.addEventListener('change', () => announceGlobalStatus('Listing filters updated.', documentRef));
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
        listingSort.addEventListener('change', () => {
            activeDiscovery = listingSort.value === 'ending-soon' ? 'ending-soon' : 'for-you';
            recordEvent(USABILITY_EVENT_TYPE.filterUsed, { metadata: { filter: 'sort' } });
            renderListings();
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
                image.alt = nextIndex === 0 ? listing.imageAlt : `${listing.title} photo ${nextIndex + 1}`;
                media.dataset.galleryIndex = String(nextIndex);
                return;
            }

            if (button.dataset.action === 'watch') {
                const currentUser = userService.getCurrentUser();
                const watchlist = userService.getWatchlist(currentUser.id);
                const wasWatching = watchlist.has(listingId);
                if (wasWatching) watchlist.delete(listingId);
                else watchlist.add(listingId);
                if (!userService.saveWatchlist(currentUser.id, watchlist)) {
                    if (wasWatching) watchlist.add(listingId);
                    else watchlist.delete(listingId);
                } else {
                    announceGlobalStatus(wasWatching ? 'Removed from Watchlist.' : 'Added to Watchlist.', documentRef);
                }
                renderListings();
                focusAction(listingId, 'watch');
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
        focusAction,
        setActionHandlers(nextActions) {
            actions = nextActions;
        }
    };
}