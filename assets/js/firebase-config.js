/**
 * Firebase Configuration — The Sandlot Tribune
 *
 * ⚠️  ONE-TIME SETUP REQUIRED FOR RUMBLR:
 *
 * 1. Go to Firebase Console (console.firebase.google.com) → project: sandlottribune
 * 2. Build → Firestore Database → Create database (Production mode, us-central1)
 * 3. Build → Authentication → Get started → Enable Email/Password provider
 * 4. Firestore → Rules → paste the rules from sandlottribune/rumblr/FIRESTORE_RULES.txt
 *
 * The Realtime Database (used for article ratings/comments) is unchanged.
 * ─────────────────────────────────────────────────────────
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getDatabase }   from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { getFirestore }  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getAuth }       from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const firebaseConfig = {
  apiKey:            "AIzaSyDpPG4MfoP7YjUzU7N5vh6TPdv_I0S6pgI",
  authDomain:        "sandlottribune.firebaseapp.com",
  projectId:         "sandlottribune",
  storageBucket:     "sandlottribune.firebasestorage.app",
  messagingSenderId: "746621553651",
  appId:             "1:746621553651:web:7b8633ac1ae9c30f0c6086",
  measurementId:     "G-MRD0QCSB4Z",
  databaseURL:       "https://sandlottribune-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);

export const db        = getDatabase(app);   // Realtime Database — article ratings/comments
export const firestore = getFirestore(app);  // Firestore — Rumblr posts & user accounts
export const auth      = getAuth(app);       // Auth — Rumblr user login
