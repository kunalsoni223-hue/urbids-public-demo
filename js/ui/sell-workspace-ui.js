/**
 * Sell Workspace V3 Coordinator
 *
 * Manages three-step flow: Create → Promote → Review
 * Works with existing seller-ui form
 * Coordinates navigation, state, and step progression
 *
 * BATCHES 1-24 Implementation:
 * - Batch 4: Step 1 form validation and next button
 * - Batch 5: Step 2 promotion tier selection
 * - Batch 7: Step 3 review with preview and checklist
 */

export function createSellWorkspaceCoordinator({
    documentRef = document,
    sellerUI,
    photoManager,
    recordEvent = () => {},
    setPrimaryView = () => {}
}) {
    const workspace = documentRef.getElementById('sell-workspace');
    if (!workspace) return null;

    const content = workspace.querySelector('.sell-workspace-content');
    const indicator = workspace.querySelector('.sell-workspace-step-indicator');

    let currentStep = 1;
    let unsavedChanges = false;
    let promotionTier = 'standard';
    let isDirty = false;
    let formValues = {};
    let reviewData = {};

    const form = documentRef.getElementById('seller-listing-form');

    // BATCH 4: Form validation helpers
    function isFormValid() {
        if (!form) return false;

        // Core validation from existing seller-ui
        const title = form.elements.namedItem('title')?.value?.trim();
        const category = form.elements.namedItem('category')?.value;
        const subcategory = form.elements.namedItem('subcategory')?.value;
        const condition = form.elements.namedItem('condition')?.value;
        const description = form.elements.namedItem('description')?.value?.trim();
        const startingBid = form.elements.namedItem('startingBid')?.value;
        const buyNowPrice = form.elements.namedItem('buyNowPrice')?.value;
        const listingFormat = form.elements.namedItem('listingFormat')?.value;
        const auctionDuration = form.elements.namedItem('auctionDurationHours')?.value;
        const fulfilmentMethod = form.elements.namedItem('fulfilmentMethod')?.value;

        return title && category && subcategory && condition && description && listingFormat
            && (listingFormat === 'buy_now' ? buyNowPrice : startingBid && auctionDuration)
            && (listingFormat !== 'auction_buy_now' || buyNowPrice) && fulfilmentMethod;
    }

    function collectFormValues() {
        if (!form) return {};

        const values = {
            // Product
            category: form.elements.namedItem('category')?.value || '',
            subcategory: form.elements.namedItem('subcategory')?.value || '',
            brandModel: form.elements.namedItem('brandModel')?.value || '',
            title: form.elements.namedItem('title')?.value || '',

            // Photos
            photoCount: form.elements.namedItem('photoCount')?.value || 1,

            // Condition
            condition: form.elements.namedItem('condition')?.value || '',
            conditionLabel: form.elements.namedItem('conditionLabel')?.value || '',
            knownDefects: form.elements.namedItem('knownDefects')?.value || '',

            // Details
            description: form.elements.namedItem('description')?.value || '',
            includedItems: form.elements.namedItem('includedItems')?.value || '',
            specifications: form.elements.namedItem('specifications')?.value || '',

            // Format & Pricing
            listingFormat: form.elements.namedItem('listingFormat')?.value || 'auction',
            startingBid: form.elements.namedItem('startingBid')?.value || 0,
            bidIncrement: form.elements.namedItem('bidIncrement')?.value || 0,
            buyNowPrice: form.elements.namedItem('buyNowPrice')?.value || null,

            // Auction Duration
            auctionDurationHours: form.elements.namedItem('auctionDurationHours')?.value || 168,

            // Fulfilment
            fulfilmentMethod: form.elements.namedItem('fulfilmentMethod')?.value || 'shipping',
            autoRelistLimit: form.elements.namedItem('autoRelistLimit')?.value || 0,
        };

        return values;
    }

    function updateNextButtonState() {
        const btn = workspace.querySelector('#seller-step-1-next');
        if (btn) {
            btn.disabled = !isFormValid();
        }
    }

    // BATCH 7: Render review preview and checklist
    function renderReviewPreview() {
        const container = workspace.querySelector('.review-preview');
        if (!container) return;

        formValues = collectFormValues();

        // Photos preview
        const photosContainer = container.querySelector('#review-photos-preview');
        if (photosContainer) {
            photosContainer.innerHTML = `<div class="preview-photos-grid">
                <div class="photo-placeholder">${formValues.photoCount || 1} photo${(formValues.photoCount || 1) > 1 ? 's' : ''}</div>
            </div>`;
        }

        // Basic info
        const titleEl = container.querySelector('#review-title');
        const categoryEl = container.querySelector('#review-category');
        const conditionEl = container.querySelector('#review-condition');

        if (titleEl) titleEl.textContent = formValues.title || 'Untitled listing';
        if (categoryEl) categoryEl.textContent = formValues.subcategory || formValues.category || 'Uncategorized';
        if (conditionEl) categoryEl.textContent = formValues.conditionLabel || formValues.condition || 'Unknown condition';

        // Description and specs
        const descEl = container.querySelector('#review-description');
        if (descEl) {
            descEl.replaceChildren();
            if (formValues.description) {
                const heading = documentRef.createElement('h4');
                heading.textContent = 'Description';
                const text = documentRef.createElement('p');
                text.textContent = formValues.description;
                descEl.append(heading, text);
            }
        }

        const specsEl = container.querySelector('#review-specs');
        if (specsEl) {
            specsEl.replaceChildren();
            if (formValues.specifications) {
                const heading = documentRef.createElement('h4');
                heading.textContent = 'Specifications';
                const text = documentRef.createElement('p');
                text.textContent = formValues.specifications;
                specsEl.append(heading, text);
            }
        }

        // Pricing
        const pricingEl = container.querySelector('#review-pricing');
        if (pricingEl) {
            let pricingHtml = `<div class="preview-section"><h4>Pricing</h4>`;
            if (formValues.listingFormat === 'auction' || formValues.listingFormat === 'auctionAndBuyNow') {
                pricingHtml += `<p><strong>Starting bid:</strong> ₹${formValues.startingBid}</p>`;
            }
            if (formValues.buyNowPrice) {
                pricingHtml += `<p><strong>Buy now:</strong> ₹${formValues.buyNowPrice}</p>`;
            }
            pricingHtml += '</div>';
            pricingEl.innerHTML = pricingHtml;
        }

        // Duration
        const durationEl = container.querySelector('#review-duration');
        if (durationEl) {
            durationEl.innerHTML = `<div class="preview-section"><h4>Duration</h4><p>${formValues.auctionDurationHours} hours</p></div>`;
        }

        // Fulfilment
        const fulfilmentEl = container.querySelector('#review-fulfilment');
        if (fulfilmentEl) {
            fulfilmentEl.innerHTML = `<div class="preview-section"><h4>Fulfilment</h4><p>${formValues.fulfilmentMethod || 'Not specified'}</p></div>`;
        }

        // Promotion
        const promoEl = container.querySelector('#review-promotion');
        if (promoEl) {
            if (promotionTier !== 'standard') {
                promoEl.innerHTML = `<div class="preview-section promotion-badge"><p><strong>Promotion:</strong> ${promotionTier}</p></div>`;
            } else {
                promoEl.innerHTML = '';
            }
        }

        updateChecklistState();
    }

    // BATCH 7: Update checklist based on form state
    function updateChecklistState() {
        const checklist = workspace.querySelector('.review-checklist');
        if (!checklist) return;

        const checks = {
            'check-product': !!formValues.category && !!formValues.subcategory,
            'check-main-photo': (formValues.photoCount || 1) >= 1,
            'check-condition': !!formValues.condition,
            'check-defects': true, // Optional but tracked
            'check-details': !!formValues.description && !!formValues.title,
            'check-pricing': !!formValues.startingBid,
            'check-duration': !!formValues.auctionDurationHours,
            'check-fulfilment': !!formValues.fulfilmentMethod,
            'check-promotion': true, // Always OK (can skip)
            'check-accuracy': false, // User must check
        };

        Object.entries(checks).forEach(([id, isValid]) => {
            const checkbox = checklist.querySelector(`#${id}`);
            if (checkbox && isValid && id !== 'check-accuracy') {
                checkbox.checked = true;
            }
        });

        updatePublishButtonState();
    }

    // BATCH 7: Check if publish button should be enabled
    function updatePublishButtonState() {
        const checklist = workspace.querySelector('.review-checklist');
        const publishBtn = workspace.querySelector('#step3-publish');

        if (!checklist || !publishBtn) return;

        const allChecked = Array.from(checklist.querySelectorAll('input[type="checkbox"]'))
            .every(cb => cb.checked);

        publishBtn.disabled = !allChecked;
    }

    function goToStep(step) {
        if (currentStep === step || !content) return;
        currentStep = step;
        updateUI();
        content.scrollTop = 0;
        setFocus();

        // BATCH 7: Render preview when moving to step 3
        if (step === 3) {
            formValues = collectFormValues();
            renderReviewPreview();
        }
    }

    function updateUI() {
        const steps = content.querySelectorAll('.sell-workspace-step');
        steps.forEach((step, i) => {
            step.hidden = (i + 1) !== currentStep;
        });

        if (indicator) {
            indicator.querySelectorAll('.step-item').forEach((item, i) => {
                const num = i + 1;
                item.classList.toggle('step-completed', num < currentStep);
                item.classList.toggle('step-active', num === currentStep);
                item.classList.toggle('step-pending', num > currentStep);
            });
        }

        // BATCH 4: Update next button state when viewing Step 1
        if (currentStep === 1) {
            updateNextButtonState();
        }
    }

    function setFocus() {
        const stepNum = currentStep;
        const selector = `.sell-workspace-step-${stepNum} h2`;
        const el = workspace.querySelector(selector);
        if (el) {
            setTimeout(() => el.focus({ preventScroll: false }), 100);
        }
    }

    function markChanged() {
        isDirty = true;
        updateNextButtonState();
    }

    function clearChanged() {
        isDirty = false;
    }

    function hasChanged() {
        return isDirty && currentStep === 1;
    }

    function showLeaveDialog(onConfirm) {
        const dialog = documentRef.createElement('dialog');
        dialog.className = 'unsaved-work-dialog';
        dialog.setAttribute('aria-labelledby', 'unsaved-title');
        dialog.innerHTML = `
            <div class="unsaved-work-content">
                <h3 id="unsaved-title">Unsaved changes</h3>
                <p>Your listing has unsaved changes. What would you like to do?</p>
                <div class="unsaved-work-actions">
                    <button class="primary-button" data-action="stay">Stay and continue</button>
                    <button class="secondary-button" data-action="save">Save draft and continue</button>
                    <button class="secondary-button" data-action="discard">Discard changes</button>
                </div>
            </div>
        `;

        documentRef.body.appendChild(dialog);
        dialog.showModal();

        dialog.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            if (!action) return;

            dialog.close();
            documentRef.body.removeChild(dialog);

            if (action === 'stay') return;
            if (action === 'save') {
                sellerUI?.saveDraft?.();
            }
            clearChanged();
            if (onConfirm) onConfirm();
        });

        dialog.addEventListener('cancel', () => {
            documentRef.body.removeChild(dialog);
        });
    }

    function exit() {
        setPrimaryView('marketplace');
        workspace.hidden = true;
        clearChanged();
        currentStep = 1;
        promotionTier = 'standard';
        formValues = {};

        const main = documentRef.getElementById('marketplace-main');
        if (main) main.focus();
    }

    function enterStep(newStep) {
        if (hasChanged()) {
            showLeaveDialog(() => goToStep(newStep));
        } else {
            goToStep(newStep);
        }
    }

    function setupNavigation() {
        // Step 1 controls
        const btn1Next = workspace.querySelector('#seller-step-1-next');
        const btnCancel = workspace.querySelector('#seller-cancel');

        // BATCH 4: Only allow next if form is valid
        if (btn1Next) {
            btn1Next.onclick = () => {
                if (!isFormValid()) return;
                clearChanged();
                recordEvent?.('step1_completed');
                goToStep(2);
                recordEvent?.('promotion_step_viewed');
            };
        }

        if (btnCancel) btnCancel.onclick = () => {
            if (hasChanged()) showLeaveDialog(exit);
            else exit();
        };

        // Step 2 controls
        const btn2Back = workspace.querySelector('#seller-step-2-back');
        const btn2Next = workspace.querySelector('#seller-step-2-next');

        if (btn2Back) btn2Back.onclick = () => goToStep(1);
        if (btn2Next) btn2Next.onclick = () => {
            recordEvent?.('promotion_tier_selected', { tier: promotionTier });
            goToStep(3);
            renderReviewPreview();
        };

        // Step 3 controls
        const btn3Back = workspace.querySelector('#step3-back');
        const btn3Draft = workspace.querySelector('#step3-save-draft');
        const btn3Publish = workspace.querySelector('#step3-publish');

        if (btn3Back) btn3Back.onclick = () => goToStep(1);
        if (btn3Draft) btn3Draft.onclick = () => {
            sellerUI?.saveDraft?.();
            recordEvent?.('draft_saved');
        };
        if (btn3Publish) btn3Publish.onclick = () => {
            sellerUI?.handlePublish?.();
        };
        const done = workspace.querySelector('#seller-publish-done');
        if (done) done.onclick = exit;

        // Back button
        const backBtn = workspace.querySelector('.sell-workspace-back');
        if (backBtn) {
            backBtn.onclick = () => {
                if (hasChanged()) showLeaveDialog(exit);
                else exit();
            };
        }

        // BATCH 5: Promo tier selection
        const promoInputs = workspace.querySelectorAll('input[name="promotionTier"]');
        promoInputs.forEach(input => {
            input.onchange = (e) => { promotionTier = e.target.value; };
        });

        // BATCH 7: Checklist change listener
        const checklist = workspace.querySelector('.review-checklist');
        if (checklist) {
            checklist.addEventListener('change', updatePublishButtonState);
        }
    }

    function setupFormTracking() {
        if (!form) return;
        const inputs = form.querySelectorAll('input, select, textarea');
        inputs.forEach(inp => {
            inp.addEventListener('change', markChanged);
            inp.addEventListener('input', markChanged);
        });
    }

    function open(draftId) {
        setPrimaryView('sell');
        workspace.hidden = false;
        currentStep = 1;
        clearChanged();
        promotionTier = 'standard';
        formValues = {};

        // Note: sellerUI.openForm() must NOT be called here
        // because openForm() is what triggered this open() call.
        // The form is already initialized and visible.

        const success = workspace.querySelector('#seller-publish-success');
        if (success) success.hidden = true;
        const actions = workspace.querySelector('#step3-publish')?.parentElement;
        if (actions) actions.hidden = false;
        updateUI();
        setFocus();

        // BATCH 4: Initial validation check
        setTimeout(updateNextButtonState, 100);
    }

    setupFormTracking();
    setupNavigation();

    return Object.freeze({
        open,
        exit,
        close: exit,
        isOpen: () => !workspace.hidden,
        goToStep,
        getCurrentStep: () => currentStep,
        hasChanged,
        getPromotionTier: () => promotionTier,
        collectFormValues,
        getFormValues: () => ({ ...formValues }),
        showSubmissionSuccess() {
            const success = workspace.querySelector('#seller-publish-success');
            if (success) success.hidden = false;
            const actions = workspace.querySelector('#step3-publish')?.parentElement;
            if (actions) actions.hidden = true;
            clearChanged();
        }
    });
}
