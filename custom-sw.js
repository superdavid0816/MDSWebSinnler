console.log('Custom SW loaded at:', new Date().toISOString());
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  console.log('Fetch event:', event.request.method, event.request.url);
  if (url.pathname === '/api/GoogleDriveService/GetFiles' && event.request.method === 'POST') {
    console.log('Intercepted POST:', event.request.url, 'Params:', url.search);
    event.request.clone().text().then(body => console.log('POST body:', body));
    event.respondWith(
      caches.open('image-api-cache').then(cache => {
        const cacheKey = new Request(url.pathname, {
          method: event.request.method,
          headers: event.request.headers
        });
        return cache.match(cacheKey).then(cachedResponse => {
          console.log('Cache hit:', !!cachedResponse);
          const fetchPromise = fetch(event.request).then(networkResponse => {
            console.log('Network response:', networkResponse.ok, networkResponse.status, networkResponse.headers.get('Content-Type'));
            if (networkResponse.ok && networkResponse.status === 200) {
              cache.put(cacheKey, networkResponse.clone());
              console.log('Cached response for:', url.pathname);
            }
            return networkResponse;
          }).catch(err => {
            console.error('Fetch failed:', err);
            return cachedResponse || new Response(null, { status: 503, statusText: 'Service Unavailable' });
          });
          return cachedResponse || fetchPromise;
        });
      })
    );
  }
});