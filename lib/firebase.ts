import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey:            'AIzaSyBDvMeWkks9WnQQqyK3tvq27-SMfm8pe1o',
  authDomain:        'gigmatchweb-aus.firebaseapp.com',
  databaseURL:       'https://gigmatchweb-aus-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId:         'gigmatchweb-aus',
  storageBucket:     'gigmatchweb-aus.firebasestorage.app',
  messagingSenderId: '1042623262510',
  appId:             '1:1042623262510:web:0c34b361ed7239b9ce14bf',
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const db      = getFirestore(app);
export const auth    = getAuth(app);
export const storage = getStorage(app);
export default app;
