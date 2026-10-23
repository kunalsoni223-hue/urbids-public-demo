import { INSPECTION_REJECTION_REASON, INSPECTION_REJECTION_REASON_LABELS, RESERVE_PRICE_MODE, USABILITY_EVENT_TYPE } from '../core/constants.js';
import { config } from '../config.js';
import { formatCurrency } from '../core/formatting.js';

export function createAuctionManagementUI({ documentRef = document, auctionManagement, listingStates, dialogController, onChanged, onOpenListing, recordEvent = () => {} }) {
    const dialog = documentRef.getElementById('auction-management-dialog');
    const form = documentRef.getElementById('auction-management-form');
    const error = documentRef.getElementById('auction-management-error');
    const success = documentRef.getElementById('auction-management-success');
    const controls = documentRef.getElementById('auction-management-actions');
    const input = name => documentRef.getElementById(`auction-${name}`);
    let activeListingId = null;
    let mode = null;
    let bidders = [];
    const labels = {
        edit: 'Edit before first bid', lowerBuyNow: 'Lower Buy Now price', endEarly: 'End listing early',
        unpublish: 'Unpublish', relist: 'Relist', secondChance: 'Second-chance offer', cancelPurchase: 'Cancel purchase',
        cancelAuction: 'Withdraw auction', confirmAvailability: 'Confirm item availability',
        correctListing: 'Correct listing details'
    };

    function renderControls() {
        const allowed = auctionManagement.permissions(activeListingId);
        input('management-stats').textContent = `${allowed.bidCount || 0} bids · ${allowed.watcherCount || 0} local watchers`;
        controls.replaceChildren(...Object.entries(labels).filter(([key]) => allowed[key]).map(([key, label]) => {
            const button = documentRef.createElement('button');
            button.type = 'button';
            button.className = key === 'relist' ? 'primary-button' : 'bid-cancel';
            button.textContent = label;
            button.addEventListener('click', () => prepare(key));
            return button;
        }));
        const view = documentRef.createElement('button');
        view.type = 'button';
        view.className = 'bid-cancel';
        view.textContent = 'View listing';
        view.addEventListener('click', () => {
            dialogController.close(dialog);
            onOpenListing(activeListingId);
        });
        if (allowed.view) controls.append(view);
    }

    function prepare(nextMode) {
        const listing = listingStates.get(activeListingId);
        if (!listing) return;
        mode = nextMode;
        error.textContent = '';
        success.textContent = '';
        form.reset();
        form.hidden = false;
        input('management-form-title').textContent = labels[mode];
        ['edit-details', 'edit-economics', 'offer-fields'].forEach(name => {
            const fieldset = input(name);
            const enabled = name === 'edit-details' ? mode === 'edit'
                : name === 'edit-economics' ? ['edit', 'relist', 'lowerBuyNow'].includes(mode)
                    : mode === 'secondChance';
            fieldset.hidden = !enabled;
            fieldset.disabled = !enabled;
        });
        input('availability-fields').hidden = mode !== 'confirmAvailability';
        input('availability-fields').disabled = mode !== 'confirmAvailability';
        input('correction-fields').hidden = mode !== 'correctListing';
        input('correction-fields').disabled = mode !== 'correctListing';
        input('cancellation-fields').hidden = !['cancelPurchase', 'cancelAuction'].includes(mode);
        input('cancellation-fields').disabled = !['cancelPurchase', 'cancelAuction'].includes(mode);
        if (mode === 'confirmAvailability') {
            input('availability-review').checked = false;
            form.querySelectorAll('input[name="auction-availability"]').forEach(radio => { radio.checked = false; });
        }
        if (mode === 'correctListing') {
            const specifications = listing.specifications || {};
            input('correction-title').value = listing.title || '';
            input('correction-brand-model').value = listing.brandModel || '';
            input('correction-condition').value = listing.conditionGrade || 'B';
            input('correction-functional').value = specifications.functionalStatus || '';
            input('correction-defects').value = specifications.knownDefects || '';
            input('correction-accessories').value = Array.isArray(specifications.includedAccessories)
                ? specifications.includedAccessories.join(', ') : specifications.includedAccessories || '';
            input('correction-serial').value = specifications.serialModelInfo || '';
            input('correction-activation').value = specifications.activationLock || '';
            input('correction-proof').value = specifications.proofOfPurchase || '';
            input('correction-description').value = listing.description || '';
            input('correction-ack').checked = false;
            const reason = auctionManagement.getMismatchReason(activeListingId);
            const requirements = {
                [INSPECTION_REJECTION_REASON.wrongProduct]: 'Correct the listing title and declared brand, model and variant to match the item.',
                [INSPECTION_REJECTION_REASON.undisclosedDefect]: 'Update functional status and known defects to disclose the reported issue.',
                [INSPECTION_REJECTION_REASON.functionalFailure]: 'Update functional status and known defects to disclose the reported issue.',
                [INSPECTION_REJECTION_REASON.missingAccessory]: 'Update included accessories to match what is supplied.',
                [INSPECTION_REJECTION_REASON.worseCondition]: 'Update the condition grade and description to match the item.',
                [INSPECTION_REJECTION_REASON.identifierMismatch]: 'Correct the model or identifier details; do not enter a full serial number or IMEI.',
                [INSPECTION_REJECTION_REASON.activationLock]: 'Correct the activation-lock disclosure.',
                [INSPECTION_REJECTION_REASON.counterfeitOwnership]: 'Correct the relevant model, identifier or proof-of-purchase disclosure.',
                [INSPECTION_REJECTION_REASON.otherMaterialMismatch]: 'Correct the listing detail that did not match the item.'
            };
            input('correction-reason').textContent = requirements[reason]
                || `Address the reported issue: ${INSPECTION_REJECTION_REASON_LABELS[reason] || 'Material mismatch'}.`;
        }
        ['title', 'brand', 'description', 'location'].forEach(name => {
            input(`edit-${name}`).value = listing[name === 'brand' ? 'brandModel' : name];
        });
        input('edit-start').value = Number.isSafeInteger(listing.startingBid) ? listing.startingBid : listing.currentBid ?? '';
        const increments = [...config.sellerBidIncrements];
        if (mode !== 'relist' && !increments.includes(listing.bidIncrement)) increments.push(listing.bidIncrement);
        input('edit-increment').replaceChildren(...increments.map(amount => {
            const option = documentRef.createElement('option');
            option.value = String(amount);
            option.textContent = formatCurrency(amount);
            return option;
        }));
        input('edit-increment').value = String(increments.includes(listing.bidIncrement) ? listing.bidIncrement : 100);
        input('edit-increment').disabled = mode === 'lowerBuyNow';
        input('edit-buy').value = listing.buyNowPrice ?? '';
        input('edit-duration').value = String(listing.auctionDurationHours || 72);
        ['start', 'buy'].forEach(name => { input(`edit-${name}`).max = String(config.auctionRules.maximumListingPrice); });
        ['start', 'duration'].forEach(name => {
            input(`edit-${name}`).disabled = mode === 'lowerBuyNow';
        });
        if (mode === 'lowerBuyNow') {
            input('edit-buy').required = true;
            input('edit-buy').max = String(listing.buyNowPrice - 1);
            input('edit-buy').min = String(listing.currentBid + 1);
        } else {
            input('edit-buy').required = false;
            input('edit-buy').min = '1';
        }
        bidders = auctionManagement.eligibleBidders(activeListingId);
        input('offer-bidder').replaceChildren(...bidders.map(bidder => {
            const option = documentRef.createElement('option');
            option.value = bidder.userId;
            option.textContent = `${bidder.label} · ${formatCurrency(bidder.amount)}`;
            return option;
        }));
        setOfferPrice();
        const confirmation = ['endEarly', 'unpublish', 'cancelPurchase', 'cancelAuction'].includes(mode);
        input('management-confirm-wrap').hidden = !confirmation;
        input('management-confirm').required = confirmation;
        input('management-confirm').disabled = !confirmation;
    }

    function setOfferPrice() {
        const bidder = bidders.find(item => item.userId === input('offer-bidder').value);
        input('offer-price').value = bidder?.amount ?? '';
        input('offer-price').max = String(bidder?.amount || config.auctionRules.maximumListingPrice);
        input('offer-price').readOnly = true;
    }

    form.addEventListener('submit', event => {
        event.preventDefault();
        const fields = {
            title: input('edit-title').value.trim(), brandModel: input('edit-brand').value.trim(),
            description: input('edit-description').value.trim(), location: input('edit-location').value.trim(),
            startingBid: Number(input('edit-start').value),
            bidIncrement: Number(input('edit-increment').value),
            buyNowPrice: input('edit-buy').value === '' ? null : Number(input('edit-buy').value),
            reservePrice: null,
            reservePriceMode: RESERVE_PRICE_MODE.none,
            auctionDurationHours: Number(input('edit-duration').value)
        };
        let result;
        if (mode === 'edit' || mode === 'lowerBuyNow') result = auctionManagement.update(activeListingId, fields, { lowerOnly: mode === 'lowerBuyNow' });
        else if (mode === 'relist') result = auctionManagement.relist(activeListingId, fields);
        else if (mode === 'secondChance') result = auctionManagement.createOffer(activeListingId, input('offer-bidder').value, Number(input('offer-price').value));
        else if (mode === 'endEarly') result = auctionManagement.endEarly(activeListingId);
        else if (mode === 'unpublish') result = auctionManagement.unpublish(activeListingId);
        else if (mode === 'cancelPurchase') result = auctionManagement.cancelPurchase(activeListingId, input('cancellation-reason').value);
        else if (mode === 'cancelAuction') result = auctionManagement.cancelAuction(activeListingId, input('cancellation-reason').value);
        else if (mode === 'confirmAvailability') {
            const selected = form.querySelector('input[name="auction-availability"]:checked');
            result = selected ? auctionManagement.confirmAvailability(activeListingId, selected.value === 'yes') : null;
        } else if (mode === 'correctListing') {
            const current = listingStates.get(activeListingId);
            const specifications = { ...(current.specifications || {}) };
            specifications.functionalStatus = input('correction-functional').value.trim();
            specifications.knownDefects = input('correction-defects').value.trim();
            specifications.includedAccessories = input('correction-accessories').value.trim();
            specifications.serialModelInfo = input('correction-serial').value.trim();
            specifications.activationLock = input('correction-activation').value.trim();
            specifications.proofOfPurchase = input('correction-proof').value.trim();
            result = auctionManagement.submitCorrection(activeListingId, {
                title: input('correction-title').value.trim(),
                brandModel: input('correction-brand-model').value.trim(),
                condition: input('correction-condition').value,
                description: input('correction-description').value,
                specifications,
                sellerAcknowledged: input('correction-ack').checked
            }, Array.from(input('correction-photos').files));
        }
        if (!result?.ok) {
            error.textContent = result?.message || 'This action could not be saved. Reopen management to see current permissions.';
            return;
        }
        if (mode === 'correctListing') {
            recordEvent(USABILITY_EVENT_TYPE.sellerSubmissionCompleted, { relatedId: activeListingId });
        }
        form.hidden = true;
        error.textContent = '';
        success.textContent = mode === 'relist' ? 'New auction published. Earlier records are unchanged.'
            : mode === 'secondChance' ? 'Private local offer created. Switch to its recipient to respond.' : 'Change saved in this browser.';
        if (mode === 'relist') activeListingId = result.data.id;
        onChanged();
        renderControls();
    });
    input('offer-bidder').addEventListener('change', setOfferPrice);
    documentRef.getElementById('close-auction-management').addEventListener('click', () => dialogController.close(dialog));

    return {
        open(listingId, initialMode = null) {
            activeListingId = listingId;
            const listing = listingStates.get(listingId);
            if (!listing || !auctionManagement.permissions(listingId).view) return;
            input('management-item').textContent = listing.title;
            form.hidden = true;
            error.textContent = '';
            success.textContent = '';
            renderControls();
            if (initialMode && auctionManagement.permissions(listingId)[initialMode]) prepare(initialMode);
            dialogController.open(dialog);
        }
    };
}
