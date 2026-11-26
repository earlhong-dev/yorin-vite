// Displays uploaded invitation files: images at their natural aspect ratio, PDFs page by page
// (rendered with pdf.js so it works on phones too, where inline PDF embeds don't). The original
// bytes are shown untouched — no recompression, no cropping.

import { h } from './dom.js';

const PDFJS_VERSION = '4.4.168';
const PDFJS_BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/`;
const MAX_PDF_PAGES = 40;

let pdfLibPromise = null;
function loadPdfJs() {
  if (!pdfLibPromise) {
    pdfLibPromise = import(/* webpackIgnore: true */ `${PDFJS_BASE}pdf.min.mjs`)
      .then((lib) => {
        // A same-origin blob wrapper lets the cross-origin CDN worker load as a module worker.
        const wrapper = new Blob([`import "${PDFJS_BASE}pdf.worker.min.mjs";`], { type: 'text/javascript' });
        lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(wrapper);
        return lib;
      })
      .catch((error) => {
        pdfLibPromise = null;
        throw error;
      });
  }
  return pdfLibPromise;
}

async function openPdf(blob) {
  const lib = await loadPdfJs();
  const data = new Uint8Array(await blob.arrayBuffer());
  return lib.getDocument({ data }).promise;
}

/** First page of a PDF as a small JPEG data URL for card thumbnails (null if it can't be rendered). */
export async function pdfThumbnail(blob, width = 420) {
  try {
    const pdf = await openPdf(blob);
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const url = canvas.toDataURL('image/jpeg', 0.78);
    pdf.destroy();
    return url;
  } catch (error) {
    console.warn('PDF thumbnail unavailable', error);
    return null;
  }
}

/** Downscaled JPEG data URL of an image blob for card thumbnails; also reports natural size. */
export async function imageThumbnail(blob, maxSide = 480) {
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const result = { dataUrl: canvas.toDataURL('image/jpeg', 0.8), width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return result;
  } catch (error) {
    console.warn('Image thumbnail unavailable', error);
    return { dataUrl: null, width: 0, height: 0 };
  }
}

/**
 * Builds a viewer element for a file blob. Returns { el, destroy }.
 *   kind: 'image' | 'pdf'
 */
export function createFileViewer(blob, { kind, name = 'Invitation' }) {
  const urls = [];
  let destroyed = false;
  let pdfDoc = null;
  const objectUrl = () => {
    const url = URL.createObjectURL(blob);
    urls.push(url);
    return url;
  };

  if (kind !== 'pdf') {
    const img = h('img', { class: 'file-image', alt: name, decoding: 'async' });
    img.src = objectUrl();
    return { el: h('div', { class: 'file-viewer file-viewer-image' }, img), destroy: () => urls.forEach(URL.revokeObjectURL) };
  }

  const pages = h('div', { class: 'pdf-pages' });
  const status = h('div', { class: 'pdf-status muted' }, 'Loading PDF…');
  const el = h('div', { class: 'file-viewer file-viewer-pdf' }, status, pages);

  (async () => {
    try {
      pdfDoc = await openPdf(blob);
      const count = Math.min(pdfDoc.numPages, MAX_PDF_PAGES);
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      for (let n = 1; n <= count; n += 1) {
        if (destroyed) return;
        const page = await pdfDoc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        // Render at a crisp width regardless of screen size; CSS scales it down to fit.
        const targetWidth = Math.max(900, Math.min(1600, (el.clientWidth || 600) * dpr));
        const viewport = page.getViewport({ scale: targetWidth / base.width });
        const canvas = h('canvas', { class: 'pdf-page', 'aria-label': `Page ${n} of ${pdfDoc.numPages}` });
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        canvas.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        pages.append(canvas);
        await page.render({ canvasContext: ctx, viewport }).promise;
        if (n === 1) status.remove();
      }
      status.remove();
      if (pdfDoc.numPages > MAX_PDF_PAGES) pages.append(h('p', { class: 'muted center' }, `Showing the first ${MAX_PDF_PAGES} pages.`));
    } catch (error) {
      if (destroyed) return;
      console.warn('PDF preview failed', error);
      status.className = 'pdf-status pdf-fallback';
      status.replaceChildren(
        h('p', {}, 'We couldn’t display this PDF here.'),
        h('a', { class: 'btn btn-secondary', href: objectUrl(), target: '_blank', rel: 'noopener noreferrer' }, 'Open PDF in a new tab'),
      );
    }
  })();

  return {
    el,
    destroy: () => {
      destroyed = true;
      pdfDoc?.destroy?.();
      urls.forEach(URL.revokeObjectURL);
    },
  };
}

/**
 * Displays 1 or more uploaded files in the configured layout ('vertical' | 'horizontal' | 'flip').
 * `items` = [{ blob, kind, name }]
 */
export function createMultiFileViewer(items, { defaultLayout = 'vertical' } = {}) {
  if (items.length === 1) {
    return createFileViewer(items[0].blob, { kind: items[0].kind, name: items[0].name });
  }

  const viewers = items.map((item) => createFileViewer(item.blob, { kind: item.kind, name: item.name }));
  const layout = ['vertical', 'horizontal', 'flip'].includes(defaultLayout) ? defaultLayout : 'vertical';

  if (layout === 'flip') {
    let index = 0;
    let animating = false;
    const pageEls = viewers.map((v) =>
      h('div', { class: 'flip-page' }, h('div', { class: 'flip-sheet' }, v.el, h('div', { class: 'flip-sheen', 'aria-hidden': 'true' }))),
    );
    const stage = h('div', { class: 'flip-stage', tabindex: '0', 'aria-label': '3D flipbook viewer. Click left or right, swipe, or use arrow keys to turn pages.' }, pageEls[0]);
    const counter = h('span', { class: 'muted small flip-counter' }, `1 / ${items.length}`);
    const prevBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', 'aria-label': 'Previous page' }, '‹ Prev');
    const nextBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', 'aria-label': 'Next page' }, 'Next ›');

    function syncControls() {
      counter.textContent = `${index + 1} / ${items.length}`;
      prevBtn.disabled = index === 0;
      nextBtn.disabled = index === items.length - 1;
    }

    function go(nextIndex) {
      if (animating || nextIndex < 0 || nextIndex >= items.length || nextIndex === index) return;
      const dir = nextIndex > index ? 'next' : 'prev';
      const outgoing = pageEls[index];
      const incoming = pageEls[nextIndex];
      index = nextIndex;
      syncControls();

      animating = true;
      outgoing.classList.add(dir === 'next' ? 'flip-out-next' : 'flip-out-prev');
      incoming.classList.add(dir === 'next' ? 'flip-in-next' : 'flip-in-prev');
      if (dir === 'next') stage.prepend(incoming);
      else stage.append(incoming);

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        outgoing.classList.remove('flip-out-next', 'flip-out-prev');
        incoming.classList.remove('flip-in-next', 'flip-in-prev');
        if (outgoing.parentNode === stage) outgoing.remove();
        animating = false;
      };
      const lead = dir === 'next' ? outgoing : incoming;
      lead.addEventListener('animationend', finish, { once: true });
      setTimeout(finish, 360);
    }

    prevBtn.addEventListener('click', () => go(index - 1));
    nextBtn.addEventListener('click', () => go(index + 1));
    stage.addEventListener('click', (e) => {
      if (e.target.closest('a, button')) return;
      const rect = stage.getBoundingClientRect();
      if (e.clientX - rect.left < rect.width / 2) go(index - 1);
      else go(index + 1);
    });
    stage.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
    });

    let touchStartX = null;
    stage.addEventListener('touchstart', (e) => { touchStartX = e.touches[0]?.clientX ?? null; }, { passive: true });
    stage.addEventListener('touchend', (e) => {
      if (touchStartX === null) return;
      const dx = (e.changedTouches[0]?.clientX ?? touchStartX) - touchStartX;
      touchStartX = null;
      if (Math.abs(dx) > 40) go(dx < 0 ? index + 1 : index - 1);
    }, { passive: true });

    syncControls();
    const controls = h('div', { class: 'flip-controls' }, prevBtn, counter, nextBtn);
    return {
      el: h('div', { class: 'multi-viewer multi-viewer-flip' }, stage, controls),
      destroy: () => viewers.forEach((v) => v?.destroy?.()),
    };
  }

  const track = h(
    'div',
    { class: `multi-viewer-track multi-viewer-${layout}` },
    ...viewers.map((v, i) =>
      h('div', { class: 'multi-viewer-item' }, v.el, h('span', { class: 'multi-viewer-index muted small' }, `${i + 1} / ${items.length}`)),
    ),
  );

  return {
    el: h('div', { class: 'multi-viewer' }, track),
    destroy: () => viewers.forEach((v) => v?.destroy?.()),
  };
}
