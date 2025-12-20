const CACHE_NAME = '7odorak-v2'; // تغيير الإصدار لتحديث الكاش
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon.png',
  './face-api.min.js'
  // ملاحظة: تأكد أن جميع ملفات الموديلات (models) موجودة فعلياً في المسارات المحددة
];

// تثبيت التطبيق وتخزين الملفات
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('جاري تخزين ملفات النظام...');
      return cache.addAll(ASSETS_TO_CACHE).catch(err => {
          console.error('فشل تخزين بعض الملفات، تأكد من صحة المسارات:', err);
      });
    })
  );
  self.skipWaiting();
});

// تفعيل وتحديث الكاش
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// العمل بدون إنترنت (Offline First)
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
