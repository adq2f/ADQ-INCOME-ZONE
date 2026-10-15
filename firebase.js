// Firebase Configuration & Exports
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCffmDp9xRUcLkqe5q4NiQubaT0iMlLDm4",
  authDomain: "adq-income-zone.firebaseapp.com",
  projectId: "adq-income-zone",
  storageBucket: "adq-income-zone.firebasestorage.app",
  messagingSenderId: "734101180975",
  appId: "1:734101180975:web:b30eb1fadaa311f492ecda"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
