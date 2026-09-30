import { ClaudeExtractor } from './ClaudeExtractor.js';
import { GeminiExtractor } from './GeminiExtractor.js';
import { OpenAIExtractor } from './OpenAIExtractor.js';
import { AwsTextractExtractor } from './AwsTextractExtractor.js';
import { GoogleDocumentAIExtractor } from './GoogleDocumentAIExtractor.js';
import { AzureDocumentIntelligenceExtractor } from './AzureDocumentIntelligenceExtractor.js';
import { BasicTextExtractor } from './BasicTextExtractor.js';

const MIME_LABELS = {
  'application/pdf': 'PDF', 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WEBP', 'image/gif': 'GIF',
};

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

/**
 * Holds every extraction tool and decides which one reads a document.
 * "auto" uses EXTRACTION_PROVIDER if it is set up, otherwise the first ready tool
 * in the priority order that can read the file type.
 */
export class ExtractorRegistry {
  constructor(priority = []) {
    this.providers = new Map();
    this.priority = priority;
  }

  register(provider) {
    if (this.providers.has(provider.id)) throw new Error(`Duplicate extraction provider id: ${provider.id}`);
    this.providers.set(provider.id, provider);
    return this;
  }

  get(id) { return this.providers.get(id) || null; }
  list() { return [...this.providers.values()]; }

  async init() {
    await Promise.all(this.list().map((p) => p.checkDependencies()));
  }

  get preferredId() {
    return (process.env.EXTRACTION_PROVIDER || 'auto').trim().toLowerCase();
  }

  /** The tool "auto" would use; optionally only tools that read mimeType. */
  resolveAuto(mimeType) {
    const order = [this.preferredId, ...this.priority, ...this.providers.keys()];
    for (const id of order) {
      const p = this.get(id);
      if (p && p.isConfigured() && (!mimeType || p.supports(mimeType))) return p;
    }
    return null;
  }

  /** Check a requested tool id is valid and ready. Returns the normalised id ("auto" or a provider id). */
  validateSelection(requested) {
    const id = (requested || 'auto').trim().toLowerCase();
    if (id === 'auto') return id;
    const p = this.get(id);
    if (!p) throw badRequest(`Unknown extraction tool "${requested}".`);
    if (!p.isConfigured()) throw badRequest(this.notReadyMessage(p));
    return id;
  }

  /** Pick the tool that will read this file. Throws a readable error if none can. */
  resolve(requested, mimeType) {
    const id = (requested || 'auto').trim().toLowerCase();
    const label = MIME_LABELS[mimeType] || mimeType;
    if (id === 'auto') {
      const p = this.resolveAuto(mimeType);
      if (!p) throw new Error(`No extraction tool that is set up can read ${label} files. Set one up on the Extraction tools page.`);
      return p;
    }
    const p = this.get(id);
    if (!p) throw new Error(`Unknown extraction tool "${requested}".`);
    if (!p.isConfigured()) throw new Error(this.notReadyMessage(p));
    if (!p.supports(mimeType)) {
      const reads = p.supportedMimeTypes.map((m) => MIME_LABELS[m] || m).join(', ');
      throw new Error(`${p.name} can't read ${label} files (it reads ${reads}). Re-run extraction with another tool.`);
    }
    return p;
  }

  notReadyMessage(p) {
    const missing = [
      ...p.missingEnv(),
      ...p.missingDependencies.map((d) => `npm package ${d}`),
    ];
    return `${p.name} is not set up. Missing: ${missing.join(', ')}.`;
  }

  describe() {
    const auto = this.resolveAuto();
    return {
      preferred: this.preferredId,
      auto_provider: auto ? auto.id : null,
      providers: this.list().map((p) => ({ ...p.describe(), is_default: auto?.id === p.id })),
    };
  }
}

export const PRIORITY = ['claude', 'azure-docintel', 'aws-textract', 'google-documentai', 'gemini', 'openai', 'basic'];

export const registry = new ExtractorRegistry(PRIORITY)
  .register(new ClaudeExtractor())
  .register(new GeminiExtractor())
  .register(new OpenAIExtractor())
  .register(new AwsTextractExtractor())
  .register(new GoogleDocumentAIExtractor())
  .register(new AzureDocumentIntelligenceExtractor())
  .register(new BasicTextExtractor());
