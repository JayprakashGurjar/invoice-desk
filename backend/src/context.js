/**
 * The signed-in user for the current request (or background job), carried through async code.
 * The ASMX client uses it so every web-service call runs with that user's own DocuSoft login.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

/** user: { agrno, email, password, userId, name } */
export function runAs(user, fn) {
  return storage.run(user, fn);
}

export function currentUser() {
  return storage.getStore() || null;
}

/** The user without the password, safe to send to the browser. */
export function publicUser(user) {
  if (!user) return null;
  return { userId: user.userId, email: user.email, name: user.name, agrno: user.agrno };
}
