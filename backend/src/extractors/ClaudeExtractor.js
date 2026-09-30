import Anthropic from '@anthropic-ai/sdk';
import { ExtractionProvider } from './ExtractionProvider.js';
import { EXTRACTION_TOOL, SYSTEM_PROMPT } from './shared/extractionSchema.js';
import { MIME } from './shared/helpers.js';

export class ClaudeExtractor extends ExtractionProvider {
  constructor() {
    super({
      id: 'claude',
      name: 'Claude',
      vendor: 'Anthropic',
      kind: 'llm',
      description: 'Reads the whole document with a vision language model. Handles scans, photos, handwriting and unusual layouts, and captures every field including line items.',
      supportedMimeTypes: [MIME.pdf, MIME.jpeg, MIME.png, MIME.webp, MIME.gif],
      requiredEnv: ['ANTHROPIC_API_KEY'],
      optionalEnv: { ANTHROPIC_MODEL: 'claude-sonnet-5' },
      capabilities: { lineItems: true, scans: true, handwriting: true, multiPage: true },
      docsUrl: 'https://console.anthropic.com',
    });
    this.client = null;
  }

  get modelName() { return process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'; }

  async extract({ filePath, mimeType }) {
    this.client ||= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const data = await this.readBase64(filePath);
    const fileBlock = mimeType === MIME.pdf
      ? { type: 'document', source: { type: 'base64', media_type: MIME.pdf, data } }
      : { type: 'image', source: { type: 'base64', media_type: mimeType, data } };

    const response = await this.client.messages.create({
      model: this.modelName,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: 'tool', name: EXTRACTION_TOOL.name },
      messages: [{
        role: 'user',
        content: [fileBlock, { type: 'text', text: 'Extract all data from this document using the record_invoice tool.' }],
      }],
    });

    if (response.stop_reason === 'max_tokens') {
      throw new Error('Document too long: Claude\'s output was cut off. Try splitting the PDF.');
    }
    const toolUse = response.content.find((b) => b.type === 'tool_use');
    if (!toolUse) throw new Error('Claude did not return structured data.');
    return toolUse.input;
  }
}
