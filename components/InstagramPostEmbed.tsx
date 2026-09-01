import { WebView } from 'react-native-webview';

interface Props {
  /** Original post URL e.g. https://www.instagram.com/p/SHORTCODE/ */
  postUrl: string;
}

export function InstagramPostEmbed({ postUrl }: Props) {
  const embedUrl = postUrl.replace(/\/?$/, '/embed/');
  return (
    <WebView
      source={{ uri: embedUrl }}
      style={{ height: 500 }}
      scrollEnabled={false}
    />
  );
}
