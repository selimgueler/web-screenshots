# 🌐 Site Screenshotter

Crawl a website and take full-page JPEG screenshots of every internal page it finds. Supports authenticated sites with an interactive login mode.

## Setup

```bash
# Install dependencies
npm install

# Install browser (first time only)
npx playwright install chromium
```

## Usage

```bash
# Public site (headless)
node index.js https://example.com

# Site requiring login (opens visible browser)
node index.js https://example.com --login
```

### Login Mode

When you pass `--login`, the script:

1. Opens a **visible** browser window at the target URL
2. Pauses and waits for you to log in manually
3. You press **Enter** in the terminal when you're done
4. Crawling begins with your authenticated session

This works with any auth method — username/password, SSO, OAuth, 2FA, etc.

## Configuration

Edit the `config` object at the top of `index.js`:

| Option | Default | Description |
|--------|---------|-------------|
| `format` | `jpeg` | `jpeg` or `png` |
| `quality` | `85` | JPEG quality (1-100) |
| `fullPage` | `true` | Capture full scrollable page |
| `viewportWidth` | `1440` | Browser viewport width |
| `viewportHeight` | `900` | Browser viewport height |
| `maxPages` | `50` | Max pages to screenshot |
| `maxDepth` | `3` | How deep to follow links |
| `timeout` | `30000` | Page load timeout (ms) |
| `waitAfterLoad` | `1500` | Extra wait for lazy content (ms) |
| `outputDir` | `./screenshots` | Output directory |

## Features

- **Interactive login** — manually log in via a visible browser, then crawl authenticated
- Crawls all internal links (same-origin only)
- Full-page scrollable screenshots
- Auto-dismisses common cookie/consent banners
- Deduplicates URLs (normalizes trailing slashes, strips tracking params)
- Saves a `manifest.json` with all results
- Configurable depth, page limit, viewport size
- Safety: skips PDFs, images, mailto links, etc.

## Output

```
screenshots/
├── index.jpeg
├── about.jpeg
├── blog.jpeg
├── blog__my-first-post.jpeg
├── contact.jpeg
└── manifest.json
```

The `manifest.json` contains metadata about the crawl — timestamp, config used, and a list of all pages with their status (success/error).
