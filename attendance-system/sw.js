const CACHE_NAME = '7odorak-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon.png',
  './face-api.min.js',
  './models/tiny_face_detector_model-weights_manifest.json',
  './models/tiny_face_detector_model-shard1',
  './models/face_landmark_68_model-weights_manifest.json',
  './models/face_landmark_68_model-shard1',
  './models/face_recognition_model-weights_manifest.json',
  './models/face_recognition_model-shard1',
  './models/face_expression_model-weights_manifest.json',
  './models/face_expression_model-shard1'
];

// تثبيت التطبيق وتخزين الملفات
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Caching app assets...');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// تفعيل السيرفر ووركر وحذف الكاش القديم
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME)
        .map(key => caches.delete(key))
      );
    })
  );
});

// استدعاء الملفات من الكاش أولاً (Offline First)
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      // لو الملف موجود في الكاش، هاته. لو لأ، هاته من النت
      return response || fetch(event.request);
    })
  );
});