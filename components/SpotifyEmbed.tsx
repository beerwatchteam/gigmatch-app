import { WebView } from 'react-native-webview';

interface Props {
  url: string;
  height: number;
}

export function SpotifyEmbed({ url, height }: Props) {
  return (
    <WebView
      source={{ uri: url }}
      style={{ height }}
      scrollEnabled={false}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
    />
  );
}
