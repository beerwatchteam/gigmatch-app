interface Props {
  url: string;
  height: number;
}

export function SpotifyEmbed({ url, height }: Props) {
  return (
    <iframe
      src={url}
      width="100%"
      height={height}
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      loading="lazy"
      style={{ border: 'none', borderRadius: 12, display: 'block' }}
    />
  );
}
