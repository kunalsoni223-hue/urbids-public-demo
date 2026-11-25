import { config } from '../config.js';
import { AUCTION_DURATION_OPTIONS_HOURS, CATEGORY, CATEGORY_LABELS, CONDITION_GRADE, CONDITION_GRADE_GUIDANCE, CONDITION_GRADE_LABELS, DEFAULT_AUCTION_DURATION_HOURS, DEFAULT_FULFILMENT_METHOD, FULFILMENT_METHOD_LABELS, LISTING_FORMAT, MUMBAI_LOCALITIES, PROTOTYPE_MODE, REJECTION_REASON_LABELS, RESERVE_PRICE_MODE, SERVICE_ERROR_CODE, SPECIFICATION_FIELDS_BY_SUBCATEGORY, SPECIFICATION_FIELD_LABELS, SUBCATEGORIES_BY_CATEGORY, SUBCATEGORY_LABELS, SUBMISSION_STATUS, SUBMISSION_STATUS_LABELS, USABILITY_EVENT_TYPE } from '../core/constants.js';
import { formatCurrency } from '../core/formatting.js';
import { isRenderableSellerSubmission, validateSellerPhotos } from '../core/validation.js';
import { getSellerPriceGuidance } from '../services/listing-service.js';
import { createSellerSubmission, deleteSellerDraft, loadSellerDraft, loadSellerSubmissions, saveSellerDraft } from '../services/submission-service.js';
import { announceGlobalStatus } from './status-announcer.js';

const sellerConditionChoices = [
    [CONDITION_GRADE.likeNew, 'Like new', 'Minimal or no visible wear.'],
    [CONDITION_GRADE.excellent, 'Excellent', 'Light signs of use; fully functional.'],
    [CONDITION_GRADE.good, 'Good', 'Visible normal wear; fully functional.'],
    [CONDITION_GRADE.fair, 'Fair', 'Clear wear or disclosed issues.'],
    ['defective', 'Defective', 'Known functional problem or incomplete functionality.']
];

const photoPurposes = {
    [CATEGORY.electronics]: ['Main photo', 'Front', 'Back', 'Sides', 'Screen/display', 'Defects', 'Accessories', 'Serial/model label'],
    [CATEGORY.furniture]: ['Main photo', 'Full view', 'Side view', 'Surface/material', 'Wear/damage', 'Dimensions/context', 'Collection/access context'],
    [CATEGORY.homeAppliances]: ['Main photo', 'Front', 'Controls', 'Interior/capacity', 'Accessories', 'Model label', 'Defects', 'Operational context'],
    [CATEGORY.fashion]: ['Main photo', 'Front', 'Back', 'Label/size', 'Material/details', 'Wear', 'Packaging/accessories'],
    [CATEGORY.books]: ['Main photo', 'Front/cover', 'Back', 'Spine', 'Edition/details', 'Markings/damage', 'Completeness']
};

