module.exports = {
  expo: {
    name: "BreakBox WWE",
    slug: "wwe-breakbox",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "dark",
    splash: {
      image: "./assets/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#0A0A0A",
    },
    ios: {
      supportsTablet: false,
      bundleIdentifier: "com.breakbox.wwe",
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#0A0A0A",
      },
      package: "com.breakbox.wwe",
    },
    web: {
      favicon: "./assets/favicon.png",
    },
    plugins: ["expo-font"],
    extra: {
      eas: {
        projectId: "a326dc90-ae56-4e26-9a90-d3827b298af0",
      },
    },
    owner: "plummerman16",
  },
};
