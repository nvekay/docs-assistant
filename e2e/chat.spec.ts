import { expect, test, type APIRequestContext } from '@playwright/test';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'change-me';

// Words that appear nowhere else in the corpus, so retrieval can only find this document
const DOC_TITLE = 'Zephyr kettle warranty';
const DOC = `# ${DOC_TITLE}

Every Zephyr kettle comes with a warranty that lasts 3 years from the date of purchase.

To claim the warranty, send the kettle serial number to the Zephyr service desk.
`;

async function adminToken(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/auth/login', { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { accessToken: string }).accessToken;
}

/** Removes documents left by this spec, so runs don't pile up duplicates */
async function deleteTestDocuments(request: APIRequestContext) {
  const token = await adminToken(request);
  const headers = { Authorization: `Bearer ${token}` };
  const docs = (await (await request.get('/api/documents', { headers })).json()) as { id: string; title: string }[];
  for (const doc of docs.filter((d) => d.title === DOC_TITLE)) {
    await request.delete(`/api/documents/${doc.id}`, { headers });
  }
}

test.beforeEach(async ({ request }) => deleteTestDocuments(request));
test.afterEach(async ({ request }) => deleteTestDocuments(request));

test('admin uploads a document, then the chat answers from it with a citation', async ({ page }) => {
  await page.goto('/admin');
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Knowledge base' })).toBeVisible();

  await page
    .getByLabel(/^File/)
    .setInputFiles({ name: 'zephyr.md', mimeType: 'text/markdown', buffer: Buffer.from(DOC) });
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  // The table polls while the worker indexes the document
  const row = page.getByRole('row', { name: new RegExp(DOC_TITLE) });
  await expect(row.getByText('ready')).toBeVisible({ timeout: 30_000 });

  await page.goto('/chat');
  await page.getByLabel('Your question').fill('How long is the Zephyr kettle warranty?');
  await page.getByRole('button', { name: 'Send' }).click();

  const answer = page.getByRole('listitem').last();
  await expect(answer).toContainText('lasts 3 years', { timeout: 15_000 });
  await expect(answer).toContainText(/\d+ tokens · \$/);

  await answer.getByRole('button', { name: 'Show source 1' }).click();
  const sources = page.getByRole('complementary');
  await expect(sources.getByText(DOC_TITLE).first()).toBeVisible();
  await expect(sources.locator('blockquote')).toContainText('send the kettle serial number');

  // The conversation survives a reload
  await page.reload();
  await expect(page.getByText('How long is the Zephyr kettle warranty?')).toBeVisible();
});

test('the demo account sees the admin panel read-only', async ({ page }) => {
  test.skip(!process.env.DEMO_VIEWER_EMAIL, 'demo viewer account is not configured');

  await page.goto('/admin');
  await page.getByRole('button', { name: 'View as demo user (read-only)' }).click();
  await expect(page.getByText('You are using the read-only demo account')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
});

test('the chat says so when the docs have no answer', async ({ page }) => {
  await page.goto('/chat');
  await page.getByLabel('Your question').fill('What is the capital of Peru?');
  await page.getByRole('button', { name: 'Send' }).click();

  const answer = page.getByRole('listitem').last();
  await expect(answer).toContainText("couldn't find the answer in the documentation", { timeout: 15_000 });
  await expect(answer.getByRole('button', { name: /Show source/ })).toHaveCount(0);
});

test('Stop cancels an answer that is still streaming', async ({ page }) => {
  await page.goto('/chat');
  await page.getByLabel('Your question').fill('How does this assistant choose its sources?');
  await page.getByRole('button', { name: 'Send' }).click();

  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByText('Stopped.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
});
