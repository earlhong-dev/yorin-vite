// Invitation templates, fonts and the option lists used by the editor.
// An invitation design is plain JSON ({ templateId, text, style }) so it can be stored in
// Firestore, edited later, and rendered anywhere — including the public share page.

export const FONTS = [
  { id: 'Cormorant Garamond', stack: "'Cormorant Garamond', Georgia, serif", weight: 600, group: 'Serif' },
  { id: 'Playfair Display', stack: "'Playfair Display', Georgia, serif", weight: 600, group: 'Serif' },
  { id: 'Cinzel', stack: "'Cinzel', Georgia, serif", weight: 600, group: 'Serif' },
  { id: 'DM Serif Display', stack: "'DM Serif Display', Georgia, serif", weight: 400, group: 'Serif' },
  { id: 'Lora', stack: "'Lora', Georgia, serif", weight: 600, group: 'Serif' },
  { id: 'Great Vibes', stack: "'Great Vibes', cursive", weight: 400, group: 'Script' },
  { id: 'Dancing Script', stack: "'Dancing Script', cursive", weight: 700, group: 'Script' },
  { id: 'Pacifico', stack: "'Pacifico', cursive", weight: 400, group: 'Script' },
  { id: 'Montserrat', stack: "'Montserrat', 'Helvetica Neue', Arial, sans-serif", weight: 600, group: 'Sans-serif' },
  { id: 'Poppins', stack: "'Poppins', 'Helvetica Neue', Arial, sans-serif", weight: 600, group: 'Sans-serif' },
  { id: 'Josefin Sans', stack: "'Josefin Sans', 'Helvetica Neue', Arial, sans-serif", weight: 600, group: 'Sans-serif' },
  { id: 'Quicksand', stack: "'Quicksand', 'Helvetica Neue', Arial, sans-serif", weight: 600, group: 'Sans-serif' },
  { id: 'Raleway', stack: "'Raleway', 'Helvetica Neue', Arial, sans-serif", weight: 600, group: 'Sans-serif' },
];

export const DECOS = [
  { id: 'none', label: 'Plain' },
  { id: 'dots', label: 'Polka dots' },
  { id: 'lines', label: 'Fine lines' },
  { id: 'glow', label: 'Soft glow' },
  { id: 'confetti', label: 'Confetti' },
];

export const FRAMES = [
  { id: 'none', label: 'None' },
  { id: 'thin', label: 'Thin line' },
  { id: 'double', label: 'Double line' },
  { id: 'corners', label: 'Corners' },
];

export const DIVIDERS = [
  { id: 'none', label: 'None' },
  { id: 'line', label: 'Line' },
  { id: 'dots', label: 'Dots' },
  { id: 'flourish', label: 'Flourish' },
];

export const ALIGNS = [
  { id: 'left', label: 'Left' },
  { id: 'center', label: 'Center' },
  { id: 'right', label: 'Right' },
];

export const VERTICALS = [
  { id: 'top', label: 'Top' },
  { id: 'middle', label: 'Middle' },
  { id: 'bottom', label: 'Bottom' },
];

export const DEFAULT_STYLE = {
  titleFont: 'Cormorant Garamond',
  bodyFont: 'Cormorant Garamond',
  textColor: '#3b2f1e',
  accentColor: '#b9923f',
  bgColor: '#fffaf0',
  bgColor2: '#f7ecd2',
  deco: 'none',
  frame: 'double',
  divider: 'flourish',
  align: 'center',
  vertical: 'middle',
  titleScale: 1,
  bodyScale: 1,
};

export const TEMPLATES = [
  {
    id: 'golden-classic',
    name: 'Golden Classic',
    style: {},
  },
  {
    id: 'blush-romance',
    name: 'Blush Romance',
    style: {
      titleFont: 'Great Vibes', bodyFont: 'Lora',
      textColor: '#5a2f3b', accentColor: '#c2415d', bgColor: '#fff4f6', bgColor2: '#fcdde4',
      deco: 'glow', frame: 'thin', divider: 'dots', titleScale: 1.2,
    },
  },
  {
    id: 'modern-minimal',
    name: 'Modern Minimal',
    style: {
      titleFont: 'Montserrat', bodyFont: 'Montserrat',
      textColor: '#1d1d1f', accentColor: '#1d1d1f', bgColor: '#ffffff', bgColor2: '#f3f1ee',
      deco: 'none', frame: 'none', divider: 'line', align: 'left', vertical: 'bottom',
      titleScale: 0.9, bodyScale: 0.95,
    },
  },
  {
    id: 'midnight-gala',
    name: 'Midnight Gala',
    style: {
      titleFont: 'Playfair Display', bodyFont: 'Josefin Sans',
      textColor: '#f4efe3', accentColor: '#e3c36f', bgColor: '#14183a', bgColor2: '#262d66',
      deco: 'dots', frame: 'corners', divider: 'line',
    },
  },
  {
    id: 'garden-sage',
    name: 'Garden Sage',
    style: {
      titleFont: 'DM Serif Display', bodyFont: 'Raleway',
      textColor: '#2f4538', accentColor: '#5f8a70', bgColor: '#f4f8f1', bgColor2: '#dbe8d6',
      deco: 'glow', frame: 'thin', divider: 'flourish',
    },
  },
  {
    id: 'confetti-party',
    name: 'Confetti Party',
    style: {
      titleFont: 'Pacifico', bodyFont: 'Quicksand',
      textColor: '#3a2a4d', accentColor: '#ff5c8a', bgColor: '#fff6d6', bgColor2: '#ffdfe6',
      deco: 'confetti', frame: 'none', divider: 'dots', titleScale: 0.95,
    },
  },
];

export const TEXT_FIELDS = [
  { key: 'eyebrow', label: 'Opening line', max: 80, multiline: false, placeholder: 'You are invited to' },
  { key: 'title', label: 'Title / names', max: 120, multiline: true, placeholder: 'Maria & Joel' },
  { key: 'subtitle', label: 'Subtitle', max: 120, multiline: false, placeholder: 'Saturday, June 14 · Garden reception' },
  { key: 'message', label: 'Message', max: 400, multiline: true, placeholder: 'Join us for an evening of food, music and joy.' },
  { key: 'date', label: 'Date', max: 80, multiline: false, placeholder: 'Saturday, June 14, 2026' },
  { key: 'time', label: 'Time', max: 60, multiline: false, placeholder: '5:00 PM' },
  { key: 'location', label: 'Location', max: 160, multiline: true, placeholder: 'The Grand Garden, Quezon City' },
  { key: 'rsvp', label: 'RSVP', max: 160, multiline: false, placeholder: 'Kindly reply by May 30' },
  { key: 'footer', label: 'Footer', max: 120, multiline: false, placeholder: 'Dress code: semi-formal' },
];

export const TEXT_LIMITS = Object.fromEntries(TEXT_FIELDS.map((f) => [f.key, f.max]));
