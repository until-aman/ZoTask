// The prototype runs in the browser, where Node's zlib isn't available. Excel files are read only in the real app.
export function inflateRawSync(): never {
  throw new Error("Excel files can be read in the real app. In this prototype, save the sheet as CSV and upload that.");
}
