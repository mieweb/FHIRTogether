/**
 * WebChartApi — minimal HTTP client for WebChart's proprietary Base64-encoded
 * JSON API. No external dependencies (uses global `fetch`).
 *
 * Public surface:
 *   login()                      — authenticate and cache session cookie
 *   get(endpoint, params?)       — Base64-encoded GET query
 *   post(endpoint, data)         — Base64-encoded PUT (create/update) via POST
 */

export interface WebChartConfig {
  baseUrl: string;   // e.g. "https://mauidev.webchartnow.com/webchart.cgi"
  username: string;
  password: string;
  /** Default location code used when creating appointments */
  defaultLocation?: string;
}

export class WebChartApi {
  private baseUrl: string;
  private username: string;
  private password: string;
  private cookie: string | null = null;

  constructor(config: WebChartConfig) {
    this.baseUrl = config.baseUrl;
    this.username = config.username;
    this.password = config.password;
  }

  /** Authenticate and store session cookie. */
  async login(): Promise<void> {
    const form = new URLSearchParams();
    form.append('login_user', this.username);
    form.append('login_passwd', this.password);

    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      redirect: 'manual',
    });

    const setCookie = res.headers.get('set-cookie') || '';
    const wcCookie = setCookie.split(',').map(c => c.trim()).find(c => c.startsWith('wc_'));
    this.cookie = wcCookie?.split(';')[0] || null;

    if (!this.cookie) {
      throw new Error('WebChart login failed — no session cookie received');
    }
  }

  /** Ensure we have a valid session. */
  private async ensureAuth(): Promise<void> {
    if (!this.cookie) await this.login();
  }

  /**
   * Generic GET via WebChart's Base64-encoded JSON API.
   * `endpoint` e.g. "db/appointments", `params` e.g. { canceled: '0', pat_id: '123' }
   */
  async get(endpoint: string, params?: Record<string, string>): Promise<any> {
    await this.ensureAuth();

    let queryString = '';
    if (params && Object.keys(params).length > 0) {
      queryString = Object.entries(params)
        .map(([k, v]) => `${k}=${v}`)
        .join('&');
    }

    const raw = queryString ? `GET/${endpoint}/${queryString}` : `GET/${endpoint}`;
    const b64 = Buffer.from(raw).toString('base64');
    const url = `${this.baseUrl}/json/${b64}`;

    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: this.cookie!,
      },
    });

    if (!res.ok) throw new Error(`WebChart GET ${endpoint} failed: ${res.status}`);

    return res.json();
  }

  /**
   * PUT to WebChart's named JSON endpoint (e.g. "appointments").
   * WebChart uses PUT/ in the base64 path for create/update operations.
   * The actual HTTP method is POST, but the base64-encoded path prefix must be PUT/.
   */
  async post(endpoint: string, data: Record<string, unknown>): Promise<any> {
    await this.ensureAuth();

    const b64 = Buffer.from(`PUT/${endpoint}`).toString('base64');
    const url = `${this.baseUrl}/json/${b64}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Cookie: this.cookie!,
      },
      body: JSON.stringify([data]),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`WebChart PUT ${endpoint} failed: ${res.status} ${body}`);
    }

    return res.json();
  }
}
