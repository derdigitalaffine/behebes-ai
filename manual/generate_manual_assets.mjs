import { chromium } from 'playwright';

const BASE_URL = 'https://www.behebes.de';
const OUT_DIR = '/home/vm/behebes.ai/manual/images';

const formInput = {
  name: 'Dominik Tröster',
  email: 'test@troester.nl',
  description:
    'Seit mehreren Tagen gibt es in der Hauptstrasse 8a in Otterberg sehr lautes Hundegebell, besonders nachts und früh morgens. Das stoert die Nachtruhe erheblich. Bitte um Pruefung.',
  address: 'Hauptstrasse 8a Otterberg',
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 2200 } });

const safeShot = async (name) => {
  await page.screenshot({ path: `${OUT_DIR}/${name}`, fullPage: true });
};

try {
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForSelector('input[name="name"]', { timeout: 30000 });
  await page.waitForTimeout(1200);
  await safeShot('01-startseite.png');

  await page.fill('input[name="name"]', formInput.name);
  await page.fill('input[name="email"]', formInput.email);
  await page.fill('textarea[name="description"]', formInput.description);

  const addressInput = page.locator('input[name="citizen_location_query"]');
  await addressInput.click();
  await addressInput.fill(formInput.address);

  const consent = page.locator('input[type="checkbox"]');
  if (!(await consent.isChecked())) {
    await consent.check();
  }

  await safeShot('02-formular-ausgefuellt.png');

  await page.click('button[type="submit"]');
  await page.waitForSelector('.summary-grid', { timeout: 30000 });
  await page.waitForTimeout(900);
  await safeShot('03-zusammenfassung.png');

  await page.click('.submission-preview-submit-inline button');
  await page.waitForSelector('.success-modal-card', { timeout: 45000 });
  await page.waitForTimeout(1200);
  await safeShot('04-erfolg-validierung.png');

  const ticketText = (await page.locator('.success-modal-ticket').innerText()).trim();
  console.log('SUCCESS_MODAL_TICKET_TEXT=' + ticketText);
} catch (error) {
  console.error('PLAYWRIGHT_RUN_FAILED', error);
  try {
    await safeShot('99-fehlerzustand.png');
  } catch {
    // ignore
  }
  process.exitCode = 1;
} finally {
  await browser.close();
}
