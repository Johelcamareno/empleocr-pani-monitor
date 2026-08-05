import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SOURCE_URL =
  'https://pani.go.cr/tramites-y-servicios/reclutamiento-recursos-humanos/';
const OUTPUT_PATH = path.resolve('data/pani.json');
const ARTIFACT_DIR = path.resolve('artifacts');
const SCREENSHOT_PATH = path.join(ARTIFACT_DIR, 'pani-ultima-ejecucion.png');
const HTML_PATH = path.join(ARTIFACT_DIR, 'pani-ultima-ejecucion.html');

const nowIso = () => new Date().toISOString();

async function readPrevious() {
  try {
    return JSON.parse(await readFile(OUTPUT_PATH, 'utf8'));
  } catch {
    return null;
  }
}

async function writeResult(result) {
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(
    OUTPUT_PATH,
    JSON.stringify(result, null, 2) + '\n',
    'utf8'
  );
}

function isChallenge(title, text, html) {
  const sample = `${title}\n${text}\n${html}`.toLowerCase();
  return [
    'just a moment',
    'checking your browser',
    'verify you are human',
    'enable javascript and cookies',
    'cf-chl-',
    'cloudflare ray id',
    'attention required'
  ].some((term) => sample.includes(term));
}

async function waitForChallenge(page) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const title = await page.title().catch(() => '');
    const text = await page.locator('body').innerText().catch(() => '');
    const html = await page.content().catch(() => '');

    if (!isChallenge(title, text.slice(0, 5000), html.slice(0, 15000))) {
      return;
    }

    console.log(
      `Cloudflare sigue visible. Espera ${attempt}/6 antes de volver a comprobar.`
    );
    await page.waitForTimeout(10000);
  }

  throw new Error(
    'El PANI mantuvo la pantalla de verificación de Cloudflare durante un minuto.'
  );
}

async function selectUsefulContent(page) {
  const result = await page.evaluate(() => {
    const selectors = [
      'main article .entry-content',
      'article .entry-content',
      '.elementor-widget-theme-post-content',
      '.elementor-location-single',
      'main article',
      'article',
      'main',
      'body'
    ];

    const candidates = selectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .filter((element, index, array) => array.indexOf(element) === index)
      .map((element) => {
        const text = (element.innerText || '').replace(/\s+/g, ' ').trim();
        const normalized = text.toLowerCase();
        let score = text.length;

        [
          'reclutamiento',
          'recursos humanos',
          'fecha de inscripción',
          'puesto vacante',
          'plaza vacante',
          'personas oferentes'
        ].forEach((term) => {
          if (normalized.includes(term)) score += 25000;
        });

        return { element, text, score };
      })
      .sort((a, b) => b.score - a.score);

    if (!candidates.length) {
      throw new Error('No se encontró contenido utilizable en la página.');
    }

    const selected = candidates[0].element.cloneNode(true);

    selected
      .querySelectorAll(
        'script,style,noscript,svg,canvas,iframe,nav,header,footer,form,' +
        '.cookie,.cookies,.menu,.navigation,.social,.share'
      )
      .forEach((node) => node.remove());

    selected
      .querySelectorAll('[style]')
      .forEach((node) => node.removeAttribute('style'));

    const html = selected.outerHTML;
    const text = (selected.innerText || candidates[0].text)
      .replace(/\s+/g, ' ')
      .trim();

    const links = Array.from(selected.querySelectorAll('a[href]'))
      .map((anchor) => ({
        text: (anchor.innerText || '').replace(/\s+/g, ' ').trim(),
        url: new URL(anchor.getAttribute('href'), document.baseURI).href
      }))
      .filter((item) => item.text || item.url)
      .slice(0, 300);

    return { html, text, links };
  });

  return result;
}

async function main() {
  const previous = await readPrevious();
  await mkdir(ARTIFACT_DIR, { recursive: true });

  let browser;
  let page;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    const context = await browser.newContext({
      locale: 'es-CR',
      timezoneId: 'America/Costa_Rica',
      viewport: { width: 1440, height: 1100 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/143.0.0.0 Safari/537.36',
      extraHTTPHeaders: {
        'Accept-Language': 'es-CR,es;q=0.9,en;q=0.7'
      }
    });

    page = await context.newPage();
    page.setDefaultNavigationTimeout(90000);
    page.setDefaultTimeout(30000);

    console.log(`Abriendo ${SOURCE_URL}`);
    const response = await page.goto(SOURCE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 90000
    });

    if (!response) {
      throw new Error('Playwright no recibió una respuesta HTTP del PANI.');
    }

    console.log(`Respuesta inicial: HTTP ${response.status()}`);
    await waitForChallenge(page);

    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);

    const title = await page.title();
    const finalUrl = page.url();
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const fullHtml = await page.content();

    if (isChallenge(title, bodyText.slice(0, 6000), fullHtml.slice(0, 20000))) {
      throw new Error(
        'La página final todavía corresponde a una verificación de Cloudflare.'
      );
    }

    const content = await selectUsefulContent(page);
    const normalized = content.text.toLowerCase();

    const looksCorrect = [
      'reclutamiento',
      'recursos humanos',
      'fecha de inscripción',
      'puesto vacante',
      'plaza vacante',
      'personas oferentes'
    ].some((term) => normalized.includes(term));

    if (!looksCorrect || content.html.length < 500) {
      throw new Error(
        'Playwright abrió una página, pero no reconoció el contenido de reclutamiento.'
      );
    }

    const hash = createHash('sha256')
      .update(content.html, 'utf8')
      .digest('hex');

    const fetchedAt = nowIso();

    await page.screenshot({
      path: SCREENSHOT_PATH,
      fullPage: true
    }).catch(() => {});

    await writeFile(HTML_PATH, fullHtml, 'utf8').catch(() => {});

    const result = {
      version: 1,
      ok: true,
      status: 'OK',
      source: 'PANI',
      sourceUrl: SOURCE_URL,
      finalUrl,
      fetchedAt,
      lastSuccessAt: fetchedAt,
      pageTitle: title,
      contentHash: hash,
      changed:
        !previous ||
        previous.ok !== true ||
        previous.contentHash !== hash,
      html: content.html,
      textPreview: content.text.slice(0, 3000),
      links: content.links,
      runner: {
        service: 'GitHub Actions',
        browser: 'Playwright Chromium'
      }
    };

    await writeResult(result);

    console.log(
      `PANI leído correctamente. HTML: ${content.html.length} caracteres.`
    );
    console.log(`Cambio detectado: ${result.changed ? 'sí' : 'no'}`);
  } catch (error) {
    const fetchedAt = nowIso();
    const message = error instanceof Error ? error.message : String(error);

    if (page) {
      await page.screenshot({
        path: SCREENSHOT_PATH,
        fullPage: true
      }).catch(() => {});

      const currentHtml = await page.content().catch(() => '');
      if (currentHtml) {
        await writeFile(HTML_PATH, currentHtml, 'utf8').catch(() => {});
      }
    }

    const result = {
      version: 1,
      ok: false,
      status: 'ERROR',
      source: 'PANI',
      sourceUrl: SOURCE_URL,
      fetchedAt,
      lastSuccessAt:
        previous?.lastSuccessAt ||
        (previous?.ok ? previous.fetchedAt : null),
      error: message,
      previousContentHash: previous?.contentHash || null,
      runner: {
        service: 'GitHub Actions',
        browser: 'Playwright Chromium'
      }
    };

    await writeResult(result);
    console.error(`Fallo al consultar el PANI: ${message}`);
    process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => {});
  }
}

await main();
