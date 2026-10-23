import { DEPOSIT_OUTCOME, DISPUTE_REASON, FAILURE_OUTCOME, FULFILMENT_METHOD, INSPECTION_REJECTION_REASON, MEETUP_ATTENDANCE_STATUS, PURCHASE_SOURCE, RESERVATION_DEPOSIT, SERVICE_ERROR_CODE, SHIPPING_STATUS, SUBCATEGORY, TRANSACTION_EVENT, TRANSACTION_STATUS, USABILITY_EVENT_TYPE } from '../core/constants.js';
import { formatCurrency, localDateValue } from '../core/formatting.js';

export function createTransactionUI({ documentRef = document, config, state, biddingService, userService, disputeService, dialogController, renderListings, recordEvent = () => {} }) {
    const { listingStates, transactionStore } = state;
    const winnerDialog = documentRef.getElementById('auction-winner-dialog');
    const buyNowDialog = documentRef.getElementById('buy-now-dialog');
    const fulfilmentChoiceDialog = documentRef.getElementById('fulfilment-choice-dialog');
    const shippingDialog = documentRef.getElementById('shipping-dialog');
    const meetupDialog = documentRef.getElementById('meetup-dialog');
    const meetupForm = documentRef.getElementById('meetup-form');
    const meetupDateInput = documentRef.getElementById('meetup-date');
    const meetupError = documentRef.getElementById('meetup-error');
    const inspectionDialog = documentRef.getElementById('inspection-dialog');
    const inspectionChecklist = documentRef.getElementById('inspection-checklist');
    const inspectionError = documentRef.getElementById('inspection-error');
    const finalPaymentDialog = documentRef.getElementById('final-payment-dialog');
    const handoverDialog = documentRef.getElementById('handover-dialog');
    let activeBuyNowListingId = null;
    let activeMeetupListingId = null;
    let activeWinnerListingId = null;
    let activeBookingContext = null;
    let activeMeetupId = null;
    let activeInspectionMeetupId = null;
    let activeFinalPaymentMeetupId = null;
    let activeHandoverMeetupId = null;
    let activeHandoverListingId = null;
    let activeHandoverIsSimple = false;
    let activeShippingListingId = null;
    let activeFulfilmentContext = null;
    let reportIssueHandler = () => {};

    function getTransaction(listingId) {
        return transactionStore.get(listingId);
    }

    function reservationDeposit(value) {
        return value < 5000 ? RESERVATION_DEPOSIT.none
            : value <= RESERVATION_DEPOSIT.standardMaximum ? RESERVATION_DEPOSIT.standard : RESERVATION_DEPOSIT.highValue;
    }

    function depositExplanation(amount) {
        return amount
            ? `A ${formatCurrency(amount)} reservation deposit applies because of this item's value and is credited toward the purchase. Seller cancellation/no-show or material mismatch is refundable; buyer change of mind/no-show may forfeit it. Prototype only • No money is collected.`
            : 'No reservation deposit applies below ₹5,000. Prototype only • No money is collected.';
    }

    function openShippingFlow(listingId, sourceDialog) {
        const listing = listingStates.get(listingId);
        const transaction = listing ? getTransaction(listingId) : null;
        if (!listing || !transactionStore.canOpenShipping(listingId)) return;
        activeShippingListingId = listingId;
        documentRef.getElementById('shipping-item-name').textContent = listing.title;
        documentRef.getElementById('shipping-error').textContent = '';
        documentRef.getElementById('shipping-reference').textContent = transaction.shippingReference
            ? `Demo reference: ${transaction.shippingReference}`
            : 'No courier booking or tracking number is created.';
        documentRef.getElementById('shipping-inspection-window').textContent = transaction.shippingInspectionEndsAt
            ? `Inspect and raise any issue by ${new Date(transaction.shippingInspectionEndsAt).toLocaleString()}. This 24-hour window is simulated.`
            : 'After simulated delivery, the buyer has 24 hours to inspect and report an issue.';
        const statusText = {
            [TRANSACTION_STATUS.tokenCompleted]: 'Reservation recorded in this prototype. No payment was taken.',
            [SHIPPING_STATUS.requested]: 'Shipping requested. Waiting for the seller to simulate dispatch.',
            [SHIPPING_STATUS.inTransit]: 'Seller dispatch simulated. Waiting for the buyer to simulate delivery.',
            [SHIPPING_STATUS.delivered]: 'Delivery simulated. The buyer can inspect the item or report an issue.',
            [TRANSACTION_STATUS.completed]: 'Buyer accepted the item. Shipping demo complete.'
        };
        documentRef.getElementById('shipping-status').textContent = transactionStore.isPaused(listingId)
            ? 'Transaction paused while this issue is reviewed.'
            : statusText[transaction.status] || 'Shipping flow unavailable for this transaction.';
        documentRef.getElementById('request-shipping').hidden = !transactionStore.canPerform(listingId, TRANSACTION_EVENT.requestShipping);
        documentRef.getElementById('dispatch-shipping').hidden = !transactionStore.canPerform(listingId, TRANSACTION_EVENT.shippingDispatched);
        documentRef.getElementById('deliver-shipping').hidden = !transactionStore.canPerform(listingId, TRANSACTION_EVENT.shippingDelivered);
        documentRef.getElementById('accept-shipping').hidden = !transactionStore.canPerform(listingId, TRANSACTION_EVENT.shippingAccept);
        documentRef.getElementById('report-shipping-issue').hidden = transactionStore.isPaused(listingId)
            || transaction.status !== TRANSACTION_STATUS.shippingDelivered
            || !disputeService.canReport(listingId);
        if (sourceDialog?.open) dialogController.transition(sourceDialog, shippingDialog);
        else dialogController.open(shippingDialog, sourceDialog);
    }

    function continueToFulfilment(context, sourceDialog) {
        if (!context) return;
        const listing = listingStates.get(context.listingId);
        if (!listing) return;
        const method = listing.fulfilmentMethod || FULFILMENT_METHOD.inPerson;
        if (method === FULFILMENT_METHOD.shipping) {
            recordEvent(USABILITY_EVENT_TYPE.fulfilmentSelected, { relatedId: listing.id, metadata: { fulfilment: 'shipping' } });
            openShippingFlow(context.listingId, sourceDialog);
        } else {
            activeFulfilmentContext = context;
            documentRef.getElementById('fulfilment-choice-item').textContent = listing.title;
            const simpleAllowed = transactionStore.canSelectSimpleCollection(context.listingId);
            documentRef.getElementById('choose-simple-collection').hidden = !simpleAllowed;
            documentRef.getElementById('simple-collection-error')?.remove();
            documentRef.getElementById('fulfilment-choice-error').textContent = '';
            documentRef.getElementById('simple-collection-decline').checked = false;
            const technical = transactionStore.getInspectionReview(context.listingId)?.level === 'Technical';
            const warning = technical
                ? 'Inspection recommended. Continuing without inspection may limit mismatch claims to issues that could not reasonably have been identified at handover.'
                : 'Simple collection is available for this item. Confirm receipt here before completion.';
            documentRef.getElementById('simple-collection-warning').textContent = `${warning} Prototype policy wording, not legal advice.`;
            documentRef.getElementById('simple-collection-decline-label').hidden = !technical;
            documentRef.getElementById('choose-shipping').hidden = method !== FULFILMENT_METHOD.both;
            if (sourceDialog?.open) dialogController.transition(sourceDialog, fulfilmentChoiceDialog);
            else dialogController.open(fulfilmentChoiceDialog, sourceDialog);
        }
    }

    function openBuyNow(listingId, source) {
        const listing = listingStates.get(listingId);
        if (!listing || !biddingService.isBuyNowAvailable(listingId)) return;

        recordEvent(USABILITY_EVENT_TYPE.buyNowStarted, { relatedId: listingId });
        activeBuyNowListingId = listingId;
        documentRef.getElementById('buy-now-item-name').textContent = listing.title;
        documentRef.getElementById('buy-now-price').textContent = `Buy Now price: ${formatCurrency(listing.buyNowPrice)}`;
        documentRef.getElementById('buy-now-token-note').textContent = depositExplanation(reservationDeposit(listing.buyNowPrice));
        documentRef.getElementById('buy-now-success').hidden = true;
        documentRef.getElementById('confirm-buy-now').hidden = false;
        documentRef.getElementById('cancel-buy-now').hidden = false;
        documentRef.getElementById('schedule-meetup').hidden = true;
        documentRef.getElementById('buy-now-done').hidden = true;
        if (source?.open) dialogController.transition(source, buyNowDialog);
        else dialogController.open(buyNowDialog, source);
    }

    function showWinnerDialog(listingId, returnFocus) {
        const listing = listingStates.get(listingId);
        const transaction = getTransaction(listingId);
        if (!listing
            || transactionStore.isPaused(listingId)
            || ![
                TRANSACTION_STATUS.auctionWon,
                TRANSACTION_STATUS.tokenPending,
                TRANSACTION_STATUS.tokenCompleted
            ].includes(transaction.status)
            || transaction.purchaseSource !== PURCHASE_SOURCE.auctionWinner
            || !transactionStore.isBuyer(listingId)) return;

        activeWinnerListingId = listingId;
        documentRef.getElementById('auction-winner-title').textContent = 'You won!';
        documentRef.getElementById('auction-winner-item').textContent = listing.title;
        documentRef.getElementById('auction-winner-name').textContent = transaction.status === TRANSACTION_STATUS.tokenCompleted
            ? 'Reservation recorded in this prototype.'
            : `Winning bidder: ${transaction.winner}`;
        documentRef.getElementById('auction-winning-bid').textContent = `Winning bid: ${formatCurrency(transaction.winningBid)}`;
        const amount = transaction.depositAmount || reservationDeposit(transaction.transactionPrice);
        documentRef.getElementById('auction-commitment-note').textContent = depositExplanation(amount);
        documentRef.getElementById('auction-winner-deadline').textContent = transaction.winnerResponseDeadline
            ? `Confirm by ${new Date(transaction.winnerResponseDeadline).toLocaleString()}.`
            : '';
        documentRef.getElementById('continue-auction-booking-token').hidden = false;
        documentRef.getElementById('decline-auction-win').hidden = transaction.status !== TRANSACTION_STATUS.auctionWon;
        documentRef.getElementById('continue-auction-booking-token').textContent = transaction.status === TRANSACTION_STATUS.tokenCompleted
            ? 'Choose handover'
            : 'Confirm purchase';
        dialogController.open(winnerDialog, returnFocus);
    }

    function resolveMeetup(listingId) {
        return transactionStore.getLatestMeetup(listingId);
    }

    function resumeTransaction(listingId, returnFocus) {
        let transaction = getTransaction(listingId);
        if (transactionStore.isPaused(listingId) || !transactionStore.isBuyer(listingId)) return;
        const meetup = resolveMeetup(listingId);

        if ([TRANSACTION_STATUS.auctionWon, TRANSACTION_STATUS.tokenPending, TRANSACTION_STATUS.tokenCompleted].includes(transaction.status)
            && transaction.purchaseSource === PURCHASE_SOURCE.auctionWinner) {
            showWinnerDialog(listingId, returnFocus);
            return;
        }
        if (transaction.status === TRANSACTION_STATUS.tokenPending && transaction.purchaseSource === PURCHASE_SOURCE.buyNow) {
            activeBookingContext = simulateBookingToken(listingId, PURCHASE_SOURCE.buyNow);
            if (activeBookingContext) continueToFulfilment(activeBookingContext, null);
            return;
        }
        if (transaction.status === TRANSACTION_STATUS.tokenCompleted && transaction.purchaseSource === PURCHASE_SOURCE.buyNow) {
            continueToFulfilment({ listingId, purchaseSource: PURCHASE_SOURCE.buyNow, transactionPrice: transaction.transactionPrice }, null);
        } else if (transaction.fulfilmentPath === 'simple_collection'
            && [TRANSACTION_STATUS.simpleCollectionRequested, TRANSACTION_STATUS.sellerHandoverConfirmed, TRANSACTION_STATUS.buyerReceiptConfirmed].includes(transaction.status)) {
            openHandover(listingId, null);
        } else if ([SHIPPING_STATUS.requested, SHIPPING_STATUS.inTransit, SHIPPING_STATUS.delivered].includes(transaction.status)) {
            openShippingFlow(listingId);
        } else if ([TRANSACTION_STATUS.meetupRequested, TRANSACTION_STATUS.inspectionPending].includes(transaction.status) && meetup) {
            if (transactionStore.canStartInspection(meetup.id)) openInspectionForMeetup(meetup);
            else openMeetupSummary(listingId);
        } else if (transaction.status === TRANSACTION_STATUS.itemApproved && meetup) {
            openFinalPayment(meetup.id);
        } else if ([
            TRANSACTION_STATUS.paymentPreviewed,
            TRANSACTION_STATUS.sellerHandoverConfirmed,
            TRANSACTION_STATUS.buyerReceiptConfirmed
        ].includes(transaction.status) && meetup) {
            if (transaction.status === TRANSACTION_STATUS.buyerReceiptConfirmed) {
                transaction = transactionStore.transition(listingId, TRANSACTION_EVENT.completeTransaction) || transaction;
                renderListings();
            }
            openHandover(meetup.id);
        }
    }

    function openMeetupSummary(listingId) {
        const meetup = transactionStore.getLatestMeetup(listingId);
        if (!meetup || !transactionStore.isParticipant(listingId)) return;
        const transaction = getTransaction(listingId);
        activeMeetupId = meetup.id;
        activeMeetupListingId = listingId;
        documentRef.getElementById('meetup-item-name').textContent = meetup.itemTitle;
        meetupForm.hidden = true;
        meetupError.textContent = '';
        const attendance = userId => meetup.attendance?.[userId]?.status || MEETUP_ATTENDANCE_STATUS.pending;
        documentRef.getElementById('meetup-success').textContent = `${meetup.date} at ${meetup.time} · ${meetup.location} · Buyer: ${attendance(transaction.buyerUserId)} · Seller: ${attendance(transaction.sellerUserId)}. Record attendance in My activity after the scheduled time.`;
        documentRef.getElementById('meetup-success').hidden = false;
        documentRef.getElementById('start-inspection').hidden = !transactionStore.canStartInspection(meetup.id);
        documentRef.getElementById('meetup-done').hidden = false;
        dialogController.open(meetupDialog);
    }

    function simulateBookingToken(listingId, purchaseSource) {
        const listing = listingStates.get(listingId);
        if (!listing || transactionStore.isPaused(listingId)) return null;
        let transaction = getTransaction(listingId);

        if (purchaseSource === PURCHASE_SOURCE.auctionWinner && transaction.status === TRANSACTION_STATUS.auctionWon) {
            transaction = transactionStore.transition(listingId, TRANSACTION_EVENT.startToken);
        } else if (purchaseSource === PURCHASE_SOURCE.buyNow && transaction.status === TRANSACTION_STATUS.auctionActive) {
            if (!biddingService.isBuyNowAvailable(listingId)) {
                if (biddingService.isAuctionExpired(listingId)) renderListings();
                return null;
            }
            transaction = transactionStore.transition(listingId, TRANSACTION_EVENT.buyNow, {
                transactionPrice: listing.buyNowPrice,
                buyerUserId: userService.getCurrentUser().id,
                sellerUserId: listing.sellerUserId
            });
        }
        if (!transaction || transaction.status !== TRANSACTION_STATUS.tokenPending || transaction.purchaseSource !== purchaseSource) return null;

        const updated = transactionStore.transition(listingId, TRANSACTION_EVENT.simulateToken);
        if (!updated) return null;
        recordEvent(USABILITY_EVENT_TYPE.tokenStepCompleted, { relatedId: listingId });
        renderListings();
        return { listingId, purchaseSource, transactionPrice: updated.transactionPrice };
    }

    function openMeetupForm(context, sourceDialog) {
        if (!context) return;
        if (!transactionStore.canPerform(context.listingId, TRANSACTION_EVENT.meetupRequested)) return;
        activeMeetupListingId = context.listingId;
        const listing = listingStates.get(context.listingId);
        if (!listing) return;

        meetupForm.reset();
        meetupDateInput.min = localDateValue();
        meetupDateInput.value = meetupDateInput.min;
        meetupError.textContent = '';
        documentRef.getElementById('meetup-item-name').textContent = listing.title;
        documentRef.getElementById('meetup-item-price').textContent = context.purchaseSource === PURCHASE_SOURCE.auctionWinner
            ? `Winning bid: ${formatCurrency(context.transactionPrice)}`
            : `Buy Now price: ${formatCurrency(context.transactionPrice)}`;
        documentRef.getElementById('meetup-success').hidden = true;
        documentRef.getElementById('start-inspection').hidden = true;
        meetupForm.hidden = false;
        documentRef.getElementById('meetup-done').hidden = true;
        if (sourceDialog?.open) dialogController.transition(sourceDialog, meetupDialog);
        else dialogController.open(meetupDialog);
    }

    function renderInspectionChecklist(checks) {
        inspectionChecklist.replaceChildren(...checks.map((check, index) => {
            const item = documentRef.createElement('li');
            const label = documentRef.createElement('label');
            const checkbox = documentRef.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = check;
            checkbox.id = `inspection-check-${index}`;
            const text = documentRef.createElement('span');
            text.textContent = check;
            label.htmlFor = checkbox.id;
            label.append(checkbox, text);
            item.append(label);
            return item;
        }));
    }

    function openInspectionForMeetup(meetup) {
        if (!meetup) return;
        if (!transactionStore.canStartInspection(meetup.id)) return;
        const transaction = getTransaction(meetup.listingId);
        const listing = listingStates.get(meetup.listingId);
        if (!listing) return;
        const currentStatus = getTransaction(meetup.listingId).status;
        if (currentStatus === TRANSACTION_STATUS.meetupRequested) {
            if (!transactionStore.startInspection(meetup.id)) return;
            recordEvent(USABILITY_EVENT_TYPE.inspectionStarted, { relatedId: meetup.listingId });
            renderListings();
        } else if (currentStatus !== TRANSACTION_STATUS.inspectionPending) {
            return;
        }

        activeMeetupId = meetup.id;
        activeInspectionMeetupId = meetup.id;
        documentRef.getElementById('inspection-item-name').textContent = listing.title;
        const inspectionReview = transactionStore.getInspectionReview(listing.id);
        documentRef.getElementById('inspection-guidance').textContent = inspectionReview.guidance;
        documentRef.getElementById('inspection-declared-details').textContent = inspectionReview.declaredDetails;
        inspectionError.textContent = '';
        documentRef.getElementById('inspection-success').hidden = true;
        documentRef.getElementById('continue-final-payment').hidden = true;
        documentRef.getElementById('inspection-done').hidden = true;
        documentRef.getElementById('approve-inspection').hidden = false;
        documentRef.getElementById('reject-inspection').hidden = false;
        documentRef.getElementById('inspection-rejection-reason').value = '';
        documentRef.getElementById('inspection-mismatch-description').value = '';
        documentRef.getElementById('inspection-mismatch-description').hidden = true;
        documentRef.getElementById('inspection-mismatch-description-label').hidden = true;
        renderInspectionChecklist(inspectionReview.checks);
        if (meetupDialog.open) dialogController.transition(meetupDialog, inspectionDialog);
        else dialogController.open(inspectionDialog);
    }

    function openFinalPayment(meetupId, sourceDialog) {
        const meetup = transactionStore.getMeetup(meetupId);
        const transaction = meetup ? getTransaction(meetup.listingId) : null;
        if (!meetup
            || !transactionStore.canPerform(meetup.listingId, TRANSACTION_EVENT.paymentPreviewed)
            || !Number.isSafeInteger(transaction.transactionPrice)) return;

        activeFinalPaymentMeetupId = meetupId;
        const remainingAmount = Math.max(0, transaction.transactionPrice - transaction.depositAmount);
        documentRef.getElementById('final-payment-item').textContent = meetup.itemTitle;
        documentRef.getElementById('final-payment-total').textContent = formatCurrency(transaction.transactionPrice);
        documentRef.getElementById('final-payment-token').textContent = formatCurrency(transaction.depositAmount);
        documentRef.getElementById('final-payment-remaining').textContent = formatCurrency(remainingAmount);
        documentRef.getElementById('final-payment-success').hidden = true;
        documentRef.getElementById('preview-final-payment').hidden = false;
        documentRef.getElementById('cancel-final-payment').hidden = false;
        documentRef.getElementById('continue-handover').hidden = true;
        documentRef.getElementById('final-payment-done').hidden = true;
        if (sourceDialog?.open) dialogController.transition(sourceDialog, finalPaymentDialog);
        else dialogController.open(finalPaymentDialog);
    }

    function openHandover(meetupId, sourceDialog) {
        const meetup = transactionStore.getMeetup(meetupId);
        const listingId = meetup?.listingId || meetupId;
        const transaction = getTransaction(listingId);
        const simple = !meetup && transaction.fulfilmentPath === 'simple_collection';
        if ((!meetup && !simple) || transactionStore.isPaused(listingId) || !transactionStore.isParticipant(listingId) || ![
            TRANSACTION_STATUS.simpleCollectionRequested,
            TRANSACTION_STATUS.paymentPreviewed,
            TRANSACTION_STATUS.sellerHandoverConfirmed,
            TRANSACTION_STATUS.buyerReceiptConfirmed,
            TRANSACTION_STATUS.completed
        ].includes(transaction.status)) return;

        activeHandoverMeetupId = meetup ? meetupId : null;
        activeHandoverListingId = listingId;
        activeHandoverIsSimple = simple;
        documentRef.getElementById('handover-item-name').textContent = meetup?.itemTitle || listingStates.get(listingId)?.title || 'Item';
        const currentUserId = userService.getCurrentUser().id;
        const isSeller = transactionStore.isSeller(listingId, currentUserId);
        const isBuyer = transactionStore.isBuyer(listingId, currentUserId);
        const sellerConfirmed = [
            TRANSACTION_STATUS.sellerHandoverConfirmed,
            TRANSACTION_STATUS.buyerReceiptConfirmed,
            TRANSACTION_STATUS.completed
        ].includes(transaction.status);
        const buyerConfirmed = [TRANSACTION_STATUS.buyerReceiptConfirmed, TRANSACTION_STATUS.completed].includes(transaction.status);
        const sellerCanConfirm = simple
            ? transactionStore.canPerform(listingId, TRANSACTION_EVENT.sellerHandover)
            : transactionStore.canPerform(listingId, TRANSACTION_EVENT.sellerHandover);
        documentRef.getElementById('confirm-seller-handover').hidden = !sellerCanConfirm;
        documentRef.getElementById('confirm-buyer-receipt').disabled = !transactionStore.canPerform(listingId, TRANSACTION_EVENT.buyerReceipt);
        documentRef.getElementById('confirm-buyer-receipt').hidden = !transactionStore.canPerform(listingId, TRANSACTION_EVENT.buyerReceipt);
        documentRef.getElementById('handover-role-note').textContent = isSeller
            ? 'Seller view'
            : isBuyer ? 'Buyer view' : 'Switch to the buyer or seller demo user to confirm this handover.';
        documentRef.getElementById('handover-status').textContent = transaction.status === TRANSACTION_STATUS.completed
            ? 'Both confirmations recorded. Demo complete.'
            : transaction.status === TRANSACTION_STATUS.buyerReceiptConfirmed
                ? 'Buyer receipt confirmed. The demo transaction will be finalized when storage is available.'
                : sellerConfirmed
                    ? 'Seller handover confirmed. Waiting for buyer receipt confirmation.'
                    : 'Waiting for seller handover confirmation.';
        documentRef.getElementById('handover-done').hidden = !buyerConfirmed;
        if (sourceDialog?.open) dialogController.transition(sourceDialog, handoverDialog);
        else dialogController.open(handoverDialog);
    }

    function bindEvents() {
        documentRef.getElementById('close-auction-winner').addEventListener('click', () => {
            dialogController.close(winnerDialog);
        });
        documentRef.getElementById('continue-auction-booking-token').addEventListener('click', () => {
            const listingId = activeWinnerListingId;
            const transaction = getTransaction(listingId);
            if (!transactionStore.isBuyer(listingId)) return;
            const context = [TRANSACTION_STATUS.auctionWon, TRANSACTION_STATUS.tokenPending].includes(transaction.status)
                ? simulateBookingToken(listingId, PURCHASE_SOURCE.auctionWinner)
                : transaction.status === TRANSACTION_STATUS.tokenCompleted
                    ? { listingId, purchaseSource: PURCHASE_SOURCE.auctionWinner, transactionPrice: transaction.transactionPrice }
                    : null;
            continueToFulfilment(context, winnerDialog);
        });
        documentRef.getElementById('decline-auction-win').addEventListener('click', () => {
            const listingId = activeWinnerListingId;
            if (!listingId || !transactionStore.declineWinner(listingId)) return;
            documentRef.getElementById('auction-commitment-note').textContent = 'Purchase declined. No deposit was collected.';
            documentRef.getElementById('decline-auction-win').hidden = true;
            documentRef.getElementById('continue-auction-booking-token').hidden = true;
            renderListings();
        });

        documentRef.getElementById('confirm-buy-now').addEventListener('click', () => {
            const listing = listingStates.get(activeBuyNowListingId);
            if (!listing) return;
            activeBookingContext = simulateBookingToken(activeBuyNowListingId, PURCHASE_SOURCE.buyNow);
            if (!activeBookingContext) {
                renderListings();
                return;
            }
            documentRef.getElementById('buy-now-success').textContent = `Reservation recorded for ${listing.title}.`;
            documentRef.getElementById('buy-now-success').hidden = false;
            documentRef.getElementById('confirm-buy-now').hidden = true;
            documentRef.getElementById('cancel-buy-now').hidden = true;
            documentRef.getElementById('schedule-meetup').hidden = false;
            documentRef.getElementById('schedule-meetup').textContent = listing.fulfilmentMethod === FULFILMENT_METHOD.inPerson
                ? 'Choose collection'
                : 'Choose fulfilment';
            documentRef.getElementById('buy-now-done').hidden = false;
        });

        documentRef.getElementById('schedule-meetup').addEventListener('click', () => {
            if (!activeBookingContext) return;
            const context = activeBookingContext;
            activeBookingContext = null;
            continueToFulfilment(context, buyNowDialog);
        });
        documentRef.getElementById('cancel-buy-now').addEventListener('click', () => dialogController.close(buyNowDialog));
        documentRef.getElementById('buy-now-done').addEventListener('click', () => dialogController.close(buyNowDialog));
        buyNowDialog.addEventListener('close', () => { activeBuyNowListingId = null; activeBookingContext = null; });

        documentRef.getElementById('choose-meetup').addEventListener('click', () => {
            const context = activeFulfilmentContext;
            activeFulfilmentContext = null;
            if (context) {
                recordEvent(USABILITY_EVENT_TYPE.fulfilmentSelected, { relatedId: context.listingId, metadata: { fulfilment: 'in_person' } });
                openMeetupForm(context, fulfilmentChoiceDialog);
            }
        });
        documentRef.getElementById('choose-simple-collection').addEventListener('click', () => {
            const context = activeFulfilmentContext;
            if (!context) return;
            const technical = transactionStore.getInspectionReview(context.listingId)?.level === 'Technical';
            if (technical && !documentRef.getElementById('simple-collection-decline').checked) {
                documentRef.getElementById('fulfilment-choice-error').textContent = 'Confirm that you understand the inspection recommendation before continuing.';
                documentRef.getElementById('simple-collection-decline').focus();
                return;
            }
            const transaction = transactionStore.requestSimpleCollection(context.listingId, {
                declinedInspection: documentRef.getElementById('simple-collection-decline').checked
            });
            if (!transaction) {
                documentRef.getElementById('fulfilment-choice-error').textContent = 'Simple collection is not available for this item.';
                return;
            }
            recordEvent(USABILITY_EVENT_TYPE.fulfilmentSelected, { relatedId: context.listingId, metadata: { fulfilment: 'simple_collection' } });
            activeFulfilmentContext = null;
            renderListings();
            openHandover(context.listingId, fulfilmentChoiceDialog);
        });
        documentRef.getElementById('choose-shipping').addEventListener('click', () => {
            const context = activeFulfilmentContext;
            activeFulfilmentContext = null;
            if (context) {
                recordEvent(USABILITY_EVENT_TYPE.fulfilmentSelected, { relatedId: context.listingId, metadata: { fulfilment: 'shipping' } });
                openShippingFlow(context.listingId, fulfilmentChoiceDialog);
            }
        });
        documentRef.getElementById('close-fulfilment-choice').addEventListener('click', () => dialogController.close(fulfilmentChoiceDialog));
        fulfilmentChoiceDialog.addEventListener('close', () => { activeFulfilmentContext = null; });
        documentRef.getElementById('request-shipping').addEventListener('click', () => {
            const updated = transactionStore.requestShipping(activeShippingListingId);
            if (updated) {
                recordEvent(USABILITY_EVENT_TYPE.shippingStarted, { relatedId: activeShippingListingId });
                openShippingFlow(activeShippingListingId);
            }
        });
        documentRef.getElementById('dispatch-shipping').addEventListener('click', () => {
            const updated = transactionStore.dispatchShipping(activeShippingListingId);
            if (updated) openShippingFlow(activeShippingListingId);
        });
        documentRef.getElementById('deliver-shipping').addEventListener('click', () => {
            const updated = transactionStore.deliverShipping(activeShippingListingId);
            if (updated) openShippingFlow(activeShippingListingId);
        });
        documentRef.getElementById('accept-shipping').addEventListener('click', () => {
            const updated = transactionStore.acceptShipping(activeShippingListingId);
            if (updated) {
                recordEvent(USABILITY_EVENT_TYPE.transactionCompleted, { relatedId: activeShippingListingId });
                renderListings();
                openShippingFlow(activeShippingListingId);
            }
        });
        documentRef.getElementById('report-shipping-issue').addEventListener('click', () => {
            reportIssueHandler(activeShippingListingId, shippingDialog);
        });
        documentRef.getElementById('close-shipping').addEventListener('click', () => dialogController.close(shippingDialog));
        shippingDialog.addEventListener('close', () => { activeShippingListingId = null; });

        meetupForm.addEventListener('submit', event => {
            event.preventDefault();
            meetupError.textContent = '';
            const listing = listingStates.get(activeMeetupListingId);
            if (!listing) return;
            const result = transactionStore.requestMeetup(activeMeetupListingId, {
                itemTitle: listing.title,
                date: meetupDateInput.value,
                time: documentRef.getElementById('meetup-time').value,
                location: documentRef.getElementById('meetup-location').value.trim()
            });
            if (!result) {
                meetupError.textContent = 'Choose a future date and time for the meetup, and enter a public meeting place.';
                return;
            }
            recordEvent(USABILITY_EVENT_TYPE.meetupScheduled, { relatedId: listing.id });
            activeMeetupId = result.meetup.id;
            renderListings();
            meetupForm.hidden = true;
            documentRef.getElementById('meetup-success').textContent = `Meetup saved for ${listing.title} on ${result.meetup.date} at ${result.meetup.time}.`;
            documentRef.getElementById('meetup-success').hidden = false;
            documentRef.getElementById('start-inspection').hidden = !transactionStore.canStartInspection(result.meetup.id);
            documentRef.getElementById('meetup-done').hidden = false;
        });
        documentRef.getElementById('start-inspection').addEventListener('click', () => {
            openInspectionForMeetup(transactionStore.getMeetup(activeMeetupId));
        });
        documentRef.getElementById('cancel-meetup').addEventListener('click', () => dialogController.close(meetupDialog));
        documentRef.getElementById('meetup-done').addEventListener('click', () => dialogController.close(meetupDialog));
        meetupDialog.addEventListener('close', () => { activeMeetupListingId = null; activeMeetupId = null; });

        function saveInspectionDecision(isApproved) {
            inspectionError.textContent = '';
            const checks = Array.from(inspectionChecklist.querySelectorAll('input')).map(input => ({
                checked: input.checked,
                value: input.value
            }));
            const rejectionReason = documentRef.getElementById('inspection-rejection-reason').value;
            const result = transactionStore.recordInspection(activeInspectionMeetupId, checks, isApproved, rejectionReason,
                documentRef.getElementById('inspection-mismatch-description').value);
            if (!result) {
                inspectionError.textContent = 'This browser could not save the demo inspection result.';
                return;
            }
            if (!result.ok) {
                inspectionError.textContent = result.code === SERVICE_ERROR_CODE.invalidInput
                    ? rejectionReason === INSPECTION_REJECTION_REASON.otherMaterialMismatch
                        ? 'Describe the other material mismatch in 200 characters or fewer.'
                        : 'Complete every inspection check before approving the item.'
                    : result.code === SERVICE_ERROR_CODE.storageFailed
                        ? 'This browser could not save the demo inspection result.'
                        : 'This inspection action is no longer available.';
                return;
            }
            recordEvent(isApproved ? USABILITY_EVENT_TYPE.itemApproved : USABILITY_EVENT_TYPE.itemRejected, {
                relatedId: result.meetup.listingId
            });
            renderListings();
            documentRef.getElementById('inspection-success').textContent = isApproved
                ? 'Item approved in this demo.'
                : result.transaction.failureOutcome !== FAILURE_OUTCOME.listingCorrectionRequired
                    ? 'Purchase cancelled as a change of mind. The simulated deposit is forfeited.'
                    : 'Material mismatch recorded. The simulated deposit is refundable; listing correction is required before relisting.';
            documentRef.getElementById('inspection-success').hidden = false;
            documentRef.getElementById('approve-inspection').hidden = true;
            documentRef.getElementById('reject-inspection').hidden = true;
            documentRef.getElementById('continue-final-payment').hidden = !isApproved;
            documentRef.getElementById('inspection-done').hidden = false;
        }

        documentRef.getElementById('approve-inspection').addEventListener('click', () => saveInspectionDecision(true));
        documentRef.getElementById('reject-inspection').addEventListener('click', () => saveInspectionDecision(false));
        documentRef.getElementById('inspection-rejection-reason').addEventListener('change', event => {
            const otherMismatch = event.target.value === INSPECTION_REJECTION_REASON.otherMaterialMismatch;
            const description = documentRef.getElementById('inspection-mismatch-description');
            description.hidden = !otherMismatch;
            description.required = otherMismatch;
            documentRef.getElementById('inspection-mismatch-description-label').hidden = !otherMismatch;
        });
        documentRef.getElementById('continue-final-payment').addEventListener('click', () => {
            openFinalPayment(activeInspectionMeetupId, inspectionDialog);
        });
        documentRef.getElementById('inspection-done').addEventListener('click', () => dialogController.close(inspectionDialog));
        inspectionDialog.addEventListener('close', () => { activeInspectionMeetupId = null; });

        documentRef.getElementById('preview-final-payment').addEventListener('click', () => {
            const result = transactionStore.previewPayment(activeFinalPaymentMeetupId);
            if (!result) return;
            renderListings();
            documentRef.getElementById('final-payment-success').textContent = 'Demo preview recorded.';
            documentRef.getElementById('final-payment-success').hidden = false;
            documentRef.getElementById('preview-final-payment').hidden = true;
            documentRef.getElementById('cancel-final-payment').hidden = true;
            documentRef.getElementById('continue-handover').hidden = false;
            documentRef.getElementById('final-payment-done').hidden = false;
        });
        documentRef.getElementById('cancel-final-payment').addEventListener('click', () => dialogController.close(finalPaymentDialog));
        documentRef.getElementById('final-payment-done').addEventListener('click', () => dialogController.close(finalPaymentDialog));
        documentRef.getElementById('continue-handover').addEventListener('click', () => {
            openHandover(activeFinalPaymentMeetupId, finalPaymentDialog);
        });
        finalPaymentDialog.addEventListener('close', () => { activeFinalPaymentMeetupId = null; });

        function recordHandover(isBuyerReceipt) {
            const result = activeHandoverIsSimple
                ? transactionStore.recordSimpleCollectionHandover(activeHandoverListingId, isBuyerReceipt)
                : transactionStore.recordHandover(activeHandoverMeetupId, isBuyerReceipt);
            if (!result) {
                documentRef.getElementById('handover-status').textContent = 'This browser could not save the demo confirmation.';
                return;
            }
            if (transactionStore.get(activeHandoverListingId).status === TRANSACTION_STATUS.completed) {
                recordEvent(USABILITY_EVENT_TYPE.transactionCompleted, { relatedId: activeHandoverListingId });
            }
            renderListings();
            openHandover(activeHandoverIsSimple ? activeHandoverListingId : activeHandoverMeetupId);
        }

        documentRef.getElementById('confirm-seller-handover').addEventListener('click', () => recordHandover(false));
        documentRef.getElementById('confirm-buyer-receipt').addEventListener('click', () => recordHandover(true));
        documentRef.getElementById('close-handover').addEventListener('click', () => dialogController.close(handoverDialog));
        documentRef.getElementById('handover-done').addEventListener('click', () => dialogController.close(handoverDialog));
        handoverDialog.addEventListener('close', () => { activeHandoverMeetupId = null; activeHandoverListingId = null; activeHandoverIsSimple = false; });
    }

    bindEvents();
    return {
        openBuyNow,
        resumeTransaction,
        openMeetupSummary,
        recordMeetupAttendance(meetupId, attendanceStatus) {
            const result = transactionStore.recordMeetupAttendance(meetupId, attendanceStatus);
            if (result?.ok) renderListings();
            return result;
        },
        reportMeetupNoShow(meetupId) {
            const result = transactionStore.reportMeetupNoShow(meetupId);
            if (result?.code === SERVICE_ERROR_CODE.attendanceConflict) {
                const transaction = getTransaction(result.meetup.listingId);
                const reason = result.missedUserId === transaction.sellerUserId
                    ? DISPUTE_REASON.sellerDidNotAttend
                    : DISPUTE_REASON.buyerDidNotAttend;
                const dispute = disputeService.openDispute(result.meetup.listingId, {
                    reason,
                    description: 'Meetup attendance reports differ. Review the issue before continuing.'
                });
                if (dispute) recordEvent(USABILITY_EVENT_TYPE.disputeOpened, { relatedId: result.meetup.listingId });
                renderListings();
                return dispute ? { ok: true, disputed: true, dispute } : { ok: false, code: SERVICE_ERROR_CODE.storageFailed };
            }
            if (result?.ok) renderListings();
            return result;
        },
        openSellerHandover(listingId) {
            if (transactionStore.isPaused(listingId) || !transactionStore.isSeller(listingId)) return;
            if (getTransaction(listingId).fulfilmentPath === 'simple_collection') {
                openHandover(listingId);
                return;
            }
            const meetup = resolveMeetup(listingId);
            if (!meetup) return;
            openHandover(meetup.id);
        },
        openShippingFlow,
        setReportIssueHandler(handler) { reportIssueHandler = handler; }
    };
}