/** DC amount to a USD string (100,000 DC = $1). */
export const dcToUsd = (dc) => (dc / 100_000).toFixed(2);
