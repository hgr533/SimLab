'use strict';

const CACHE_PREFIX = 'emerald-klondike-';
const CACHE_NAME = CACHE_PREFIX + 'v4';
const APP_ROOT = new URL('./', self.registration.scope).href;
const APP_INDEX = new URL('index.html', APP_ROOT).href;
const ASSETS = [
  'index.html', 'style.css', 'engine.js', 'app.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'
].map(file => new URL(file, APP_ROOT).href);
const ASSET_SET = new Set(ASSETS);
const APP_MARKER = /<meta\b(?=[^>]*\bname\s*=\s*["']application-name["'])(?=[^>]*\bcontent\s*=\s*["']Emerald Klondike["'])[^>]*>/i;

async function isGameDocument(response) {
  if (!response || !response.ok || response.redirected) return false;
  if (!response.headers.get('content-type')?.includes('text/html')) return false;
  return APP_MARKER.test(await response.clone().text());
}

async function mayCache(response, key) {
  if (!response || !response.ok || response.redirected || response.type === 'opaque') return false;
  if (new URL(response.url || key).origin !== self.location.origin) return false;
  if (key === APP_INDEX || key === APP_ROOT) return isGameDocument(response);
  // A sign-in or error page must never be stored under an asset filename.
  return !response.headers.get('content-type')?.includes('text/html');
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(ASSETS.map(async key => {
      const response = await fetch(key, { credentials: 'same-origin', cache: 'reload' });
      if (await mayCache(response, key)) {
        await cache.put(key, response.clone());
        if (key === APP_INDEX) await cache.put(APP_ROOT, response.clone());
      }
    }));
    // A missing optional icon should not prevent the worker from installing.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys()).filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(APP_ROOT)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        if (await isGameDocument(response)) {
          await cache.put(APP_INDEX, response.clone());
          await cache.put(APP_ROOT, response.clone());
        }
        // Online authentication redirects stay online; do not cache their pages.
        if (response.ok || response.redirected) return response;
        return (await cache.match(APP_INDEX)) || response;
      } catch {
        return (await cache.match(APP_INDEX)) || new Response(
          '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Emerald Klondike</title><body style="font:18px system-ui;background:#075b43;color:#fff;padding:2rem"><h1>Connect once to prepare your table</h1><p>Open Emerald Klondike online once, then return here to play offline.</p></body></html>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  const key = url.origin + url.pathname;
  if (!ASSET_SET.has(key)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(key);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (await mayCache(response, key)) await cache.put(key, response.clone());
      return response;
    } catch { return Response.error(); }
  })());
});


