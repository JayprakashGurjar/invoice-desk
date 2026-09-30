import path from 'node:path';
import { ExtractionProvider } from './ExtractionProvider.js';
import { JSON_OUTPUT_INSTRUCTIONS, SYSTEM_PROMPT } from './shared/extractionSchema.js';
import { fetchJson, MIME, parseJsonText } from './shared/helpers.js';

/** OpenAI GPT vision models via the Chat Completions REST API. Works with Azure OpenAI-compatible base URLs too. */
export class OpenAIExtractor extends ExtractionProvider {
  constructor() {
    super({
      id: 'openai',
      name: 'OpenAI GPT',
      vendor: 'OpenAI',
      kind: 'llm',
      description: 'OpenAI\'s vision language model reads the document and returns every field including line items.',
      supportedMimeTypes: [MIME.pdf, MIME.jpeg, MIME.png, MIME.webp, MIME.gif],
      requiredEnv: ['OPENAI_API_KEY'],
      optionalEnv: { OPENAI_MODEL: 'gpt-4o', OPENAI_BASE_URL: 'https://api.openai.com/v1' },
      capabilities: { lineItems: true, scans: true, handwriting: true, multiPage: true },
      docsUrl: 'https://platform.openai.com/api-keys',
    });
  }

  get modelName() { return process.env.OPENAI_MODEL || 'gpt-4o'; }

  async extract({ filePath, mimeType, originalName }) {
    const data = await this.readBase64(filePath);
    const filePart = mimeType === MIME.pdf
      ? { type: 'file', file: { filename: path.basename(originalName || 'document.pdf'), file_data: `data:${MIME.pdf};base64,${data}` } }
      : { type: 'image_url', image_url: { url: `data:${mimeType};base64,${data}`, detail: 'high' } };

    const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const { body } = await fetchJson(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: this.modelName,
        temperature: 0,
        max_tokens: 16000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: [filePart, { type: 'text', text: JSON_OUTPUT_INSTRUCTIONS }] },
        ],
      }),
    }, { service: 'OpenAI' });

    const choice = body?.choices?.[0];
    if (choice?.finish_reason === 'length') {
      throw new Error('Document too long: the OpenAI output was cut off. Try splitting the PDF.');
    }
    return parseJsonText(choice?.message?.content, 'OpenAI');
  }
}
