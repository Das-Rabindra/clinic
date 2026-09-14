/**
 * Storage abstraction. `STORAGE_DRIVER=s3` can be wired up later by adding a
 * module with the same five exports; nothing else in the app changes.
 */
import * as local from './local.js';
import * as blob from './blob.js';
import { config } from '../../config/env.js';

const drivers = { local, blob };

export function driver() {
  const d = drivers[config.storage.driver];
  if (!d) throw new Error(`Unknown STORAGE_DRIVER "${config.storage.driver}". Available: ${Object.keys(drivers).join(', ')}`);
  return d;
}

export const put = (...a) => driver().put(...a);
export const get = (...a) => driver().get(...a);
export const remove = (...a) => driver().remove(...a);
export const url = (...a) => driver().url(...a);
export const exists = (...a) => driver().exists(...a);
export const driverName = () => driver().name;
