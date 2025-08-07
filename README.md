# Kyoshop Monitor

Kyoshop Monitor is a Node.js bot designed to track product availability and price changes on the Kyoshop website. It sends real-time notifications to a Telegram channel, helping collectors and shop managers stay updated on new arrivals, restocks, and price drops.

## Features

- Monitors all products listed in the Kyoshop sitemap
- Detects new products, restocks, sold-out items, and price changes
- Sends beautiful, formatted alerts to Telegram (with product image and direct link)
- Filters out showcase items (products with price 0 or null)
- Customizable alert messages and inline buttons
- Easy configuration via `config.json`
- Saves product state to avoid duplicate alerts

## Requirements

- Node.js v18 or newer
- Telegram Bot Token
- Access to the Kyoshop product sitemap

## Installation

1. Clone this repository:
    ```bash
    git clone https://github.com/yourusername/kyoshop-monitor.git
    cd kyoshop-monitor
    ```

2. Install dependencies:
    ```bash
    npm install
    ```

3. Configure your bot:
    - Fill in your Telegram bot token, chat ID, and Kyoshop sitemap URL

## Usage

Start the monitor with:

```bash
node monitor_kyoshop.js
```

The bot will continuously check for product updates and send alerts to your Telegram channel.

## Configuration

Edit `config.json` to set:

- `telegramToken`: Your Telegram bot token
- `telegramChatId`: The chat/channel ID where alerts will be sent
- `sitemapUrl`: The Kyoshop product sitemap URL
- `pollInterval`: How often to check for updates (in milliseconds)

## License

See [LICENSE](LICENSE) for usage restrictions.

## Author

Matthew Gasparetti

---

**Note:**  
This project is not affiliated with Kyoshop.  
For questions or suggestions, open an issue or contact the author.

