import { ExtractionProvider } from './ExtractionProvider.js';
import { JSON_OUTPUT_INSTRUCTIONS, SYSTEM_PROMPT } from './shared/extractionSchema.js';
import { fetchJson, MIME, parseJsonText } from './shared/helpers.js';

/** Google Gemini via the Generative Language REST API (no SDK needed). */
export class GeminiExtractor extends ExtractionProvider {
  constructor() {
    super({
      id: 'gemini',
      name: 'Google Gemini',
      vendor: 'Google',
      kind: 'llm',
      description: 'Google\'s vision language model reads the document and returns every field including line items. Handles scans and photos.',
      supportedMimeTypes: [MIME.pdf, MIME.jpeg, MIME.png, MIME.webp],
      requiredEnv: ['GEMINI_API_KEY'],
      optionalEnv: { GEMINI_MODEL: 'gemini-2.5-flash' },
      capabilities: { lineItems: true, scans: true, handwriting: true, multiPage: true },
      docsUrl: 'https://aistudio.google.com/apikey',
    });
  }

  get modelName() { return process.env.GEMINI_MODEL || 'gemini-2.5-flash'; }

  async extract({ filePath, mimeType }) {
    const data = await this.readBase64(filePath);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.modelName)}:generateContent`;
    const { body } = await fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{
          role: 'user',
          parts: [{ inline_data: { mime_type: mimeType, data } }, { text: JSON_OUTPUT_INSTRUCTIONS }],
        }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 16000 },
      }),
    }, { service: 'Gemini' });

    const candidate = body?.candidates?.[0];
    if (!candidate) {
      const reason = body?.promptFeedback?.blockReason;
      throw new Error(reason ? `Gemini blocked the request (${reason}).` : 'Gemini returned no result.');
    }
    if (candidate.finishReason === 'MAX_TOKENS') {
      throw new Error('Document too long: Gemini\'s output was cut off. Try splitting the PDF.');
    }
    const text = (candidate.content?.parts || []).map((p) => p.text || '').join('');
    return parseJsonText(text, 'Gemini');
  }
}
