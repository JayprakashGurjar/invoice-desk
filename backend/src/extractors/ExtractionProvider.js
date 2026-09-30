import fs from 'node:fs/promises';

/**
 * Base class for every extraction tool.
 *
 * To add a new tool: extend this class, describe it in the constructor, implement extract(),
 * and register an instance in ExtractorRegistry.js. extract() must resolve to the common
 * raw shape (see emptyResult() in shared/helpers.js); normalize.js then cleans and validates it.
 */
export class ExtractionProvider {
  /**
   * @param {object} meta
   * @param {string}   meta.id                  Stable id stored in the database (max 20 chars)
   * @param {string}   meta.name                Display name
   * @param {string}   meta.vendor              Company behind the service
   * @param {'llm'|'ocr'|'basic'} meta.kind     llm = vision language model, ocr = invoice OCR service
   * @param {string}   meta.description         One or two plain sentences for the UI
   * @param {string[]} meta.supportedMimeTypes  File types the tool can read
   * @param {string[]} [meta.requiredEnv]       Env vars that must be set
   * @param {object}   [meta.optionalEnv]       Env var -> default value, shown in the UI
   * @param {string[]} [meta.dependencies]      npm packages loaded on demand
   * @param {object}   [meta.capabilities]      { lineItems, scans, handwriting, multiPage }
   * @param {string}   [meta.docsUrl]
   * @param {string}   [meta.notes]             Caveats shown in the UI
   */
  constructor(meta) {
    if (new.target === ExtractionProvider) throw new TypeError('ExtractionProvider is abstract');
    Object.assign(this, {
      requiredEnv: [], optionalEnv: {}, dependencies: [], capabilities: {}, docsUrl: null, notes: null,
      ...meta,
    });
    if (!this.id || this.id.length > 20) throw new Error(`Provider id "${this.id}" must be 1-20 characters`);
    this.missingDependencies = [];
  }

  /** Model or engine name shown in the UI. Override when relevant. */
  get modelName() { return null; }

  /** Checks optional npm packages once at startup, so the UI can say what to install. */
  async checkDependencies() {
    this.missingDependencies = [];
    for (const dep of this.dependencies) {
      try { await import(dep); } catch { this.missingDependencies.push(dep); }
    }
  }

  missingEnv() {
    return this.requiredEnv.filter((k) => !process.env[k]?.trim());
  }

  isConfigured() {
    return this.missingEnv().length === 0 && this.missingDependencies.length === 0;
  }

  supports(mimeType) {
    return this.supportedMimeTypes.includes(mimeType);
  }

  /**
   * @param {{ filePath: string, mimeType: string, originalName: string }} file
   * @returns {Promise<object>} raw extraction in the common shape
   */
  // eslint-disable-next-line no-unused-vars
  async extract(file) {
    throw new Error(`${this.name} has not implemented extract()`);
  }

  async readBase64(filePath) {
    return (await fs.readFile(filePath)).toString('base64');
  }

  /** Public metadata for the API. Never includes secret values. */
  describe() {
    return {
      id: this.id,
      name: this.name,
      vendor: this.vendor,
      kind: this.kind,
      description: this.description,
      notes: this.notes,
      model: this.modelName,
      supported_mime_types: this.supportedMimeTypes,
      capabilities: this.capabilities,
      docs_url: this.docsUrl,
      ready: this.isConfigured(),
      settings: [
        ...this.requiredEnv.map((k) => ({ name: k, required: true, set: Boolean(process.env[k]?.trim()) })),
        ...Object.entries(this.optionalEnv).map(([k, def]) => ({
          name: k, required: false, set: Boolean(process.env[k]?.trim()), default: def,
        })),
      ],
      missing_packages: this.missingDependencies,
    };
  }
}
