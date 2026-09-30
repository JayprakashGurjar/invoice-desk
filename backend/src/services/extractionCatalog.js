/**
 * Extraction tools available to the current user.
 * Web-service mode: from the agreement's settings in DS_AgreementTable (GetExtractionSettings,
 * secrets masked). Local mode: from the Node extractors and backend/.env.
 */
import { registry } from '../extractors/ExtractorRegistry.js';
import { capabilities, getExtractionSettings } from './repository.js';

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

export async function getExtractionCatalog() {
  if (capabilities.remoteExtraction) return getExtractionSettings();
  return { ...registry.describe(), mode: 'local', require_approver: false };
}

/** Check a tool choice for upload / re-run. Returns the id or "auto". */
export async function validateProvider(requested) {
  const id = String(requested || 'auto').trim().toLowerCase();
  if (!capabilities.remoteExtraction) return registry.validateSelection(id);
  const catalog = await getExtractionSettings();
  if (id === 'auto') {
    if (!catalog.providers.some((p) => p.ready)) throw badRequest('No extraction tool is set up for this agreement. Add keys on the Extraction tools page.');
    return id;
  }
  const p = catalog.providers.find((x) => x.id === id);
  if (!p) throw badRequest(`Unknown extraction tool "${requested}".`);
  if (!p.ready) throw badRequest(`${p.name} is not set up for this agreement. Add its keys on the Extraction tools page.`);
  return id;
}
