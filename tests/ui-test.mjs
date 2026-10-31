import { test as base, expect } from '@playwright/test';
import { startOfflineServer } from './ui-fixture.mjs';

export { expect };

export const test = base.extend({
  offlineApp: async ({}, use, testInfo) => {
    const offline = await startOfflineServer({ dbPath: testInfo.outputPath('data', 'agent.sqlite') });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== offline.url) {
        offline.calls.blocked.push({ source: 'server', url: url.href });
        throw new Error(`Unexpected live fetch in offline test: ${url.origin}`);
      }
      return originalFetch(input, init);
    };
    try {
      await use(offline);
    } finally {
      try {
        await offline.close();
      } finally {
        globalThis.fetch = originalFetch;
        await testInfo.attach('offline-calls', { body: JSON.stringify(offline.calls, null, 2), contentType: 'application/json' });
      }
      expect(offline.calls.blocked, 'Tests must not contact external services').toEqual([]);
    }
  },
  baseURL: async ({ offlineApp: offline }, use) => {
    await use(offline.url);
  },
  storageState: async ({ baseURL }, use) => {
    await use({ cookies: [], origins: [{ origin: baseURL, localStorage: [{ name: 'qiyi-entrance-seen', value: 'true' }] }] });
  },
  context: async ({ context, offlineApp: offline }, use, testInfo) => {
    const diagnostics = { pageErrors: [], consoleErrors: [], failedRequests: [], errorResponses: [] };
    context.on('page', page => {
      page.on('pageerror', error => diagnostics.pageErrors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') diagnostics.consoleErrors.push(message.text()); });
      page.on('requestfailed', request => diagnostics.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
      page.on('response', response => { if (response.status() >= 400) diagnostics.errorResponses.push({ url: response.url(), status: response.status() }); });
    });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== offline.url && !['data:', 'blob:'].includes(url.protocol)) {
        offline.calls.blocked.push({ source: 'browser', url: url.href });
        await route.abort('blockedbyclient');
      } else await route.continue();
    });
    await use(context);
    await testInfo.attach('browser-diagnostics', { body: JSON.stringify(diagnostics, null, 2), contentType: 'application/json' });
    expect(diagnostics.pageErrors, 'No unhandled browser errors').toEqual([]);
  },
});
