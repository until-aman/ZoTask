/* eslint-disable @next/next/no-img-element */
export default function Photo({ name }: { name: string }) {
  if (name.startsWith("sample:")) return <span className="ph" title={name.slice(7)}>📷 {name.slice(7)}</span>;
  return <a href={`/api/files/${name}`} target="_blank" rel="noreferrer"><img className="ph" src={`/api/files/${name}`} alt="Evidence photo" /></a>;
}
