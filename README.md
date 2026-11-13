# Passalong

Passalong is a small, installable web app for sharing contact-style information between browsers. It is built with SvelteKit and stores saved and received records in the browser's IndexedDB.

## How it works

1. Enter a name, email, phone number, subject, and message, then save the record to this browser.
2. Select one or more saved records and generate a link. The app encodes the selected records as Base64URL JSON in a `#data=` URL fragment and displays a QR code. The data is created entirely in the browser; it is not uploaded.
3. Open the link in the app on another browser. The app validates the records, saves them to the `receivedData` store in `DataTransferDB`, skips records already received with the same ID, and removes the data fragment from the address bar.
4. Browse, open, delete, export, or clear received records from the inbox. Manage saved records from the share page.

The link contains the actual information. Base64URL is encoding, not encryption: anyone with the link can read its contents. Do not share sensitive information this way. The sender and receiver must use the same app origin.

## Run locally

Requirements: Node.js and npm.

```sh
npm install
npm run dev
```

To build and preview the production app:

```sh
npm run build
npm run preview
```

For PWA installation and service-worker behavior, serve the app from `localhost` or an HTTPS origin.

## Project map

- `src/routes/+page.svelte` - interface, multi-record selection, URL encoding/decoding, QR generation, and IndexedDB operations.
- `static/manifest.webmanifest` - PWA install metadata.
- `static/service-worker.js` - cached application shell and offline navigation behavior.
