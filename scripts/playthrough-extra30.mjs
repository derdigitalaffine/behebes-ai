import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = process.env.PLAYTHROUGH_BASE_URL || 'https://www.behebes.de';
const HEADLESS = process.env.PLAYTHROUGH_HEADLESS !== 'false';
const ADDRESS_FILE = path.resolve('manual/loadtest-assets/validated-addresses-otterbach-otterberg.json');
const runStartedAt = new Date();
const runStamp = runStartedAt.toISOString().replace(/[:.]/g, '-');
const reportDir = path.resolve('manual/loadtest-results', `${runStamp}-extra30`);
const MAX_ATTEMPTS = 3;

const citizens = [
  { name: 'Anna Schmitt', email: 'anna.schmitt@troester.nl' },
  { name: 'Ben Weber', email: 'ben.weber@troester.nl' },
  { name: 'Clara Hoffmann', email: 'clara.hoffmann@troester.nl' },
  { name: 'David Krueger', email: 'david.krueger@troester.nl' },
  { name: 'Emma Becker', email: 'emma.becker@troester.nl' },
  { name: 'Felix Neumann', email: 'felix.neumann@troester.nl' },
  { name: 'Greta Wagner', email: 'greta.wagner@troester.nl' },
  { name: 'Hannes Keller', email: 'hannes.keller@troester.nl' },
  { name: 'Iris Voigt', email: 'iris.voigt@troester.nl' },
  { name: 'Jonas Barth', email: 'jonas.barth@troester.nl' },
];

const imagePool = [
  path.resolve('manual/loadtest-assets/free-01.jpg'),
  path.resolve('manual/loadtest-assets/free-02.jpg'),
  path.resolve('manual/loadtest-assets/free-03.jpg'),
  path.resolve('manual/loadtest-assets/free-04.jpg'),
  path.resolve('manual/loadtest-assets/free-05.jpg'),
  path.resolve('manual/loadtest-assets/free-06.jpg'),
  path.resolve('manual/loadtest-assets/free-07.jpg'),
  path.resolve('manual/loadtest-assets/free-08.jpg'),
];

const seriousTemplates = [
  {
    title: 'Tiefe Fahrbahnkante nach Aufbruch',
    body: 'Nach einem Aufbruch ist an der Fahrbahn eine tiefe Kante geblieben. Fahrzeuge weichen aus, dadurch entsteht Gegenverkehrsrisiko.',
  },
  {
    title: 'Laternenausfall im Strassenabschnitt',
    body: 'Mehrere Leuchten sind ausgefallen. Der Fussweg ist in den Abendstunden kaum einsehbar und es besteht erhoehte Unfallgefahr.',
  },
  {
    title: 'Gefaehrliche Absackung am Schacht',
    body: 'Ein Schachtbereich ist deutlich abgesackt. Zweiradfahrer geraten beim Ueberfahren ins Schleudern.',
  },
  {
    title: 'Astbruch blockiert Gehweg',
    body: 'Ein grosser Ast liegt ueber dem Gehweg. Fussgaenger muessen auf die Fahrbahn ausweichen.',
  },
  {
    title: 'Wasseraustritt aus Hydrant',
    body: 'An einem Hydranten tritt dauerhaft Wasser aus. Der Bereich ist nass und bei Kaltwetter rutschig.',
  },
  {
    title: 'Sichtbehinderung durch defektes Schild',
    body: 'Ein Verkehrszeichen steht schraeg und verdeckt Sichtbeziehungen im Einmuendungsbereich.',
  },
];

