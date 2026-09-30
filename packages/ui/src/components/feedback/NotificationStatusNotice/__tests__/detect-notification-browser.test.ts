import { describe, expect, it } from 'vitest';

import { detectNotificationBrowser } from '../NotificationStatusNotice.helpers';

const UA = {
  chromeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  chromeIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  samsung:
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  opera:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/115.0.0.0',
};

describe('detectNotificationBrowser', () => {
  it.each([
    ['Chrome on Windows', UA.chromeWindows, 0, { family: 'chrome', platform: 'desktop' }],
    ['Chrome on Android', UA.chromeAndroid, 5, { family: 'chrome', platform: 'android' }],
    ['Chrome on iPhone', UA.chromeIos, 5, { family: 'chrome', platform: 'ios' }],
    ['Edge, which also says Chrome', UA.edgeWindows, 0, { family: 'edge', platform: 'desktop' }],
    ['Firefox on a Mac', UA.firefoxMac, 0, { family: 'firefox', platform: 'desktop' }],
    ['Safari on a Mac', UA.safariMac, 0, { family: 'safari', platform: 'desktop' }],
    ['Safari on an iPhone', UA.safariIphone, 5, { family: 'safari', platform: 'ios' }],
    ['an iPad asking for the desktop site', UA.safariMac, 5, { family: 'safari', platform: 'ios' }],
    ['Samsung Internet, which also says Chrome', UA.samsung, 5, { family: 'samsung', platform: 'android' }],
    ['Opera, which also says Chrome', UA.opera, 0, { family: 'opera', platform: 'desktop' }],
    ['something unrecognised', 'curl/8.5.0', 0, { family: 'other', platform: 'desktop' }],
  ])('reads %s', (_name, userAgent, touchPoints, expected) => {
    expect(detectNotificationBrowser(userAgent, touchPoints)).toEqual(expected);
  });
});
