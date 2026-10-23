export function createNotificationUI({ documentRef = document, notificationService, userService, activityService, dialogController, onNavigate = () => {} }) {
    const dialog = documentRef.getElementById('notification-dialog');
    const list = documentRef.getElementById('notification-list');
    const empty = documentRef.getElementById('notification-empty');
    const count = documentRef.getElementById('notification-unread-count');
    const trigger = documentRef.getElementById('notification-center-button');
    function render() {
        const userId = userService.getCurrentUser().id;
        const notifications = notificationService.getForUser(userId);
        const unreadCount = notificationService.getUnreadCount(userId);
        count.textContent = String(unreadCount);
        count.hidden = unreadCount === 0;
        trigger.setAttribute('aria-label', unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications');
        empty.hidden = notifications.length > 0;
        documentRef.getElementById('mark-notifications-read').disabled = unreadCount === 0;
        list.replaceChildren(...notifications.map(notification => {
            const item = documentRef.createElement('li');
            item.className = `notification-item${notification.readAt ? '' : ' is-unread'}`;
            const button = documentRef.createElement('button');
            button.type = 'button';
            button.className = 'notification-open';
            button.dataset.notificationId = notification.id;
            const title = documentRef.createElement('strong');
            title.textContent = notification.title;
            const message = documentRef.createElement('span');
            message.textContent = notification.message;
            const date = documentRef.createElement('time');
            date.dateTime = notification.createdAt;
            const createdAt = new Date(notification.createdAt);
            date.textContent = Number.isNaN(createdAt.getTime()) ? '' : createdAt.toLocaleString();
            button.append(title, message, date);
            const action = activityService.getPrimaryAction(notification.listingId, userId);
            const nextStep = documentRef.createElement('span');
            nextStep.textContent = action
                ? `Open listing · ${action.actionLabel}`
                : notification.listingId ? 'Open listing' : 'Open selling area';
            button.append(nextStep);
            item.append(button);
            return item;
        }));
    }

    trigger.addEventListener('click', () => {
        render();
        dialogController.open(dialog, trigger);
    });
    list.addEventListener('click', event => {
        const button = event.target.closest('button[data-notification-id]');
        if (!button) return;
        const userId = userService.getCurrentUser().id;
        const notification = notificationService.getForUser(userId).find(item => item.id === button.dataset.notificationId);
        if (!notification || !notificationService.markRead(notification.id, userId)) return;
        render();
        dialogController.close(dialog);
        onNavigate(notification);
    });
    documentRef.getElementById('mark-notifications-read').addEventListener('click', () => {
        notificationService.markAllRead(userService.getCurrentUser().id);
        render();
    });
    documentRef.getElementById('close-notifications').addEventListener('click', () => dialogController.close(dialog));

    render();
    return { render };
}