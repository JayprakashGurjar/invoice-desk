// Minimal in-process job queue with a concurrency limit.
// For production scale, swap for BullMQ/Redis or an Azure queue.
//
// Each job runs as the user who queued it, so its web-service calls use that user's
// DocuSoft login and reach that user's agreement database. Jobs are keyed by agreement
// and id because invoice ids are only unique within one agreement database.
import { config } from '../config.js';
import { currentUser, runAs } from '../context.js';
import { getPendingInvoiceIds, serviceAccount } from './repository.js';
import { processInvoice } from './processor.js';

const pending = [];
const queued = new Set();
let active = 0;

const keyOf = (user, id) => `${user?.agrno || 'local'}:${id}`;

export function enqueue(id, user = currentUser()) {
  const key = keyOf(user, id);
  if (queued.has(key)) return;
  queued.add(key);
  pending.push({ key, id, user });
  pump();
}

function pump() {
  while (active < config.maxConcurrent && pending.length) {
    const job = pending.shift();
    active += 1;
    const run = () => processInvoice(job.id);
    (job.user ? runAs(job.user, run) : run())
      .catch((e) => console.error('[queue]', e))
      .finally(() => { queued.delete(job.key); active -= 1; pump(); });
  }
}

/** Requeue a user's (agreement's) documents that were interrupted, e.g. by a restart. */
export async function resumePendingFor(user) {
  let ids;
  try {
    ids = await (user ? runAs(user, () => getPendingInvoiceIds()) : getPendingInvoiceIds());
  } catch (err) {
    console.error(`[queue] could not load pending documents: ${err.message}`);
    return;
  }
  ids.forEach((id) => enqueue(id, user));
  if (ids.length) console.log(`[queue] resumed ${ids.length} pending document(s)${user ? ` for agreement ${user.agrno}` : ''}`);
}

/**
 * On startup. Local mode: resume everything. Web-service mode: each agreement is resumed
 * when one of its users signs in; if a service account is set in .env its agreement is
 * resumed straight away.
 */
export async function resumePending({ remote }) {
  if (!remote) return resumePendingFor(null);
  const account = serviceAccount();
  if (account) return resumePendingFor({ ...account, userId: 0, name: 'service account' });
  return undefined;
}
