import path from 'path';
import admin from 'firebase-admin';
import { config } from './config';

const keyPath = path.resolve(config.FIREBASE_SERVICE_ACCOUNT_PATH);

const serviceAccount = require(keyPath) as admin.ServiceAccount;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

export const messaging = admin.messaging();
