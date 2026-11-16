import { CATEGORY, DEFAULT_FULFILMENT_METHOD, DISPUTE_RESOLUTION, DISPUTE_RESOLUTION_LABELS, FULFILMENT_METHOD, FULFILMENT_METHOD_LABELS, LISTING_FORMAT, SERVICE_ERROR_CODE, SPECIFICATION_FIELDS_BY_SUBCATEGORY, SPECIFICATION_FIELD_LABELS, TRANSACTION_STATUS, USABILITY_EVENT_TYPE } from '../core/constants.js';
import { formatCurrency, formatTimeRemaining } from '../core/formatting.js';
import { getTransactionTimeline, transactionStatusLabel } from '../services/transaction-service.js';
import { listingPlaceholderLabel } from '../services/listing-service.js';
import { normalizeSpecifications } from '../core/normalization.js';
import { renderTransactionTimeline } from './transaction-timeline-ui.js';
import { announceGlobalStatus } from './status-announcer.js';

export function createListingDialogUI({ documentRef = document, state, biddingService, activityService, auctionManagement, watchlistService, engagementService, dialogController, renderListings, renderRecentlyViewed = () => {}, recordEvent = () => {} }) {
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
    image.width = 800;
    image.height = 720;
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
    let historyEntryForDialog = false;
    let questionStartedForListing = null;
    const engagementRoot = documentRef.createElement('section');
    engagementRoot.className = 'product-detail-engagement';
    documentRef.querySelector('.product-detail-sections').after(engagementRoot);
    const shareButton = documentRef.createElement('button');
    shareButton.type = 'button';
    shareButton.className = 'bid-cancel product-share-button';
    shareButton.textContent = 'Share';
    shareButton.setAttribute('aria-label', 'Share this listing');
    documentRef.getElementById('close-product-details').before(shareButton);

    function relativeDate(value) {
        const elapsedDays = Math.floor((Date.now() - Date.parse(value)) / 86400000);
        if (!Number.isFinite(elapsedDays) || elapsedDays < 0) return '';
        return elapsedDays === 0 ? 'today' : elapsedDays === 1 ? 'yesterday' : `${elapsedDays} days ago`;
    }

    function inferListingField(question, listing) {
        const text = question.toLowerCase();
        const supportedFields = new Set(SPECIFICATION_FIELDS_BY_SUBCATEGORY[listing.subcategory] || []);
        const supported = field => supportedFields.has(field) ? field : null;
        if (listing.category === CATEGORY.fashion && /measurement|size/.test(text)) return supported('size');
        if (listing.category === CATEGORY.furniture && /wear|mark|scratch|condition/.test(text)) return supported('signsOfWear');
        if (/battery|charge cycle/.test(text)) return supported('batteryHealth');
        if (/included|accessor|come with/.test(text)) return supported('includedAccessories');
        if (/defect|mark|scratch|wear|condition/.test(text)) return supported('knownDefects') || supported('signsOfWear');
        if (/proof|receipt|purchase/.test(text)) return supported('proofOfPurchase');
        if (/warranty/.test(text)) return supported('warrantyStatus');
        if (/dimension|measurement|size/.test(text)) return supported('dimensions');
        if (/collection|access|disassembl/.test(text)) return supported('collectionRequirements');
        if (/service|repair|maintenance/.test(text)) return supported('serviceHistory');
        if (/work|operate|functional|power on/.test(text)) return supported('functionalStatus');
        if (/edition|printing/.test(text)) return supported('edition');
        if (/complete|volume|part/.test(text)) return supported('completeness');
        if (/marking|annotation|written/.test(text)) return supported('annotations');
        if (/packaging|box/.test(text)) return supported('originalPackaging');
        return null;
    }

    function compactListingSection(title, listings, eventType, source) {
        if (!listings.length) return null;
        const section = documentRef.createElement('section');
        section.className = 'product-detail-section discovery-detail-section';
        const heading = documentRef.createElement('h3');
        heading.className = 'product-section-heading';
        heading.textContent = title;
        const grid = documentRef.createElement('div');
        grid.className = 'detail-listing-grid';
        listings.forEach(listing => {
            const button = documentRef.createElement('button');
            button.type = 'button';
            button.className = 'detail-listing-card';
            button.dataset.openListing = listing.id;
            const titleText = documentRef.createElement('strong');
            titleText.textContent = listing.title;
            const price = documentRef.createElement('span');
            price.textContent = `${listing.listingFormat === LISTING_FORMAT.buyNow ? 'Buy Now' : 'Current bid'} · ${formatCurrency(listing.listingFormat === LISTING_FORMAT.buyNow ? listing.buyNowPrice : listing.currentBid)}`;
            button.append(titleText, price);
            if (listing.image) {
                const thumbnail = documentRef.createElement('img');
                thumbnail.src = listing.image;
                thumbnail.alt = '';
                thumbnail.loading = 'lazy';
                thumbnail.width = 96;
                thumbnail.height = 76;
                button.prepend(thumbnail);
            }
            button.addEventListener('click', () => {
                recordEvent(eventType, { relatedId: listing.id, metadata: { category: listing.category, subcategory: listing.subcategory, source } });
                showProductDetails(listing.id);
            });
            grid.append(button);
        });
        section.append(heading, grid);
        return section;
    }

    function renderQuestion(question, questionList, ownsListing, currentUserId, listing) {
        const item = documentRef.createElement('article');
        item.className = 'listing-question';

        // Question section
        const questionSection = documentRef.createElement('div');
        questionSection.className = 'listing-question-section';
        const questionText = documentRef.createElement('p');
        questionText.className = 'listing-question-text';
        questionText.textContent = question.question;
        questionSection.append(questionText);

        // Sample label (single location per batch 10)
        if (question.prototypeSample) {
            const sampleLabel = documentRef.createElement('small');
            sampleLabel.className = 'prototype-sample-label';
            sampleLabel.textContent = 'Prototype sample';
            questionSection.append(sampleLabel);
        }

        item.append(questionSection);

        // Answer section
        if (question.answer) {
            const answerSection = documentRef.createElement('div');
            answerSection.className = 'listing-answer-section';
            const answer = documentRef.createElement('p');
            answer.className = 'listing-answer-text';
            const label = documentRef.createElement('strong');
            label.textContent = 'Seller answer: ';
            answer.append(label, documentRef.createTextNode(question.answer));
            answerSection.append(answer);

            const date = relativeDate(question.answeredAt);
            if (date) {
                const time = documentRef.createElement('small');
                time.className = 'product-details-meta';
                time.textContent = date;
                answerSection.append(time);
            }
            item.append(answerSection);
        } else if (question.questioningDemoUserId === currentUserId) {
            const waiting = documentRef.createElement('p');
            waiting.className = 'product-details-meta answer-waiting';
            waiting.textContent = 'Awaiting seller response';
            item.append(waiting);
        }

        // Seller answer form
        if (ownsListing && !question.answer && !question.prototypeSample) {
            const answerForm = documentRef.createElement('form');
            answerForm.className = 'seller-answer-form';
            answerForm.dataset.answerQuestion = question.id;
            const answerLabel = documentRef.createElement('label');
            const answerId = `answer-${question.id}`;
            answerLabel.htmlFor = answerId;
            answerLabel.textContent = 'Answer publicly';
            const answerInput = documentRef.createElement('textarea');
            answerInput.id = answerId;
            answerInput.maxLength = 500;
            answerInput.required = true;
            answerInput.rows = 2;
            const field = inferListingField(question.question, listing);
            answerForm.append(answerLabel, answerInput);
            if (field) {
                const updateLabel = documentRef.createElement('label');
                updateLabel.className = 'listing-detail-update-option';
                const updateInput = documentRef.createElement('input');
                updateInput.type = 'checkbox';
                updateInput.dataset.listingDetailField = field;
                updateInput.disabled = listing.bidCount > 0;
                updateLabel.append(updateInput, documentRef.createTextNode('Add this answer to listing details'));
                answerForm.append(updateLabel);
                if (listing.bidCount > 0) {
                    const lockNote = documentRef.createElement('small');
                    lockNote.textContent = 'Listing details are locked after the first bid.';
                    answerForm.append(lockNote);
                }
            }
            const answerActions = documentRef.createElement('div');
            answerActions.className = 'listing-question-actions';
            const answerButton = documentRef.createElement('button');
            answerButton.type = 'submit';
            answerButton.className = 'primary-button';
            answerButton.textContent = 'Post answer';
            const dismissSelect = documentRef.createElement('select');
            dismissSelect.setAttribute('aria-label', 'Reason for dismissing this question');
            dismissSelect.innerHTML = '<option value="duplicate">Duplicate</option><option value="already_answered">Already covered in listing</option><option value="contact_request">Contact or payment request</option><option value="inappropriate">Inappropriate</option><option value="not_relevant">Not relevant</option>';
            const dismissButton = documentRef.createElement('button');
            dismissButton.type = 'button';
            dismissButton.className = 'bid-cancel';
            dismissButton.dataset.dismissQuestion = question.id;
            dismissButton.textContent = 'Dismiss';
            answerActions.append(answerButton, dismissSelect, dismissButton);
            answerForm.append(answerActions);
            answerForm.addEventListener('submit', event => {
                event.preventDefault();
                if (answerButton.disabled) return;
                answerButton.disabled = true;
                const updateField = answerForm.querySelector('[data-listing-detail-field]:checked')?.dataset.listingDetailField || null;
                const result = engagementService?.answerQuestion(question.id, answerInput.value, currentUserId, updateField);
                if (!result?.ok) {
                    answerButton.disabled = false;
                    const message = result?.code === 'listing_locked'
                        ? 'Listing details are locked after the first bid. Uncheck the listing update and post the public answer.'
                        : 'The answer could not be saved. Remove contact, payment or address details and try again.';
                    announceGlobalStatus(message, documentRef, { allowDialog: true });
                    return;
                }
                recordEvent(USABILITY_EVENT_TYPE.sellerAnswerSubmitted, { relatedId: listing.id, metadata: { category: listing.category, subcategory: listing.subcategory, questionType: 'general', source: 'product_details' } });
                if (updateField) recordEvent(USABILITY_EVENT_TYPE.answerAddedToListing, { relatedId: listing.id, metadata: { category: listing.category, subcategory: listing.subcategory, questionType: updateField, source: 'product_details' } });
                renderListings();
                showProductDetails(listing.id);
                announceGlobalStatus(updateField ? 'Seller answer saved and listing details updated.' : 'Seller answer saved publicly.', documentRef, { allowDialog: true });
            });
            dismissButton.addEventListener('click', () => {
                const result = engagementService?.dismissQuestion(question.id, currentUserId, dismissSelect.value);
                if (!result?.ok) {
                    announceGlobalStatus('This question could not be dismissed.', documentRef, { allowDialog: true });
                    return;
                }
                renderEngagement(listing);
                announceGlobalStatus('Question dismissed from the public listing.', documentRef, { allowDialog: true });
            });
            item.append(answerForm);
        }

        questionList.append(item);
    }

    function renderEngagement(listing) {
        const currentUserId = userService.getCurrentUser().id;
        const ownsListing = userService.isListingOwner(listing.id);
        const root = documentRef.createElement('div');
        root.className = 'product-detail-engagement-content';
        const questionsSection = documentRef.createElement('section');
        questionsSection.className = 'product-detail-section listing-questions';
        const heading = documentRef.createElement('h3');
        heading.className = 'product-section-heading';
        heading.textContent = 'Questions about this item';
        heading.tabIndex = -1;
        questionsSection.append(heading);
        const questionList = documentRef.createElement('div');
        questionList.className = 'listing-question-list';
        const questions = engagementService?.getQuestions(listing.id, currentUserId) || [];

        // Separate sample questions from real questions
        const sampleQuestions = questions.filter(q => q.prototypeSample);
        const realQuestions = questions.filter(q => !q.prototypeSample);

        // Show up to 3 sample questions initially
        let questionCount = 0;
        const maxSampleShown = 3;

        realQuestions.forEach(question => {
            renderQuestion(question, questionList, ownsListing, currentUserId, listing);
            questionCount++;
        });

        sampleQuestions.slice(0, maxSampleShown).forEach(question => {
            renderQuestion(question, questionList, ownsListing, currentUserId, listing);
            questionCount++;
        });

        // Add "View all sample questions" if more exist
        if (sampleQuestions.length > maxSampleShown) {
            const viewAll = documentRef.createElement('button');
            viewAll.type = 'button';
            viewAll.className = 'link-button';
            viewAll.textContent = `View all ${sampleQuestions.length} sample questions`;
            viewAll.addEventListener('click', () => {
                sampleQuestions.slice(maxSampleShown).forEach(question => {
                    renderQuestion(question, questionList, ownsListing, currentUserId, listing);
                });
                viewAll.remove();
            });
            questionList.append(viewAll);
        }


        if (!questions.length) {
            const empty = documentRef.createElement('p');
            empty.className = 'product-details-meta';
            empty.textContent = 'No questions yet. Ask the seller about specifics to build your confidence.';
            questionList.append(empty);
        }
        questionsSection.append(questionList);
        const askForm = documentRef.createElement('form');
        askForm.className = 'ask-listing-question-form';
        const askHeading = documentRef.createElement('h4');
        askHeading.textContent = 'Ask the seller';
        const requestSelect = documentRef.createElement('select');
        requestSelect.setAttribute('aria-label', 'Choose a question prompt');
        requestSelect.innerHTML = '<option value="">Choose a request (optional)</option>';
        const prompts = {
            [CATEGORY.electronics]: [['battery', 'Ask about battery', 'How is the battery condition?'], ['included', 'Ask what is included', 'What accessories are included?'], ['defects', 'Ask about defects', 'Are there any known defects or visible wear?'], ['photo', 'Request another photo', 'Could you add another photo of the item?']],
            [CATEGORY.furniture]: [['dimensions', 'Ask for dimensions', 'Could you share the dimensions?'], ['wear', 'Ask about visible wear', 'Are there any visible marks or wear?'], ['collection', 'Ask about collection/access', 'Are there any collection or access requirements?'], ['photo', 'Request another photo', 'Could you add another photo of the item?']],
            [CATEGORY.homeAppliances]: [['works', 'Ask whether it works', 'Does it work as expected?'], ['included', 'Ask what is included', 'What accessories are included?'], ['service_history', 'Ask about service history', 'Has it had any servicing or repairs?'], ['photo', 'Request another photo', 'Could you add another photo of the item?']],
            [CATEGORY.fashion]: [['measurements', 'Ask for measurements', 'Could you share the measurements?'], ['wear', 'Ask about wear', 'Is there any notable wear or damage?'], ['proof_packaging', 'Ask about proof/packaging', 'Is proof of purchase or original packaging available?'], ['photo', 'Request another photo', 'Could you add another photo of the item?']],
            [CATEGORY.booksCollectibles]: [['edition', 'Ask about edition', 'Which edition or printing is this?'], ['markings', 'Ask about markings', 'Are there any markings or annotations?'], ['completeness', 'Ask whether complete', 'Is the set complete, including all parts?'], ['photo', 'Request another photo', 'Could you add another photo of the item?']]
        };
        const categoryPrompts = prompts[listing.category] || prompts[CATEGORY.electronics];
        categoryPrompts.forEach(([type, label, text]) => {
            const option = documentRef.createElement('option');
            option.value = type;
            option.textContent = label;
            option.dataset.question = text;
            requestSelect.append(option);
        });
        const askLabel = documentRef.createElement('label');
        const askId = `question-input-${listing.id}`;
        askLabel.htmlFor = askId;
        askLabel.textContent = 'Your question';
        const askInput = documentRef.createElement('textarea');
        askInput.id = askId;
        askInput.maxLength = 300;
        askInput.required = true;
        askInput.rows = 3;
        askInput.disabled = ownsListing;
        const guidance = documentRef.createElement('small');
        guidance.textContent = 'Do not share contact, payment or address details.';
        const askButton = documentRef.createElement('button');
        askButton.type = 'submit';
        askButton.className = 'primary-button';
        askButton.textContent = 'Submit question';
        askButton.disabled = ownsListing;
        const status = documentRef.createElement('p');
        status.className = 'listing-question-status';
        status.setAttribute('role', 'status');
        if (ownsListing) status.textContent = 'You own this listing and cannot ask the seller a question.';
        askForm.append(askHeading, requestSelect, askLabel, askInput, guidance, askButton, status);
        if (!ownsListing) {
            askInput.addEventListener('focus', () => {
                if (questionStartedForListing === listing.id) return;
                questionStartedForListing = listing.id;
                recordEvent(USABILITY_EVENT_TYPE.questionStarted, { relatedId: listing.id, metadata: { category: listing.category, subcategory: listing.subcategory, source: 'product_details' } });
            });
            requestSelect.addEventListener('change', () => {
                const option = requestSelect.selectedOptions[0];
                if (!option?.dataset.question) return;
                askInput.value = option.dataset.question;
                askInput.focus();
                askInput.setSelectionRange(askInput.value.length, askInput.value.length);
            });
            askForm.addEventListener('submit', event => {
                event.preventDefault();
                if (askButton.disabled) return;
                askButton.disabled = true;
                const type = requestSelect.value || 'general';
                const result = engagementService?.askQuestion(listing.id, askInput.value, { questionType: type });
                if (!result?.ok) {
                    status.textContent = result?.code === 'storage_failed'
                        ? 'The question could not be saved in this browser.'
                        : 'Remove contact, payment or address details and enter a question up to 300 characters.';
                    askButton.disabled = false;
                    return;
                }
                recordEvent(USABILITY_EVENT_TYPE.questionSubmitted, { relatedId: listing.id, metadata: { category: listing.category, subcategory: listing.subcategory, questionType: type, source: 'product_details' } });
                if (type === 'photo') recordEvent(USABILITY_EVENT_TYPE.additionalPhotoRequested, { relatedId: listing.id, metadata: { category: listing.category, subcategory: listing.subcategory, questionType: type, source: 'product_details' } });
                renderEngagement(listing);
                const currentStatus = engagementRoot.querySelector('.listing-question-status');
                if (currentStatus) currentStatus.textContent = 'Question saved as public listing information in this browser.';
                renderRecentlyViewed();
            });
        }
        root.append(questionsSection, askForm);
        const shareStatus = documentRef.createElement('p');
        shareStatus.className = 'listing-share-status';
        shareStatus.setAttribute('role', 'status');
        const similar = engagementService?.getSimilarListings(listing.id, auctionManagement.isPublicListing) || [];
        const fromSeller = engagementService?.getSellerListings(listing.sellerUserId, listing.id, auctionManagement.isPublicListing) || [];
        const similarSection = compactListingSection('Similar finds', similar, USABILITY_EVENT_TYPE.similarListingOpened, 'similar_finds');
        const sellerSection = compactListingSection('More from this seller', fromSeller, USABILITY_EVENT_TYPE.sellerListingOpened, 'seller_listings');
        root.append(shareStatus);
        engagementRoot.replaceChildren(root, ...[similarSection, sellerSection].filter(Boolean));
    }

    async function shareListing() {
        const listing = listingStates.get(activeDetailsListingId);
        if (!listing) return;
        const windowRef = documentRef.defaultView;
        const shareUrl = new URL(windowRef.location.pathname, windowRef.location.origin);
        shareUrl.hash = `listing=${encodeURIComponent(listing.id)}`;
        const status = engagementRoot.querySelector('.listing-share-status');
        let method = 'copied';
        try {
            if (typeof windowRef.navigator.share === 'function') {
                await windowRef.navigator.share({ title: listing.title, text: `${listing.title} · Urbids prototype listing`, url: shareUrl.href });
                method = 'native';
                if (status) status.textContent = 'Listing link shared.';
            } else {
                if (windowRef.navigator.clipboard?.writeText) await windowRef.navigator.clipboard.writeText(shareUrl.href);
                else {
                    const copyInput = documentRef.createElement('textarea');
                    copyInput.value = shareUrl.href;
                    copyInput.setAttribute('readonly', '');
                    copyInput.style.position = 'fixed';
                    copyInput.style.opacity = '0';
                    documentRef.body.append(copyInput);
                    copyInput.select();
                    const copied = documentRef.execCommand('copy');
                    copyInput.remove();
                    if (!copied) throw new Error('Clipboard unavailable');
                }
                if (status) status.textContent = 'Listing link copied.';
            }
            recordEvent(USABILITY_EVENT_TYPE.listingShared, { relatedId: listing.id, metadata: { category: listing.category, subcategory: listing.subcategory, shareMethod: method, source: 'product_details' } });
        } catch (error) {
            if (error?.name === 'AbortError') return;
            if (status) status.textContent = 'Could not share this link. Select and copy the page URL.';
        }
    }

    function closeProductDetails() {
        const windowRef = documentRef.defaultView;
        if (historyEntryForDialog && windowRef.history.state?.urbidsListingId === activeDetailsListingId) {
            historyEntryForDialog = false;
            windowRef.history.back();
            return;
        }
        const cleanUrl = `${windowRef.location.pathname}${windowRef.location.search}`;
        windowRef.history.replaceState(null, '', cleanUrl);
        historyEntryForDialog = false;
        dialogController.close(detailsDialog);
    }

    function handleListingLocation() {
        const windowRef = documentRef.defaultView;
        const match = windowRef.location.hash.match(/^#listing=([A-Za-z0-9_-]+)$/);
        if (!match) {
            if (detailsDialog.open) dialogController.close(detailsDialog);
            historyEntryForDialog = false;
            if (windowRef.location.hash.startsWith('#listing=')) {
                windowRef.history.replaceState(null, '', `${windowRef.location.pathname}${windowRef.location.search}`);
            }
            return;
        }
        const listingId = decodeURIComponent(match[1]);
        if (!listingStates.has(listingId)) {
            windowRef.history.replaceState(null, '', `${windowRef.location.pathname}${windowRef.location.search}`);
            if (detailsDialog.open) dialogController.close(detailsDialog);
            return;
        }
        historyEntryForDialog = windowRef.history.state?.urbidsListingId === listingId;
        showProductDetails(listingId, undefined, { syncHash: false });
    }

    shareButton.addEventListener('click', shareListing);
    documentRef.defaultView.addEventListener('popstate', handleListingLocation);
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

    function showProductDetails(listingId, returnFocus, { syncHash = true } = {}) {
        const listing = listingStates.get(listingId);
        if (!listing) return;
        if (syncHash) {
            const windowRef = documentRef.defaultView;
            const nextHash = `#listing=${encodeURIComponent(listingId)}`;
            if (windowRef.location.hash !== nextHash) {
                const nextUrl = `${windowRef.location.pathname}${windowRef.location.search}${nextHash}`;
                windowRef.history.pushState({ urbidsListingId: listingId }, '', nextUrl);
                historyEntryForDialog = true;
            }
        }
        activeDetailsListingId = listingId;
        biddingService.closeExpiredAuctions();
        watchlistService.sync();
        recordEvent(USABILITY_EVENT_TYPE.listingOpened, { relatedId: listingId });
        engagementService?.trackViewed(listingId);
        renderRecentlyViewed();

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
            thumbnail.width = 120;
            thumbnail.height = 120;
            thumbnail.alt = '';
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
            ? `Second-chance offer ${auctionManagement.offerStatus(listing)} · ${formatCurrency(listing.secondChanceOffer.price)} based on your last visible bid · Expires ${new Date(listing.secondChanceOffer.expiresAt).toLocaleString()}`
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
        detailWatchButton.setAttribute('aria-label', watchlist.has(listingId) ? 'Saved, remove from Watchlist' : 'Save to Watchlist');

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
        questionStartedForListing = null;
        renderEngagement(listing);
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
        bidSuccess.textContent = `${leading ? 'Bid accepted. You\u2019re leading.'
            : 'Bid accepted. You were immediately outbid by another buyer\u2019s automatic bid.'}${result.data.auctionExtended ? ' Auction extended by two minutes.' : ''}`;
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
        if (result.data.auctionExtended) autoBidStatus.textContent += '\nAuction extended by two minutes.';
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
    documentRef.getElementById('close-product-details').addEventListener('click', closeProductDetails);
    detailsDialog.addEventListener('cancel', event => {
        event.preventDefault();
        closeProductDetails();
    });
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
        if (saved && wasWatching !== isWatching) {
            const eventType = isWatching ? USABILITY_EVENT_TYPE.watchlistAdded : USABILITY_EVENT_TYPE.watchlistRemoved;
            recordEvent(eventType, { relatedId: activeDetailsListingId });
            announceGlobalStatus(isWatching ? 'Added to Watchlist.' : 'Removed from Watchlist.', documentRef, { allowDialog: true });
        }
        detailWatchButton.textContent = isWatching ? 'Saved' : 'Save';
        detailWatchButton.setAttribute('aria-pressed', String(isWatching));
        detailWatchButton.setAttribute('aria-label', isWatching ? 'Saved, remove from Watchlist' : 'Save to Watchlist');
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
        handleListingLocation,
        openBidDialog,
        setBuyNowHandler(handler) { buyNowHandler = handler; },
        setReportIssueHandler(handler) { reportIssueHandler = handler; },
        setPrimaryActionHandler(handler) { primaryActionHandler = handler; },
        setSellerProfileHandler(handler) { sellerProfileHandler = handler; },
        focusListingAction,
        focusQuestions() {
            const heading = engagementRoot.querySelector('.listing-questions h3');
            documentRef.defaultView.requestAnimationFrame(() => {
                if (!heading?.isConnected || !detailsDialog.open) return;
                heading.focus({ preventScroll: true });
                heading.scrollIntoView({ block: 'center', behavior: documentRef.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
            });
        }
    };
}