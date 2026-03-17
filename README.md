# tab-limit-chrome-ext

Chrome extension that keeps your tab count under a configured limit by closing the least recently touched tab whenever a new tab pushes you over the cap.

## What it does

- Tracks tab IDs, window IDs, and a touch counter in `chrome.storage.local`
- Updates recency when a tab is created, activated, moved, or replaced
- Closes the least recently touched tab when the total open tab count exceeds the configured limit
- Stores no page content and requests no host permissions

## Load it in Chrome

1. Open `chrome://extensions`
2. Turn on `Developer mode`
3. Click `Load unpacked`
4. Select this repo folder: `/Users/bryanwhiting/gh/bryanwhiting/tab-limit-chrome-ext`

## Use it

1. Click the extension action
2. Set your max tab count
3. Open tabs normally

If your limit is `5` and opening a sixth tab would exceed it, the extension closes the least recently touched tracked tab.
