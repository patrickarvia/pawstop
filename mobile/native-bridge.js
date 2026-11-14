import { Geolocation } from '@capacitor/geolocation';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Share } from '@capacitor/share';

document.documentElement.classList.add('native-app');

async function safeHaptic(run) {
  try { await run(); } catch {}
}

window.PawstopNative = {
  async getCurrentPosition() {
    const status = await Geolocation.checkPermissions();
    if (status.location !== 'granted') {
      const requested = await Geolocation.requestPermissions({ permissions: ['location'] });
      if (requested.location !== 'granted') throw new Error('LOCATION_DENIED');
    }
    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: false,
      timeout: 10000,
      maximumAge: 60000
    });
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy
    };
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
