import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'change-me';

// Words that appear nowhere else in the corpus, so retrieval can only find these documents
const DOC_TITLE = 'Zephyr kettle warranty';
const DOC = `# ${DOC_TITLE}

Every Zephyr kettle comes with a warranty that lasts 3 years from the date of purchase.

To claim the warranty, send the kettle serial number to the Zephyr service desk.
`;
const DOC2_TITLE = 'Quokka toaster manual';
const DOC2 = `# ${DOC2_TITLE}

The Quokka toaster has six browning levels and a defrost button.
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
  for (const doc of docs.filter((d) => d.title === DOC_TITLE || d.title === DOC2_TITLE)) {
    await request.delete(`/api/documents/${doc.id}`, { headers });
  }
}

async function signInAsAdmin(page: Page) {
  await page.goto('/admin');
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Knowledge base' })).toBeVisible();
}

/** The last message in the open chat (the chat list uses its own list) */
const lastMessage = (page: Page) => page.locator('main ol > li').last();

async function ask(page: Page, question: string) {
  await page.getByLabel('Your question').fill(question);
  await page.getByRole('button', { name: 'Send' }).click();
  // The token count appears once the answer has finished
  await expect(lastMessage(page)).toContainText(/\d+ tokens · \$/, { timeout: 15_000 });
}

test.beforeEach(async ({ request }) => deleteTestDocuments(request));
test.afterEach(async ({ request }) => deleteTestDocuments(request));

test('admin uploads a document, then the chat answers from it with a citation', async ({ page }) => {
  await signInAsAdmin(page);
  await page
    .getByLabel('Files')
    .setInputFiles({ name: 'zephyr.md', mimeType: 'text/markdown', buffer: Buffer.from(DOC) });
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  // The table polls while the worker indexes the document
  const row = page.getByRole('row', { name: new RegExp(DOC_TITLE) });
  await expect(row.getByText('ready')).toBeVisible({ timeout: 30_000 });

  await page.goto('/chat');
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await ask(page, 'How long is the Zephyr kettle warranty?');
  const answer = lastMessage(page);
  await expect(answer).toContainText('lasts 3 years');

  await answer.getByRole('button', { name: 'Show source 1' }).click();
  const sources = page.getByRole('complementary', { name: 'Sources' });
  await expect(sources.getByText(DOC_TITLE).first()).toBeVisible();
  await expect(sources.locator('blockquote')).toContainText('send the kettle serial number');

  // The open chat is in the URL, so it survives a reload
  await expect(page).toHaveURL(/\/chat\?c=[0-9a-f-]{36}$/);
  await page.reload();
  await expect(page.locator('main ol > li').first()).toContainText('How long is the Zephyr kettle warranty?');
});

test('several files can be uploaded at once', async ({ page }) => {
  await signInAsAdmin(page);
  await page.getByLabel('Files').setInputFiles([
    { name: 'zephyr.md', mimeType: 'text/markdown', buffer: Buffer.from(DOC) },
    { name: 'quokka.md', mimeType: 'text/markdown', buffer: Buffer.from(DOC2) },
    { name: 'notes.docx', mimeType: 'application/octet-stream', buffer: Buffer.from('x') },
  ]);
  // The unsupported file is flagged right away and not counted
  await expect(page.getByText('Not .md, .txt or .pdf')).toBeVisible();
  await page.getByRole('button', { name: 'Add 2 files' }).click();
  await expect(page.getByText('2 files added')).toBeVisible();

  for (const title of [DOC_TITLE, DOC2_TITLE]) {
    await expect(page.getByRole('row', { name: new RegExp(title) }).getByText('ready')).toBeVisible({
      timeout: 30_000,
    });
  }
});

test('chats are listed, can be switched and deleted', async ({ page, isMobile }) => {
  const list = page.getByRole('navigation', { name: 'Chats' });
  // On phones the list is a drawer behind the "Chats" button
  const openList = async () => {
    if (isMobile) await page.getByRole('button', { name: 'Chats', exact: true }).click();
  };

  await page.goto('/chat');
  await ask(page, 'How do I reset my password?');
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await expect(page.getByRole('heading', { name: 'Ask the docs' })).toBeVisible();
  await ask(page, 'Can I export invoices to CSV?');

  await openList();
  const items = list.getByRole('listitem');
  await expect(items).toHaveCount(2);
  // Newest first
  await expect(items.first()).toContainText('Can I export invoices to CSV?');

  await list.getByRole('button', { name: /^How do I reset my password/ }).click();
  await expect(page.locator('main ol > li').first()).toContainText('How do I reset my password?');

  await openList();
  await list.getByRole('button', { name: /Delete chat “How do I reset/ }).click();
  await list.getByRole('button', { name: 'Delete', exact: true }).click();
  // The open chat was the deleted one, so a new empty chat is shown (and the phone drawer closes)
  await expect(page.getByRole('heading', { name: 'Ask the docs' })).toBeVisible();
  await openList();
  await expect(items).toHaveCount(1);
});

test('the demo account sees the admin panel read-only', async ({ page }) => {
  test.skip(!process.env.DEMO_VIEWER_EMAIL, 'demo viewer account is not configured');

  await page.goto('/admin');
  await page.getByRole('button', { name: 'View as demo user (read-only)' }).click();
  await expect(page.getByText('You are using the read-only demo account')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reindex all' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
});

test('the chat says so when the docs have no answer', async ({ page }) => {
  await page.goto('/chat');
  await ask(page, 'What is the capital of Peru?');
  const answer = lastMessage(page);
  await expect(answer).toContainText("couldn't find the answer in the documentation");
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
