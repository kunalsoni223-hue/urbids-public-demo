export function renderTransactionTimeline(container, stages, documentRef = document) {
    container.replaceChildren();
    container.hidden = stages.length === 0;
    if (!stages.length) return;

    const list = documentRef.createElement('ol');
    list.className = 'transaction-timeline';
    list.setAttribute('aria-label', 'Transaction progress');
    stages.forEach(stage => {
        const item = documentRef.createElement('li');
        item.dataset.state = stage.state;
        if (stage.state === 'current') item.setAttribute('aria-current', 'step');
        item.textContent = stage.label;
        list.append(item);
    });
    container.append(list);
}
