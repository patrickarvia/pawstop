import { registerPlugin } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Share } from '@capacitor/share';

document.documentElement.classList.add('native-app');

const PawstopLocation = registerPlugin('PawstopLocation');

async function safeHaptic(run) {
  try { await run(); } catch {}
}

function withTimeout(promise, ms, code='LOCATION_TIMEOUT') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(code)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function normalizePosition(position) {
  const latitude = position?.coords?.latitude;
  const longitude = position?.coords?.longitude;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error('LOCATION_UNAVAILABLE');
  return { latitude, longitude, accuracy: position.coords.accuracy ?? null };
}

async function directCoreLocationPosition() {
  return PawstopLocation.getCurrentPosition();
}

async function pluginPosition() {
  // A short-lived watch is more resilient on iOS than the one-shot request:
  // transient CoreLocation failures can break getCurrentPosition delivery,
  // while a watch can keep listening for the next usable fix.
  return new Promise((resolve, reject) => {
    let watchId = null;
    let settled = false;
    let timer = null;

    const cleanup = async () => {
      if (!watchId) return;
      try { await Geolocation.clearWatch({ id: watchId }); } catch {}
    };

    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      cleanup();
      handler(value);
    };

    timer = setTimeout(() => {
      const error = new Error('LOCATION_WATCH_TIMEOUT');
      error.code = 'LOCATION_WATCH_TIMEOUT';
      finish(reject, error);
    }, 30000);

    Geolocation.watchPosition({
      enableHighAccuracy: false,
      timeout: 45000,
      maximumAge: 300000
    }, (position, error) => {
      if (position) {
        finish(resolve, position);
        return;
      }

      if (!error) return;
      const code = error.code || error.message || '';

      // Keep listening through recoverable iOS locationUnknown/timeout events.
      if (code === 'OS-PLUG-GLOC-0002' || code === 'OS-PLUG-GLOC-0010') {
        console.warn('Pawstop transient location event', { code, message: error.message || '' });
        return;
      }

      finish(reject, error);
    }).then((id) => {
      watchId = id;
      if (settled) cleanup();
    }).catch((error) => finish(reject, error));
  });
}

function webviewPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('LOCATION_UNAVAILABLE'));
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 8000,
      maximumAge: 60000
    });
  });
}

window.PawstopNative = {
  async getCurrentPosition() {
    let directError;
    try {
      return normalizePosition(await withTimeout(directCoreLocationPosition(), 35000, 'PAWSTOP_CORELOCATION_TIMEOUT'));
    } catch (error) {
      directError = error;
    }

    try {
      return normalizePosition(await withTimeout(pluginPosition(), 35000));
    } catch (pluginError) {
      try {
        return normalizePosition(await withTimeout(webviewPosition(), 20000));
      } catch (webError) {
        const directCode = directError?.code || directError?.message || '';
        const pluginCode = pluginError?.code || pluginError?.message || '';
        const webCode = webError?.code || null;
        console.warn('Pawstop location diagnostic', {
          directCode,
          pluginCode,
          webCode,
          directMessage: directError?.message || '',
          pluginMessage: pluginError?.message || '',
          webMessage: webError?.message || ''
        });

        const makeLocationError = (message) => {
          const error = new Error(message);
          error.pawstopDiagnostic = { directCode, pluginCode, webCode };
          return error;
        };

        if (directCode === 'PAWSTOP_LOCATION_DENIED' || pluginCode === 'OS-PLUG-GLOC-0003' || webCode === 1) throw makeLocationError('LOCATION_DENIED');
        if (directCode === 'PAWSTOP_LOCATION_SERVICES_DISABLED' || pluginCode === 'OS-PLUG-GLOC-0007') throw makeLocationError('LOCATION_SERVICES_DISABLED');
        if (directCode === 'PAWSTOP_LOCATION_RESTRICTED' || pluginCode === 'OS-PLUG-GLOC-0008') throw makeLocationError('LOCATION_RESTRICTED');
        if (directCode === 'PAWSTOP_CORELOCATION_TIMEOUT' || directCode.startsWith('PAWSTOP_LIVEUPDATES_TIMEOUT') || pluginCode === 'LOCATION_WATCH_TIMEOUT' || pluginCode === 'OS-PLUG-GLOC-0010') throw makeLocationError('LOCATION_TIMEOUT');
        throw makeLocationError('LOCATION_UNAVAILABLE');
      }
    }
  },
  impact() {
    return safeHaptic(() => Haptics.impact({ style: ImpactStyle.Light }));
  },
  success() {
    return safeHaptic(() => Haptics.notification({ type: NotificationType.Success }));
  },
  error() {
    return safeHaptic(() => Haptics.notification({ type: NotificationType.Error }));
  },
  shareRoute({ text, url }) {
    return Share.share({
      title: 'Pawstop route',
      text,
      url,
      dialogTitle: 'Share Pawstop route'
    });
  }
};
