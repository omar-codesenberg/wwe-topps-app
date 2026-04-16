import Constants from 'expo-constants';

// These values come from app.config.js extra field (populated from EAS secrets)
// For local development, fall back to empty strings — Firebase RNFirebase
// reads directly from google-services.json / GoogleService-Info.plist
export const ENV = {
  APP_ENV: (Constants.expoConfig?.extra?.APP_ENV as string) ?? 'development',
  IS_PRODUCTION: Constants.expoConfig?.extra?.APP_ENV === 'production',
};
