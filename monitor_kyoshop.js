import fetch from 'node-fetch';
import cheerio from 'cheerio';
import fs from 'fs';
import TelegramBot from 'node-telegram-bot-api';

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
        // Migliorato: controlla anche la presenza del messaggio "Prodotto Esaurito"
        let available = $('button.single_add_to_cart_button').length > 0;
        if ($('p.stock.out-of-stock').length > 0) available = false;
        if (price === null) available = false;
        const qtyTag = $('input.qty');
        const quantity = qtyTag.attr('max') || null;
        const imageUrl = $('div.woocommerce-product-gallery__image img').attr('src') || null;
        return { name, price, available, quantity, imageUrl };
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
            if (price !== null && oldProd.price !== null && price !== oldProd.price) {
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

async function sendTelegramAlert(bot, chatId, message, url, imageUrl) {
    const opts = {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '🛒 Acquista ora', url: url }
                ]
            ]
        }
    };
    try {
        if (imageUrl) {
            await bot.sendPhoto(chatId, imageUrl, { ...opts, caption: message });
        } else {
            await bot.sendMessage(chatId, message, opts);
        }
    } catch (err) {
        logError(`Telegram error: ${err}`, loadConfig().alertLogFile);
    }
}

function isSamePrice(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((v, i) => v === b[i]);
    }
    return a === b;
}

function formatPrice(price) {
    if (Array.isArray(price)) {
        return price[0] + '€';
    }
    return price + '€';
}

function formatAlert(prod, oldProd) {
    // Nuovo prodotto
    if (!oldProd) {
        return `
✨ <b>NUOVO ARRIVO!</b> ✨
<b>${prod.name}</b>
💰 <b>Prezzo:</b> <code>${formatPrice(prod.price)}</code>
${prod.quantity ? `📦 <b>Disponibilità:</b> <code>${prod.quantity}</code>` : ''}
👇 <b>Scopri di più e acquista ora!</b>
        `.trim();
    }
    // Restock
    if (!oldProd.available && prod.available) {
        return `
🔄 <b>RESTOCK!</b>
<b>${prod.name}</b>
💰 <b>Prezzo:</b> <code>${formatPrice(prod.price)}</code>
${prod.quantity ? `📦 <b>Disponibilità:</b> <code>${prod.quantity}</code>` : ''}
👇 <b>Non perdere l'occasione!</b>
        `.trim();
    }
    // Sold out
    if (oldProd.available && !prod.available) {
        return `
❌ <b>Sold Out!</b>
<b>${prod.name}</b>
⏳ <i>Al momento non disponibile.</i>
        `.trim();
    }
    // Prezzo cambiato (array o singolo)
    if (!isSamePrice(prod.price, oldProd.price) && prod.price !== null && oldProd.price !== null) {
        let oldP = Array.isArray(oldProd.price) ? oldProd.price[0] : oldProd.price;
        let newP = Array.isArray(prod.price) ? prod.price[0] : prod.price;
        const perc = ((newP - oldP) / oldP * 100).toFixed(2);
        return `
💸 <b>PREZZO AGGIORNATO!</b>
<b>${prod.name}</b>
<b>${oldP}€</b> <b>→</b> <b>${newP}€</b> <i>(${perc > 0 ? '+' : ''}${perc}%)</i>
${prod.quantity ? `📦 <b>Disponibilità:</b> <code>${prod.quantity}</code>` : ''}
🔥 <b>Approfitta subito del nuovo prezzo!</b>
        `.trim();
    }
    return null;
}

function cleanName(name) {
    return name.split('|')[0].trim();
}

async function main() {
    const config = loadConfig();
    const { sitemapUrl, pollInterval, alertLogFile, telegramToken, telegramChatId } = config;
    let lastAlerts = loadLastAlerts(alertLogFile);

    const bot = telegramToken && telegramChatId ? new TelegramBot(telegramToken) : null;

    try {
        const oldState = loadState();
        const urls = await getProductUrlsFromSitemap(sitemapUrl);
        const products = [];
        for (const url of urls) {
            try {
                const prod = await getProductInfo(url);

                // Escludi prodotti con prezzo 0 o null (anche se array)
                let priceToCheck = Array.isArray(prod.price) ? prod.price[0] : prod.price;
                if (priceToCheck === 0 || priceToCheck === null) continue;

                const oldProd = oldState[prod.name];
                let alert = null;

                if (!oldProd) {
                    alert = `🆕 <b>Nuovo prodotto</b>\n<b>${cleanName(prod.name)}</b>\nPrezzo: <b>${formatPrice(prod.price)}</b>`;
                } else {
                    if (!oldProd.available && prod.available) {
                        alert = `🔄 <b>Restock</b>\n<b>${cleanName(prod.name)}</b>\nPrezzo: <b>${formatPrice(prod.price)}</b>`;
                    }
                    if (oldProd.available && !prod.available) {
                        alert = `❌ <b>Sold out</b>\n<b>${cleanName(prod.name)}</b>`;
                    }
                    if (!isSamePrice(prod.price, oldProd.price) && prod.price !== null && oldProd.price !== null) {
                        // Se entrambi sono array, considera solo il primo prezzo
                        if (Array.isArray(prod.price) && Array.isArray(oldProd.price)) {
                            if (prod.price[0] !== oldProd.price[0]) {
                                const perc = ((prod.price[0] - oldProd.price[0]) / oldProd.price[0] * 100).toFixed(2);
                                alert = `💸 <b>Prezzo cambiato</b>\n<b>${cleanName(prod.name)}</b>\n<b>${oldProd.price[0]}€ → ${prod.price[0]}€</b> <i>(${perc > 0 ? '+' : ''}${perc}%)</i>`;
                            }
                        } else if (prod.price !== oldProd.price) {
                            const perc = ((prod.price - oldProd.price) / oldProd.price) * 100;
                            alert = `💸 <b>Prezzo cambiato</b>\n<b>${cleanName(prod.name)}</b>\n<b>${oldP}€ → ${newP}€</b> <i>(${perc > 0 ? '+' : ''}${perc}%)</i>`;
                        }
                    }
                }

                if (alert) {
                    console.log(alert.replace(/<[^>]+>/g, ''));
                    logAlert(alert.replace(/<[^>]+>/g, ''), alertLogFile);
                    if (bot) await sendTelegramAlert(bot, telegramChatId, alert, url, prod.imageUrl);
                }

                oldState[prod.name] = {
                    price: prod.price,
                    available: prod.available,
                    quantity: prod.quantity
                };
                saveState(oldState);

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
            for (const a of newAlerts) {
                console.log(a);
                logAlert(a, alertLogFile);
                if (bot) await sendTelegramAlert(bot, telegramChatId, a);
            }
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