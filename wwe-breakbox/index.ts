import { registerRootComponent } from 'expo';

import App from './App';

if (__DEV__) {
  const originalFetch = global.fetch;
  global.fetch = async (...args: Parameters<typeof fetch>) => {
    const [input, init] = args;
    const url = typeof input === 'string' ? input : (input as Request).url;
    const method = init?.method || (typeof input !== 'string' && (input as Request).method) || 'GET';
    console.log('→', method, url);
    try {
      const res = await originalFetch(...args);
      console.log('←', res.status, method, url);
      return res;
    } catch (err) {
      console.log('✗', method, url, err);
      throw err;
    }
  };

  const OriginalXHR = global.XMLHttpRequest;
  // @ts-expect-error patching for dev logging
  global.XMLHttpRequest = function PatchedXHR() {
    const xhr = new OriginalXHR();
    let _method = 'GET';
    let _url = '';
    const origOpen = xhr.open;
    xhr.open = function (method: string, url: string, ...rest: any[]) {
      _method = method;
      _url = url;
      console.log('→', method, url);
      // @ts-expect-error forwarding args
      return origOpen.call(xhr, method, url, ...rest);
    };
    xhr.addEventListener('load', () => console.log('←', xhr.status, _method, _url));
    xhr.addEventListener('error', () => console.log('✗', _method, _url));
    return xhr;
  } as unknown as typeof XMLHttpRequest;
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
