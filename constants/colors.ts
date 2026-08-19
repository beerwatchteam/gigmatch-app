export const LightColors = {
  orange:      '#fa830c',
  black:       '#111111',
  grey:        '#666666',
  greyLight:   '#aaaaaa',
  border:      '#e8e8e8',
  borderFaint: '#f0f0f0',
  bg:          '#ffffff',
  bgFaint:     '#fafafa',
  danger:      '#e94560',
} as const;

export const DarkColors = {
  orange:      '#fa830c',
  black:       '#f0f0f0',
  grey:        '#aaaaaa',
  greyLight:   '#555555',
  border:      '#2a2a2a',
  borderFaint: '#1f1f1f',
  bg:          '#111111',
  bgFaint:     '#1a1a1a',
  danger:      '#e94560',
} as const;

export type ThemeColors = typeof LightColors;

// Default export stays for backward-compat (light palette)
export const Colors = LightColors;
