/**
 * Firebase Configuration — The Sandlot Tribune
 *
 * ⚠️  ACTION REQUIRED BEFORE THIS WORKS:
 *
 * 1. Go to Firebase Console → Realtime Database
 * 2. Copy the URL shown at the top (looks like:
 *    https://sandlottribune-default-rtdb.firebaseio.com )
 * 3. Paste it as the databaseURL value below
 * 4. If the URL below is already correct, you're done!
 *
 * ─────────────────────────────────────────────────────────
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getDatabase }   from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

const firebaseConfig = {
  apiKey:            "AIzaSyDpPG4MfoP7YjUzU7N5vh6TPdv_I0S6pgI",
  authDomain:        "sandlottribune.firebaseapp.com",
  projectId:         "sandlottribune",
  storageBucket:     "sandlottribune.firebasestorage.app",
  messagingSenderId: "746621553651",
  appId:             "1:746621553651:web:7b8633ac1ae9c30f0c6086",
  measurementId:     "G-MRD0QCSB4Z",

  // ⬇️  PASTE YOUR REALTIME DATABASE URL HERE
  databaseURL: "https://sandlottribune-default-rtdb.firebaseio.com"
  //           ↑ Verify this matches what you see in Firebase Console → Realtime Database
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