const minorTemplates = [
  {
    title: 'Muelleimer ueberfuellt',
    body: 'Der oeffentliche Muelleimer ist ueberfuellt und es liegt bereits Abfall daneben.',
  },
  {
    title: 'Graffiti an Haltestelle',
    body: 'Eine Haltestellenflaeche ist beschmiert. Keine akute Gefahr, aber deutlicher Pflegebedarf.',
  },
  {
    title: 'Banklatte locker',
    body: 'An einer Sitzbank ist eine Latte locker. Nutzung ist moeglich, sollte aber gewartet werden.',
  },
  {
    title: 'Verwilderter Randstreifen',
    body: 'Der Randstreifen waechst weit in den Gehbereich hinein und sollte gemaeht werden.',
  },
  {
    title: 'Verschmutztes Strassenschild',
    body: 'Ein Strassenschild ist kaum lesbar, da es stark verschmutzt ist.',
  },
  {
    title: 'Leerer Beutelspender',
    body: 'Ein Hundekotbeutelspender ist leer und sollte nachgefuellt werden.',
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function extractTicketId(ticketText) {
  const candidates = String(ticketText || '').match(/[0-9a-f]{8}-[0-9a-f-]{27,}|[A-Z0-9-]{6,}/gi) || [];
  return candidates.length ? candidates[candidates.length - 1] : '';
}

function pickImages(index, count) {
  if (!count) return [];
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push(imagePool[(index + i) % imagePool.length]);
  }
  return out;
}

function buildScenario(addressEntry, index) {
  const severity = index % 5 < 3 ? 'ernst' : 'banal';
  const templates = severity === 'ernst' ? seriousTemplates : minorTemplates;
  const template = templates[index % templates.length];
  const address = `${addressEntry.street}, ${addressEntry.town}`;
  const imageCount = severity === 'ernst' ? (index % 4 === 0 ? 2 : 1) : index % 3 === 0 ? 1 : 0;
  const citizenIndex = index % citizens.length;
  const description =
    `${template.body}\n\nOrt: ${address}.\n` +
    'Bitte pruefen und Rueckmeldung im Bearbeitungsstatus geben.';
  return {
    citizenIndex,
    severity,
    address,
    title: template.title,
    description,
    imageCount,
  };
}

async function submitScenario(browser, scenario, index) {
  const citizen = citizens[scenario.citizenIndex];
  const attachedImages = pickImages(index, scenario.imageCount);
  const context = await browser.newContext({ viewport: { width: 1440, height: 2100 } });
  const page = await context.newPage();
  page.on('dialog', async (dialog) => {
    try {
      await dialog.accept();
    } catch {
      // ignore
    }
  });

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 120000 });
    await page.waitForSelector('input[name=\"name\"]', { timeout: 45000 });
    await page.fill('input[name=\"name\"]', citizen.name);
    await page.fill('input[name=\"email\"]', citizen.email);
    await page.fill(
      'textarea[name=\"description\"]',
      `[${scenario.severity.toUpperCase()}] ${scenario.title}\n\n${scenario.description}`
    );

    const addressInput = page.locator('input[name=\"citizen_location_query\"]');
    await addressInput.click();
    await addressInput.fill(scenario.address);
    await addressInput.press('Escape').catch(() => undefined);
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.mouse.click(8, 8).catch(() => undefined);

    if (attachedImages.length > 0) {
      await page.locator('#photo-upload').setInputFiles(attachedImages);
      await page.waitForTimeout(700);
      const exifPrompt = page.locator('.exif-prompt-modal');
      if (await exifPrompt.isVisible().catch(() => false)) {
        const dismissExif = exifPrompt.locator('.exif-prompt-secondary').first();
        if (await dismissExif.isVisible().catch(() => false)) {
          await dismissExif.click({ force: true });
        }
      }
    }

    const consent = page.locator('input[type=\"checkbox\"]').first();
    if (!(await consent.isChecked())) {
      await consent.check({ force: true });
    }

    await page.click('button[type=\"submit\"]', { force: true });
    const noLocationWarning = page.locator('.warning-modal .warning-card .warning-confirm');
    if (await noLocationWarning.isVisible().catch(() => false)) {
      await noLocationWarning.first().click({ force: true });
    }

    await page.waitForSelector('.summary-grid', { timeout: 45000 });
    await page.click('.submission-preview-submit-inline button');
    await page.waitForSelector('.success-modal-card', { timeout: 90000 });

    const ticketText = (await page.locator('.success-modal-ticket').innerText()).trim();
    const ticketId = extractTicketId(ticketText);

    return {
      ok: true,
      citizenName: citizen.name,
      citizenEmail: citizen.email,
      severity: scenario.severity,
      title: scenario.title,
      address: scenario.address,
      imagesAttached: attachedImages.map((filePath) => path.basename(filePath)),
      ticketText,
      ticketId,
    };
  } finally {
    await context.close();
  }
}

