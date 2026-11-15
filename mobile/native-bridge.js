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
  const status = await Geolocation.checkPermissions();
  if (status.location !== 'granted') {
    const requested = await Geolocation.requestPermissions({ permissions: ['location'] });
    if (requested.location !== 'granted') throw new Error('LOCATION_DENIED');
  }
  return Geolocation.getCurrentPosition({
    enableHighAccuracy: false,
    timeout: 8000,
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
      return normalizePosition(await withTimeout(pluginPosition(), 10000));
    } catch (pluginError) {
      try {
        return normalizePosition(await withTimeout(webviewPosition(), 10000));
      } catch (webError) {
        if (pluginError?.message === 'LOCATION_DENIED' || webError?.code === 1) throw new Error('LOCATION_DENIED');
        throw new Error('LOCATION_UNAVAILABLE');
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
