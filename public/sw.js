/*
  Minechat 前端静态资源离线缓存（CacheStorage）

  目标：
  - 首次访问从网络获取 HTML/JS/CSS/图片等静态资源并写入本地缓存（浏览器/Chromium 的磁盘缓存目录）。
  - 后续访问同资源直接从缓存返回，不再向服务器发起网络请求。
  - 忽略服务器 Cache-Control / Expires 等缓存策略（以本 SW 的策略为准）。

  注意：
  - 这是“应用层缓存”，不影响 API 请求。
  - 浏览器仍可能对 sw.js 本身进行更新检查（属于平台行为）。
*/

const CACHE_PREFIX = 'minechat-static';
const CACHE_VERSION = 1;
const CACHE_NAME = `${CACHE_PREFIX}-v${CACHE_VERSION}`;

// OSS 资源“永久缓存”（按需写入，命中即离线可用）
// 说明：浏览器/Chromium 仍可能在磁盘压力下回收存储；前端会尝试申请 Persistent Storage。
const OSS_HOST = 'ag-chatapp.oss-cn-hangzhou.aliyuncs.com';
const OSS_CACHE_PREFIX = 'minechat-oss-perma';
const OSS_CACHE_VERSION = 1;
const OSS_CACHE_NAME = `${OSS_CACHE_PREFIX}-v${OSS_CACHE_VERSION}`;

const CACHEABLE_EXTS = new Set([
  '.html',
  '.js',
  '.css',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.ico',
  '.json',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf'
]);

function isCacheableStaticRequest(request) {
  try {
    if (!request || request.method !== 'GET') return false;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return false;

    // 导航请求（如 / 或 /chat.html）：按 HTML 处理
    if (request.mode === 'navigate') return true;

    const pathname = url.pathname || '';
    const dot = pathname.lastIndexOf('.');
    const ext = dot >= 0 ? pathname.slice(dot).toLowerCase() : '';
    if (CACHEABLE_EXTS.has(ext)) return true;

    // 不缓存无扩展名接口（如 /config、/api/...）
    return false;
  } catch {
    return false;
  }
}

function isOssRequest(request) {
  try {
    if (!request || request.method !== 'GET') return false;
    const url = new URL(request.url);
    return url.hostname === OSS_HOST;
  } catch {
    return false;
  }
}

async function ossCacheFirst(request) {
  const cache = await caches.open(OSS_CACHE_NAME);
  // 使用 URL 字符串做 key，避免同一 URL 因 mode/no-cors 差异导致 cache.match 失配。
  const cacheKey = request.url;

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  // 未命中：走网络并写入缓存（跨域资源可能是 opaque 响应，也允许缓存）。
  const reqNoStore = new Request(request, { cache: 'no-store' });
  const resp = await fetch(reqNoStore);
  if (resp) {
    try {
      await cache.put(cacheKey, resp.clone());
    } catch {
      // ignore quota / opaque put failure
    }
  }
  return resp;
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  // 先命中缓存：命中则完全不走网络。
  const cached = await cache.match(request);
  if (cached) return cached;

  // 未命中：走网络（强制绕过 HTTP 缓存），成功后落盘。
  const resp = await fetch(request, { cache: 'no-store' });
  if (resp && resp.ok) {
    try {
      await cache.put(request, resp.clone());
    } catch {
      // ignore quota / opaque etc.
    }
  }
  return resp;
}

self.addEventListener('install', (event) => {
  // 让新 SW 尽快接管。
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter((k) => k.startsWith(`${CACHE_PREFIX}-`) && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        );
      } catch {
        // ignore
      }

      try {
        await self.clients.claim();
      } catch {
        // ignore
      }
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // OSS 域名资源：持久缓存（cache-first）。
  if (isOssRequest(req)) {
    event.respondWith(
      (async () => {
        try {
          return await ossCacheFirst(req);
        } catch {
          const cache = await caches.open(OSS_CACHE_NAME);
          const cached = await cache.match(req.url);
          if (cached) return cached;
          return new Response('', { status: 504 });
        }
      })()
    );
    return;
  }

  if (!isCacheableStaticRequest(req)) return;

  event.respondWith(
    (async () => {
      try {
        return await cacheFirst(req);
      } catch {
        // 离线且未命中缓存：返回一个尽量友好的降级
        if (req.mode === 'navigate') {
          return new Response('离线：页面尚未缓存。请联网访问一次以生成离线缓存。', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        }
        return new Response('', { status: 504 });
      }
    })()
  );
});
