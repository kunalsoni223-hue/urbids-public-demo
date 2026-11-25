export function createSellRouting({ documentRef, sellerUI, getWorkspace, getAccountUI }) {
    const windowRef = documentRef.defaultView;
    let restoring = false;

    function setPrimaryView(view) {
        documentRef.body.dataset.view = view;
        if (view === 'marketplace' && !restoring && windowRef.location.hash === '#sell') {
            if (windowRef.history.state?.urbidsView === 'sell') windowRef.history.back();
            else windowRef.history.replaceState(null, '', windowRef.location.pathname + windowRef.location.search);
        }
    }

    function openSell(trigger, fromLocation = false) {
        const open = () => {
            if (!fromLocation && windowRef.location.hash !== '#sell') {
                windowRef.history.pushState({ urbidsView: 'sell' }, '', '#sell');
            }
            sellerUI.openForm();
            windowRef.scrollTo({ top: 0, behavior: 'instant' });
        };
        if (getAccountUI().requireLocalAccount(open, trigger)) open();
    }

    function start() {
        documentRef.addEventListener('click', event => {
            const trigger = event.target.closest('a[href="#sell"], #start-listing-button');
            if (!trigger) return;
            event.preventDefault();
            openSell(trigger);
        });
        windowRef.addEventListener('popstate', () => {
            restoring = true;
            if (windowRef.location.hash === '#sell') openSell(documentRef.getElementById('start-listing-button'), true);
            else if (getWorkspace().isOpen()) {
                getWorkspace().exit();
                documentRef.body.dataset.view = getAccountUI().getView();
            }
            restoring = false;
        });
        if (windowRef.location.hash === '#sell') openSell(documentRef.getElementById('start-listing-button'), true);
    }

    return { start, setPrimaryView };
}
