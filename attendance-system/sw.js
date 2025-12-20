const CACHE_NAME = '7odorak-v2'; // غيرت الاسم عشان يجبر المتصفح يحدث الكاش
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon.png',
  './face-api.min.js'
  // شيلنا كل الموديلات من هنا مؤقتاً
];

self.addEventListener('install', (event) => {
  self.skipWaiting(); // أمر مهم للتفعيل الفوري
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Caching essential assets only...');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  return self.clients.claim(); // بيخلي الـ SW يسيطر على الصفحة فوراً
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
