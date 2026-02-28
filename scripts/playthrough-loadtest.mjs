import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = process.env.PLAYTHROUGH_BASE_URL || 'https://www.behebes.de';
const HEADLESS = process.env.PLAYTHROUGH_HEADLESS !== 'false';
const MAX_ATTEMPTS = 2;
const SCENARIOS_FILTER = String(process.env.PLAYTHROUGH_SCENARIOS || '')
  .split(',')
  .map((part) => Number(part.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);

const runStartedAt = new Date();
const runStamp = runStartedAt.toISOString().replace(/[:.]/g, '-');
const reportDir = path.resolve('manual/loadtest-results', runStamp);
const assetDir = path.resolve('manual/loadtest-assets');

const imagePool = [
  'free-01.jpg',
  'free-02.jpg',
  'free-03.jpg',
  'free-04.jpg',
  'free-05.jpg',
  'free-06.jpg',
  'free-07.jpg',
  'free-08.jpg',
];

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

const scenarios = [
  {
    citizenIndex: 0,
    severity: 'ernst',
    address: 'Hauptstrasse 8a, Otterberg',
    title: 'Tiefes Schlagloch in Fahrbahn',
    description:
      'In Otterberg, Hauptstrasse 8a, ist ein tiefes Schlagloch auf der rechten Fahrspur. Fahrzeuge weichen aus und geraten in den Gegenverkehr. Bitte kurzfristig absichern und reparieren.',
    imageCount: 1,
  },
  {
    citizenIndex: 1,
    severity: 'ernst',
    address: 'Hauptstrasse 14, Otterbach',
    title: 'Strassenbeleuchtung komplett ausgefallen',
    description:
      'In der Hauptstrasse in Otterbach sind seit gestern Abend mehrere Laternen ohne Funktion. Der Fussweg ist nachts kaum sichtbar. Es besteht Unfallgefahr fuer Fussgaenger.',
    imageCount: 1,
  },
  {
    citizenIndex: 2,
    severity: 'ernst',
    address: 'Lauterstrasse 12, Katzweiler',
    title: 'Kanaldeckel locker',
    description:
      'In Katzweiler in der Lauterstrasse klappert ein Kanaldeckel und hebt sich bei Ueberfahrt leicht an. Besonders fuer Radfahrer ist das gefaehrlich. Bitte zeitnah sichern.',
    imageCount: 0,
  },
  {
    citizenIndex: 3,
    severity: 'ernst',
    address: 'Hauptstrasse 5, Mehlbach',
    title: 'Verkehrsschild umgestuerzt',
    description:
      'In Mehlbach ist in der Hauptstrasse ein Vorfahrtsschild umgestuerzt und liegt am Fahrbahnrand. An der Kreuzung ist die Vorfahrt jetzt unklar. Bitte wieder aufstellen.',
    imageCount: 1,
  },
  {
    citizenIndex: 4,
    severity: 'ernst',
    address: 'Hauptstrasse 18, Schneckenhausen',
    title: 'Ast blockiert Gehweg',
    description:
      'In Schneckenhausen blockiert ein grosser abgeknickter Ast den Gehweg in der Hauptstrasse. Kinder muessen auf die Strasse ausweichen. Bitte den Ast entfernen.',
    imageCount: 1,
  },
  {
    citizenIndex: 5,
    severity: 'ernst',
    address: 'Hauptstrasse 3, Olsbruecken',
    title: 'Boeschung rutscht auf Weg',
    description:
      'In Olsbruecken ist am Weg entlang der Hauptstrasse die Boeschung teilweise abgerutscht. Erde liegt bereits auf dem Gehbereich. Bitte sichern, bevor mehr nachrutscht.',
    imageCount: 2,
  },
  {
    citizenIndex: 6,
    severity: 'ernst',
    address: 'Ringstrasse 9, Niederkirchen',
    title: 'Illegale Muellablagerung',
    description:
      'In Niederkirchen wurden mehrere Saecke mit Hausmuell an der Ringstrasse abgestellt. Der Bereich riecht stark und zieht Tiere an. Bitte entsorgen und kontrollieren.',
    imageCount: 1,
  },
  {
    citizenIndex: 7,
    severity: 'ernst',
    address: 'Schulstrasse 4, Heiligenmoschel',
    title: 'Scherben auf Spielplatz',
    description:
      'Am Spielplatz in Heiligenmoschel bei der Schulstrasse liegen viele Glasscherben im Sand. Es besteht Verletzungsgefahr fuer Kinder. Bitte um schnelle Reinigung.',
    imageCount: 0,
  },
  {
    citizenIndex: 8,
    severity: 'ernst',
    address: 'Talstrasse 7, Schallodenbach',
    title: 'Hydrant undicht',
    description:
      'In Schallodenbach tritt an einem Hydranten in der Talstrasse dauerhaft Wasser aus. Die Flaeche ist vereist bzw. sehr rutschig bei Kaltwetter. Bitte technische Pruefung.',
    imageCount: 1,
  },
  {
    citizenIndex: 9,
    severity: 'ernst',
    address: 'Hauptstrasse 11, Sulzbachtal',
    title: 'Defekte Fusswegbeleuchtung',
    description:
      'In Sulzbachtal ist auf dem Fussweg entlang der Hauptstrasse ein kompletter Beleuchtungsabschnitt dunkel. Gerade am spaeten Abend ist die Strecke unsicher.',
    imageCount: 0,
  },
  {
    citizenIndex: 0,
    severity: 'banal',
    address: 'Hauptstrasse 21, Otterberg',
    title: 'Muelleimer ueberfuellt',
    description:
      'Der oeffentliche Muelleimer in Otterberg in der Hauptstrasse ist seit Tagen ueberfuellt. Es liegen bereits Abfaelle daneben. Bitte bei der naechsten Tour leeren.',
    imageCount: 0,
  },
  {
    citizenIndex: 1,
    severity: 'banal',
    address: 'Lauterstrasse 4, Otterbach',
    title: 'Graffiti an Bushaltestelle',
    description:
      'An einer Bushaltestelle in Otterbach wurde eine Seitenwand mit Graffiti beschmiert. Keine akute Gefahr, aber unschoenes Erscheinungsbild. Bitte reinigen.',
    imageCount: 1,
  },
  {
    citizenIndex: 2,
    severity: 'banal',
    address: 'Hauptstrasse 9, Katzweiler',
    title: 'Parkbanklatte locker',
    description:
      'In Katzweiler ist an einer Parkbank an der Hauptstrasse eine Holzlatte locker. Die Bank ist noch nutzbar, sollte aber nachgezogen werden.',
    imageCount: 0,
  },
  {
    citizenIndex: 3,
    severity: 'ernst',
    address: 'Kirchstrasse 6, Mehlbach',
    title: 'Gullideckel abgesackt',
    description:
      'In Mehlbach ist in der Kirchstrasse ein Gullideckel stark abgesackt. Beim Ueberfahren gibt es harte Schlaege und Gefahr fuer Zweiradfahrer.',
    imageCount: 1,
  },
  {
    citizenIndex: 4,
    severity: 'banal',
    address: 'Hauptstrasse 2, Schneckenhausen',
    title: 'Randstreifen stark verwildert',
    description:
      'In Schneckenhausen waechst am Randstreifen der Hauptstrasse das Unkraut weit auf den Gehweg. Bitte in die naechste Pflege einplanen.',
    imageCount: 0,
  },
  {
    citizenIndex: 5,
    severity: 'ernst',
    address: 'Talstrasse 2, Olsbruecken',
    title: 'Starker Wasserabfluss aus Schacht',
    description:
      'In Olsbruecken laeuft aus einem Schacht in der Talstrasse kontinuierlich Wasser aus. Die Strasse ist bereits grossflaechig nass. Bitte Ursache pruefen.',
    imageCount: 2,
  },
  {
    citizenIndex: 6,
    severity: 'banal',
    address: 'Dorfstrasse 7, Niederkirchen',
    title: 'Hundekotbeutelspender leer',
    description:
      'In Niederkirchen ist der Hundekotbeutelspender in der Dorfstrasse leer. Bitte bei Gelegenheit auffuellen.',
    imageCount: 0,
  },
  {
    citizenIndex: 2,
    severity: 'ernst',
    address: 'Hauptstrasse 12, Heiligenmoschel',
    title: 'Riss an Stuetzmauer',
    description:
      'In Heiligenmoschel ist an einer kleinen Stuetzmauer in der Hauptstrasse ein deutlicher Laengsriss sichtbar. Bitte Bauamt zur Pruefung schicken.',
    imageCount: 1,
  },
  {
    citizenIndex: 7,
    severity: 'banal',
    address: 'Muehlweg 3, Schallodenbach',
    title: 'Strassenschild verschmutzt',
    description:
      'In Schallodenbach ist ein Strassenschild am Muehlweg stark verschmutzt und kaum lesbar. Keine Dringlichkeit, aber bitte reinigen.',
    imageCount: 0,
  },
  {
    citizenIndex: 9,
    severity: 'ernst',
    address: 'Brunnenstrasse 5, Sulzbachtal',
    title: 'Tiefe Kante zwischen Gehweg und Fahrbahn',
    description:
      'In Sulzbachtal an der Brunnenstrasse ist eine tiefe Kante zwischen Gehweg und Fahrbahn entstanden. Stolpergefahr insbesondere fuer aeltere Personen.',
    imageCount: 1,
  },
];

const imagePaths = imagePool.map((name) => path.join(assetDir, name));

function pickImages(index, count) {
  if (!count || count <= 0) return [];
  const selected = [];
  for (let i = 0; i < count; i += 1) {
    selected.push(imagePaths[(index + i) % imagePaths.length]);
  }
  return selected;
}

function extractTicketId(ticketText) {
  const candidates = String(ticketText || '').match(/[0-9a-f]{8}-[0-9a-f-]{27,}|[A-Z0-9-]{6,}/gi) || [];
  return candidates.length ? candidates[candidates.length - 1] : '';
}

async function ensureAssetsExist() {
  for (const filePath of imagePaths) {
    await fs.access(filePath);
  }
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
      // ignore dialog errors
    }
  });

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 120000 });
    await page.waitForSelector('input[name="name"]', { timeout: 45000 });
    await page.fill('input[name="name"]', citizen.name);
    await page.fill('input[name="email"]', citizen.email);

    const fullDescription = `[${scenario.severity.toUpperCase()}] ${scenario.title}\n\n${scenario.description}\n\nOrt: ${scenario.address}`;
    await page.fill('textarea[name="description"]', fullDescription);

    const addressInput = page.locator('input[name="citizen_location_query"]');
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

    const consent = page.locator('input[type="checkbox"]').first();
    if (!(await consent.isChecked())) {
      await consent.check({ force: true });
    }

    await page.click('button[type="submit"]', { force: true });
    const noLocationWarning = page.locator('.warning-modal .warning-card .warning-confirm');
    if (await noLocationWarning.isVisible().catch(() => false)) {
      const warningButtons = page.locator('.warning-modal .warning-card button');
      if ((await warningButtons.count()) >= 2) {
        await noLocationWarning.first().click({ force: true });
      }
    }
    await page.waitForSelector('.summary-grid', { timeout: 45000 });
    await page.click('.submission-preview-submit-inline button');
    await page.waitForSelector('.success-modal-card', { timeout: 90000 });

    const ticketText = (await page.locator('.success-modal-ticket').innerText()).trim();
    const ticketId = extractTicketId(ticketText);
    const validationCopy = (await page.locator('.success-modal-copy p').first().innerText()).trim();

    return {
      ok: true,
      citizenName: citizen.name,
      citizenEmail: citizen.email,
      severity: scenario.severity,
      address: scenario.address,
      title: scenario.title,
      imagesAttached: attachedImages.map((filePath) => path.basename(filePath)),
      ticketText,
      ticketId,
      validationCopy,
    };
  } finally {
    await context.close();
  }
}

