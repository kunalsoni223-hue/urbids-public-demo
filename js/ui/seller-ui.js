import { config } from '../config.js';
import { AUCTION_DURATION_OPTIONS_HOURS, CATEGORY, CATEGORY_LABELS, CONDITION_GRADE_GUIDANCE, CONDITION_GRADE_LABELS, DEFAULT_AUCTION_DURATION_HOURS, DEFAULT_FULFILMENT_METHOD, FULFILMENT_METHOD_LABELS, REJECTION_REASON_LABELS, RESERVE_PRICE_MODE, SERVICE_ERROR_CODE, SPECIFICATION_FIELDS_BY_SUBCATEGORY, SPECIFICATION_FIELD_LABELS, SUBCATEGORIES_BY_CATEGORY, SUBCATEGORY_LABELS, SUBMISSION_STATUS, SUBMISSION_STATUS_LABELS, USABILITY_EVENT_TYPE } from '../core/constants.js';
import { formatCurrency } from '../core/formatting.js';
import { isRenderableSellerSubmission, validateSellerPhotos } from '../core/validation.js';
import { getSellerPriceGuidance } from '../services/listing-service.js';
import { createSellerSubmission, loadSellerSubmissions } from '../services/submission-service.js';

export function createSellerPhotoManager({ documentRef = document, URLRef = URL }) {
    const filesBySubmission = new Map();
    const publishedUrls = new Map();
    let previewUrls = [];

    function clearPreviews(fileInput, previewContainer, clearSelection = true) {
        previewUrls.forEach(url => URLRef.revokeObjectURL(url));
        previewUrls = [];
        previewContainer.replaceChildren();
        if (clearSelection) fileInput.value = '';
    }

    function showPreviews(fileInput, previewContainer, errorElement) {
        const files = Array.from(fileInput.files);
        clearPreviews(fileInput, previewContainer, false);
        errorElement.textContent = '';
        const validation = validateSellerPhotos(files);
        if (!validation.valid) {
            errorElement.textContent = validation.reason === 'too_many'
                ? 'Choose no more than five photos.'
                : 'Choose image files only.';
            fileInput.value = '';
            return;
        }

        files.forEach(file => {
            const imageUrl = URLRef.createObjectURL(file);
            previewUrls.push(imageUrl);
            const preview = documentRef.createElement('figure');
            preview.className = 'seller-photo-preview';
            const image = documentRef.createElement('img');
            image.src = imageUrl;
            image.alt = '';
            const caption = documentRef.createElement('figcaption');
            caption.textContent = file.name;
            preview.append(image, caption);
            previewContainer.append(preview);
        });
    }

    function resolveImages(submission) {
        if (publishedUrls.has(submission.id)) return publishedUrls.get(submission.id);
        const imageFiles = filesBySubmission.get(submission.id) || [];
        const imageUrls = imageFiles.map(file => URLRef.createObjectURL(file));
        publishedUrls.set(submission.id, imageUrls);
        filesBySubmission.delete(submission.id);
        return imageUrls;
    }

    return {
        clearPreviews,
        showPreviews,
        rememberFiles(submissionId, files) {
            filesBySubmission.set(submissionId, Array.from(files));
        },
        resolveImage(submission) {
            return resolveImages(submission)[0] || null;
        },
        resolveImages,
        copyImages(sourceId, targetId) {
            const urls = publishedUrls.get(sourceId) || [];
            publishedUrls.set(targetId, [...urls]);
        },
        releaseImage(submissionId) {
            const imageUrls = publishedUrls.get(submissionId) || [];
            publishedUrls.delete(submissionId);
            imageUrls.forEach(imageUrl => {
                if (!Array.from(publishedUrls.values()).some(urls => urls.includes(imageUrl))) URLRef.revokeObjectURL(imageUrl);
            });
            filesBySubmission.delete(submissionId);
        }
    };
}

