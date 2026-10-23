import { DEFAULT_FULFILMENT_METHOD, DISPUTE_RESOLUTION, DISPUTE_RESOLUTION_LABELS, FULFILMENT_METHOD, FULFILMENT_METHOD_LABELS, LISTING_FORMAT, SERVICE_ERROR_CODE, SPECIFICATION_FIELDS_BY_SUBCATEGORY, SPECIFICATION_FIELD_LABELS, TRANSACTION_STATUS, USABILITY_EVENT_TYPE } from '../core/constants.js';
import { formatCurrency, formatTimeRemaining } from '../core/formatting.js';
import { getTransactionTimeline, transactionStatusLabel } from '../services/transaction-service.js';
import { listingPlaceholderLabel } from '../services/listing-service.js';
import { normalizeSpecifications } from '../core/normalization.js';
import { renderTransactionTimeline } from './transaction-timeline-ui.js';

export function createListingDialogUI({ documentRef = document, state, biddingService, activityService, auctionManagement, watchlistService, dialogController, renderListings, recordEvent = () => {} }) {
    const { listingStates, transactionStore, userService } = state;
    const disputeService = state.disputeService;
    const detailsDialog = documentRef.getElementById('product-details-dialog');
    const bidDialog = documentRef.getElementById('bid-dialog');
    const bidForm = documentRef.getElementById('bid-form');
    const nextBidButton = documentRef.getElementById('place-next-bid');
    let displayedNextBid = null;
    const autoBidPanel = documentRef.getElementById('auto-bid-panel');
    const autoBidExpand = documentRef.getElementById('auto-bid-expand');
    const autoBidFields = documentRef.getElementById('auto-bid-fields');
    const autoBidMax = documentRef.getElementById('auto-bid-max');
    const autoBidStatus = documentRef.getElementById('auto-bid-status');
    const autoBidDisable = documentRef.getElementById('auto-bid-disable');
    const detailWatchButton = documentRef.getElementById('product-details-watch');
    const image = documentRef.getElementById('product-details-image');
    const placeholder = documentRef.getElementById('product-details-placeholder');
    const thumbnailContainer = documentRef.getElementById('product-details-thumbnails');
    const reportIssueButton = documentRef.getElementById('product-details-report-issue');
    let activeDetailsListingId = null;
    let activeBidListingId = null;
    let activeImages = [];
    let buyNowHandler = () => {};
    let reportIssueHandler = () => {};
    let primaryActionHandler = () => {};
    let sellerProfileHandler = () => {};
    documentRef.querySelector('.seller-profile-compact').addEventListener('click', event => {
        const listing = listingStates.get(activeDetailsListingId);
        if (!listing || !userService.getUser(listing.sellerUserId)
            || !event.target.closest('#product-details-seller-avatar, .seller-link')) return;
        sellerProfileHandler(listing.sellerUserId, activeDetailsListingId);
    });
    const primaryButton = documentRef.getElementById('product-details-primary');
    const declineOfferButton = documentRef.getElementById('product-details-decline-offer');
    const cancelPurchaseButton = documentRef.getElementById('product-details-cancel-purchase');

    function showImageUnavailable(listing) {
        image.hidden = true;
        placeholder.className = `product-detail-placeholder seller-listing-placeholder seller-listing-placeholder-${listing.category}`;
        placeholder.setAttribute('role', 'img');
        placeholder.setAttribute('aria-label', `${listing.title} photo unavailable`);
        placeholder.textContent = 'Photo unavailable';
        placeholder.hidden = false;
    }

    function focusListingAction(listingId, action) {
        const card = documentRef.querySelector(`.listing-card[data-listing-id="${listingId}"]`);
        const target = card?.querySelector(`button[data-action="${action}"]`);
        const focusTarget = target && !target.disabled && !target.hidden
            ? target
            : card?.querySelector('button[data-action="details"]');
        focusTarget?.focus({ preventScroll: true });
    }

    function showProductDetails(listingId, returnFocus) {
        const listing = listingStates.get(listingId);
        if (!listing) return;
        activeDetailsListingId = listingId;
        biddingService.closeExpiredAuctions();
        watchlistService.sync();
        recordEvent(USABILITY_EVENT_TYPE.listingOpened, { relatedId: listingId });

        documentRef.getElementById('product-details-title').textContent = listing.title;
        activeImages = Array.isArray(listing.images) && listing.images.length
            ? listing.images.filter(imageUrl => typeof imageUrl === 'string' && imageUrl.length > 0)
            : listing.image ? [listing.image] : [];
        image.alt = listing.imageAlt;
        image.onerror = () => {
            if (activeImages.length) showImageUnavailable(listing);
        };
        image.onload = () => {
            image.hidden = false;
            placeholder.hidden = true;
        };
        if (activeImages.length) {
            image.src = activeImages[0];
            image.hidden = false;
            placeholder.hidden = true;
        } else {
            image.removeAttribute('src');
            image.hidden = true;
            placeholder.className = `product-detail-placeholder seller-listing-placeholder seller-listing-placeholder-${listing.category}`;
            placeholder.setAttribute('role', 'img');
            placeholder.setAttribute('aria-label', listing.imageAlt || `${listing.title} photo unavailable`);
            placeholder.textContent = listingPlaceholderLabel(listing);
            placeholder.hidden = false;
        }
        thumbnailContainer.replaceChildren(...activeImages.map((imageUrl, index) => {
            const button = documentRef.createElement('button');
            button.type = 'button';
            button.className = 'product-image-thumbnail';
            button.dataset.imageIndex = String(index);
            button.setAttribute('aria-label', `View photo ${index + 1}`);
            button.setAttribute('aria-pressed', String(index === 0));
            const thumbnail = documentRef.createElement('img');
            thumbnail.src = imageUrl;
            thumbnail.loading = 'lazy';
            thumbnail.alt = listing.imageAlt;
            button.append(thumbnail);
            return button;
        }));
        thumbnailContainer.hidden = activeImages.length < 2;
        const brand = documentRef.getElementById('product-details-brand');
        brand.textContent = listing.brandModel;
        brand.hidden = !listing.brandModel || listing.brandModel === listing.title;
        documentRef.getElementById('product-details-condition').textContent = `${listing.conditionGrade} ${listing.conditionLabel}`;
        documentRef.getElementById('product-details-listing-format').textContent = listing.listingFormat === LISTING_FORMAT.buyNow
            ? 'Buy Now only'
            : listing.listingFormat === LISTING_FORMAT.auction ? 'Auction' : 'Auction + Buy Now';
        documentRef.getElementById('product-details-correction-notice').hidden = !listing.correctionOf;
        documentRef.getElementById('product-details-location').textContent = listing.location;
        documentRef.getElementById('product-details-description').textContent = listing.description;
        documentRef.getElementById('product-details-accessories').textContent = listing.accessories.length
            ? `Included: ${listing.accessories.join(', ')}`
            : 'No accessories listed';
        const specifications = normalizeSpecifications(listing.specifications);
        const specificationRows = (SPECIFICATION_FIELDS_BY_SUBCATEGORY[listing.subcategory] || [])
            .filter(key => key !== 'includedAccessories' && specifications[key] !== undefined && specifications[key] !== null && specifications[key] !== '')
            .map(key => {
                const row = documentRef.createElement('div');
                row.className = 'product-specification-row';
                if (key === 'knownDefects') row.dataset.field = 'known-defects';
                const term = documentRef.createElement('dt');
                term.textContent = SPECIFICATION_FIELD_LABELS[key] || key;
                const value = documentRef.createElement('dd');
                value.textContent = key === 'serialModelInfo'
                    ? specifications[key] === 'No' ? 'Not supplied' : 'Available for private in-person check'
                    : Array.isArray(specifications[key]) ? specifications[key].join(', ') : String(specifications[key]);
                row.append(term, value);
                return row;
            });
        const specificationsList = documentRef.getElementById('product-details-specifications');
        specificationsList.replaceChildren(...specificationRows);
        specificationsList.parentElement.hidden = specificationRows.length === 0;
        documentRef.getElementById('product-details-fulfilment').textContent = FULFILMENT_METHOD_LABELS[listing.fulfilmentMethod]
            || FULFILMENT_METHOD_LABELS[DEFAULT_FULFILMENT_METHOD];
        const seller = userService.getUser(listing.sellerUserId);
        const reputation = state.ratingService.getReputation(listing.sellerUserId);
        const sellerAvatar = documentRef.getElementById('product-details-seller-avatar');
        sellerAvatar.textContent = seller?.initials || '';
        sellerAvatar.dataset.avatarColor = seller?.avatarColor || 'default';
        documentRef.getElementById('product-details-seller').textContent = seller?.firstName || listing.sellerName;
        documentRef.getElementById('product-details-seller-location').textContent = listing.location;
        documentRef.getElementById('product-details-rating').textContent = seller
            ? `★ ${reputation.sellerRating.toFixed(1)}`
            : listing.sellerRating;
        documentRef.getElementById('product-details-seller-transactions').textContent = seller
            ? `${reputation.completedTransactions} completed`
            : '';
        documentRef.getElementById('product-details-seller-member-since').textContent = seller
            ? `Member since ${seller.memberSince}`
            : '';
        const buyNowOnly = listing.listingFormat === LISTING_FORMAT.buyNow;
        documentRef.querySelector('.product-price-label').textContent = buyNowOnly ? 'Buy Now price' : 'Current bid';
        documentRef.getElementById('product-details-bid').textContent = formatCurrency(buyNowOnly ? listing.buyNowPrice : listing.currentBid);
        documentRef.getElementById('product-details-bid-count').textContent = `${listing.bidCount} bids`;
        const history = biddingService.getBidHistory(listingId);
        const historyList = documentRef.getElementById('product-details-bid-history');
        historyList.parentElement.open = false;
        historyList.parentElement.hidden = buyNowOnly;
        documentRef.getElementById('product-details-bid-count').parentElement.hidden = buyNowOnly;
        historyList.replaceChildren(...history.map(bid => {
            const row = documentRef.createElement('li');
            const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(bid.placedAt)) / 60000));
            const timestamp = !Number.isFinite(minutes) ? 'Time unavailable'
                : minutes < 1 ? 'Just now' : minutes < 60 ? `${minutes} min ago`
                    : new Date(bid.placedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            row.textContent = `${bid.label}${bid.auto ? ' · Auto' : ''} · ${formatCurrency(bid.amount)} · ${timestamp}`;
            return row;
        }));
        if (!history.length) {
            const empty = documentRef.createElement('li');
            empty.textContent = 'No recorded bids yet.';
            historyList.append(empty);
        }
        const transaction = transactionStore.get(listingId);
        const remainingTime = formatTimeRemaining(listing.auctionEndsAt);
        documentRef.getElementById('product-details-end').textContent = buyNowOnly
            ? 'Available at fixed price'
            : remainingTime === 'Ended' || transaction.status !== TRANSACTION_STATUS.auctionActive
                ? 'Auction ended'
                : remainingTime;
        const latestDispute = disputeService.getLatestForListing(listingId);
        documentRef.getElementById('product-details-auction-status').textContent = listing.secondChanceOffer
            ? `Second-chance offer ${auctionManagement.offerStatus(listing)} · ${formatCurrency(listing.secondChanceOffer.price)} · Expires ${new Date(listing.secondChanceOffer.expiresAt).toLocaleString()}`
            : listing.listingFormat === LISTING_FORMAT.buyNow && transaction.status === TRANSACTION_STATUS.auctionActive
            ? 'Available at fixed price'
            : transactionStore.isPaused(listingId)
            ? 'Transaction paused while this issue is reviewed.'
            : latestDispute?.resolution && latestDispute.resolution !== DISPUTE_RESOLUTION.noAction
                ? `Issue resolved · ${DISPUTE_RESOLUTION_LABELS[latestDispute.resolution]}`
                : transactionStatusLabel(transaction);
        reportIssueButton.hidden = !disputeService.canReport(listingId);
        documentRef.getElementById('product-details-buy-now-price').textContent = listing.buyNowPrice === null
            ? 'Auction only'
            : biddingService.isBuyNowPriceAvailable(listingId)
                ? `Buy Now: ${formatCurrency(listing.buyNowPrice)}`
                : `Buy Now unavailable · ${formatCurrency(listing.buyNowPrice)}`;
        const isSeller = userService.isListingOwner(listingId);
        const auctionActive = transaction.status === TRANSACTION_STATUS.auctionActive && !biddingService.isAuctionExpired(listingId);
        documentRef.getElementById('product-details-minimum-bid').textContent = buyNowOnly
            ? 'This listing is available at its fixed Buy Now price.'
            : auctionActive
            ? `Next bid: ${formatCurrency(biddingService.minimumNextBid(listing))}${isSeller ? ' · You cannot bid on your own listing' : ''}`
            : 'Bidding is closed';
        const inspectionLevel = transactionStore.getInspectionReview(listingId)?.level;
        documentRef.getElementById('product-details-trust-note').textContent = [
            'Condition declared by seller',
            inspectionLevel === 'Technical' ? 'Technical inspection recommended'
                : inspectionLevel === 'Basic' ? 'Basic inspection may be available' : '',
            'Meetup is optional; eligible listings may use simple collection',
            listing.fulfilmentMethod === FULFILMENT_METHOD.shipping
                ? 'Shipping is prototype-only'
                : listing.fulfilmentMethod === FULFILMENT_METHOD.both
                    ? 'Shipping is prototype-only'
                    : '',
            'Prototype only; no payment is processed'
        ].filter(Boolean).join(' · ');
        renderTransactionTimeline(
            documentRef.getElementById('product-details-transaction-timeline'),
            getTransactionTimeline(transaction, listing.fulfilmentMethod, { issueOpen: transactionStore.isPaused(listingId) }),
            documentRef
        );
        const watchlist = userService.getWatchlist();
        detailWatchButton.textContent = watchlist.has(listingId) ? 'Saved' : 'Save';
        detailWatchButton.setAttribute('aria-pressed', String(watchlist.has(listingId)));
        detailWatchButton.setAttribute('aria-label', watchlist.has(listingId) ? 'Remove from watchlist' : 'Add to watchlist');

        const buyNowButton = documentRef.getElementById('product-details-buy-now-button');
        buyNowButton.hidden = !biddingService.isBuyNowAvailable(listingId);
        buyNowButton.disabled = !biddingService.isBuyNowAvailable(listingId);
        documentRef.getElementById('product-details-place-bid').hidden = !biddingService.canBid(listingId);
        documentRef.getElementById('product-details-place-bid').disabled = !biddingService.canBid(listingId);
        const primary = activityService.getPrimaryAction(listingId);
        primaryButton.textContent = primary?.actionLabel || '';
        primaryButton.hidden = !primary || ['bid', 'view'].includes(primary.action);
        declineOfferButton.hidden = !auctionManagement.getOfferActions(listingId).includes('decline-offer');
        cancelPurchaseButton.hidden = !transactionStore.canCancelUnstartedPurchase(listingId);
        cancelPurchaseButton.textContent = transaction.depositAmount > 0
            ? 'Cancel purchase (deposit forfeiture may apply)' : 'Cancel purchase';
        documentRef.getElementById('product-details-market-signals').textContent = [
            biddingService.getBidFeedback(listingId), ...watchlistService.getIndicators(listingId)
        ].filter(Boolean).join(' · ');
        watchlistService.acknowledge(listingId);
        dialogController.open(detailsDialog, returnFocus);
    }

    function prepareBidDialog(listingId) {
        const listing = listingStates.get(listingId);
        if (!listing) return false;

        activeBidListingId = listingId;
        documentRef.getElementById('bid-item-name').textContent = listing.title;
        documentRef.getElementById('bid-error').textContent = '';
        documentRef.getElementById('bid-success').hidden = true;
        bidForm.hidden = false;
        refreshNextBid();
        renderAutoBidPanel();
        return true;
    }

    function refreshNextBid() {
        const listing = listingStates.get(activeBidListingId);
        if (!listing) return;
        displayedNextBid = biddingService.minimumNextBid(listing);
        documentRef.getElementById('dialog-current-bid').textContent = formatCurrency(listing.currentBid);
        const open = biddingService.canBid(activeBidListingId);
        documentRef.getElementById('dialog-next-bid').textContent = open ? formatCurrency(displayedNextBid) : 'Bidding closed';
        nextBidButton.textContent = open ? `Place bid ${formatCurrency(displayedNextBid)}` : 'Bidding closed';
        nextBidButton.disabled = !open;
    }

    function renderAutoBidPanel() {
        const status = biddingService.getAutoBid(activeBidListingId);
        autoBidPanel.hidden = !status?.canConfigure;
        if (!status) return;
        autoBidFields.hidden = true;
        autoBidExpand.setAttribute('aria-expanded', 'false');
        autoBidExpand.textContent = status.maxAmount === null ? 'Set maximum' : 'Increase maximum';
        autoBidMax.value = status.maxAmount === null ? '' : String(status.maxAmount);
        autoBidMax.min = String(status.minimumMaximum);
        autoBidMax.max = String(status.maximumAllowed);
        autoBidMax.removeAttribute('aria-invalid');
        autoBidDisable.hidden = !status.enabled;
        autoBidStatus.textContent = status.maxAmount === null ? ''
            : `${status.leading ? 'You\u2019re leading' : 'You\u2019ve been outbid'}\nYour private maximum\n${formatCurrency(status.maxAmount)}`
                + (!status.enabled ? '\nAutomatic bidding is off.' : '');
    }

    function bidErrorMessage(result) {
        return result.code === SERVICE_ERROR_CODE.bidTooLow
            ? result.increment
                ? `Next bid updated to ${formatCurrency(result.minimumBid)}. Submit again to place it.`
                : `Enter a whole-number amount of at least ${formatCurrency(result.minimumBid)}.`
            : result.code === SERVICE_ERROR_CODE.bidTooHigh
                ? `Amounts cannot exceed ${formatCurrency(result.maximumBid)}.`
                : result.code === SERVICE_ERROR_CODE.invalidInput
                    ? 'Enter a whole-number amount above zero.'
                    : result.code === SERVICE_ERROR_CODE.ownListing
                        ? 'You cannot bid on your own listing.'
                        : result.code === SERVICE_ERROR_CODE.auctionClosed
                            ? 'This auction has ended.'
                            : 'This browser could not save your change.';
    }

    function openBidDialog(listingId, returnFocus) {
        if (!prepareBidDialog(listingId)) return;
        dialogController.open(bidDialog, returnFocus);
        nextBidButton.focus();
    }

    function saveAutoBidMaximum() {
        const result = biddingService.setAutoBid(activeBidListingId, Number(autoBidMax.value));
        if (!result.ok) {
            autoBidMax.setAttribute('aria-invalid', 'true');
            documentRef.getElementById('bid-error').textContent = bidErrorMessage(result);
            autoBidMax.focus();
            return result;
        }
        autoBidMax.removeAttribute('aria-invalid');
        return result;
    }

    function submitBid(event) {
        event.preventDefault();
        const listing = listingStates.get(activeBidListingId);
        if (!listing) return;

        recordEvent(USABILITY_EVENT_TYPE.nextBidAttempted, { relatedId: activeBidListingId });
        const result = biddingService.placeBid(activeBidListingId, displayedNextBid);
        refreshNextBid();
        renderAutoBidPanel();
        documentRef.getElementById('bid-error').textContent = '';
        documentRef.getElementById('bid-success').hidden = true;
        if (!result.ok) {
            recordEvent(USABILITY_EVENT_TYPE.bidRejected, {
                relatedId: activeBidListingId,
                metadata: { code: result.code || SERVICE_ERROR_CODE.actionNotAllowed }
            });
            if (result.code === SERVICE_ERROR_CODE.auctionClosed) renderListings();
            documentRef.getElementById('bid-error').textContent = bidErrorMessage(result);
            (nextBidButton.disabled ? documentRef.getElementById('cancel-bid') : nextBidButton).focus();
            return;
        }

        recordEvent(USABILITY_EVENT_TYPE.nextBidAccepted, { relatedId: activeBidListingId });
        const leading = result.data.leading;
        if (!leading) recordEvent(USABILITY_EVENT_TYPE.immediatelyOutbid, { relatedId: activeBidListingId });
        renderListings();
        const bidSuccess = documentRef.getElementById('bid-success');
        bidSuccess.textContent = leading ? 'Bid accepted. You\u2019re leading.'
            : 'Bid accepted. You were immediately outbid by another buyer\u2019s automatic bid.';
        bidSuccess.hidden = false;
    }

    function saveMaximumOnly() {
        const previousMaximum = biddingService.getAutoBid(activeBidListingId)?.maxAmount;
        const nextMaximum = Number(autoBidMax.value);
        const result = saveAutoBidMaximum();
        if (!result.ok) return;
        if (previousMaximum === null || nextMaximum > previousMaximum) {
            recordEvent(previousMaximum === null ? USABILITY_EVENT_TYPE.maximumBidSet : USABILITY_EVENT_TYPE.maximumBidIncreased,
                { relatedId: activeBidListingId });
        }
        if (!result.data.leading) recordEvent(USABILITY_EVENT_TYPE.immediatelyOutbid, { relatedId: activeBidListingId });
        renderListings();
        prepareBidDialog(activeBidListingId);
        autoBidExpand.focus();
    }

    bidForm.addEventListener('submit', submitBid);
    autoBidExpand.addEventListener('click', () => {
        autoBidFields.hidden = !autoBidFields.hidden;
        autoBidExpand.setAttribute('aria-expanded', String(!autoBidFields.hidden));
        if (!autoBidFields.hidden) autoBidMax.focus();
    });
    autoBidMax.addEventListener('input', () => {
        autoBidMax.removeAttribute('aria-invalid');
        documentRef.getElementById('bid-error').textContent = '';
    });
    autoBidMax.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.isComposing) {
            event.preventDefault();
            saveMaximumOnly();
        }
    });
    documentRef.getElementById('auto-bid-save').addEventListener('click', saveMaximumOnly);
    autoBidDisable.addEventListener('click', () => {
        const result = biddingService.disableAutoBid(activeBidListingId);
        if (!result.ok) {
            documentRef.getElementById('bid-error').textContent = bidErrorMessage(result);
            return;
        }
        renderAutoBidPanel();
        autoBidFields.hidden = false;
        autoBidExpand.setAttribute('aria-expanded', 'true');
        autoBidStatus.textContent = 'Automatic bidding is off. Your existing bid stays in place.';
    });
    documentRef.getElementById('cancel-bid').addEventListener('click', () => dialogController.close(bidDialog));
    bidDialog.addEventListener('close', () => { activeBidListingId = null; });
    documentRef.getElementById('close-product-details').addEventListener('click', () => dialogController.close(detailsDialog));
    documentRef.getElementById('product-details-place-bid').addEventListener('click', () => {
        if (!prepareBidDialog(activeDetailsListingId)) return;
        dialogController.transition(detailsDialog, bidDialog);
        nextBidButton.focus();
    });
    documentRef.getElementById('product-details-buy-now-button').addEventListener('click', () => {
        buyNowHandler(activeDetailsListingId, detailsDialog);
    });
    reportIssueButton.addEventListener('click', () => reportIssueHandler(activeDetailsListingId, detailsDialog));
    primaryButton.addEventListener('click', () => {
        const listingId = activeDetailsListingId;
        const primary = activityService.getPrimaryAction(listingId);
        if (primary?.action === 'accept-offer') {
            const result = auctionManagement.respondToOffer(listingId, 'accept');
            if (!result.ok) {
                documentRef.getElementById('product-details-auction-status').textContent = result.message;
                return;
            }
            renderListings();
            showProductDetails(listingId);
            return;
        }
        dialogController.close(detailsDialog);
        primaryActionHandler(listingId, primary);
    });
    declineOfferButton.addEventListener('click', () => {
        const listingId = activeDetailsListingId;
        const result = auctionManagement.respondToOffer(listingId, 'decline');
        if (!result.ok) {
            documentRef.getElementById('product-details-auction-status').textContent = result.message;
            return;
        }
        renderListings();
        showProductDetails(listingId);
    });
    cancelPurchaseButton.addEventListener('click', () => {
        if (!documentRef.defaultView.confirm('Cancel this local purchase? The transaction and bid history will be retained.')) return;
        const reason = documentRef.defaultView.prompt('Optional concise cancellation reason (200 characters or fewer):', '');
        if (reason === null) return;
        const listingId = activeDetailsListingId;
        const result = auctionManagement.cancelPurchase(listingId, reason);
        if (!result.ok) {
            documentRef.getElementById('product-details-auction-status').textContent = result.message;
            return;
        }
        renderListings();
        showProductDetails(listingId);
    });
    thumbnailContainer.addEventListener('click', event => {
        const button = event.target.closest('button[data-image-index]');
        if (!button) return;
        const imageIndex = Number(button.dataset.imageIndex);
        const imageUrl = activeImages[imageIndex];
        if (!imageUrl) return;
        image.src = imageUrl;
        thumbnailContainer.querySelectorAll('button[data-image-index]').forEach(thumbnail => {
            thumbnail.setAttribute('aria-pressed', String(thumbnail === button));
        });
    });
    detailWatchButton.addEventListener('click', () => {
        if (!activeDetailsListingId) return;
        const currentUser = userService.getCurrentUser();
        const watchlist = userService.getWatchlist(currentUser.id);
        const wasWatching = watchlist.has(activeDetailsListingId);
        if (wasWatching) watchlist.delete(activeDetailsListingId);
        else watchlist.add(activeDetailsListingId);
        const saved = userService.saveWatchlist(currentUser.id, watchlist);
        if (!saved) {
            if (wasWatching) watchlist.add(activeDetailsListingId);
            else watchlist.delete(activeDetailsListingId);
        }
        const isWatching = watchlist.has(activeDetailsListingId);
        if (saved && !wasWatching && isWatching) {
            recordEvent(USABILITY_EVENT_TYPE.watchlistAdded, { relatedId: activeDetailsListingId });
        }
        detailWatchButton.textContent = isWatching ? 'Saved' : 'Save';
        detailWatchButton.setAttribute('aria-pressed', String(isWatching));
        detailWatchButton.setAttribute('aria-label', isWatching ? 'Remove from watchlist' : 'Add to watchlist');
        renderListings();
    });
    detailsDialog.addEventListener('close', () => {
        activeDetailsListingId = null;
        activeImages = [];
        thumbnailContainer.replaceChildren();
        thumbnailContainer.hidden = true;
    });

    return {
        showProductDetails,
        openBidDialog,
        setBuyNowHandler(handler) { buyNowHandler = handler; },
        setReportIssueHandler(handler) { reportIssueHandler = handler; },
        setPrimaryActionHandler(handler) { primaryActionHandler = handler; },
        setSellerProfileHandler(handler) { sellerProfileHandler = handler; },
        focusListingAction
    };
}