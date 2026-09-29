import type {FirebaseApp} from 'firebase/app';
import {
  browserLocalPersistence,
  indexedDBLocalPersistence,
  initializeAuth,
  type Auth,
  type Persistence
} from 'firebase/auth';

/**
 * Firebase-owned durable browser persistence for the Tauri WebView2 profile.
 * IndexedDB is preferred and localStorage is the supported fallback. Firebase
 * chooses the first persistence implementation supported by the WebView and
 * remains responsible for storing and refreshing its own session state.
 */
export const windowsAuthPersistence:Persistence[]=[
  indexedDBLocalPersistence,
  browserLocalPersistence
];

export function initializeWindowsAuth(app:FirebaseApp):Auth{
  return initializeAuth(app,{persistence:windowsAuthPersistence});
}
