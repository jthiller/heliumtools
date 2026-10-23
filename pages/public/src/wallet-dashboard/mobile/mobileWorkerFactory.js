// Keep Vite's worker entry separate from main-thread lifecycle logic so
// lifecycle tests can substitute a Worker without loading the worker runtime.
export { default } from "./mobileWorker.js?worker";
