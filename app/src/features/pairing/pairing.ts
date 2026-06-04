/**
 * pairing.ts — device credential storage (expo-secure-store, Keystore-backed).
 *
 * The `bridge pair` CLI prints a QR encoding {tunnelUrl, deviceToken}. The app
 * scans it once (M0 also supports manual paste) and stores it here. The token
 * is the WS Bearer credential; the Bridge holds only its hash.
 */

import * as SecureStore from "expo-secure-store";

const KEY_TUNNEL_URL = "hermes.tunnelUrl";
const KEY_DEVICE_TOKEN = "hermes.deviceToken";

export interface Pairing {
  tunnelUrl: string;
  deviceToken: string;
}

/** Shape of the JSON encoded in the pairing QR. */
export interface PairingPayload {
  tunnelUrl: string;
  deviceToken: string;
}

export function parsePairingPayload(raw: string): PairingPayload {
  const data = JSON.parse(raw);
  if (
    typeof data?.tunnelUrl !== "string" ||
    typeof data?.deviceToken !== "string" ||
    !data.tunnelUrl ||
    !data.deviceToken
  ) {
    throw new Error("invalid pairing payload");
  }
  return { tunnelUrl: data.tunnelUrl, deviceToken: data.deviceToken };
}

export async function savePairing(p: Pairing): Promise<void> {
  await SecureStore.setItemAsync(KEY_TUNNEL_URL, p.tunnelUrl);
  await SecureStore.setItemAsync(KEY_DEVICE_TOKEN, p.deviceToken);
}

export async function loadPairing(): Promise<Pairing | null> {
  const tunnelUrl = await SecureStore.getItemAsync(KEY_TUNNEL_URL);
  const deviceToken = await SecureStore.getItemAsync(KEY_DEVICE_TOKEN);
  if (!tunnelUrl || !deviceToken) return null;
  return { tunnelUrl, deviceToken };
}

export async function clearPairing(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY_TUNNEL_URL);
  await SecureStore.deleteItemAsync(KEY_DEVICE_TOKEN);
}

export async function isPaired(): Promise<boolean> {
  return (await loadPairing()) !== null;
}
