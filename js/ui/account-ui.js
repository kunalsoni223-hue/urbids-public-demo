import { AVATAR_COLORS, MEETUP_ATTENDANCE_STATUS, PROFILE_CONSTRAINTS, SERVICE_ERROR_CODE } from '../core/constants.js';
import { formatCurrency, formatTimeRemaining } from '../core/formatting.js';
import { deriveInitials } from '../core/validation.js';
import { renderTransactionTimeline } from './transaction-timeline-ui.js';

const SECTIONS = ['activity', 'profile', 'details'];
const SECTION_LABELS = { activity: 'My Activity', profile: 'Profile and reviews', details: 'Account details' };
const ACTIVITY_TABS = [['overview', 'Overview'], ['buying', 'Buying'], ['selling', 'Selling'], ['watchlist', 'Watchlist'], ['history', 'History']];
const BUYING_FILTERS = [['active', 'Active bids'], ['purchases', 'Won and purchases'], ['offers', 'Second-chance offers']];
const SELLING_FILTERS = [['active', 'Active listings'], ['review', 'In review'], ['action', 'Needs seller action'], ['progress', 'Sale in progress'], ['sold', 'Sold']];
const WATCHLIST_FILTERS = [['all', 'All'], ['ending', 'Ending soon'], ['price', 'Price drops'], ['relisted', 'Relisted']];
const WATCHLIST_FLAGS = { ending: 'Ending soon', price: 'Price changed', relisted: 'Relisted' };
const HISTORY_FILTERS = [['all', 'All'], ['purchases', 'Purchases'], ['sales', 'Sales'], ['cancelled', 'Cancelled'], ['resolved', 'Resolved issues']];
const REVIEW_FILTERS = [['all', 'All'], ['seller', 'As seller'], ['buyer', 'As buyer']];
const UNAVAILABLE_CAPABILITIES = ['Email verification', 'Phone verification', 'Password', 'Government identification', 'KYC', 'Bank account', 'Payment methods', 'Payout details'];

