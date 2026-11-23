import { AVATAR_COLORS, LOCAL_ACCOUNT_INTEREST, MUMBAI_LOCALITIES, PROFILE_CONSTRAINTS, USABILITY_EVENT_TYPE } from '../core/constants.js';
export function createAccountCreationDialog({ documentRef = document, localAccountService, dialogController, recordEvent = () => {} }) {
    const dialog = documentRef.createElement('dialog');
    dialog.id = 'account-creation-dialog';
    dialog.className = 'account-creation-dialog';

    const dialogContent = documentRef.createElement('div');
    dialogContent.className = 'account-creation-content';

    let isOpen = false;
    let returnAfterCreate = null;
    let submitting = false;
    let returnFocus = null;

    function closeDialog() {
        if (!isOpen) return;
        isOpen = false;
        dialogController.close(dialog);
    }

    function handleCancel() {
        if (!isOpen) return;
        recordEvent(USABILITY_EVENT_TYPE.accountCreationAbandoned);
        closeDialog();
        if (returnAfterCreate?.onCancel) returnAfterCreate.onCancel();
        returnAfterCreate = null;
    }

    function handleCreateAccount(e) {
        e.preventDefault();
        if (submitting) return;
        submitting = true;
        const submitButton = dialogContent.querySelector('button[type="submit"]');
        submitButton.disabled = true;

        const formData = new FormData(e.target);
        const displayName = String(formData.get('displayName') || '').trim();
        const locality = String(formData.get('locality') || '').trim();
        const interest = String(formData.get('interest') || '').trim();
        const avatarColor = String(formData.get('avatarColor') || 'default').trim();

        const displayNameField = dialogContent.querySelector('input[name="displayName"]');
        const localityField = dialogContent.querySelector('select[name="locality"]');
        const errorContainer = dialogContent.querySelector('.form-errors');

        const result = localAccountService.createLocalAccount({
            displayName,
            locality,
            interest,
            avatarColor
        });

        if (!result.ok) {
            if (errorContainer) {
                errorContainer.innerHTML = '';
                Object.entries(result.errors).forEach(([field, message]) => {
                    const errorEl = documentRef.createElement('div');
                    errorEl.className = 'error-message';
                    errorEl.textContent = message;
                    errorContainer.appendChild(errorEl);

                    if (field === 'displayName') displayNameField?.focus();
                    else if (field === 'locality') localityField?.focus();
                    else if (field === 'interest') dialogContent.querySelector('input[name="interest"]')?.focus();
                });
            }
            submitting = false;
            submitButton.disabled = false;
            return;
        }

        recordEvent(USABILITY_EVENT_TYPE.accountCreated, {
            metadata: { interest }
        });

        const onSuccess = returnAfterCreate?.onSuccess;
        returnAfterCreate = null;
        submitting = false;
        submitButton.disabled = false;
        closeDialog();
        onSuccess?.(result.data);
    }

    function renderForm() {
        const form = documentRef.createElement('form');
        form.className = 'account-creation-form';
        form.addEventListener('submit', handleCreateAccount);

        const heading = documentRef.createElement('h2');
        heading.className = 'account-creation-title';
        heading.textContent = 'Create your prototype account';
        form.appendChild(heading);

        const subtitle = documentRef.createElement('p');
        subtitle.className = 'account-creation-subtitle';
        subtitle.innerHTML = 'Prototype account • Stored only in this browser';
        form.appendChild(subtitle);

        const errorContainer = documentRef.createElement('div');
        errorContainer.className = 'form-errors';
        errorContainer.setAttribute('role', 'alert');
        errorContainer.setAttribute('aria-live', 'assertive');
        form.appendChild(errorContainer);

        const fieldsContainer = documentRef.createElement('div');
        fieldsContainer.className = 'account-creation-fields';

        const displayNameLabel = documentRef.createElement('label');
        displayNameLabel.textContent = 'Display name';
        const displayNameInput = documentRef.createElement('input');
        displayNameInput.type = 'text';
        displayNameInput.name = 'displayName';
        displayNameInput.required = true;
        displayNameInput.maxLength = PROFILE_CONSTRAINTS.maximumDisplayNameLength;
        displayNameInput.placeholder = 'Your name or nickname';
        displayNameLabel.appendChild(documentRef.createElement('br'));
        displayNameLabel.appendChild(displayNameInput);
        fieldsContainer.appendChild(displayNameLabel);

        const localityLabel = documentRef.createElement('label');
        localityLabel.textContent = 'Mumbai locality';
        const localitySelect = documentRef.createElement('select');
        localitySelect.name = 'locality';
        localitySelect.required = true;
        const defaultOption = documentRef.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = '—Choose a locality—';
        defaultOption.disabled = true;
        localitySelect.appendChild(defaultOption);
        MUMBAI_LOCALITIES.forEach(locality => {
            const option = documentRef.createElement('option');
            option.value = locality;
            option.textContent = locality;
            localitySelect.appendChild(option);
        });
        localityLabel.appendChild(documentRef.createElement('br'));
        localityLabel.appendChild(localitySelect);
        fieldsContainer.appendChild(localityLabel);

        const interestLabel = documentRef.createElement('fieldset');
        interestLabel.className = 'account-creation-fieldset';
        interestLabel.dataset.name = 'interest';
        const interestLegend = documentRef.createElement('legend');
        interestLegend.textContent = 'I\'m interested in';
        interestLabel.appendChild(interestLegend);

        const interestOptions = [
            { value: LOCAL_ACCOUNT_INTEREST.buying, label: 'Buying' },
            { value: LOCAL_ACCOUNT_INTEREST.selling, label: 'Selling' },
            { value: LOCAL_ACCOUNT_INTEREST.both, label: 'Both' }
        ];

        interestOptions.forEach(option => {
            const radioDiv = documentRef.createElement('div');
            radioDiv.className = 'radio-option';
            const radio = documentRef.createElement('input');
            radio.type = 'radio';
            radio.name = 'interest';
            radio.value = option.value;
            radio.required = true;
            const radioLabel = documentRef.createElement('label');
            radioLabel.htmlFor = `interest-${option.value}`;
            radioLabel.textContent = option.label;
            radio.id = `interest-${option.value}`;
            radioDiv.appendChild(radio);
            radioDiv.appendChild(radioLabel);
            interestLabel.appendChild(radioDiv);
        });
        fieldsContainer.appendChild(interestLabel);

        const avatarLabel = documentRef.createElement('label');
        avatarLabel.textContent = 'Avatar colour';
        const avatarSelect = documentRef.createElement('select');
        avatarSelect.name = 'avatarColor';
        AVATAR_COLORS.forEach(color => {
            const option = documentRef.createElement('option');
            option.value = color.id;
            option.textContent = color.label;
            if (color.id === 'default') option.selected = true;
            avatarSelect.appendChild(option);
        });
        avatarLabel.appendChild(documentRef.createElement('br'));
        avatarLabel.appendChild(avatarSelect);
        fieldsContainer.appendChild(avatarLabel);

        form.appendChild(fieldsContainer);

        const buttonContainer = documentRef.createElement('div');
        buttonContainer.className = 'account-creation-buttons';

        const createButton = documentRef.createElement('button');
        createButton.type = 'submit';
        createButton.className = 'button-primary';
        createButton.textContent = 'Create account';
        buttonContainer.appendChild(createButton);

        const cancelButton = documentRef.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'button-secondary';
        cancelButton.textContent = 'Cancel';
        cancelButton.addEventListener('click', handleCancel);
        buttonContainer.appendChild(cancelButton);

        form.appendChild(buttonContainer);
        return form;
    }

    const form = renderForm();
    dialogContent.appendChild(form);
    dialog.appendChild(dialogContent);
    dialog.addEventListener('close', () => { if (isOpen) handleCancel(); });
    documentRef.body.appendChild(dialog);

    return {
        show(returnConfig) {
            if (isOpen) return false;
            form.reset();
            dialogContent.querySelector('.form-errors').replaceChildren();
            dialogContent.querySelector('button[type="submit"]').disabled = false;
            submitting = false;
            recordEvent(USABILITY_EVENT_TYPE.accountCreationStarted);
            returnAfterCreate = returnConfig || {};
            returnFocus = returnConfig?.returnFocus || documentRef.activeElement;
            isOpen = true;
            dialogController.open(dialog, returnFocus);
            const displayNameInput = dialog.querySelector('input[name="displayName"]');
            if (displayNameInput) {
                setTimeout(() => displayNameInput.focus(), 0);
            }
            return true;
        },

        close() {
            closeDialog();
        },

        isOpen() {
            return isOpen;
        }
    };
}
