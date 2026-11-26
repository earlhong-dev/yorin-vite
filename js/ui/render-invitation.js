// Renders an invitation design to a DOM element. Used everywhere: editor preview, template
// gallery, cards, full preview and the public share page — so what you design is exactly
// what guests see. Sizes use container-query units (cqw), so the same element scales cleanly
// from a 200px card thumbnail to a full-width mobile view while keeping its 5:7 proportions.

import { getFont, sanitizeDesign } from '../lib/design.js';
import { h } from './dom.js';

export const INVITATION_ASPECT = 5 / 7;

export function renderInvitation(rawDesign, { label } = {}) {
  const d = sanitizeDesign(rawDesign);
  const s = d.style;
  const t = d.text;

  const root = h('div', {
    class: 'inv',
    role: 'img',
    'aria-label': label || `Invitation: ${t.title.replace(/\s+/g, ' ').trim() || 'untitled'}`,
    style: {
      '--inv-text': s.textColor,
      '--inv-accent': s.accentColor,
      '--inv-bg': s.bgColor,
      '--inv-bg2': s.bgColor2,
      '--inv-title-font': getFont(s.titleFont).stack,
      '--inv-title-weight': String(getFont(s.titleFont).weight),
      '--inv-body-font': getFont(s.bodyFont).stack,
      '--inv-ts': String(s.titleScale),
      '--inv-bs': String(s.bodyScale),
    },
    dataset: { deco: s.deco, align: s.align, vertical: s.vertical },
  });

  root.append(h('div', { class: 'inv-deco', 'aria-hidden': 'true' }));

  if (s.frame !== 'none') {
    const frame = h('div', { class: 'inv-frame', dataset: { frame: s.frame }, 'aria-hidden': 'true' });
    if (s.frame === 'corners') for (const c of ['tl', 'tr', 'bl', 'br']) frame.append(h('i', { class: `c-${c}` }));
    root.append(frame);
  }

  const content = h('div', { class: 'inv-content' });
  const line = (cls, text) => (text ? h('div', { class: cls }, text) : null);

  const details = [t.date, t.time, t.location].some(Boolean)
    ? h('div', { class: 'inv-details' }, line('inv-date', t.date), line('inv-time', t.time), line('inv-location', t.location))
    : null;

  const divider =
    s.divider === 'none'
      ? null
      : h('div', { class: 'inv-divider', dataset: { divider: s.divider }, 'aria-hidden': 'true' }, h('span'), s.divider === 'flourish' ? h('i', {}, '✦') : s.divider === 'dots' ? h('i', {}, '• • •') : null, h('span'));

  content.append(
    ...[
      line('inv-eyebrow', t.eyebrow),
      line('inv-title', t.title),
      divider,
      line('inv-subtitle', t.subtitle),
      line('inv-message', t.message),
      details,
      line('inv-rsvp', t.rsvp),
      line('inv-footer', t.footer),
    ].filter(Boolean),
  );
  root.append(content);
  return root;
}
