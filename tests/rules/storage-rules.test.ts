/**
 * Storage security rules tests.
 *
 * REQUIRES: Firestore + Auth + Storage emulators running.
 *   firebase emulators:start --only firestore,auth,storage
 *
 * Run via: npm run test:rules
 */

import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ref, uploadBytes, getBytes } from 'firebase/storage';
import { UID } from '../seed';

const PROJECT_ID      = 'gigmatchweb-aus-test-storage';
const RULES_PATH      = resolve(__dirname, '../../storage.rules');
const FIRESTORE_RULES = resolve(__dirname, '../../firestore.rules');

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(FIRESTORE_RULES, 'utf8'),
      host:  'localhost',
      port:  8080,
    },
    storage: {
      rules: readFileSync(RULES_PATH, 'utf8'),
      host:  'localhost',
      port:  9199,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function storage(uid: string) {
  return testEnv.authenticatedContext(uid).storage();
}
function unauthStorage() {
  return testEnv.unauthenticatedContext().storage();
}

function pdfBytes(sizeBytes: number): Uint8Array {
  // Fake PDF: starts with %PDF header, padded to requested size
  const buf = new Uint8Array(sizeBytes);
  buf[0] = 0x25; buf[1] = 0x50; buf[2] = 0x44; buf[3] = 0x46; // %PDF
  return buf;
}

const MB = 1024 * 1024;

// ── gigDocs ───────────────────────────────────────────────────────────────────

test('gigDocs — artistA reads own file', async () => {
  // Seed a file for artistA
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(
      ref(ctx.storage(), `gigDocs/${UID.artistA}/enq1/existing.pdf`),
      pdfBytes(1024),
      { contentType: 'application/pdf' },
    );
  });

  await assertSucceeds(
    getBytes(ref(storage(UID.artistA), `gigDocs/${UID.artistA}/enq1/existing.pdf`))
  );
});

test('gigDocs — artistA writes a PDF file (19 MB, valid)', async () => {
  await assertSucceeds(
    uploadBytes(
      ref(storage(UID.artistA), `gigDocs/${UID.artistA}/enq1/x.pdf`),
      pdfBytes(19 * MB),
      { contentType: 'application/pdf' },
    )
  );
});

test('gigDocs — artistA denied: read artistB file', async () => {
  // Seed a file for artistB
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(
      ref(ctx.storage(), `gigDocs/${UID.artistB}/enq1/b.pdf`),
      pdfBytes(1024),
      { contentType: 'application/pdf' },
    );
  });

  await assertFails(
    getBytes(ref(storage(UID.artistA), `gigDocs/${UID.artistB}/enq1/b.pdf`))
  );
});

test('gigDocs — unauthenticated denied: read', async () => {
  await assertFails(
    getBytes(ref(unauthStorage(), `gigDocs/${UID.artistA}/enq1/x.pdf`))
  );
});

test('gigDocs — 21 MB file denied (exceeds 20 MB limit)', async () => {
  await assertFails(
    uploadBytes(
      ref(storage(UID.artistA), `gigDocs/${UID.artistA}/enq1/toolarge.pdf`),
      pdfBytes(21 * MB),
      { contentType: 'application/pdf' },
    )
  );
});

test('gigDocs — .exe denied (application/x-msdownload)', async () => {
  await assertFails(
    uploadBytes(
      ref(storage(UID.artistA), `gigDocs/${UID.artistA}/enq1/malware.exe`),
      new Uint8Array(1024),
      { contentType: 'application/x-msdownload' },
    )
  );
});
