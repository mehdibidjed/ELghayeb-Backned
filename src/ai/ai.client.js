import { env } from '../config/env.js';

export class AiServiceError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** HTTP client for the Python AI service (ai-service/, wraps ../vision_model). */
export class AiClient {
  constructor({ baseUrl = env.AI_SERVICE_URL, timeoutMs = env.AI_TIMEOUT_MS } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
  }

  async #request(path, init = {}) {
    let res;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      throw new AiServiceError(503, `AI service unreachable: ${err.cause?.code ?? err.name}`);
    }
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    if (!res.ok) throw new AiServiceError(res.status, body.detail ?? `AI service error ${res.status}`, body);
    return body;
  }

  /** { status, face: bool, behavior: bool, ... } */
  health() {
    return this.#request('/health');
  }

  /** Detect faces in one enrollment photo → { faces: [{ bbox, det_score, embedding }] } */
  embedFace(buffer, filename = 'photo.jpg') {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: 'image/jpeg' }), filename);
    return this.#request('/faces/embed', { method: 'POST', body: form });
  }

  /**
   * Recognise the students of a group in 1..n classroom photos (G·C·D).
   * @param {Array<{ buffer: Buffer, position?: number|null }>} images
   * @param {Array<{ id: number, embeddings: number[][] }>} students
   * @returns {Promise<{ students: Array<{ id, status, similarity, seen_in }>, faces_total, unknown_faces, images }>}
   */
  recognize(images, students) {
    const form = new FormData();
    images.forEach((img, i) => form.append('images', new Blob([img.buffer], { type: 'image/jpeg' }), `shot-${i}.jpg`));
    form.append('payload', JSON.stringify({ students, positions: images.map((i) => i.position ?? null) }));
    return this.#request('/attendance/recognize', { method: 'POST', body: form });
  }

  /** Model 2 on one photo → { persons, attentive, phone, head_down, hand_up } (counts). */
  analyzeBehavior(buffer) {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: 'image/jpeg' }), 'frame.jpg');
    return this.#request('/behavior/analyze', { method: 'POST', body: form });
  }
}

export const aiClient = new AiClient();
