import { Geolocation } from '@capacitor/geolocation';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Share } from '@capacitor/share';

document.documentElement.classList.add('native-app');

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

async function pluginPosition() {
  // Capacitor's iOS getCurrentPosition handles the authorization flow itself.
  // Calling it directly avoids a separate permission preflight getting stuck in
  // Apple's "Ask Next Time Or When I Share" state.
  return Geolocation.getCurrentPosition({
    enableHighAccuracy: false,
    timeout: 25000,
    maximumAge: 60000
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
    try {
      return normalizePosition(await withTimeout(pluginPosition(), 30000));
    } catch (pluginError) {
      try {
        return normalizePosition(await withTimeout(webviewPosition(), 20000));
      } catch (webError) {
        const pluginCode = pluginError?.code || pluginError?.message || '';
        const webCode = webError?.code || null;
        console.warn('Pawstop location diagnostic', { pluginCode, webCode, pluginMessage: pluginError?.message || '', webMessage: webError?.message || '' });

        const makeLocationError = (message) => {
          const error = new Error(message);
          error.pawstopDiagnostic = { pluginCode, webCode };
          return error;
        };

        if (pluginCode === 'OS-PLUG-GLOC-0003' || webCode === 1) throw makeLocationError('LOCATION_DENIED');
        if (pluginCode === 'OS-PLUG-GLOC-0007') throw makeLocationError('LOCATION_SERVICES_DISABLED');
        if (pluginCode === 'OS-PLUG-GLOC-0008') throw makeLocationError('LOCATION_RESTRICTED');
        if (pluginCode === 'OS-PLUG-GLOC-0010') throw makeLocationError('LOCATION_TIMEOUT');
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