export function createAccountUI({ documentRef = document, state, activityService, profileService, onAction, onOpenListing, onRecordMeetupAttendance, onReportMeetupNoShow, onResumeBuyer, onProfileChanged }) {
    const { userService, listingStates } = state;
    const windowRef = documentRef.defaultView;
    const body = documentRef.body;
    const accountArea = documentRef.getElementById('account-area');
    const publicView = documentRef.getElementById('public-profile-view');
    const panel = documentRef.getElementById('account-panel');
    const heading = documentRef.getElementById('account-heading');
    const sectionTabs = Array.from(documentRef.querySelectorAll('#account-sections [role="tab"]'));
    const liveRegion = documentRef.getElementById('account-live');
    const ui = { section: 'activity', tab: 'overview', buying: 'active', selling: 'active', watchlist: 'all', history: 'all', reviews: 'all' };
    const publicUi = { userId: null, listingId: null, from: 'marketplace', reviews: 'all' };
    let view = 'marketplace';
    let returnTarget = null;
    let savedScroll = 0;
    let pushed = false;
    let renderedUserId = null;
    let detailsStatus = '';
    let afterLeave = null;

    function el(tag, className, text) {
        const node = documentRef.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function button(label, className, onClick, focusKey) {
        const node = el('button', className, label);
        node.type = 'button';
        if (focusKey) node.dataset.focusKey = focusKey;
        node.addEventListener('click', onClick);
        return node;
    }

    function avatar(user, className = '') {
        const node = el('span', `account-avatar ${className}`.trim(), user.initials);
        node.dataset.avatarColor = user.avatarColor || 'default';
        node.setAttribute('aria-hidden', 'true');
        return node;
    }

    function announce(message) {
        liveRegion.textContent = '';
        windowRef.setTimeout(() => { liveRegion.textContent = message; }, 30);
    }

    function formatDate(value) {
        const time = Date.parse(value);
        return Number.isFinite(time)
            ? new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date unavailable';
    }

    function formatWhen(value) {
        const time = Date.parse(value);
        return Number.isFinite(time)
            ? new Date(time).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    }

    // Roving-tabindex tablist with arrow-key navigation and automatic activation.
    function bindTablist(tablist, onSelect) {
        tablist.addEventListener('keydown', event => {
            const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
            const index = tabs.indexOf(documentRef.activeElement);
            if (index < 0) return;
            const target = { ArrowRight: tabs[(index + 1) % tabs.length], ArrowLeft: tabs[(index - 1 + tabs.length) % tabs.length], Home: tabs[0], End: tabs.at(-1) }[event.key];
            if (!target) return;
            event.preventDefault();
            target.focus();
            onSelect(target);
        });
    }

    function filterGroup(label, options, selected, counts, onSelect, keyPrefix) {
        const group = el('div', 'account-filters');
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', label);
        options.forEach(([id, text]) => {
            const node = button(counts && counts[id] !== undefined ? `${text} (${counts[id]})` : text, 'account-filter', () => onSelect(id), `${keyPrefix}-${id}`);
            node.setAttribute('aria-pressed', String(id === selected));
            group.append(node);
        });
        return group;
    }

    function listingButton(row) {
        const exists = listingStates.has(row.listing.id);
        const title = el('button', 'account-card-title', row.listing.title);
        title.type = 'button';
        title.disabled = !exists;
        if (exists) title.addEventListener('click', () => onOpenListing(row.listing.id));
        return title;
    }

    function metaChips(row) {
        const chips = [];
        if (row.currentBid !== undefined) chips.push(`${row.live === false && row.format === 'Buy Now' ? 'Price' : 'Current bid'} ${formatCurrency(row.currentBid)}`);
        if (row.bidCount !== undefined && row.format !== 'Buy Now') chips.push(`${row.bidCount} ${row.bidCount === 1 ? 'bid' : 'bids'}`);
        if (row.watcherCount !== undefined) chips.push(`${row.watcherCount} ${row.watcherCount === 1 ? 'watcher' : 'watchers'}`);
        if (row.endsAt !== undefined && row.format !== 'Buy Now') chips.push(row.live ? `${formatTimeRemaining(row.endsAt)} left` : 'Ended');
        if (row.format) chips.push(row.format);
        if (row.leading !== undefined) chips.push(row.leading ? 'You are leading' : 'You have been outbid');
        if (row.privateMax) chips.push(`Your maximum (private) ${formatCurrency(row.privateMax)}`);
        const list = el('ul', 'account-chips');
        chips.forEach(chip => list.append(el('li', '', chip)));
        return list;
    }

    function meetupActions(row, item) {
        row.actions.forEach(({ type, label }) => {
            item.append(button(label, 'account-action', () => {
                if (type === 'record-arrived' || type === 'record-no-show') {
                    onRecordMeetupAttendance(row.meetup.id, type === 'record-arrived' ? MEETUP_ATTENDANCE_STATUS.arrived : MEETUP_ATTENDANCE_STATUS.noShow);
                    render();
                } else if (type === 'report-no-show') {
                    const result = onReportMeetupNoShow(row.meetup.id);
                    render();
                    if (result?.code === SERVICE_ERROR_CODE.attendanceConflict) onOpenListing(row.meetup.listingId);
                } else if (type === 'continue-inspection') {
                    onResumeBuyer(row.meetup.listingId);
                }
            }));
        });
    }

    function renderRow(row) {
        const item = el('li', 'account-card');
        item.append(listingButton(row));
        if (row.status) item.append(el('p', 'account-card-status', row.status));
        if (row.currentBid !== undefined || row.format) item.append(metaChips(row));
        if (row.indicators?.length) {
            const flags = el('ul', 'account-chips account-flags');
            row.indicators.forEach(flag => flags.append(el('li', '', flag)));
            item.append(flags);
        }
        if (row.timeline?.length) {
            const timeline = el('div', 'activity-transaction-timeline');
            renderTransactionTimeline(timeline, row.timeline, documentRef);
            item.append(timeline);
        }
        if (row.actions) meetupActions(row, item);
        else if (row.action && row.actionLabel && listingStates.has(row.listing.id)) {
            item.append(button(row.actionLabel, 'account-action', () => onAction(row.listing.id, row)));
        }
        return item;
    }

    function list(rows, emptyText, renderItem = renderRow) {
        if (!rows.length) return el('p', 'account-empty', emptyText);
        const node = el('ul', 'account-list');
        rows.forEach(row => node.append(renderItem(row)));
        return node;
    }

    function section(title, ...children) {
        const node = el('section', 'account-section');
        node.append(el('h3', '', title), ...children);
        return node;
    }

    function renderUpcomingItem(item) {
        const row = el('li', 'account-card');
        row.append(el('p', 'account-card-status', item.label));
        const title = el('button', 'account-card-title', item.listing.title);
        title.type = 'button';
        title.addEventListener('click', () => onOpenListing(item.listing.id));
        row.append(title, el('p', 'account-card-status', [item.at ? formatWhen(item.at) : '', item.detail].filter(Boolean).join(' · ')));
        return row;
    }

    function renderRecentItem(notification) {
        const row = el('li', 'account-card');
        row.append(el('strong', 'account-card-title-text', notification.title), el('p', 'account-card-status', notification.message),
            el('p', 'account-card-status', formatWhen(notification.createdAt)));
        if (listingStates.has(notification.listingId)) row.append(button('View listing', 'account-action', () => onOpenListing(notification.listingId)));
        return row;
    }

    function renderOverview(data, target) {
        target.append(
            section('Needs attention', list(data.overview.needsAttention, 'No actions need your attention right now.')),
            section('Upcoming', list(data.overview.upcoming, 'Nothing scheduled yet.', renderUpcomingItem)),
            section('Recent activity', list(data.overview.recent, 'No recent activity yet.', renderRecentItem))
        );
    }

    function renderFiltered(options, selected, counts, key, onSelect, panelTitle, target) {
        target.append(filterGroup(panelTitle, options, selected, counts, onSelect, key));
    }

    function renderBuying(data, target) {
        const sets = { active: data.buying.activeBids, purchases: data.buying.purchases, offers: data.buying.offers };
        const empty = { active: 'No active bids.', purchases: 'No won auctions or purchases yet.', offers: 'No second-chance offers.' };
        renderFiltered(BUYING_FILTERS, ui.buying, Object.fromEntries(Object.entries(sets).map(([id, rows]) => [id, rows.length])), 'buying',
            id => { ui.buying = id; render(); }, 'Buying views', target);
        target.append(list(sets[ui.buying], empty[ui.buying]));
    }

    function renderSelling(data, target) {
        const sets = { active: data.selling.active, review: data.selling.inReview, action: data.selling.needsAction, progress: data.selling.inProgress, sold: data.selling.sold };
        const empty = { active: 'No active listings.', review: 'No listings are in review.', action: 'No seller actions needed.', progress: 'No sales awaiting the buyer.', sold: 'No completed sales yet.' };
        const summary = data.sellerSummary;
        target.append(el('p', 'account-summary', `${summary.activeListings} live · ${summary.soldItems} sold · ${summary.sellThroughRate}% auction sell-through · ${summary.averageRating.toFixed(1)} average rating`));
        renderFiltered(SELLING_FILTERS, ui.selling, Object.fromEntries(Object.entries(sets).map(([id, rows]) => [id, rows.length])), 'selling',
            id => { ui.selling = id; render(); }, 'Selling views', target);
        target.append(list(sets[ui.selling], empty[ui.selling]));
    }

    function renderWatchlist(data, target) {
        const matches = id => id === 'all' ? data.watchlist : data.watchlist.filter(row => row.indicators.includes(WATCHLIST_FLAGS[id]));
        renderFiltered(WATCHLIST_FILTERS, ui.watchlist, Object.fromEntries(WATCHLIST_FILTERS.map(([id]) => [id, matches(id).length])), 'watch',
            id => { ui.watchlist = id; render(); }, 'Watchlist filters', target);
        target.append(list(matches(ui.watchlist), ui.watchlist === 'all' ? 'Your watchlist is empty.' : 'No watched items match this filter.'));
    }

    function renderHistoryRow(row) {
        const item = el('li', 'account-card history-row');
        item.append(listingButton(row));
        const fields = el('dl', 'account-fields');
        [['Role', row.role], ['Amount', row.amount === null ? 'Not applicable' : formatCurrency(row.amount)], ['Outcome', row.outcome],
            ['Counterparty', row.counterparty], ['Date', row.dateValue ? formatDate(row.dateValue) : 'Date unavailable'], ['Rating', row.ratingStatus]]
            .forEach(([term, value]) => {
                const group = el('div');
                group.append(el('dt', '', term), el('dd', '', value));
                fields.append(group);
            });
        item.append(fields);
        if (listingStates.has(row.listing.id)) item.append(button('View transaction', 'account-action', () => onOpenListing(row.listing.id)));
        return item;
    }

    function renderHistory(data, target) {
        const matches = id => id === 'all' ? data.history : data.history.filter(row => row.kinds.includes(id));
        renderFiltered(HISTORY_FILTERS, ui.history, Object.fromEntries(HISTORY_FILTERS.map(([id]) => [id, matches(id).length])), 'history',
            id => { ui.history = id; render(); }, 'History filters', target);
        target.append(list(matches(ui.history), 'Nothing in your history yet.', renderHistoryRow));
    }

    function renderActivity() {
        const data = activityService.getForUser(userService.getCurrentUser().id);
        panel.replaceChildren();
        const tablist = el('div', 'account-subtabs');
        tablist.setAttribute('role', 'tablist');
        tablist.setAttribute('aria-label', 'My Activity views');
        ACTIVITY_TABS.forEach(([id, label]) => {
            const tab = el('button', 'account-subtab', label);
            tab.type = 'button';
            tab.id = `activity-tab-${id}`;
            tab.dataset.tab = id;
            tab.dataset.focusKey = `tab-${id}`;
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', String(id === ui.tab));
            tab.setAttribute('aria-controls', 'activity-tabpanel');
            tab.tabIndex = id === ui.tab ? 0 : -1;
            if (id === 'overview' && data.overview.needsAttention.length) {
                const badge = el('span', 'account-count', String(data.overview.needsAttention.length));
                badge.setAttribute('aria-label', `${data.overview.needsAttention.length} need attention`);
                tab.append(' ', badge);
            }
            tablist.append(tab);
        });
        const select = tab => { ui.tab = tab.dataset.tab; replaceHistoryState(); render(); };
        tablist.addEventListener('click', event => {
            const tab = event.target.closest('[role="tab"]');
            if (tab) select(tab);
        });
        bindTablist(tablist, select);
        const tabpanel = el('div', 'account-tabpanel');
        tabpanel.id = 'activity-tabpanel';
        tabpanel.setAttribute('role', 'tabpanel');
        tabpanel.setAttribute('aria-labelledby', `activity-tab-${ui.tab}`);
        ({ overview: renderOverview, buying: renderBuying, selling: renderSelling, watchlist: renderWatchlist, history: renderHistory })[ui.tab](data, tabpanel);
        panel.append(tablist, tabpanel);
    }

    function renderProfileContent(target, userId, { own, filter, keyPrefix, onReviewFilter }) {
        const profile = profileService.getPublicProfile(userId);
        if (!profile) {
            target.append(el('p', 'account-empty', 'This profile is not available.'));
            return;
        }
        const summary = profileService.getReviewSummary(userId, filter);
        const card = el('section', 'account-profile-card');
        card.setAttribute('aria-label', 'Public profile');
        card.append(avatar(profile, 'account-avatar-large'));
        const copy = el('div', 'account-profile-copy');
        copy.append(el('h2', '', profile.displayName), el('p', '', profile.location), el('p', '', `Member since ${profile.memberSince}`));
        card.append(copy);
        const facts = el('ul', 'account-chips');
        facts.append(el('li', '', `★ ${profile.rating.toFixed(1)} average rating`), el('li', '', `${profile.completedTransactions} completed transactions`));
        if (profile.resolvedNoShows > 0) facts.append(el('li', '', `${profile.resolvedNoShows} resolved seller no-show${profile.resolvedNoShows === 1 ? '' : 's'}`));
        copy.append(facts);
        if (own) {
            copy.append(el('p', 'account-card-status', 'This is how other users see your public profile.'));
            copy.append(button('Edit account details', 'secondary-button', () => setSection('details', { focus: true }), 'edit-details'));
        }

        const reputation = el('section', 'account-section');
        reputation.append(el('h3', '', 'Reputation and reviews'));
        const totals = el('p', 'account-summary', `★ ${summary.average.toFixed(1)} overall · ${summary.completedTransactions} completed transactions · ${summary.totalReviewCount} visible ${summary.totalReviewCount === 1 ? 'review' : 'reviews'}`);
        reputation.append(totals);
        if (summary.isSample) reputation.append(el('p', 'account-note', 'Showing a sample of prototype reviews. Sample reviews are fictional and do not cover every completed transaction.'));
        else reputation.append(el('p', 'account-note', 'Sample reviews are fictional prototype content.'));
        const maxCount = Math.max(1, ...summary.distribution.map(entry => entry.count));
        const distribution = el('ul', 'account-distribution');
        distribution.setAttribute('aria-label', 'Rating distribution for the reviews shown');
        summary.distribution.forEach(({ stars, count }) => {
            const row = el('li');
            const bar = el('span', 'account-meter');
            bar.setAttribute('aria-hidden', 'true');
            const fill = el('span', 'account-bar-fill');
            fill.style.width = `${Math.round(count / maxCount * 100)}%`;
            bar.append(fill);
            row.append(el('span', 'account-bar-label', `${stars} ${stars === 1 ? 'star' : 'stars'}`), bar, el('span', 'account-bar-count', String(count)));
            distribution.append(row);
        });
        reputation.append(distribution);
        reputation.append(filterGroup('Filter reviews', REVIEW_FILTERS, filter, null, onReviewFilter, `${keyPrefix}-filter`));
        reputation.append(el('p', 'account-card-status', `${summary.reviewCount} ${summary.reviewCount === 1 ? 'review' : 'reviews'} shown`));
        reputation.append(list(summary.reviews, 'No reviews for this filter yet.', review => {
            const item = el('li', 'account-card review-card');
            const stars = el('p', 'review-stars', `${'★'.repeat(review.score)}${'☆'.repeat(5 - review.score)}`);
            stars.setAttribute('aria-label', `${review.score} out of 5 stars`);
            item.append(stars);
            if (review.comment) item.append(el('p', 'review-comment', review.comment));
            item.append(el('p', 'account-card-status', `${review.role === 'seller' ? 'As seller' : 'As buyer'} · ${review.productTitle}`),
                el('p', 'account-card-status', `${review.reviewerName} · ${formatDate(review.date)}`),
                el('span', 'review-badge', review.sample ? 'Sample review (fictional)' : 'Prototype rating'));
            return item;
        }));

        const listings = section('Active public listings', list(profile.activeListings, 'No active public listings.', listing => {
            const item = el('li', 'account-card');
            const title = el('button', 'account-card-title', listing.title);
            title.type = 'button';
            title.addEventListener('click', () => onOpenListing(listing.id));
            item.append(title, el('p', 'account-card-status', `${listing.listingFormat === 'buy_now' ? 'Price' : 'Current bid'} ${formatCurrency(listing.listingFormat === 'buy_now' ? listing.buyNowPrice : listing.currentBid)}${listing.listingFormat === 'buy_now' ? '' : ` · ${formatTimeRemaining(listing.auctionEndsAt)} left`}`));
            return item;
        }));
        target.append(card, reputation, listings);
    }

    function renderProfileSection() {
        panel.replaceChildren();
        renderProfileContent(panel, userService.getCurrentUser().id, {
            own: true,
            filter: ui.reviews,
            keyPrefix: 'own',
            onReviewFilter: id => { ui.reviews = id; render(); }
        });
    }

    function renderDetailsSection() {
        const user = userService.getCurrentUser();
        panel.replaceChildren();
        renderedUserId = user.id;
        const form = el('form', 'account-form');
        form.noValidate = true;
        const nameId = 'account-display-name';
        const field = (id, labelText, control, hint) => {
            const wrap = el('div', 'account-field');
            const label = el('label', '', labelText);
            label.htmlFor = id;
            const describedBy = [];
            if (hint) { const hintNode = el('p', 'account-hint', hint); hintNode.id = `${id}-hint`; describedBy.push(hintNode.id); wrap.append(label, control, hintNode); } else wrap.append(label, control);
            const error = el('p', 'account-error');
            error.id = `${id}-error`;
            error.hidden = true;
            wrap.append(error);
            control.dataset.errorId = error.id;
            control.dataset.describedBy = describedBy.join(' ');
            control.setAttribute('aria-describedby', describedBy.join(' '));
            return wrap;
        };
        const nameInput = el('input');
        nameInput.id = nameId;
        nameInput.type = 'text';
        nameInput.required = true;
        nameInput.maxLength = PROFILE_CONSTRAINTS.maximumDisplayNameLength + 20;
        nameInput.autocomplete = 'off';
        nameInput.value = user.firstName;
        const initialsPreview = el('p', 'account-hint', `Initials: ${user.initials} (derived from the display name)`);
        const localitySelect = el('select');
        localitySelect.id = 'account-locality';
        const base = userService.getBaseUser(user.id);
        const localityValue = user.location.replace(', Mumbai', '');
        userService.getLocalityOptions(base.id).forEach(name => {
            const option = el('option', '', name);
            option.value = name;
            option.selected = name === localityValue;
            localitySelect.append(option);
        });
        nameInput.addEventListener('input', () => {
            const clean = nameInput.value.replace(/<[^>]*>/g, '').replace(/[<>&"`]/g, '').replace(/\s+/g, ' ').trim();
            initialsPreview.textContent = `Initials: ${clean ? deriveInitials(clean) : '—'} (derived from the display name)`;
        });

        const colours = el('fieldset', 'account-colours');
        colours.append(el('legend', '', 'Avatar colour'));
        AVATAR_COLORS.forEach(colour => {
            const label = el('label', 'account-colour');
            const radio = el('input');
            radio.type = 'radio';
            radio.name = 'account-avatar-color';
            radio.value = colour.id;
            radio.checked = colour.id === user.avatarColor;
            const swatch = el('span', 'account-avatar account-colour-swatch', user.initials);
            swatch.dataset.avatarColor = colour.id;
            swatch.setAttribute('aria-hidden', 'true');
            label.append(radio, swatch, el('span', '', colour.label));
            colours.append(label);
        });

        const status = el('p', 'account-saved');
        status.hidden = !detailsStatus;
        status.textContent = detailsStatus;
        const save = el('button', 'primary-button', 'Save account details');
        save.type = 'submit';
        form.append(
            field(nameId, 'Display name', nameInput, `Up to ${PROFILE_CONSTRAINTS.maximumDisplayNameLength} characters. Shown on listings and your public profile.`),
            initialsPreview,
            field('account-locality', 'Mumbai locality', localitySelect, 'Approximate location only. Do not enter an exact address.'),
            colours, save, status
        );
        form.addEventListener('submit', event => {
            event.preventDefault();
            form.querySelectorAll('.account-error').forEach(node => { node.hidden = true; node.textContent = ''; });
            [nameInput, localitySelect].forEach(control => {
                control.removeAttribute('aria-invalid');
                control.setAttribute('aria-describedby', control.dataset.describedBy);
            });
            const result = userService.updateProfile(user.id, {
                displayName: nameInput.value,
                locality: localitySelect.value,
                avatarColor: form.querySelector('input[name="account-avatar-color"]:checked')?.value
            });
            if (!result.ok) {
                const errors = Object.keys(result.errors).length
                    ? result.errors : { displayName: 'Details could not be saved. Check browser storage and try again.' };
                const controls = { displayName: nameInput, locality: localitySelect, avatarColor: nameInput };
                let first = null;
                Object.entries(errors).forEach(([key, message]) => {
                    const control = controls[key];
                    const error = documentRef.getElementById(control.dataset.errorId);
                    error.textContent = message;
                    error.hidden = false;
                    control.setAttribute('aria-invalid', 'true');
                    control.setAttribute('aria-describedby', `${control.dataset.describedBy} ${error.id}`.trim());
                    first ||= control;
                });
                announce(Object.values(errors).join(' '));
                first.focus();
                return;
            }
            detailsStatus = 'Account details saved.';
            onProfileChanged();
            render({ force: true });
            announce(detailsStatus);
        });
        form.addEventListener('input', () => { detailsStatus = ''; });

        const readOnly = el('dl', 'account-fields account-readonly');
        [['Member since', String(user.memberSince)], ['Account status', 'Research prototype profile']].forEach(([term, value]) => {
            const group = el('div');
            group.append(el('dt', '', term), el('dd', '', value));
            readOnly.append(group);
        });
        const unavailable = el('ul', 'account-unavailable');
        UNAVAILABLE_CAPABILITIES.forEach(name => {
            const item = el('li');
            item.append(el('strong', '', name), el('span', '', 'Not available in this prototype.'));
            unavailable.append(item);
        });
        panel.append(
            section('Public details', form),
            section('Read-only', readOnly),
            section('Not available in this prototype', unavailable)
        );
    }

    function renderPublic() {
        const target = documentRef.getElementById('public-profile-content');
        target.replaceChildren();
        renderProfileContent(target, publicUi.userId, {
            own: false,
            filter: publicUi.reviews,
            keyPrefix: 'public',
            onReviewFilter: id => { publicUi.reviews = id; renderPublic(); }
        });
        const name = profileService.getPublicProfile(publicUi.userId)?.displayName;
        documentRef.getElementById('public-profile-heading').textContent = name ? `${name}'s profile` : 'Seller profile';
    }

    function render({ force = false } = {}) {
        if (view === 'profile') {
            const key = documentRef.activeElement?.dataset?.focusKey;
            renderPublic();
            if (key) documentRef.querySelector(`#public-profile-content [data-focus-key="${key}"]`)?.focus();
            return;
        }
        if (view !== 'account') return;
        const user = userService.getCurrentUser();
        documentRef.getElementById('account-user').textContent = `${user.firstName} · ${user.location}`;
        sectionTabs.forEach(tab => {
            const selected = tab.dataset.section === ui.section;
            tab.setAttribute('aria-selected', String(selected));
            tab.tabIndex = selected ? 0 : -1;
        });
        panel.setAttribute('aria-labelledby', `account-tab-${ui.section}`);
        if (ui.section === 'details' && !force && renderedUserId === user.id && panel.querySelector('.account-form')) return;
        const key = documentRef.activeElement?.dataset?.focusKey;
        ({ activity: renderActivity, profile: renderProfileSection, details: renderDetailsSection })[ui.section]();
        if (ui.section !== 'details') renderedUserId = null;
        if (key) panel.querySelector(`[data-focus-key="${key}"]`)?.focus();
    }

    function setView(next) {
        view = next;
        body.dataset.view = next;
        accountArea.hidden = next !== 'account';
        publicView.hidden = next !== 'profile';
    }

    function currentState() {
        return view === 'account'
            ? { urbidsView: 'account', section: ui.section, tab: ui.tab }
            : { urbidsView: 'profile', userId: publicUi.userId, listingId: publicUi.listingId };
    }

    function replaceHistoryState() {
        if (view === 'marketplace') return;
        windowRef.history.replaceState(currentState(), '', view === 'account' ? `#account/${ui.section}` : `#profile/${publicUi.userId}`);
    }

    function enter(next, focusTarget) {
        if (view === 'marketplace') {
            savedScroll = windowRef.scrollY;
            setView(next);
            windowRef.history.pushState(currentState(), '', next === 'account' ? `#account/${ui.section}` : `#profile/${publicUi.userId}`);
            pushed = true;
        } else {
            setView(next);
            replaceHistoryState();
        }
        windowRef.scrollTo({ top: 0, behavior: 'instant' });
        focusTarget.focus({ preventScroll: true });
    }

    function leave({ restore = true } = {}) {
        if (view === 'marketplace') return;
        setView('marketplace');
        pushed = false;
        if (restore) {
            windowRef.scrollTo({ top: savedScroll, behavior: 'instant' });
            const target = returnTarget?.isConnected ? returnTarget : documentRef.querySelector('#listings .section-title') || documentRef.getElementById('listings');
            if (target && !target.matches('a[href], button, input, select, textarea, summary, [tabindex]')) target.tabIndex = -1;
            target?.focus?.({ preventScroll: true });
        }
        const callback = afterLeave;
        afterLeave = null;
        callback?.();
    }

    function returnToMarketplace(callback = null) {
        afterLeave = callback;
        if (pushed) windowRef.history.back();
        else {
            windowRef.history.replaceState(null, '', windowRef.location.pathname + windowRef.location.search);
            leave();
        }
    }

    function setSection(section, { focus = false } = {}) {
        if (!SECTIONS.includes(section)) return;
        ui.section = section;
        if (view !== 'account') enter('account', heading);
        else replaceHistoryState();
        render({ force: true });
        if (focus) heading.focus({ preventScroll: true });
    }

    function openAccount(section = 'activity', trigger = null) {
        if (view === 'marketplace' && trigger) returnTarget = trigger;
        ui.section = SECTIONS.includes(section) ? section : 'activity';
        if (ui.section === 'details') detailsStatus = '';
        enter('account', heading);
        render({ force: true });
    }

    function openPublicProfile(userId, { listingId = null } = {}) {
        publicUi.userId = userId;
        publicUi.listingId = listingId;
        publicUi.from = view === 'account' ? 'account' : 'marketplace';
        publicUi.reviews = 'all';
        documentRef.getElementById('public-profile-back').textContent = listingId ? '← Back to listing' : '← Back to marketplace';
        const heading2 = documentRef.getElementById('public-profile-heading');
        if (view === 'marketplace') returnTarget = documentRef.getElementById('product-details-seller-reputation');
        enter('profile', heading2);
        renderPublic();
        heading2.focus({ preventScroll: true });
        // The product dialog's close handling can move focus after this call.
        windowRef.setTimeout(() => { if (view === 'profile') heading2.focus({ preventScroll: true }); }, 0);
    }

    sectionTabs.forEach(tab => tab.addEventListener('click', () => setSection(tab.dataset.section)));
    bindTablist(documentRef.getElementById('account-sections'), tab => setSection(tab.dataset.section));
    documentRef.getElementById('account-back').addEventListener('click', () => returnToMarketplace());
    documentRef.getElementById('public-profile-back').addEventListener('click', () => {
        const { listingId, from } = publicUi;
        if (from === 'account') {
            setSection(ui.section);
            if (listingId) onOpenListing(listingId);
            return;
        }
        returnToMarketplace(listingId ? () => onOpenListing(listingId) : null);
    });

    windowRef.addEventListener('popstate', () => {
        const saved = windowRef.history.state;
        if (saved?.urbidsView === 'account') {
            ui.section = SECTIONS.includes(saved.section) ? saved.section : 'activity';
            setView('account');
            render({ force: true });
        } else if (saved?.urbidsView === 'profile' && userService.getUser(saved.userId)) {
            publicUi.userId = saved.userId;
            publicUi.listingId = saved.listingId;
            setView('profile');
            renderPublic();
        } else leave();
    });

    // Header navigation and search leave the account view so marketplace targets are visible.
    documentRef.querySelector('.site-header').addEventListener('click', event => {
        if (view === 'marketplace') return;
        const target = event.target.closest('a[href^="#"], [data-discovery], #header-watchlist-toggle, #mobile-watchlist-toggle, #mobile-search-toggle');
        if (target && !target.closest('[data-account-section]')) {
            windowRef.history.replaceState(null, '', windowRef.location.pathname + windowRef.location.search);
            leave({ restore: false });
        }
    });
    documentRef.getElementById('listing-search-input').addEventListener('input', () => {
        if (view !== 'marketplace') leave({ restore: false });
    });

    function openFromLocation() {
        const match = windowRef.location.hash.match(/^#account\/(activity|profile|details)$/);
        if (!match) return;
        windowRef.history.replaceState(null, '', windowRef.location.pathname + windowRef.location.search);
        openAccount(match[1]);
    }

    return { render, openAccount, openFromLocation, openPublicProfile, closeAccount: returnToMarketplace, getView: () => view };
}
