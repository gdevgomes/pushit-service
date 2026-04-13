import path from 'path';
import admin from 'firebase-admin';
import { config } from './config';

function loadCredential(): admin.ServiceAccount {
  if (config.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const json = Buffer.from(config.FIREBASE_SERVICE_ACCOUNT_JSON, 'base64').toString('utf8');
    return JSON.parse(json) as admin.ServiceAccount;
  }
  return require(path.resolve(config.FIREBASE_SERVICE_ACCOUNT_PATH)) as admin.ServiceAccount;
}

admin.initializeApp({
  credential: admin.credential.cert(loadCredential()),
});

export const messaging = admin.messaging();
