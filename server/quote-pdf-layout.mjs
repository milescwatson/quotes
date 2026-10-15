import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import { HttpError } from './shared.mjs';

const LEFT = 42, RIGHT = 570, BOTTOM = 738;
const regular = fileURLToPath(new URL('./assets/fonts/DejaVuSans.ttf', import.meta.url));
const bold = fileURLToPath(new URL('./assets/fonts/DejaVuSans-Bold.ttf', import.meta.url));
const money = value => `$${value.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

// Layout owns wrapping and pagination, never business pricing.
export function renderQuotePdf(model) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: LEFT, left: LEFT, right: LEFT, bottom: 20 }, bufferPages: true, font: regular,
      info: { Title: `Quote #${model.id}`, Author: model.organization.name } });
    const chunks = []; let bytes = 0, y = LEFT;
    doc.on('data', chunk => {
      bytes += chunk.length;
      // Leave room for base64 and the Lambda proxy response envelope.
      if (bytes > 4 * 1024 * 1024) doc.destroy(new HttpError(413, 'PDF_TOO_LARGE', 'This PDF exceeds the supported download size.'));
      else chunks.push(chunk);
    });
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    try {
      doc.registerFont('Regular', regular).registerFont('Bold', bold);
      function text(value, x, top, width, size = 10, weight = 'Regular', align = 'left') {
        doc.font(weight).fontSize(size).fillColor('#20242a').text(value, x, top, { width, align, lineGap: 2 });
      }
      function height(value, width, size = 10, weight = 'Regular') {
        return doc.font(weight).fontSize(size).heightOfString(value, { width, lineGap: 2 });
      }
      function columns() {
        text('Part number / description', LEFT, y, 340, 9, 'Bold');
        text('Quantity', 390, y, 60, 9, 'Bold', 'right');
        text('Extended price', 460, y, 110, 9, 'Bold', 'right');
        y += 22;
        doc.moveTo(LEFT, y - 6).lineTo(RIGHT, y - 6).strokeColor('#b7bdc5').stroke();
      }
      function nextPage() {
        doc.addPage(); y = LEFT;
        text(`Quote #${model.id} - continued`, LEFT, y, 528, 11, 'Bold');
        y += 28; columns();
      }
      function ensure(space) { if (y + space > BOTTOM) nextPage(); }
      // Split even unusually long descriptions across pages without clipping.
      function flowing(value, x, width, size = 9) {
        let remaining = value;
        while (remaining) {
          ensure(18);
          let count = remaining.length;
          while (height(remaining.slice(0, count), width, size) > BOTTOM - y) count = Math.floor(count * 0.85);
          if (!count) { nextPage(); continue; }
          if (count < remaining.length) {
            const space = remaining.lastIndexOf(' ', count);
            if (space > count / 2) count = space;
          }
          const piece = remaining.slice(0, count);
          text(piece, x, y, width, size); y += height(piece, width, size) + 3;
          remaining = remaining.slice(count).trimStart();
        }
      }
      function header() {
        text('QUOTE', LEFT, y, 300, 22, 'Bold');
        text(`#${model.id}`, 390, y + 5, 180, 13, 'Bold', 'right'); y += 38;
        flowing(model.organization.name, LEFT, 528, 12);
        for (const contact of model.organization.contact) flowing(contact, LEFT, 528);
        y += 14;
      }
      function customerDetails() {
        flowing(`Customer: ${model.customer}`, LEFT, 528, 11);
        flowing(`Project: ${model.project}`, LEFT, 528, 11);
        if (model.draft) flowing('DRAFT - Incomplete quote; prices are estimated.', LEFT, 528, 10);
        flowing('USD. All prices shown are after the quote multiple.', LEFT, 528, 9);
        flowing('Option additions are per unit and included in the extended price.', LEFT, 528, 9);
        y += 16; ensure(30); columns();
      }
      function lineItems() {
        for (const line of model.lines) {
          const rowHeight = Math.max(20, height(line.partNumber, 330, 10, 'Bold'));
          const firstOptionHeight = line.options.length ? Math.min(48, height(line.options[0].description, 355, 9)) + 8 : 0;
          ensure(Math.min(rowHeight + firstOptionHeight + 8, 600));
          const top = y;
          const page = doc.page;
          text(String(line.quantity), 390, top, 60, 10, 'Regular', 'right');
          text(money(line.extendedPrice), 460, top, 110, 10, 'Bold', 'right');
          // Part numbers may themselves be long and must wrap naturally.
          flowing(line.partNumber, LEFT, 330, 10);
          if (doc.page === page) y = Math.max(y, top + 20);
          if (line.description) flowing(line.description, LEFT, 330);
          for (const option of line.options) {
            ensure(Math.min(height(option.description, 350, 9) + 6, 60));
            text(`${money(option.addition)} / unit`, 430, y, 140, 9, 'Regular', 'right');
            flowing(option.description, LEFT + 16, 350);
          }
          y += 10;
        }
      }
      function totals() {
        ensure(55); y += 8;
        doc.moveTo(LEFT, y).lineTo(RIGHT, y).strokeColor('#b7bdc5').stroke(); y += 12;
        text(model.draft ? 'Estimated total (USD)' : 'Total (USD)', LEFT, y, 350, 12, 'Bold');
        text(money(model.total), 400, y, 170, 12, 'Bold', 'right');
      }
      header(); customerDetails(); lineItems(); totals();
      const range = doc.bufferedPageRange();
      for (let page = 0; page < range.count; page++) {
        doc.switchToPage(page);
        text(`Quote #${model.id} | Page ${page + 1} of ${range.count}`, LEFT, 756, 528, 8, 'Regular', 'right');
      }
      doc.end();
    } catch (error) { doc.destroy(); reject(error); }
  });
}
