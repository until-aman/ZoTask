/* eslint-disable @next/next/no-img-element */
export default function Photo({ name }: { name: string }) {
  if (name.startsWith("sample:")) return <span className="ph" title={name.slice(7)}>📷 {name.slice(7)}</span>;
  const src = name.startsWith("data:") ? name : `/api/files/${name}`;
  return <a href={src} target="_blank" rel="noreferrer"><img className="ph" src={src} alt="Evidence photo" /></a>;
}