function toMarkdownReport(runMeta, results) {
  const lines = [];
  lines.push(`# Playthrough Lasttest`);
  lines.push('');
  lines.push(`- Datum: ${runMeta.startedAt}`);
  lines.push(`- Ziel: ${runMeta.baseUrl}`);
  lines.push(`- Buerger: ${runMeta.citizenCount}`);
  lines.push(`- Meldungen gesamt: ${runMeta.total}`);
  lines.push(`- Erfolgreich: ${runMeta.ok}`);
  lines.push(`- Fehlgeschlagen: ${runMeta.failed}`);
  lines.push('');
  lines.push('| # | Status | Schwere | Buerger | E-Mail | Titel | Ort | Ticket | Bilder |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  results.forEach((result, idx) => {
    const status = result.ok ? 'OK' : 'FAIL';
    const ticket = result.ticketId || '-';
    const images = result.imagesAttached && result.imagesAttached.length ? result.imagesAttached.join(', ') : '-';
    const safeTitle = String(result.title || '').replace(/\|/g, '/');
    const safeAddress = String(result.address || '').replace(/\|/g, '/');
    lines.push(
      `| ${idx + 1} | ${status} | ${result.severity || '-'} | ${result.citizenName || '-'} | ${result.citizenEmail || '-'} | ${safeTitle} | ${safeAddress} | ${ticket} | ${images} |`
    );
  });
  return `${lines.join('\n')}\n`;
}

