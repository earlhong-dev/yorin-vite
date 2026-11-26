// Invitation design model: defaults, sanitizing, templates. Pure — no DOM.
//
// sanitizeDesign() is the single gate every design passes through before it is rendered or saved.
// It clamps every value to a known-good set, so even a tampered document can't inject CSS or
// load an arbitrary font (and all text is rendered with textContent, never as HTML).

import {
  ALIGNS, DECOS, DEFAULT_STYLE, DIVIDERS, FONTS, FRAMES, TEMPLATES, TEXT_FIELDS, TEXT_LIMITS, VERTICALS,
} from '../templates/templates.js';
import { formatLongDate } from './format.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const HEX = /^#[0-9a-fA-F]{6}$/;

const pickEnum = (value, list, fallback) => (list.some((o) => o.id === value) ? value : fallback);
const pickColor = (value, fallback) => (typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : fallback);
const pickFont = (value, fallback) => (FONTS.some((f) => f.id === value) ? value : fallback);
const clampNum = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

// Strips control characters (keeping newlines) and enforces the per-field length limit.
const cleanText = (value, max) =>
  String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .slice(0, max);

export const getTemplate = (id) => TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];
export const getFont = (id) => FONTS.find((f) => f.id === id) || FONTS[0];
export const templateStyle = (id) => ({ ...DEFAULT_STYLE, ...getTemplate(id).style });

export function sanitizeDesign(raw) {
  const input = isObj(raw) ? raw : {};
  const tpl = getTemplate(input.templateId);
  const base = { ...DEFAULT_STYLE, ...tpl.style };
  const s = isObj(input.style) ? input.style : {};
  const t = isObj(input.text) ? input.text : {};

  const text = {};
  for (const { key } of TEXT_FIELDS) text[key] = cleanText(t[key], TEXT_LIMITS[key]);

  return {
    v: 1,
    templateId: tpl.id,
    text,
    style: {
      titleFont: pickFont(s.titleFont, base.titleFont),
      bodyFont: pickFont(s.bodyFont, base.bodyFont),
      textColor: pickColor(s.textColor, base.textColor),
      accentColor: pickColor(s.accentColor, base.accentColor),
      bgColor: pickColor(s.bgColor, base.bgColor),
      bgColor2: pickColor(s.bgColor2, base.bgColor2),
      deco: pickEnum(s.deco, DECOS, base.deco),
      frame: pickEnum(s.frame, FRAMES, base.frame),
      divider: pickEnum(s.divider, DIVIDERS, base.divider),
      align: pickEnum(s.align, ALIGNS, base.align),
      vertical: pickEnum(s.vertical, VERTICALS, base.vertical),
      titleScale: clampNum(s.titleScale, 0.6, 1.6, base.titleScale),
      bodyScale: clampNum(s.bodyScale, 0.7, 1.5, base.bodyScale),
    },
  };
}

const EVENT_COPY = {
  Wedding: ['You are invited to the wedding of', 'We would be honored to have you share in our joy.'],
  Birthday: ['Come celebrate', 'Join us for cake, music and good company.'],
  Graduation: ['Celebrating the graduation of', 'Please join us as we celebrate this milestone.'],
  Anniversary: ['Celebrate the anniversary of', 'Join us for an evening of memories and cheer.'],
  'Corporate Event': ['You are cordially invited to', 'We look forward to welcoming you.'],
  Other: ['You are invited to', 'We would love to celebrate with you.'],
  Custom: ['You are invited to', 'We would love to celebrate with you.'],
};

/** A starting design pre-filled from the event the invitation belongs to. */
export function createDefaultDesign(event, templateId = TEMPLATES[0].id) {
  const [eyebrow, message] = EVENT_COPY[event?.type] || EVENT_COPY.Other;
  return sanitizeDesign({
    templateId,
    text: {
      eyebrow,
      title: event?.name || 'Your Event',
      message,
      date: event?.date ? formatLongDate(event.date) : '',
      location: event?.location || '',
    },
    style: templateStyle(templateId),
  });
}

/** Switch template: new look, same words. */
export function applyTemplate(design, templateId) {
  const current = sanitizeDesign(design);
  return sanitizeDesign({ templateId, text: current.text, style: templateStyle(templateId) });
}

export const SAMPLE_TEXT = {
  eyebrow: 'You are invited',
  title: 'Your Event',
  subtitle: '',
  message: 'Add your own words here.',
  date: 'Saturday, June 14',
  time: '5:00 PM',
  location: 'Your venue',
  rsvp: '',
  footer: '',
};

export const sampleDesign = (templateId) =>
  sanitizeDesign({ templateId, text: SAMPLE_TEXT, style: templateStyle(templateId) });

export const designsEqual = (a, b) => JSON.stringify(sanitizeDesign(a)) === JSON.stringify(sanitizeDesign(b));
