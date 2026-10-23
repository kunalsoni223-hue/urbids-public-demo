let storageProblemHandler = () => {};

export function setStorageProblemHandler(handler) {
    if (typeof handler !== 'function') throw new TypeError('Storage problem handler must be a function');
    storageProblemHandler = handler;
}

function reportStorageProblem(key, error) {
    console.warn(`Browser storage could not process ${key}.`, error);
    storageProblemHandler({ key, error });
}

export function readJSON(key, fallback, validate = () => true) {
    try {
        const storedValue = localStorage.getItem(key);
        if (storedValue === null) return fallback;

        const value = JSON.parse(storedValue);
        if (validate(value)) return value;
        reportStorageProblem(key, 'Unexpected saved-data format');
        return fallback;
    } catch (error) {
        reportStorageProblem(key, error);
        return fallback;
    }
}

export function readArray(key) {
    return readJSON(key, [], Array.isArray);
}

export function readRecord(key) {
    return readJSON(key, {}, value => value !== null && typeof value === 'object' && !Array.isArray(value));
}

export function writeJSON(key, value) {
    try {
        const serializedValue = JSON.stringify(value);
        if (serializedValue === undefined) throw new TypeError('Cannot store an undefined value');
        localStorage.setItem(key, serializedValue);
        return true;
    } catch (error) {
        reportStorageProblem(key, error);
        return false;
    }
}

export function removeStoredValue(key) {
    try {
        localStorage.removeItem(key);
        return true;
    } catch (error) {
        reportStorageProblem(key, error);
        return false;
    }
}