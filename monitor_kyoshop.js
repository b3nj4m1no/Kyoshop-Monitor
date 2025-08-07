import fetch from 'node-fetch';
import cheerio from 'cheerio';
import fs from 'fs';

const CONFIG_FILE = 'config.json';
const STATE_FILE = 'products_state.json';

function loadConfig() {
    return JSON.parse(fs.readFileSync(CONFIG_FILE));
}

function logAlert(message, logFile) {
    fs.appendFileSync(logFile, message + '\n');
}

function logError(error, logFile) {
    const msg = `[${new Date().toISOString()}] ERROR: ${error}`;
    fs.appendFileSync(logFile, msg + '\n');
}

async function getProductUrlsFromSitemap(sitemapUrl) {
    try {
        const resp = await fetch(sitemapUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KyoshopMonitorBot/1.0)' } });
        const xml = await resp.text();
        const $ = cheerio.load(xml, { xmlMode: true });
        const urls = [];
        $('loc').each((i, el) => {
            const url = $(el).text().trim();
            if (url.startsWith('http') && url.includes('/shop/')) urls.push(url);
        });
        console.log(`Totale URL prodotto trovati: ${urls.length}`);
        return urls;
    } catch (err) {
        throw `Errore nel download della sitemap: ${err}`;
    }
}

async function getProductInfo(productUrl) {
    try {
        const resp = await fetch(productUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KyoshopMonitorBot/1.0)' } });
        const html = await resp.text();
        const $ = cheerio.load(html);
        const name = $('h1.product_title').text().trim() || 'N/A';
        let price = null;
        const priceTags = $('p.price span.woocommerce-Price-amount bdi');
        if (priceTags.length > 0) {
            const prices = [];
            priceTags.each((i, el) => {
                prices.push(parseFloat($(el).text().replace('€', '').replace(',', '.').trim()));
            });
            price = prices.length > 1 ? prices : prices[0];
        }
        let available = $('button.single_add_to_cart_button').length > 0;
        if (price === null) available = false;
        const qtyTag = $('input.qty');
        const quantity = qtyTag.attr('max') || null;
        return { name, price, available, quantity };
    } catch (err) {
        throw `Errore su ${productUrl}: ${err}`;
    }
}

function loadState() {
    if (!fs.existsSync(STATE_FILE)) return {};
    return JSON.parse(fs.readFileSync(STATE_FILE));
}

function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

function loadLastAlerts(logFile) {
    if (!fs.existsSync(logFile)) return [];
    const lines = fs.readFileSync(logFile, 'utf-8').trim().split('\n');
    // Prendi solo gli ultimi alert (non errori)
    return lines.filter(l => !l.includes('ERROR:'));
}

function checkChanges(oldState, products) {
    const alerts = [];
    for (const prod of products) {
        const { name, price, available } = prod;
        const oldProd = oldState[name];
        if (!oldProd) {
            alerts.push(`🆕 Nuovo prodotto: ${name} (${price}€)`);
        } else {
            if (!oldProd.available && available) alerts.push(`🔄 Restock: ${name} (${price}€)`);
            if (oldProd.available && !available) alerts.push(`❌ Sold out: ${name}`);
            if (price !== oldProd.price && price !== null && oldProd.price !== null) {
                try {
                    const perc = ((price - oldProd.price) / oldProd.price) * 100;
                    alerts.push(`💸 Prezzo cambiato: ${name} da ${oldProd.price}€ a ${price}€ (${perc.toFixed(2)}%)`);
                } catch {
                    alerts.push(`💸 Prezzo cambiato: ${name} da ${oldProd.price}€ a ${price}€`);
                }
            }
        }
    }
    return alerts;
}

async function main() {
    const config = loadConfig();
    const { sitemapUrl, pollInterval, alertLogFile } = config;
    let lastAlerts = loadLastAlerts(alertLogFile);

    try {
        const oldState = loadState();
        const urls = await getProductUrlsFromSitemap(sitemapUrl);
        const products = [];
        for (const url of urls) {
            try {
                const prod = await getProductInfo(url);
                products.push(prod);
                console.log(`Prodotto estratto:`, prod);
            } catch (e) {
                logError(e, alertLogFile);
                console.log(e);
            }
        }
        if (Object.keys(oldState).length === 0) {
            console.log('Inizializzazione: salvataggio di tutti i prodotti.');
            for (const prod of products) {
                oldState[prod.name] = {
                    price: prod.price,
                    available: prod.available,
                    quantity: prod.quantity
                };
            }
            saveState(oldState);
        } else {
            const alerts = checkChanges(oldState, products);
            // Evita duplicati: stampa e logga solo alert nuovi
            const newAlerts = alerts.filter(a => !lastAlerts.includes(a));
            newAlerts.forEach(a => {
                console.log(a);
                logAlert(a, alertLogFile);
            });
            for (const prod of products) {
                oldState[prod.name] = {
                    price: prod.price,
                    available: prod.available,
                    quantity: prod.quantity
                };
            }
            saveState(oldState);
        }
    } catch (err) {
        logError(err, alertLogFile);
        console.log(err);
    }
}

async function mainLoop() {
    const config = loadConfig();
    const { pollInterval } = config;
    while (true) {
        await main();
        console.log(`Attendo ${pollInterval} secondi...`);
        await new Promise(res => setTimeout(res, pollInterval * 1000));
    }
}

mainLoop();