import { createHash, randomBytes } from 'node:crypto';

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const newDeviceToken = () => `dev_${randomBytes(24).toString('base64url')}`;