async function main() {
  await ensureAssetsExist();
  await fs.mkdir(reportDir, { recursive: true });

  const selectedEntries = scenarios
    .map((scenario, index) => ({ scenario, index }))
    .filter(({ index }) => SCENARIOS_FILTER.length === 0 || SCENARIOS_FILTER.includes(index + 1));

  if (selectedEntries.length === 0) {
    throw new Error('Keine gueltigen Szenarien zur Ausfuehrung ausgewaehlt.');
  }

  const browser = await chromium.launch({ headless: HEADLESS });
  const results = [];

  try {
    for (let i = 0; i < selectedEntries.length; i += 1) {
      const entry = selectedEntries[i];
      const scenario = entry.scenario;
      const scenarioNumber = entry.index + 1;
      let lastError = null;
      let succeeded = false;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          const result = await submitScenario(browser, scenario, entry.index);
          results.push(result);
          succeeded = true;
          console.log(
            `[${i + 1}/${selectedEntries.length}] OK (Szenario ${scenarioNumber}) - ${result.citizenEmail} - ${scenario.title} - Ticket: ${result.ticketId || 'n/a'}`
          );
          break;
        } catch (error) {
          lastError = error;
          console.error(
            `[${i + 1}/${selectedEntries.length}] Versuch ${attempt}/${MAX_ATTEMPTS} fehlgeschlagen (Szenario ${scenarioNumber}): ${
              error && error.message ? error.message : String(error)
            }`
          );
          await new Promise((resolve) => setTimeout(resolve, 1200));
        }
      }

      if (!succeeded) {
        const citizen = citizens[scenario.citizenIndex];
        results.push({
          ok: false,
          citizenName: citizen.name,
          citizenEmail: citizen.email,
          severity: scenario.severity,
          address: scenario.address,
          title: scenario.title,
          imagesAttached: pickImages(entry.index, scenario.imageCount).map((filePath) => path.basename(filePath)),
          ticketText: '',
          ticketId: '',
          validationCopy: '',
          error: lastError && lastError.message ? lastError.message : String(lastError),
        });
      }
    }
  } finally {
    await browser.close();
  }

  const ok = results.filter((result) => result.ok).length;
  const failed = results.length - ok;

  const reportPayload = {
    startedAt: runStartedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    citizenCount: citizens.length,
    total: selectedEntries.length,
    ok,
    failed,
    citizens,
    results,
  };

  const jsonPath = path.join(reportDir, 'results.json');
  const mdPath = path.join(reportDir, 'results.md');
  await fs.writeFile(jsonPath, `${JSON.stringify(reportPayload, null, 2)}\n`, 'utf8');
  await fs.writeFile(
    mdPath,
    toMarkdownReport(
      {
        startedAt: runStartedAt.toISOString(),
        baseUrl: BASE_URL,
        citizenCount: citizens.length,
        total: selectedEntries.length,
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
  console.error('LOADTEST_FATAL', error);
  process.exit(1);
});
