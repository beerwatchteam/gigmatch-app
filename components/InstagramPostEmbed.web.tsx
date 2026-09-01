import { useEffect, useRef } from 'react';
import { View } from 'react-native';

interface Props {
  /** Original post URL e.g. https://www.instagram.com/p/SHORTCODE/ */
  postUrl: string;
}

export function InstagramPostEmbed({ postUrl }: Props) {
  const ref = useRef<any>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    // Clear any previous embed
    container.innerHTML = '';

    // Build the official blockquote embed element
    const blockquote = document.createElement('blockquote');
    blockquote.className = 'instagram-media';
    blockquote.setAttribute('data-instgrm-permalink', postUrl);
    blockquote.setAttribute('data-instgrm-version', '14');
    blockquote.style.cssText =
      'background:#fff; border:0; border-radius:3px; box-shadow:0 0 1px 0 rgba(0,0,0,0.5),0 1px 10px 0 rgba(0,0,0,0.15); margin:0; max-width:540px; min-width:326px; padding:0; width:100%;';
    container.appendChild(blockquote);

    // If embed.js is already loaded, just re-process; otherwise inject it
    const win = window as any;
    const existingScript = document.querySelector('script[src*="instagram.com/embed.js"]');
    if (existingScript) {
      if (win.instgrm?.Embeds) {
        win.instgrm.Embeds.process();
      }
    } else {
      const script = document.createElement('script');
      script.async = true;
      script.src = '//www.instagram.com/embed.js';
      document.body.appendChild(script);
    }

    return () => {
      if (container) container.innerHTML = '';
    };
  }, [postUrl]);

  return <View ref={ref} style={{ minHeight: 420 }} />;
}