export function createSellerUI({ documentRef = document, dialogController, photoManager, userService, recordEvent = () => {}, onSubmissionsChanged = () => {} }) {
    const dialog = documentRef.getElementById('seller-listing-dialog');
    const form = documentRef.getElementById('seller-listing-form');
    const errorElement = documentRef.getElementById('seller-listing-error');
    const photoInput = documentRef.getElementById('seller-photos');
    const photoPreviews = documentRef.getElementById('seller-photo-previews');
    const submissionPanel = documentRef.getElementById('seller-submissions-panel');
    const submissionList = documentRef.getElementById('seller-submission-list');
    const startButton = documentRef.getElementById('start-listing-button');
    const categorySelect = documentRef.getElementById('seller-category');
    const subcategorySelect = documentRef.getElementById('seller-subcategory');
    const conditionSelect = documentRef.getElementById('seller-condition');
    const fulfilmentSelect = documentRef.getElementById('seller-fulfilment-method');
    const durationSelect = documentRef.getElementById('seller-auction-duration');
    const formatSelect = documentRef.getElementById('seller-listing-format');
    const incrementSelect = documentRef.getElementById('seller-bid-increment');
    incrementSelect.replaceChildren(...config.sellerBidIncrements.map(amount => {
        const option = documentRef.createElement('option');
        option.value = String(amount);
        option.textContent = formatCurrency(amount);
        option.defaultSelected = amount === 100;
        return option;
    }));
    const priceGuidance = documentRef.getElementById('seller-price-guidance');
    const conditionGuidance = documentRef.getElementById('seller-condition-guidance');
    const maximumListingPrice = String(config.auctionRules.maximumListingPrice);
    ['seller-starting-bid', 'seller-buy-now', 'seller-estimated-value'].forEach(id => {
        documentRef.getElementById(id).max = maximumListingPrice;
    });
    const specificationFields = documentRef.getElementById('seller-specification-fields');
    const reviewSummary = {
        title: documentRef.getElementById('seller-summary-title'),
        brand: documentRef.getElementById('seller-summary-brand'),
        category: documentRef.getElementById('seller-summary-category'),
        description: documentRef.getElementById('seller-summary-description'),
        photos: documentRef.getElementById('seller-summary-photos'),
        location: documentRef.getElementById('seller-summary-location'),
        fulfilment: documentRef.getElementById('seller-summary-fulfilment'),
        specifications: documentRef.getElementById('seller-summary-specifications'),
        startingBid: documentRef.getElementById('seller-summary-starting-bid'),
        buyNow: documentRef.getElementById('seller-summary-buy-now'),
        duration: documentRef.getElementById('seller-summary-duration'),
        format: documentRef.getElementById('seller-summary-format')
    };

    const inPilotMode = () => true;
    function updateCategoryOptions() {
        categorySelect.replaceChildren(...Object.entries(CATEGORY_LABELS).map(([value, label]) => new Option(label, value)));
        categorySelect.value = CATEGORY.electronics;
    }
    updateCategoryOptions();
    conditionSelect.replaceChildren(...Object.entries(CONDITION_GRADE_LABELS).map(([value, label]) => new Option(`${value} - ${label}`, value)));
    fulfilmentSelect.replaceChildren(...Object.entries(FULFILMENT_METHOD_LABELS).map(([value, label]) => new Option(label, value)));
    durationSelect.replaceChildren(...AUCTION_DURATION_OPTIONS_HOURS.map(hours => new Option(`${hours} hours`, String(hours))));

    function renderSpecificationFields() {
        const fieldNames = SPECIFICATION_FIELDS_BY_SUBCATEGORY[subcategorySelect.value] || [];
        specificationFields.replaceChildren(...fieldNames.map(key => {
            const wrapper = documentRef.createElement('label');
            wrapper.className = 'seller-specification-field';
            wrapper.textContent = SPECIFICATION_FIELD_LABELS[key] || key;
            let input;
            if (['warrantyStatus', 'originalBox', 'proofOfPurchase', 'originalPackaging', 'functionalStatus', 'serialModelInfo', 'activationLock', 'ownershipConcern', 'counterfeitConcern', 'assemblyRequired', 'originalInvoice'].includes(key)) {
                input = documentRef.createElement('select');
                input.append(new Option('Not specified', ''));
                const values = key === 'warrantyStatus' ? ['Active', 'Expired', 'Unknown']
                    : key === 'functionalStatus' ? ['Fully functional', 'Functional with disclosed defects', 'Not functional']
                        : ['ownershipConcern', 'counterfeitConcern'].includes(key) ? ['No', 'Yes', 'Unsure']
                        : ['Yes', 'No'];
                values.forEach(value => input.append(new Option(value, value)));
            } else if (['knownDefects', 'signsOfWear', 'authenticityNotes', 'collectionRequirements', 'accessNotes', 'serviceHistory', 'coverCondition', 'annotations'].includes(key)) {
                input = documentRef.createElement('textarea');
                input.rows = 2;
                input.maxLength = 240;
            } else {
                input = documentRef.createElement('input');
                input.type = ['purchaseYear', 'publicationYear'].includes(key) ? 'number' : 'text';
                if (['purchaseYear', 'publicationYear'].includes(key)) {
                    input.min = key === 'publicationYear' ? '1800' : '1990';
                    input.max = String(new Date().getFullYear());
                }
            }
            input.name = `specifications.${key}`;
            input.dataset.specification = key;
            input.required = inPilotMode() && categorySelect.value === CATEGORY.electronics
                && ['functionalStatus', 'knownDefects', 'proofOfPurchase', 'serialModelInfo'].includes(key);
            if (inPilotMode() && ['smartphones', 'laptops'].includes(subcategorySelect.value) && key === 'activationLock') input.required = true;
            wrapper.append(input);
            return wrapper;
        }));
    }

    function updateSubcategoryOptions() {
        const allSubcategories = SUBCATEGORIES_BY_CATEGORY[categorySelect.value] || [];
        const subcategories = allSubcategories;
        subcategorySelect.replaceChildren(
            new Option('Choose a subcategory', ''),
            ...subcategories.map(value => new Option(SUBCATEGORY_LABELS[value], value))
        );
        subcategorySelect.value = '';
        renderSpecificationFields();
    }

    updateSubcategoryOptions();

    function updateReviewSummary() {
        const values = new FormData(form);
        const title = String(values.get('title') || '').trim();
        const brand = String(values.get('brandModel') || '').trim();
        const description = String(values.get('description') || '').trim();
        const startingBid = Number(values.get('startingBid'));
        const estimatedValue = Number(values.get('estimatedValue'));
        const buyNowValue = values.get('buyNowPrice');
        const category = CATEGORY_LABELS[values.get('category')] || 'Not selected';
        const subcategory = SUBCATEGORY_LABELS[values.get('subcategory')] || 'Choose a subcategory';
        const condition = CONDITION_GRADE_LABELS[values.get('condition')];
        conditionGuidance.textContent = condition
            ? `${condition}: ${CONDITION_GRADE_GUIDANCE[values.get('condition')]}. Grades are seller-reported.`
            : 'Condition grades are seller-reported; describe defects and wear clearly.';
        const fulfilment = FULFILMENT_METHOD_LABELS[values.get('fulfilmentMethod')] || FULFILMENT_METHOD_LABELS[DEFAULT_FULFILMENT_METHOD];
        const specifications = Array.from(specificationFields.querySelectorAll('[data-specification]'))
            .filter(input => input.value.trim())
            .map(input => `${SPECIFICATION_FIELD_LABELS[input.dataset.specification]}: ${input.value.trim()}`);

        reviewSummary.title.textContent = title || 'Add an item title';
        reviewSummary.brand.textContent = brand || 'Not entered';
        reviewSummary.category.textContent = condition
            ? `${category} · ${subcategory} · ${condition}`
            : `${category} · ${subcategory}`;
        reviewSummary.description.textContent = description
            ? `${description.slice(0, 140)}${description.length > 140 ? '…' : ''}`
            : 'Not entered';
        reviewSummary.photos.textContent = photoInput.files.length
            ? `${photoInput.files.length} selected`
            : 'None selected';
        reviewSummary.location.textContent = String(values.get('location') || '').trim() || 'Not entered';
        reviewSummary.fulfilment.textContent = fulfilment;
        reviewSummary.specifications.textContent = specifications.length ? specifications.slice(0, 3).join(' · ') : 'None added';
        reviewSummary.startingBid.textContent = String(values.get('listingFormat')) === 'buy_now'
            ? 'Not used'
            : Number.isSafeInteger(startingBid) && startingBid > 0
            ? formatCurrency(startingBid)
            : 'Not entered';
        reviewSummary.buyNow.textContent = buyNowValue
            ? formatCurrency(Number(buyNowValue))
            : 'Not set';
        documentRef.getElementById('seller-summary-bid-increment').textContent = formatCurrency(Number(values.get('bidIncrement')));
        reviewSummary.duration.textContent = `${Number(values.get('auctionDurationHours')) || DEFAULT_AUCTION_DURATION_HOURS} hours`;
        reviewSummary.format.textContent = {
            auction: 'Auction',
            buy_now: 'Buy Now',
            auction_buy_now: 'Auction + Buy Now'
        }[String(values.get('listingFormat'))] || 'Auction';
        const estimateSummary = documentRef.getElementById('seller-summary-estimated-value');
        if (estimateSummary) estimateSummary.textContent = Number.isSafeInteger(estimatedValue) && estimatedValue > 0
            ? formatCurrency(estimatedValue) : 'Not entered';
        const guidance = getSellerPriceGuidance({
            subcategory: String(values.get('subcategory') || ''),
            condition: String(values.get('condition') || ''),
            startingBid: Number(values.get('startingBid')),
            buyNowPrice: buyNowValue ? Number(buyNowValue) : null
        });
        priceGuidance.textContent = guidance.low === null
            ? guidance.warning
            : `Sample range ${formatCurrency(guidance.low)} to ${formatCurrency(guidance.high)} from ${guidance.sampleCount} listing${guidance.sampleCount === 1 ? '' : 's'}${guidance.conditionMatched ? ' in this condition.' : ' in this subcategory.'}${guidance.warning ? ` ${guidance.warning}` : ''}`;
    }

    function updateListingFormat() {
        const buyNowOnly = formatSelect.value === 'buy_now';
        const auction = formatSelect.value !== 'buy_now';
        const buyNowAvailable = formatSelect.value !== 'auction';
        documentRef.getElementById('seller-auction-pricing').hidden = !auction;
        documentRef.getElementById('seller-starting-bid').required = auction;
        documentRef.getElementById('seller-starting-bid').disabled = !auction;
        documentRef.getElementById('seller-auction-duration-wrap').hidden = buyNowOnly;
        durationSelect.required = !buyNowOnly;
        durationSelect.disabled = buyNowOnly;
        documentRef.getElementById('seller-buy-now').required = buyNowAvailable;
        documentRef.getElementById('seller-buy-now-controls').hidden = !buyNowAvailable;
        if (!buyNowAvailable) documentRef.getElementById('seller-buy-now').value = '';
    }

    function openForm() {
        form.reset();
        updateCategoryOptions();
        updateSubcategoryOptions();
        fulfilmentSelect.value = DEFAULT_FULFILMENT_METHOD;
        durationSelect.value = String(DEFAULT_AUCTION_DURATION_HOURS);
        formatSelect.value = 'auction';
        updateListingFormat();
        photoManager.clearPreviews(photoInput, photoPreviews);
        documentRef.getElementById('seller-location').value = config.pilotCity;
        documentRef.getElementById('seller-location').readOnly = inPilotMode();
        documentRef.getElementById('seller-estimated-value').required = inPilotMode();
        photoInput.required = inPilotMode();
        updateReviewSummary();
        errorElement.textContent = '';
        documentRef.getElementById('seller-listing-success').hidden = true;
        documentRef.getElementById('seller-listing-done').hidden = true;
        form.hidden = false;
        recordEvent(USABILITY_EVENT_TYPE.sellerSubmissionStarted);
        dialogController.open(dialog, startButton);
    }

    function renderSubmissions() {
        const items = loadSellerSubmissions()
            .filter(isRenderableSellerSubmission)
            .filter(submission => submission.sellerUserId === userService.getCurrentUser().id)
            .map(submission => {
                const item = documentRef.createElement('li');
                item.className = 'seller-submission-item';
                const details = documentRef.createElement('div');
                const title = documentRef.createElement('h4');
                title.textContent = submission.title;
                const metadata = documentRef.createElement('p');
                metadata.textContent = [submission.brandModel, submission.category, submission.condition, submission.location]
                    .filter(Boolean)
                    .join(' · ');
                const price = documentRef.createElement('p');
                const hasBuyNow = Number.isSafeInteger(submission.buyNowPrice) && submission.buyNowPrice > submission.startingBid;
                const buyNowText = hasBuyNow ? ` · Buy Now ${formatCurrency(submission.buyNowPrice)}` : '';
                price.textContent = `Starting bid ${formatCurrency(submission.startingBid)}${buyNowText}`;
                details.append(title, metadata, price);

                if (submission.status === SUBMISSION_STATUS.rejected && submission.rejectionReason) {
                    const reason = documentRef.createElement('p');
                    reason.textContent = `Rejection reason: ${REJECTION_REASON_LABELS[submission.rejectionReason] || submission.rejectionReason}`;
                    details.append(reason);
                }

                const status = documentRef.createElement('span');
                status.className = 'seller-submission-status';
                status.textContent = SUBMISSION_STATUS_LABELS[submission.status] || 'Submitted';
                item.append(details, status);
                return item;
            });

        submissionList.replaceChildren(...items);
        submissionPanel.hidden = items.length === 0;
    }

    function submitForm(event) {
        event.preventDefault();
        errorElement.textContent = '';
        const formData = new FormData(form);
        const buyNowValue = formData.get('buyNowPrice');
        const specifications = Object.fromEntries(Array.from(specificationFields.querySelectorAll('[data-specification]'))
            .map(input => [input.dataset.specification, input.value.trim()])
            .filter(([, value]) => value));
        const result = createSellerSubmission({
            title: String(formData.get('title')),
            brandModel: String(formData.get('brandModel')),
            category: String(formData.get('category')),
            subcategory: String(formData.get('subcategory')),
            sellerUserId: userService.getCurrentUser().id,
            fulfilmentMethod: String(formData.get('fulfilmentMethod') || DEFAULT_FULFILMENT_METHOD),
            specifications,
            photoCount: photoInput.files.length,
            condition: String(formData.get('condition')),
            description: String(formData.get('description')),
            location: inPilotMode() ? config.pilotCity : String(formData.get('location')),
            estimatedValue: Number(formData.get('estimatedValue')),
            pilotMode: inPilotMode(),
            listingFormat: String(formData.get('listingFormat')),
            startingBid: String(formData.get('listingFormat')) === 'buy_now' ? 1 : Number(formData.get('startingBid')),
            bidIncrement: Number(formData.get('bidIncrement')),
            buyNowPrice: String(formData.get('listingFormat')) === 'auction' ? null : Number(buyNowValue),
            auctionDurationHours: Number(formData.get('auctionDurationHours')) || DEFAULT_AUCTION_DURATION_HOURS,
            reservePriceMode: RESERVE_PRICE_MODE.none,
            reservePrice: null
        });

        if (!result.ok) {
            if (result.validation?.validBidIncrement === false) {
                errorElement.textContent = 'Choose one of the available bid increments.';
            } else if (result.validation?.validStartingBid === false) {
                errorElement.textContent = 'Enter a whole-number starting bid greater than zero.';
            } else if (result.validation?.validSubcategory === false) {
                errorElement.textContent = 'Choose a subcategory for the selected category.';
            } else if (result.validation?.validBuyNowPrice === false) {
                errorElement.textContent = 'The Buy Now price must be greater than the starting bid.';
            } else if (result.validation?.validReservePrice === false) {
                errorElement.textContent = 'The reserve must be a whole-number amount greater than the starting bid and within the listing limit.';
            } else if (result.validation?.validAuctionDuration === false) {
                errorElement.textContent = 'Choose one of the available auction durations.';
            } else if (result.validation?.validPriceLimit === false) {
                errorElement.textContent = `Prices must not exceed ${formatCurrency(config.auctionRules.maximumListingPrice)}.`;
            } else if (result.validation && result.validation.hasPhotos === false) {
                errorElement.textContent = 'Add at least one clear product photo.';
            } else if (result.validation && result.validation.completeDisclosures === false) {
                errorElement.textContent = 'Complete functional status, known defects, proof-of-purchase availability, and relevant model/lock disclosures.';
            } else if (result.validation && result.validation.eligibleValue === false) {
                errorElement.textContent = 'Enter a whole-number estimated value greater than zero and within the listing limit.';
            } else if (result.validation && result.validation.eligibleSubcategory === false) {
                errorElement.textContent = 'Choose a subcategory for the selected category.';
            } else if (result.code === SERVICE_ERROR_CODE.storageFailed) {
                errorElement.textContent = 'This browser could not save your listing.';
            } else {
                errorElement.textContent = 'Complete the listing details using a supported category and condition.';
            }
            const fieldId = result.validation && [
                ['validStartingBid', 'seller-starting-bid'], ['validSubcategory', 'seller-subcategory'],
                ['validBuyNowPrice', 'seller-buy-now'],
                ['validAuctionDuration', 'seller-auction-duration'], ['validPriceLimit', 'seller-starting-bid']
            ].find(([rule]) => result.validation[rule] === false)?.[1];
            if (fieldId) {
                const field = documentRef.getElementById(fieldId);
                field.setAttribute('aria-invalid', 'true');
                field.focus();
            }
            return;
        }

        photoManager.rememberFiles(result.submission.id, photoInput.files);
        recordEvent(USABILITY_EVENT_TYPE.sellerSubmissionCompleted, {
            relatedId: result.submission.listingId,
            metadata: { category: result.submission.category, subcategory: result.submission.subcategory }
        });
        renderSubmissions();
        onSubmissionsChanged();
        photoManager.clearPreviews(photoInput, photoPreviews);
        form.hidden = true;
        const success = documentRef.getElementById('seller-listing-success');
        success.textContent = 'Listing submitted for review. It will appear after approval. Photos are available only during this visit.';
        success.hidden = false;
        documentRef.getElementById('seller-listing-done').hidden = false;
    }

    startButton.addEventListener('click', openForm);
    categorySelect.addEventListener('change', () => {
        updateSubcategoryOptions();
        updateReviewSummary();
    });
    formatSelect.addEventListener('change', () => {
        updateListingFormat();
        updateReviewSummary();
    });
    subcategorySelect.addEventListener('change', () => {
        renderSpecificationFields();
        updateReviewSummary();
        if (subcategorySelect.value) recordEvent(USABILITY_EVENT_TYPE.sellerSubmissionStarted, {
            metadata: { category: categorySelect.value, subcategory: subcategorySelect.value, source: 'category_selection' }
        });
    });
    photoInput.addEventListener('change', () => photoManager.showPreviews(photoInput, photoPreviews, errorElement));
    form.addEventListener('input', updateReviewSummary);
    form.addEventListener('change', updateReviewSummary);
    form.addEventListener('submit', submitForm);
    documentRef.getElementById('cancel-seller-listing').addEventListener('click', () => dialogController.close(dialog));
    documentRef.getElementById('seller-listing-done').addEventListener('click', () => dialogController.close(dialog));
    dialog.addEventListener('close', () => photoManager.clearPreviews(photoInput, photoPreviews));

    return { openForm, renderSubmissions };
}