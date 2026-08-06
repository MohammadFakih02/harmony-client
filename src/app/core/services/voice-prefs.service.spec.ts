import { VoicePrefsService } from './voice-prefs.service';

const STORAGE_KEY = 'harmony-voice-prefs';

describe('VoicePrefsService', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it('starts with defaults when nothing is persisted', () => {
    const svc = new VoicePrefsService();

    expect(svc.prefs()).toEqual({
      micDeviceId: null,
      speakerDeviceId: null,
      cameraDeviceId: null,
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
      screenShareResolution: '720p',
      screenShareFps: 30,
    });
  });

  it('setters update the signal and persist to localStorage', () => {
    const svc = new VoicePrefsService();

    svc.setMicDevice('mic-1');
    svc.setNoiseSuppression(false);

    expect(svc.prefs().micDeviceId).toBe('mic-1');
    expect(svc.prefs().noiseSuppression).toBe(false);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toMatchObject({
      micDeviceId: 'mic-1',
      noiseSuppression: false,
      echoCancellation: true, // untouched fields keep their defaults
    });
  });

  it('reloads persisted prefs on construction', () => {
    new VoicePrefsService().setSpeakerDevice('spk-9');

    const fresh = new VoicePrefsService();
    expect(fresh.prefs().speakerDeviceId).toBe('spk-9');
  });

  it('tolerates a corrupt entry and missing fields', () => {
    localStorage.setItem(STORAGE_KEY, 'not json');
    expect(new VoicePrefsService().prefs().echoCancellation).toBe(true);

    // A partial entry (older schema) fills the gaps with defaults.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ micDeviceId: 'mic-2' }));
    const svc = new VoicePrefsService();
    expect(svc.prefs().micDeviceId).toBe('mic-2');
    expect(svc.prefs().autoGainControl).toBe(true);
  });

  it('setting a device back to null returns to the system default', () => {
    const svc = new VoicePrefsService();
    svc.setCameraDevice('cam-1');
    svc.setCameraDevice(null);

    expect(svc.prefs().cameraDeviceId).toBeNull();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).cameraDeviceId).toBeNull();
  });
});
