/**
 * Joins class names, filtering out falsy values
 * @param {...(string|boolean|undefined|null)} classes
 * @returns {string}
 */
export const classNames = (...classes) => classes.filter(Boolean).join(" ");

/** Format as USD currency (e.g. "$1,234.56") */
export const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

/** Format plain numbers with commas (e.g. "1,234,567") */
export const numberFormatter = new Intl.NumberFormat("en-US");

/**
 * Safe localStorage helpers to handle private browsing mode
 * where localStorage may throw exceptions
 */

/**
 * Safely get an item from localStorage
 * @param {string} key - The key to retrieve
 * @returns {string|null} The value or null if not found or error occurs
 */
export const getLocalStorageItem = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

/**
 * Safely set an item in localStorage
 * @param {string} key - The key to set
 * @param {string} value - The value to store
 */
export const setLocalStorageItem = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore errors in private browsing mode
  }
};

/**
 * Safely remove an item from localStorage
 * @param {string} key - The key to remove
 */
export const removeLocalStorageItem = (key) => {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore errors in private browsing mode
  }
};
