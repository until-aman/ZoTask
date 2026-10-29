// Client-side photo upload. Large phone photos are shrunk first (longest side 1600 px, JPEG) to stay under the host's request size limit.
async function shrink(f: File): Promise<Blob> {
  if (f.size < 1.5 * 1024 * 1024 || !f.type.startsWith("image/") || f.type === "image/gif") return f;
  try {
    const img = await createImageBitmap(f);
    const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob>((ok) => c.toBlob((b) => ok(b ?? f), "image/jpeg", 0.82));
  } catch { return f; }
}

/** Uploads one photo and returns its stored name, or null if the upload failed. */
export async function uploadPhoto(f: File): Promise<string | null> {
  const b = await shrink(f);
  const fd = new FormData();
  fd.append("file", b instanceof File ? b : new File([b], f.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }));
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  return res.ok ? (await res.json()).name : null;
}
