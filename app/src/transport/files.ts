/**
 * files.ts — file upload/download against the Bridge (§4.2).
 *
 * Files never travel inside WS frames; they go over HTTP and are referenced by
 * `fileId`. Uploads are multipart (the platform streams the body; the Bridge
 * reads it in chunks). Downloads hit GET /files/{id}, which supports HTTP Range
 * for audio streaming + lazy images.
 *
 * Images are loaded directly by expo-image from the authenticated URL via
 * `imageSource()` (expo-image caches them); large/explicit fetches use
 * `downloadFile()` to the app cache.
 */

import { File, Paths } from "expo-file-system";
import type { Pairing } from "../features/pairing/pairing";

export interface UploadResult {
  id: string;
  size: number;
  mime: string | null;
}

/** Convert a ws(s)/http(s) tunnel URL (possibly ending /ws) to an http(s) base. */
export function httpBase(pairing: Pairing): string {
  let u = pairing.tunnelUrl.trim();
  if (u.startsWith("wss://")) u = "https://" + u.slice(6);
  else if (u.startsWith("ws://")) u = "http://" + u.slice(5);
  u = u.replace(/\/+$/, "");
  if (u.endsWith("/ws")) u = u.slice(0, -3);
  return u;
}

export function authHeader(pairing: Pairing): Record<string, string> {
  return { Authorization: `Bearer ${pairing.deviceToken}` };
}

/** Remote URL for a file (optionally its thumbnail). */
export function fileUrl(fileId: string, pairing: Pairing, opts?: { thumb?: boolean }): string {
  const q = opts?.thumb ? "?thumb=1" : "";
  return `${httpBase(pairing)}/files/${encodeURIComponent(fileId)}${q}`;
}

/** expo-image / expo-audio source object carrying auth headers. */
export function remoteSource(
  fileId: string,
  pairing: Pairing,
  opts?: { thumb?: boolean },
): { uri: string; headers: Record<string, string> } {
  return { uri: fileUrl(fileId, pairing, opts), headers: authHeader(pairing) };
}

function guessName(uri: string, fallback: string): string {
  const tail = uri.split("/").pop();
  return tail && tail.length > 0 ? tail : fallback;
}

/**
 * Upload a local file (content URI) to POST /files. Returns the new fileId.
 * The platform streams the multipart body; the Bridge enforces size + mime.
 */
export async function uploadFile(
  uri: string,
  pairing: Pairing,
  meta?: { name?: string; mime?: string },
): Promise<UploadResult> {
  const form = new FormData();
  // React Native FormData accepts a {uri, name, type} file descriptor.
  form.append("file", {
    uri,
    name: meta?.name ?? guessName(uri, "upload.bin"),
    type: meta?.mime ?? "application/octet-stream",
  } as any);

  const res = await fetch(`${httpBase(pairing)}/files`, {
    method: "POST",
    headers: authHeader(pairing), // do NOT set Content-Type; fetch sets the boundary
    body: form,
  });
  if (!res.ok) {
    throw new Error(`upload failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  return (await res.json()) as UploadResult;
}

/**
 * Download a file to the app cache and return its local uri. Re-uses an
 * existing cached copy. `range` (e.g. "bytes=0-65535") requests a partial body.
 */
export async function downloadFile(
  fileId: string,
  pairing: Pairing,
  opts?: { thumb?: boolean; range?: string },
): Promise<string> {
  const name = opts?.thumb ? `${fileId}.thumb` : fileId;
  const file = new File(Paths.cache, name);
  if (file.exists && !opts?.range) return file.uri;

  const headers: Record<string, string> = authHeader(pairing);
  if (opts?.range) headers["Range"] = opts.range;

  const res = await fetch(fileUrl(fileId, pairing, { thumb: opts?.thumb }), { headers });
  if (!res.ok && res.status !== 206) {
    throw new Error(`download failed: ${res.status}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
  return file.uri;
}