const sellerSubcategoryLabels = {
    [CATEGORY.electronics]: { wearables: 'Smartwatches / wearables', audio: 'Audio', other_electronics: 'Other electronics' },
    [CATEGORY.homeAppliances]: { coffee_machines: 'Coffee machines', kitchen_appliances: 'Kitchen appliances', cleaning_appliances: 'Cleaning appliances', air_treatment: 'Air treatment', small_appliances: 'Small appliances' },
    [CATEGORY.books]: { books: 'Books', box_sets: 'Box sets', collectibles: 'Collectibles' },
    [CATEGORY.fashion]: { accessories: 'Watches / accessories', fashion: 'Other fashion' }
};

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

    function showPreviews(fileInput, previewContainer, errorElement, purpose = 'Product photo') {
        const files = Array.from(fileInput.files);
        clearPreviews(fileInput, previewContainer, false);
        errorElement.textContent = '';
        const validation = validateSellerPhotos(files);
        if (!validation.valid) {
            errorElement.textContent = validation.reason === 'too_many'
                ? 'Choose no more than ten photos.'
                : 'Choose image files only.';
            fileInput.value = '';
            return;
        }

        files.forEach((file, index) => {
            const imageUrl = URLRef.createObjectURL(file);
            previewUrls.push(imageUrl);
            const preview = documentRef.createElement('figure');
            preview.className = 'seller-photo-preview';
            const image = documentRef.createElement('img');
            image.src = imageUrl;
            image.alt = '';
            const caption = documentRef.createElement('figcaption');
            caption.textContent = `${purpose}: ${file.name}`;
            const mainLabel = documentRef.createElement('label');
            const mainChoice = documentRef.createElement('input');
            mainChoice.type = 'radio';
            mainChoice.name = 'seller-main-photo';
            mainChoice.value = String(index);
            mainChoice.checked = index === 0;
            mainLabel.append(mainChoice, documentRef.createTextNode(' Main photo'));
            preview.append(image, caption, mainLabel);
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

export function createSellerUI({ documentRef = document, dialogController, photoManager, userService, getPrototypeMode = () => PROTOTYPE_MODE.development, getActiveScenarioId = () => null, recordEvent = () => {}, onSubmissionsChanged = () => {}, onPreviewListing = () => {}, onDisableAutoRelist = () => {}, workspaceCoordinator = null }) {
    const dialog = documentRef.getElementById('seller-listing-dialog');
    const form = documentRef.getElementById('seller-listing-form');
    if (!form) {
        // Form doesn't exist in DOM - return stub functions
        return {
            openForm: () => {},
            renderSubmissions: () => {},
            getDraft: () => null,
            resumeDraft: () => {},
            deleteDraft: () => {},
            setAccountGate: () => {},
            handleSellerLocation: () => {},
            setWorkspaceCoordinator: () => {},
            collectFormValues: () => ({}),
            saveDraft: () => {},
            submitForm: () => {},
            renderSubmissions: () => {},
            handlePublish: () => {}
        };
    }
    const errorElement = documentRef.getElementById('seller-listing-error');
    const photoInput = documentRef.getElementById('seller-photos');
    const photoPreviews = documentRef.getElementById('seller-photo-previews');
    const submissionPanel = documentRef.getElementById('seller-submissions-panel');
    const submissionList = documentRef.getElementById('seller-submission-list');
    const startButton = documentRef.getElementById('start-listing-button');
    const categorySelect = documentRef.getElementById('seller-category');
    const subcategorySelect = documentRef.getElementById('seller-subcategory');
    const photoPurposeSelect = documentRef.getElementById('seller-photo-purpose');
    const photoGuidance = documentRef.getElementById('seller-photo-guidance');
    const conditionRadios = Array.from(documentRef.querySelectorAll('input[name="condition"]'));
    const fulfilmentSelect = documentRef.getElementById('seller-fulfilment-method');
    const locationSelect = documentRef.getElementById('seller-location');
    const durationSelect = documentRef.getElementById('seller-auction-duration');
    const formatRadios = Array.from(documentRef.querySelectorAll('input[name="listingFormat"]'));
    const bidIncrementRadios = Array.from(documentRef.querySelectorAll('input[name="bidIncrement"]'));
    const autoRelistSelect = documentRef.getElementById('seller-auto-relist');
    const reserveModeSelect = documentRef.getElementById('seller-reserve-mode');
    const reservePriceInput = documentRef.getElementById('seller-reserve-price');
    const reservePriceWrap = documentRef.getElementById('seller-reserve-price-wrap');
    const priceGuidance = documentRef.getElementById('seller-price-guidance');
    const conditionGuidance = documentRef.getElementById('seller-condition-guidance');
    const maximumListingPrice = String(config.auctionRules.maximumListingPrice);
    ['seller-starting-bid', 'seller-buy-now', 'seller-reserve-price', 'seller-estimated-value'].forEach(id => {
        const el = documentRef.getElementById(id);
        if (el) el.max = maximumListingPrice;
    });
    const specificationFields = documentRef.getElementById('seller-specification-fields');
    const sectionDetails = Array.from(form.querySelectorAll('[data-seller-section]'));
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
        reserve: documentRef.getElementById('seller-summary-reserve'),
        format: documentRef.getElementById('seller-summary-format')
    };
    let accountGate = () => true;

    const inPilotMode = () => getPrototypeMode() === PROTOTYPE_MODE.usabilityTest;
    function updateCategoryOptions() {
        const categoryLabels = {
            [CATEGORY.electronics]: 'Electronics', [CATEGORY.furniture]: 'Furniture',
            [CATEGORY.homeAppliances]: 'Home', [CATEGORY.fashion]: 'Fashion', [CATEGORY.books]: 'Books & Collectibles'
        };
        categorySelect.replaceChildren(...Object.entries(categoryLabels).map(([value, label]) => new Option(label, value)));
        categorySelect.value = CATEGORY.electronics;
    }
    updateCategoryOptions();
    fulfilmentSelect.replaceChildren(...Object.entries(FULFILMENT_METHOD_LABELS).map(([value, label]) => new Option(label, value)));
    locationSelect.replaceChildren(new Option('Mumbai (city only)', config.pilotCity), ...MUMBAI_LOCALITIES.map(locality => new Option(locality, locality)));

    durationSelect.replaceChildren(...AUCTION_DURATION_OPTIONS_HOURS.map(hours => {
        const days = hours / 24;
        return new Option(`${days} days${days === 7 ? ' - Recommended' : ''}`, String(hours));
    }));

    // Populate Auto-relist select
    if (autoRelistSelect) {
        autoRelistSelect.replaceChildren(
            new Option('Let me decide', 'decide'),
            new Option('Automatically relist once', 'once'),
            new Option('Automatically relist up to 3 times', 'three')
        );
        autoRelistSelect.value = 'decide';
    }

    // Populate Reserve mode select (hidden in pilot mode, used in development)
    if (reserveModeSelect) {
        reserveModeSelect.replaceChildren(
            new Option('No reserve', RESERVE_PRICE_MODE.none),
            new Option('Set reserve', RESERVE_PRICE_MODE.set)
        );
        reserveModeSelect.value = RESERVE_PRICE_MODE.none;
    }

    function renderSpecificationFields() {
        const fieldNames = (SPECIFICATION_FIELDS_BY_SUBCATEGORY[subcategorySelect.value] || [])
            .filter(key => !['knownDefects', 'includedAccessories'].includes(key));
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
        if (!categorySelect || !subcategorySelect) return;
        const allSubcategories = SUBCATEGORIES_BY_CATEGORY[categorySelect.value] || [];
        const subcategories = allSubcategories;
        subcategorySelect.replaceChildren(
            new Option('Choose a subcategory', ''),
            ...subcategories.map(value => new Option(sellerSubcategoryLabels[categorySelect.value]?.[value] || SUBCATEGORY_LABELS[value], value))
        );
        subcategorySelect.value = '';
        if (photoPurposeSelect) {
            const suggestions = photoPurposes[categorySelect.value] || ['Main photo', 'Front', 'Back', 'Details', 'Wear/damage'];
            photoPurposeSelect.replaceChildren(...suggestions.map(value => new Option(value, value)));
        }
        if (photoGuidance) {
            const suggestions = photoPurposes[categorySelect.value] || ['Main photo', 'Front', 'Back', 'Details', 'Wear/damage'];
            photoGuidance.replaceChildren(...suggestions.map(value => {
                const item = documentRef.createElement('span');
                item.textContent = value;
                return item;
            }));
        }
        const proofHelp = documentRef.getElementById('seller-proof-help');
        if (proofHelp) proofHelp.hidden = categorySelect.value !== CATEGORY.electronics;
        const activationHelp = documentRef.getElementById('seller-activation-help');
        if (activationHelp) activationHelp.hidden = !['smartphones', 'laptops', 'wearables'].includes(subcategorySelect.value);
        const fulfilmentRecommendation = categorySelect.value === CATEGORY.furniture
            ? 'Large furniture: public collection is recommended.'
            : categorySelect.value === CATEGORY.electronics && ['smartphones', 'laptops', 'wearables', 'audio'].includes(subcategorySelect.value)
                ? 'For higher-risk electronics, meet and inspect is recommended.'
                : categorySelect.value === CATEGORY.books || ['small_appliances', 'accessories'].includes(subcategorySelect.value)
                    ? 'For small goods, collection or prototype shipping may be suitable.' : '';
        const fulfilmentRec = documentRef.getElementById('seller-fulfilment-recommendation');
        if (fulfilmentRec) fulfilmentRec.textContent = fulfilmentRecommendation;
        renderSpecificationFields();
    }

    // Note: updateSubcategoryOptions() is called from openForm(), not here, to avoid errors with hidden form elements

    function updateReviewSummary() {
        // Guard: skip if review summary elements don't exist
        if (!reviewSummary.title || !reviewSummary.category) return;

        const values = new FormData(form);
        const title = String(values.get('title') || '').trim();
        const brand = String(values.get('brandModel') || '').trim();
        const description = String(values.get('description') || '').trim();
        const startingBid = Number(values.get('startingBid'));
        const estimatedValue = Number(values.get('estimatedValue'));
        const buyNowValue = values.get('buyNowPrice');
        const category = CATEGORY_LABELS[values.get('category')] || 'Not selected';
        const subcategory = SUBCATEGORY_LABELS[values.get('subcategory')] || 'Choose a subcategory';
        const chosenCondition = sellerConditionChoices.find(([value]) => value === values.get('condition'));
        const condition = chosenCondition?.[1] || '';
        conditionGuidance.textContent = chosenCondition
            ? `${chosenCondition[2]} Condition is seller-declared, not Urbids-verified.`
            : 'Condition is seller-declared, not Urbids-verified.';
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
            ? `${photoInput.files.length} selected${photoPreviews.querySelector('input[name="seller-main-photo"]:checked') ? ', main photo selected' : ''}`
            : 'Main photo required';
        reviewSummary.location.textContent = String(values.get('location') || '').trim() || 'Not entered';
        reviewSummary.fulfilment.textContent = `${fulfilment}${documentRef.getElementById('seller-meet-inspect').checked ? ' · Public meet and inspect' : ''}`;
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
        reviewSummary.duration.textContent = `${(Number(values.get('auctionDurationHours')) || DEFAULT_AUCTION_DURATION_HOURS) / 24} days`;
        reviewSummary.format.textContent = {
            auction: 'Auction',
            buy_now: 'Buy Now',
            auction_buy_now: 'Auction + Buy Now'
        }[String(values.get('listingFormat'))] || 'Auction';
        reviewSummary.reserve.textContent = values.get('reservePriceMode') === RESERVE_PRICE_MODE.set && values.get('reservePrice')
            ? formatCurrency(Number(values.get('reservePrice')))
            : 'None';
        const estimateSummary = documentRef.getElementById('seller-summary-estimated-value');
        if (estimateSummary) estimateSummary.textContent = Number.isSafeInteger(estimatedValue) && estimatedValue > 0
            ? formatCurrency(estimatedValue) : 'Not entered';
        const guidance = getSellerPriceGuidance({
            subcategory: String(values.get('subcategory') || ''),
            condition: String(values.get('condition') || ''),
            startingBid: Number(values.get('startingBid')),
            buyNowPrice: buyNowValue ? Number(buyNowValue) : null
        });
        priceGuidance.textContent = guidance.low === null || guidance.sampleCount < 2
            ? `Prototype price guidance: ${guidance.warning}`
            : `Prototype price guidance: sample range ${formatCurrency(guidance.low)} to ${formatCurrency(guidance.high)} from ${guidance.sampleCount} listing${guidance.sampleCount === 1 ? '' : 's'}${guidance.conditionMatched ? ' in this condition.' : ' in this subcategory.'}${guidance.warning ? ` ${guidance.warning}` : ''}`;
        const startingPrice = Number(values.get('startingBid'));
        const buyNowPrice = Number(values.get('buyNowPrice'));
        const startingShare = Number.isSafeInteger(startingPrice) && startingPrice > 0
            && Number.isSafeInteger(buyNowPrice) && buyNowPrice > 0
            && String(values.get('listingFormat')) !== LISTING_FORMAT.buyNow
            ? ` Starting bid is ${Math.round(startingPrice / buyNowPrice * 100)}% of Buy Now.` : '';
        if (startingShare) priceGuidance.textContent += startingShare;
        if (startingShare && startingPrice >= buyNowPrice) priceGuidance.textContent += ' Starting price must be below Buy Now.';
        if ([startingPrice, buyNowPrice].some(price => Number.isFinite(price) && price > config.auctionRules.maximumListingPrice)) {
            priceGuidance.textContent += ` Prices cannot exceed ${formatCurrency(config.auctionRules.maximumListingPrice)}.`;
        }
        const incrementRecommendation = startingPrice < 5000 ? 'Suggested increment: ₹10 or ₹100.'
            : startingPrice <= 25000 ? 'Suggested increment: ₹100.' : 'Suggested increment: ₹1,000.';
        documentRef.getElementById('seller-increment-recommendation').textContent = Number.isFinite(startingPrice) && startingPrice > 0
            ? incrementRecommendation : '';
        const defectsConfirmed = documentRef.getElementById('seller-defects-confirmed').checked
            && (values.get('condition') !== 'defective' || String(values.get('knownDefects') || '').trim().length > 0);
        const categoryNeedsBrand = values.get('category') === CATEGORY.electronics || values.get('category') === CATEGORY.homeAppliances
            || (values.get('category') === CATEGORY.fashion && ['sneakers', 'bags', 'accessories'].includes(String(values.get('subcategory'))));
        const photoSelected = photoInput.files.length > 0 && Boolean(photoPreviews.querySelector('input[name="seller-main-photo"]:checked'));
        const buyNowOnly = values.get('listingFormat') === LISTING_FORMAT.buyNow;
        const startingValid = buyNowOnly || (Number.isSafeInteger(startingPrice) && startingPrice > 0);
        const buyNowValid = ![LISTING_FORMAT.buyNow, LISTING_FORMAT.auctionAndBuyNow].includes(values.get('listingFormat'))
            || (Number.isSafeInteger(buyNowPrice) && buyNowPrice > (buyNowOnly ? 0 : startingPrice));
        const checklist = {
            product: Boolean(title && values.get('category') && values.get('subcategory') && (!categoryNeedsBrand || brand)),
            photo: photoSelected,
            condition: Boolean(values.get('condition')),
            defects: defectsConfirmed,
            details: Array.from(specificationFields.querySelectorAll('[required]')).every(field => String(field.value).trim()),
            format: Object.values(LISTING_FORMAT).includes(values.get('listingFormat')),
            pricing: startingValid && buyNowValid && (!startingPrice || startingPrice <= config.auctionRules.maximumListingPrice)
                && (!buyNowPrice || buyNowPrice <= config.auctionRules.maximumListingPrice),
            duration: buyNowOnly || Boolean(values.get('auctionDurationHours')),
            fulfilment: Boolean(values.get('fulfilmentMethod')),
            acknowledgement: documentRef.getElementById('seller-acknowledgement').checked
        };
        Object.entries(checklist).forEach(([key, complete]) => {
            const item = documentRef.querySelector(`[data-check="${key}"]`);
            item.dataset.complete = String(complete);
            item.setAttribute('aria-label', `${item.textContent.trim()}, ${complete ? 'complete' : 'incomplete'}`);
        });
    }

    function updateCharacterCounts() {
        [['seller-item-title', 'seller-title-count', 60], ['seller-description', 'seller-description-count', 2000], ['seller-known-defects', 'seller-defects-count', 500]]
            .forEach(([inputId, countId, maximum]) => {
                documentRef.getElementById(countId).textContent = `${documentRef.getElementById(inputId).value.length} / ${maximum}`;
            });
    }

    function updateActiveSection() {
        const openSection = sectionDetails.find(section => section.open);
        sectionDetails.forEach(section => { section.dataset.current = String(section === openSection); });
    }

    function revealField(field) {
        const selected = field.closest('[data-seller-section]');
        if (!selected) return;
        sectionDetails.forEach(section => { section.open = section === selected; });
        updateActiveSection();
    }

    function collectDraftValues() {
        const values = {};
        Array.from(form.elements).forEach(field => {
            if (!field.name || field.type === 'file' || field.name.startsWith('specifications.')) return;
            values[field.name] = field.type === 'checkbox' ? field.checked : field.value;
        });
        values.specifications = Object.fromEntries(Array.from(specificationFields.querySelectorAll('[data-specification]'))
            .map(field => [field.dataset.specification, field.value]));
        return values;
    }

    function restoreDraftValues(values) {
        const savedSubcategory = values.subcategory;
        Object.entries(values).forEach(([name, value]) => {
            if (['specifications', 'mainPhotoIndex', 'photos'].includes(name)) return;
            const field = form.elements.namedItem(name);
            if (!field) return;
            if (field.type === 'checkbox') {
                field.checked = value === true;
            } else if (field.type === 'radio') {
                // For radio buttons, find and check the one with matching value
                const radioToCheck = Array.from(documentRef.querySelectorAll(`input[name="${name}"]`)).find(r => r.value === String(value));
                if (radioToCheck) radioToCheck.checked = true;
            } else {
                field.value = String(value ?? '');
            }
        });
        updateSubcategoryOptions();
        subcategorySelect.value = SUBCATEGORIES_BY_CATEGORY[categorySelect.value]?.includes(savedSubcategory) ? savedSubcategory : '';
        renderSpecificationFields();
        const specifications = values.specifications && typeof values.specifications === 'object' ? values.specifications : {};
        Object.entries(specifications).forEach(([key, value]) => {
            const field = specificationFields.querySelector(`[data-specification="${key}"]`);
            if (field) field.value = String(value ?? '');
        });
        updateListingFormat();
        updateReserveControl();
        updateCharacterCounts();
        updateReviewSummary();
    }

    function updateReserveControl() {
        const controls = documentRef.getElementById('seller-reserve-controls');
        if (controls) controls.hidden = inPilotMode();

        const reserveRow = documentRef.getElementById('seller-summary-reserve-row');
        if (reserveRow) reserveRow.hidden = inPilotMode();

        if (inPilotMode()) {
            if (reserveModeSelect) reserveModeSelect.value = RESERVE_PRICE_MODE.none;
        }

        const hasReserve = !inPilotMode() && reserveModeSelect && reserveModeSelect.value === RESERVE_PRICE_MODE.set;
        if (reservePriceWrap) reservePriceWrap.hidden = !hasReserve;
        if (reservePriceInput) {
            reservePriceInput.disabled = !hasReserve;
            reservePriceInput.required = hasReserve;
            if (!hasReserve) reservePriceInput.value = '';
        }
    }

    function updateListingFormat() {
        const selectedFormatRadio = documentRef.querySelector('input[name="listingFormat"]:checked');
        const formatValue = selectedFormatRadio?.value || '';
        const hasFormat = !!formatValue;
        const buyNowOnly = formatValue === LISTING_FORMAT.buyNow;
        const auction = formatValue === LISTING_FORMAT.auction || formatValue === LISTING_FORMAT.auctionAndBuyNow;
        const buyNowAvailable = formatValue === LISTING_FORMAT.buyNow || formatValue === LISTING_FORMAT.auctionAndBuyNow;

        // Show/hide auction controls based on format
        const auctionControls = documentRef.getElementById('seller-auction-controls');
        if (auctionControls) auctionControls.hidden = !auction;

        // Update starting bid validation and visibility
        const startingBid = documentRef.getElementById('seller-starting-bid');
        if (startingBid) {
            startingBid.required = auction;
            startingBid.disabled = !auction;
            const auctionPriceGroup = documentRef.getElementById('seller-auction-price-group');
            if (auctionPriceGroup) auctionPriceGroup.hidden = !auction;
        }

        // Update bid increment fieldset validation and visibility
        const bidIncrementWrapper = documentRef.querySelector('.bid-increment-wrapper');
        if (bidIncrementWrapper) {
            bidIncrementWrapper.hidden = !auction;
            const bidIncrementRadios = bidIncrementWrapper.querySelectorAll('input[name="bidIncrement"]');
            bidIncrementRadios.forEach(r => {
                r.required = auction;
                r.disabled = !auction;
            });
        }

        // Update auction duration validation and visibility
        const auctionDuration = documentRef.getElementById('seller-auction-duration');
        if (auctionDuration) {
            auctionDuration.required = auction;
            auctionDuration.disabled = !auction;
            if (auctionDuration.parentElement) auctionDuration.parentElement.hidden = !auction;
        }

        // Update auto-relist visibility and state
        const autoRelist = documentRef.getElementById('seller-auto-relist');
        if (autoRelist) {
            autoRelist.disabled = !auction;
            if (autoRelist.closest('[id$="-wrap"]')) {
                autoRelist.closest('[id$="-wrap"]').hidden = !auction;
            }
        }

        // Show/hide buy now controls
        const buyNowControls = documentRef.getElementById('seller-buynow-controls');
        if (buyNowControls) buyNowControls.hidden = !buyNowAvailable;

        // Update buy now price validation and visibility
        const buyNowPrice = documentRef.getElementById('seller-buy-now-price');
        if (buyNowPrice) {
            buyNowPrice.required = buyNowAvailable;
            buyNowPrice.disabled = !buyNowAvailable;
            if (!buyNowAvailable) buyNowPrice.value = '';
            const buyNowPriceGroup = documentRef.getElementById('seller-buynow-price-group');
            if (buyNowPriceGroup) buyNowPriceGroup.hidden = !buyNowAvailable;
        }

        // Update reserve mode if switching to buy-now-only
        if (buyNowOnly) {
            const reserveMode = documentRef.getElementById('seller-reserve-mode');
            if (reserveMode) {
                reserveMode.value = RESERVE_PRICE_MODE.none;
            }
            updateReserveControl();
        }
    }

    function updateBidIncrementRecommendation() {
        const startingBidInput = documentRef.getElementById('seller-starting-bid');
        const recommendationEl = documentRef.getElementById('bid-increment-recommendation');
        if (!recommendationEl || !startingBidInput) return;

        const startingBid = Number(startingBidInput.value) || 0;

        // Hide recommendation if no price entered
        if (!startingBid) {
            recommendationEl.textContent = '';
            return;
        }

        let recommended = 100;
        if (startingBid < 500) recommended = 10;
        if (startingBid < 100) recommended = 1;
        if (startingBid >= 5000) recommended = 1000;

        recommendationEl.textContent = `Recommended increment: ₹${recommended.toLocaleString('en-IN')}`;
    }

    function openForm(draftToResume = null) {
        form.reset();
        delete form.dataset.submitting;
        updateCategoryOptions();
        updateSubcategoryOptions();
        if (fulfilmentSelect) fulfilmentSelect.value = DEFAULT_FULFILMENT_METHOD;
        if (durationSelect) durationSelect.value = String(DEFAULT_AUCTION_DURATION_HOURS);
        // Reset format radios
        formatRadios.forEach(r => { r.checked = false; });
        updateListingFormat();
        if (reserveModeSelect) reserveModeSelect.value = RESERVE_PRICE_MODE.none;
        updateReserveControl();
        photoManager.clearPreviews(photoInput, photoPreviews);
        if (locationSelect) {
            locationSelect.value = config.pilotCity;
            locationSelect.disabled = inPilotMode();
        }
        const estimatedValueEl = documentRef.getElementById('seller-estimated-value');
        if (estimatedValueEl) estimatedValueEl.required = inPilotMode();

        const draft = draftToResume?.values ? draftToResume : loadSellerDraft(userService.getCurrentUser()?.id);
        if (draft) {
            restoreDraftValues(draft.values);
            recordEvent(USABILITY_EVENT_TYPE.sellerDraftResumed, { metadata: { source: 'seller_panel' } });
        }
        sectionDetails.forEach((section, index) => { section.open = index === 0; });
        updateActiveSection();
        updateCharacterCounts();
        updateReviewSummary();
        if (errorElement) errorElement.textContent = '';

        const successEl = documentRef.getElementById('seller-listing-success');
        if (successEl) successEl.hidden = true;

        const doneEl = documentRef.getElementById('seller-listing-done');
        if (doneEl) doneEl.hidden = true;

        form.hidden = false;
        recordEvent(USABILITY_EVENT_TYPE.sellerFormStarted);

        // Use workspace if available, otherwise use dialog
        if (workspaceCoordinator) {
            workspaceCoordinator.open(draftToResume);
        } else {
            dialogController.open(dialog, startButton);
        }
    }

    function saveDraft() {
        if (accountGate(() => saveDraft(), documentRef.getElementById('seller-save-draft')) === false) return;
        const result = saveSellerDraft(userService.getCurrentUser().id, collectDraftValues());
        if (!result.ok) {
            errorElement.textContent = 'This browser could not save your draft.';
            return;
        }
        recordEvent(USABILITY_EVENT_TYPE.sellerDraftSaved, { metadata: { source: 'seller_form' } });
        announceGlobalStatus('Draft saved in this browser. Photo files may need to be selected again.', documentRef, { allowDialog: true });
        renderSubmissions();
    }

    function renderSubmissions() {
        const currentUserId = userService.getCurrentUser()?.id;
        const items = loadSellerSubmissions()
            .filter(isRenderableSellerSubmission)
            .filter(submission => submission.sellerUserId === currentUserId)
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
                if (submission.status === SUBMISSION_STATUS.published && submission.autoRelistLimit > (submission.autoRelistCount || 0)) {
                    const disableRelist = documentRef.createElement('button');
                    disableRelist.type = 'button';
                    disableRelist.className = 'account-action';
                    disableRelist.textContent = 'Disable future automatic relists';
                    disableRelist.addEventListener('click', () => onDisableAutoRelist(submission.listingId));
                    item.append(disableRelist);
                }
                return item;
            });

        const draft = loadSellerDraft(currentUserId);
        if (draft) {
            const item = documentRef.createElement('li');
            item.className = 'seller-submission-item seller-draft-item';
            const details = documentRef.createElement('div');
            const title = documentRef.createElement('h4');
            title.textContent = String(draft.values.title || '').trim() || 'Untitled draft';
            const metadata = documentRef.createElement('p');
            metadata.textContent = `${CATEGORY_LABELS[draft.values.category] || 'Category not selected'} · Updated ${new Date(draft.updatedAt).toLocaleDateString()}`;
            details.append(title, metadata);
            const resume = documentRef.createElement('button');
            resume.type = 'button';
            resume.className = 'account-action';
            resume.textContent = 'Resume';
            resume.addEventListener('click', () => openForm(draft));
            const remove = documentRef.createElement('button');
            remove.type = 'button';
            remove.className = 'account-action';
            remove.textContent = 'Delete';
            remove.addEventListener('click', () => {
                deleteSellerDraft(currentUserId);
                recordEvent(USABILITY_EVENT_TYPE.sellerDraftDeleted, { metadata: { source: 'seller_panel' } });
                renderSubmissions();
            });
            item.append(details, resume, remove);
            items.unshift(item);
        }

        submissionList.replaceChildren(...items);
        submissionPanel.hidden = items.length === 0;
    }

    function submitForm(event) {
        event.preventDefault();
        if (form.dataset.submitting === 'true') return;
        if (accountGate(() => form.requestSubmit(), form.querySelector('button[type="submit"]')) === false) return;
        errorElement.textContent = '';
        const formData = new FormData(form);
        const plainText = value => String(value ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
        const title = plainText(formData.get('title')).slice(0, 60);
        const brand = plainText(formData.get('brandModel'));
        const model = plainText(formData.get('model'));
        const description = plainText(formData.get('description')).slice(0, 2000);
        const knownDefects = plainText(formData.get('knownDefects')).slice(0, 500);
        const selectedCondition = String(formData.get('condition') || '');
        const category = String(formData.get('category') || '');
        const sellerBrandRequired = category === CATEGORY.electronics || category === CATEGORY.homeAppliances
            || (category === CATEGORY.fashion && ['sneakers', 'bags', 'accessories'].includes(String(formData.get('subcategory'))));
        const validationMessage = !title ? 'Enter a listing title.'
            : sellerBrandRequired && !brand ? 'Enter the brand or maker for this category.'
                : !selectedCondition ? 'Choose a condition for the item.'
                : !description ? 'Enter a description using plain text.'
                    : selectedCondition === 'defective' && !knownDefects ? 'Describe the known functional problem.'
                        : formData.get('defectsConfirmed') !== 'on' ? 'Confirm that you have disclosed all known defects.'
                            : formData.get('sellerAcknowledgement') !== 'on' ? 'Accept the seller acknowledgement before submitting.'
                                : !photoInput.files.length || !photoPreviews.querySelector('input[name="seller-main-photo"]:checked') ? 'Select a main photo for your listing.'
                                    : '';
        if (validationMessage) {
            errorElement.textContent = validationMessage;
            const target = validationMessage.includes('photo') ? photoInput
                : validationMessage.includes('defect') ? documentRef.getElementById('seller-known-defects')
                    : validationMessage.includes('acknowledgement') ? documentRef.getElementById('seller-acknowledgement')
                        : validationMessage.includes('condition') ? conditionSelect
                        : documentRef.getElementById('seller-item-title');
            revealField(target);
            target.focus();
            return;
        }
        form.dataset.submitting = 'true';
        const buyNowValue = formData.get('buyNowPrice');
        const reservePriceValue = formData.get('reservePrice');
        const specifications = Object.fromEntries(Array.from(specificationFields.querySelectorAll('[data-specification]'))
            .map(input => [input.dataset.specification, plainText(input.value)])
            .filter(([, value]) => value));
        const includedItems = plainText(formData.get('includedItems'));
        if (knownDefects) specifications.knownDefects = knownDefects;
        if (includedItems) specifications.includedAccessories = includedItems;
        if (model) specifications.model = model;
        const seller = userService.getCurrentUser();
        const result = createSellerSubmission({
            title,
            brandModel: [brand, model].filter(Boolean).join(' ').slice(0, 100),
            category,
            subcategory: String(formData.get('subcategory')),
            sellerUserId: seller.id,
            sellerName: seller.firstName,
            scenarioId: getActiveScenarioId(),
            fulfilmentMethod: String(formData.get('fulfilmentMethod') || DEFAULT_FULFILMENT_METHOD),
            meetAndInspectAvailable: formData.get('meetAndInspectAvailable') === 'on',
            specifications,
            photoCount: photoInput.files.length,
            condition: selectedCondition === 'defective' ? CONDITION_GRADE.fair : selectedCondition,
            conditionLabel: sellerConditionChoices.find(([value]) => value === selectedCondition)?.[1] || '',
            description,
            location: inPilotMode() ? config.pilotCity : String(formData.get('location')),
            estimatedValue: Number(formData.get('estimatedValue')),
            pilotMode: inPilotMode(),
            listingFormat: String(formData.get('listingFormat')),
            startingBid: String(formData.get('listingFormat')) === 'buy_now' ? 1 : Number(formData.get('startingBid')),
            bidIncrement: Number(formData.get('bidIncrement')),
            buyNowPrice: String(formData.get('listingFormat')) === 'auction' ? null : Number(buyNowValue),
            auctionDurationHours: Number(formData.get('auctionDurationHours')) || DEFAULT_AUCTION_DURATION_HOURS,
            sellerAcknowledged: true,
            autoRelistLimit: { decide: 0, once: 1, three: 3 }[String(formData.get('autoRelist'))] || 0,
            sellerReference: plainText(formData.get('sellerReference')).slice(0, 40),
            reservePriceMode: inPilotMode() || String(formData.get('listingFormat')) === 'buy_now'
                ? RESERVE_PRICE_MODE.none : String(formData.get('reservePriceMode')),
            reservePrice: inPilotMode() || String(formData.get('listingFormat')) === 'buy_now'
                ? null : reservePriceValue === null || reservePriceValue === '' ? null : Number(reservePriceValue)
        });

        if (!result.ok) {
            form.dataset.submitting = 'false';
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
                ['validBuyNowPrice', 'seller-buy-now'], ['validReservePrice', 'seller-reserve-price'],
                ['validAuctionDuration', 'seller-auction-duration'], ['validPriceLimit', 'seller-starting-bid']
            ].find(([rule]) => result.validation[rule] === false)?.[1];
            if (fieldId) {
                const field = documentRef.getElementById(fieldId);
                revealField(field);
                field.setAttribute('aria-invalid', 'true');
                field.focus();
            }
            return;
        }

        const mainPhotoIndex = Number(photoPreviews.querySelector('input[name="seller-main-photo"]:checked')?.value || 0);
        const orderedFiles = Array.from(photoInput.files);
        if (mainPhotoIndex > 0) orderedFiles.unshift(...orderedFiles.splice(mainPhotoIndex, 1));
        photoManager.rememberFiles(result.submission.id, orderedFiles);
        deleteSellerDraft(seller.id);
        recordEvent(USABILITY_EVENT_TYPE.sellerSubmissionCompleted, {
            relatedId: result.submission.listingId,
            metadata: { category: result.submission.category, subcategory: result.submission.subcategory }
        });
        renderSubmissions();
        onSubmissionsChanged();
        photoManager.clearPreviews(photoInput, photoPreviews);
        form.hidden = true;
        const success = documentRef.getElementById('seller-listing-success');
        success.textContent = 'Saved as a pending-review simulation in this browser. No real review or publication occurs. Photos are available only during this visit.';
        success.hidden = false;
        documentRef.getElementById('seller-listing-done').hidden = false;
    }

    if (startButton) startButton.addEventListener('click', openForm);
    if (categorySelect) categorySelect.addEventListener('change', () => {
        updateSubcategoryOptions();
        updateReviewSummary();
    });

    // Condition radio change listener
    conditionRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            const defectInput = documentRef.getElementById('seller-known-defects');
            const condition = radio.value;
            if (defectInput) {
                defectInput.placeholder = condition === 'defective'
                    ? 'Describe the known functional problem.'
                    : condition === CONDITION_GRADE.fair ? 'Describe clear wear or disclosed issues.' : '';
            }
            updateReviewSummary();
        });
    });

    // Format radio change listener
    formatRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            updateListingFormat();
            updateReviewSummary();
            const selectedFormat = Array.from(documentRef.querySelectorAll('input[name="listingFormat"]:checked')).map(r => r.value).join();
            recordEvent(USABILITY_EVENT_TYPE.sellingFormatSelected, {
                metadata: { category: categorySelect?.value, subcategory: subcategorySelect?.value, format: selectedFormat }
            });
            updateBidIncrementRecommendation();
        });
    });

    // Bid increment radio change listener
    bidIncrementRadios.forEach(radio => {
        radio.addEventListener('change', () => recordEvent(USABILITY_EVENT_TYPE.sellingFormatSelected, {
            metadata: {
                category: categorySelect?.value,
                subcategory: subcategorySelect?.value,
                format: Array.from(documentRef.querySelectorAll('input[name="listingFormat"]:checked')).map(r => r.value).join(),
                bidIncrementOption: radio.value
            }
        }));
    });

    if (subcategorySelect) subcategorySelect.addEventListener('change', () => {
        renderSpecificationFields();
        updateReviewSummary();
        if (subcategorySelect.value) recordEvent(USABILITY_EVENT_TYPE.sellerSubmissionStarted, {
            metadata: { category: categorySelect?.value, subcategory: subcategorySelect.value, source: 'category_selection' }
        });
    });
    if (photoInput) photoInput.addEventListener('change', () => {
        photoManager.showPreviews(photoInput, photoPreviews, errorElement, photoPurposeSelect?.value);
        updateReviewSummary();
    });
    form.addEventListener('input', (event) => {
        documentRef.activeElement?.removeAttribute('aria-invalid');
        updateCharacterCounts();
        if (event.target.id === 'seller-starting-bid') {
            updateBidIncrementRecommendation();
        }
        updateReviewSummary();
    });
    form.addEventListener('change', event => {
        updateCharacterCounts();
        updateReviewSummary();
        if (event.target === durationSelect) recordEvent(USABILITY_EVENT_TYPE.auctionDurationSelected, {
            metadata: { durationOption: durationSelect?.value, category: categorySelect?.value, subcategory: subcategorySelect?.value }
        });
        if (event.target.id === 'seller-auto-relist') recordEvent(USABILITY_EVENT_TYPE.autoRelistSelected, {
            metadata: { autoRelistChoice: event.target.value, category: categorySelect?.value, subcategory: subcategorySelect?.value }
        });
        if (event.target === fulfilmentSelect) recordEvent(USABILITY_EVENT_TYPE.sellerFulfilmentSelected, {
            metadata: { fulfilment: fulfilmentSelect?.value, category: categorySelect?.value, subcategory: subcategorySelect?.value }
        });
    });
    sectionDetails.forEach(section => section.addEventListener('toggle', () => {
        if (section.open) sectionDetails.forEach(other => { if (other !== section) other.open = false; });
        if (!section.open) recordEvent(USABILITY_EVENT_TYPE.sellerSectionCompleted, {
            metadata: { code: section.dataset.sellerSection }
        });
        updateActiveSection();
    }));
    if (reserveModeSelect) reserveModeSelect.addEventListener('change', () => {
        updateReserveControl();
        updateReviewSummary();
    });
    const saveDraftBtn = documentRef.getElementById('seller-save-draft');
    if (saveDraftBtn) saveDraftBtn.addEventListener('click', saveDraft);
    const previewBtn = documentRef.getElementById('seller-preview-listing');
    if (previewBtn) previewBtn.addEventListener('click', () => {
        recordEvent(USABILITY_EVENT_TYPE.sellerPreviewOpened, { metadata: { source: 'preview' } });
        const values = new FormData(form);
        const selected = sellerConditionChoices.find(([value]) => value === values.get('condition'));
        const specifications = Object.fromEntries(Array.from(specificationFields.querySelectorAll('[data-specification]'))
            .map(field => [field.dataset.specification, field.value.replace(/<[^>]*>/g, '').trim()]).filter(([, value]) => value));
        const defects = String(values.get('knownDefects') || '').trim();
        const included = String(values.get('includedItems') || '').trim();
        if (defects) specifications.knownDefects = defects;
        if (included) specifications.includedAccessories = included;
        const selectedFormat = String(values.get('listingFormat') || LISTING_FORMAT.auction);
        const previewImages = Array.from(photoPreviews.querySelectorAll('img')).map(image => image.src);
        const mainIndex = Number(photoPreviews.querySelector('input[name="seller-main-photo"]:checked')?.value || 0);
        if (mainIndex > 0) previewImages.unshift(...previewImages.splice(mainIndex, 1));
        const seller = userService.getCurrentUser();
        onPreviewListing({
            title: String(values.get('title') || '').trim(),
            brandModel: [String(values.get('brandModel') || '').trim(), String(values.get('model') || '').trim()].filter(Boolean).join(' '),
            category: String(values.get('category') || CATEGORY.electronics),
            subcategory: String(values.get('subcategory') || ''),
            conditionGrade: selected?.[0] === 'defective' ? CONDITION_GRADE.fair : selected?.[0] || CONDITION_GRADE.good,
            conditionLabel: selected?.[1] || 'Good',
            description: String(values.get('description') || '').trim(),
            specifications,
            accessories: included ? included.split(',').map(item => item.trim()).filter(Boolean) : [],
            images: previewImages,
            image: previewImages[0] || null,
            sellerUserId: seller.id,
            sellerName: seller.firstName,
            location: String(values.get('location') || config.pilotCity),
            listingFormat: selectedFormat,
            startingBid: selectedFormat === LISTING_FORMAT.buyNow ? Number(values.get('buyNowPrice')) || 1 : Number(values.get('startingBid')) || 1,
            bidIncrement: Number(values.get('bidIncrement')) || 100,
            buyNowPrice: selectedFormat === LISTING_FORMAT.auction ? null : Number(values.get('buyNowPrice')) || null,
            auctionDurationHours: Number(values.get('auctionDurationHours')) || DEFAULT_AUCTION_DURATION_HOURS,
            fulfilmentMethod: String(values.get('fulfilmentMethod') || DEFAULT_FULFILMENT_METHOD),
            meetAndInspectAvailable: values.get('meetAndInspectAvailable') === 'on',
            reservePriceMode: RESERVE_PRICE_MODE.none,
            reservePrice: null
        });
    });
    form.addEventListener('submit', submitForm);
    const cancelBtn = documentRef.getElementById('cancel-seller-listing');
    if (cancelBtn) cancelBtn.addEventListener('click', () => dialogController.close(dialog));
    const doneBtn = documentRef.getElementById('seller-listing-done');
    if (doneBtn) doneBtn.addEventListener('click', () => dialogController.close(dialog));
    if (dialog) dialog.addEventListener('close', () => photoManager.clearPreviews(photoInput, photoPreviews));

    function handleSellerLocation() {
        const windowRef = documentRef.defaultView || window;
        if (windowRef.location.hash === '#sell') {
            accountGate(() => openForm(), startButton);
        }
    }

    documentRef.defaultView.addEventListener('popstate', handleSellerLocation);
    documentRef.defaultView.addEventListener('hashchange', handleSellerLocation);

    return {
        openForm,
        renderSubmissions,
        getDraft() { return loadSellerDraft(userService.getCurrentUser()?.id); },
        resumeDraft(draft) { openForm(draft); },
        deleteDraft() {
            const userId = userService.getCurrentUser()?.id;
            deleteSellerDraft(userId);
            recordEvent(USABILITY_EVENT_TYPE.sellerDraftDeleted, { metadata: { source: 'seller_panel' } });
            renderSubmissions();
        },
        setAccountGate(handler) { accountGate = handler; },
        handleSellerLocation,
        setWorkspaceCoordinator(coordinator) { workspaceCoordinator = coordinator; },
        // Additional methods for workspace
        collectFormValues() {
            return collectDraftValues();
        },
        saveDraft() {
            saveDraft();
        },
        submitForm(values) {
            if (values) {
                // Use provided values instead of collecting from form
                return createSubmission(values);
            }
            return submitForm();
        },
        validateForm() {
            // Trigger validation by checking form validity
            if (!form.checkValidity()) {
                form.reportValidity();
                return false;
            }
            return true;
        }
    };
}
