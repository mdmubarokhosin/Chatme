"use client";

import { setClientCookie } from "../cookie.client";
import { setLocalStorageValue } from "../local-storage.client";
import {
  getPreferencePersistence,
  type PreferenceKey,
  type PreferenceValueMap,
} from "./preferences-config";

function persistByMode(mode: string, key: string, value: string): void {
  switch (mode) {
    case "none":
      return;

    case "client-cookie":
    case "server-cookie":
      setClientCookie(key, value);
      return;

    case "localStorage":
      setLocalStorageValue(key, value);
      return;
  }
}

export function persistPreference<K extends PreferenceKey>(key: K, value: PreferenceValueMap[K]): void {
  persistByMode(getPreferencePersistence(key), key, value);
}
