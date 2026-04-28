import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hormuzpass.app',
  appName: 'Hormuz Pass',
  webDir: 'dist',
  ios: {
    contentInset: 'always',
    backgroundColor: '#000d1a',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#000d1a',
      showSpinner: false,
      androidSpinnerStyle: 'large',
      iosSpinnerStyle: 'large',
      spinnerColor: '#ffffff',
      splashFullScreen: true,
      splashImmersive: true,
    },
    Haptics: {},
  },
};

export default config;
