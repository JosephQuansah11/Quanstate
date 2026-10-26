import { Platform } from "react-native";

const fallback = Platform.select({
  android: "http://10.0.2.2:8000",
  ios: "http://127.0.0.1:8000",
  default: "http://127.0.0.1:8000",
});

/** Set EXPO_PUBLIC_API_URL to your LAN address when running on a physical phone. */
export const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? fallback ?? "http://127.0.0.1:8000").replace(/\/$/, "");

export const DEFAULT_PAIR = { source: "en", target: "es" };
