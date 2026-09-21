import { initializeApp } from 'firebase-admin/app';

// Initialise once — all modules share this default app.
initializeApp();

export * from './calendar';
export * from './publicGigs';
export * from './payments';
