/**
 * Joins class names, filtering out falsy values
 * @param {...(string|boolean|undefined|null)} classes
 * @returns {string}
 */
export const classNames = (...classes) => classes.filter(Boolean).join(" ");