function buildMarkdown(runMeta, results) {
  const lines = [];
  lines.push('# Extra 30 Tickets Playthrough');
  lines.push('');
  lines.push(`- Datum: ${runMeta.startedAt}`);
  lines.push(`- Ziel: ${runMeta.baseUrl}`);
  lines.push(`- Erfolgreich: ${runMeta.ok}`);
  lines.push(`- Fehlgeschlagen: ${runMeta.failed}`);
  lines.push('');
  lines.push('| # | Status | E-Mail | Schwere | Titel | Adresse | Ticket-ID |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  results.forEach((row, idx) => {
    lines.push(
      `| ${idx + 1} | ${row.ok ? 'OK' : 'FAIL'} | ${row.citizenEmail || '-'} | ${row.severity || '-'} | ${String(
        row.title || ''
      ).replace(/\\|/g, '/')} | ${String(row.address || '').replace(/\\|/g, '/')} | ${row.ticketId || '-'} |`
    );
  });
  return `${lines.join('\n')}\n`;
}

async function main() {
  const addressesRaw = JSON.parse(await fs.readFile(ADDRESS_FILE, 'utf8'));
  if (!Array.isArray(addressesRaw) || addressesRaw.length < 30) {
    throw new Error(`Zu wenige verifizierte Adressen in ${ADDRESS_FILE}`);
  }

  const addresses = addressesRaw.slice(0, 30);
  const scenarios = addresses.map((entry, idx) => buildScenario(entry, idx));

  await fs.mkdir(reportDir, { recursive: true });
  const browser = await chromium.launch({ headless: HEADLESS });
  const results = [];

  try {
    for (let i = 0; i < scenarios.length; i += 1) {
      const scenario = scenarios[i];
      let done = false;
      let lastError = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          const row = await submitScenario(browser, scenario, i);
          results.push(row);
          done = true;
          console.log(
            `[${i + 1}/30] OK - ${row.citizenEmail} - ${row.title} - ${row.address} - Ticket: ${row.ticketId || 'n/a'}`
          );
          break;
        } catch (error) {
          lastError = error;
          console.error(
            `[${i + 1}/30] Versuch ${attempt}/${MAX_ATTEMPTS} fehlgeschlagen: ${
              error && error.message ? error.message : String(error)
            }`
          );
          await sleep(1200);
        }
      }
      if (!done) {
        const citizen = citizens[scenario.citizenIndex];
        results.push({
          ok: false,
          citizenName: citizen.name,
          citizenEmail: citizen.email,
          severity: scenario.severity,
          title: scenario.title,
          address: scenario.address,
          ticketId: '',
          imagesAttached: pickImages(i, scenario.imageCount).map((filePath) => path.basename(filePath)),
          error: lastError && lastError.message ? lastError.message : String(lastError),
        });
      }
    }
  } finally {
    await browser.close();
  }

  const ok = results.filter((row) => row.ok).length;
  const failed = results.length - ok;
  const payload = {
    startedAt: runStartedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    total: results.length,
    ok,
    failed,
    sourceAddressFile: ADDRESS_FILE,
    results,
  };

  const jsonPath = path.join(reportDir, 'results.json');
  const mdPath = path.join(reportDir, 'results.md');
  await fs.writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.writeFile(
    mdPath,
    buildMarkdown(
      {
        startedAt: payload.startedAt,
        baseUrl: payload.baseUrl,
        ok,
        failed,
      },
      results
    ),
    'utf8'
  );

  console.log(`REPORT_JSON=${jsonPath}`);
  console.log(`REPORT_MD=${mdPath}`);
  console.log(`SUMMARY_OK=${ok}`);
  console.log(`SUMMARY_FAILED=${failed}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('EXTRA30_FATAL', error);
  process.exit(1);
});
