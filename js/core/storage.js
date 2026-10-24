import { PROTOTYPE_STORAGE_SCHEMA_VERSION, STORAGE_KEYS } from './constants.js';
import { normalizeStorageSchemaVersion } from './normalization.js';

let storageProblemHandler = () => {};
const urbidsStorageKeys = new Set(Object.values(STORAGE_KEYS));
let externalStorageChangeDetected = false;

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
    if (externalStorageChangeDetected) return false;
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
    if (externalStorageChangeDetected) return false;
    try {
        localStorage.removeItem(key);
        return true;
    } catch (error) {
        reportStorageProblem(key, error);
        return false;
    }
}

export function initializePrototypeStorageSchema() {
    const key = STORAGE_KEYS.schemaVersion;
    const savedVersion = normalizeStorageSchemaVersion(readJSON(key, 0));
    if (savedVersion > PROTOTYPE_STORAGE_SCHEMA_VERSION) {
        reportStorageProblem(key, 'This prototype data uses a newer storage schema.');
        return false;
    }
    if (savedVersion === PROTOTYPE_STORAGE_SCHEMA_VERSION) return true;
    return writeJSON(key, PROTOTYPE_STORAGE_SCHEMA_VERSION);
}

export function subscribeToStorageChanges(handler, windowRef = globalThis.window) {
    if (typeof handler !== 'function') throw new TypeError('Storage change handler must be a function');
    if (!windowRef?.addEventListener) return () => {};
    const onStorage = event => {
        if (event.key === null || urbidsStorageKeys.has(event.key)) {
            externalStorageChangeDetected = true;
            handler({ key: event.key });
        }
    };
    windowRef.addEventListener('storage', onStorage);
    return () => {
        windowRef.removeEventListener('storage', onStorage);
        externalStorageChangeDetected = false;
    };
}