import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import { HttpError } from './shared.mjs';

const LEFT = 42, RIGHT = 570, BOTTOM = 738;
const ACCENT = '#24577b', PALE = '#f0f5f9', MUTED = '#586674', INK = '#20242a';
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
      function text(value, x, top, width, size = 10, weight = 'Regular', align = 'left', color = INK) {
        doc.font(weight).fontSize(size).fillColor(color).text(value, x, top, { width, align, lineGap: 2 });
      }
      function height(value, width, size = 10, weight = 'Regular') {
        return doc.font(weight).fontSize(size).heightOfString(value, { width, lineGap: 2 });
      }
      function columns() {
        doc.rect(LEFT - 8, y - 5, RIGHT - LEFT + 16, 26).fill(PALE);
        text('Product / part number / description', LEFT, y + 2, 340, 9, 'Bold', 'left', ACCENT);
        text('Quantity', 390, y + 2, 60, 9, 'Bold', 'right', ACCENT);
        text('Extended price', 460, y + 2, 110, 9, 'Bold', 'right', ACCENT);
        y += 32;
      }
      function nextPage() {
        doc.addPage(); y = LEFT;
        doc.rect(LEFT, 28, RIGHT - LEFT, 2).fill(ACCENT);
        text(`Quote #${model.id} - continued`, LEFT, y, 528, 11, 'Bold', 'left', ACCENT);
        y += 28; columns();
      }
      function ensure(space) { if (y + space > BOTTOM) nextPage(); }
      // Split even unusually long descriptions across pages without clipping.
      function flowing(value, x, width, size = 9, weight = 'Regular', color = INK) {
        let remaining = value;
        while (remaining) {
          ensure(18);
          let count = remaining.length;
          while (height(remaining.slice(0, count), width, size, weight) > BOTTOM - y) count = Math.floor(count * 0.85);
          if (!count) { nextPage(); continue; }
          if (count < remaining.length) {
            const space = remaining.lastIndexOf(' ', count);
            if (space > count / 2) count = space;
          }
          const piece = remaining.slice(0, count);
          text(piece, x, y, width, size, weight, 'left', color); y += height(piece, width, size, weight) + 3;
          remaining = remaining.slice(count).trimStart();
        }
      }
      function header() {
        doc.rect(LEFT, 28, RIGHT - LEFT, 3).fill(ACCENT);
        text('QUOTE', LEFT, y, 300, 24, 'Bold', 'left', ACCENT);
        text('QUOTE NUMBER', 390, y, 180, 8, 'Bold', 'right', MUTED);
        text(`#${model.id}`, 390, y + 15, 180, 16, 'Bold', 'right', ACCENT); y += 50;
        if (model.organization.logo) {
          doc.image(model.organization.logo, LEFT, y, { fit: [160, 72], align: 'left', valign: 'top' });
          y += 84;
        }
        const address = (model.organization.address || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        const contact = model.organization.contact;
        const addressHeight = height(model.organization.name, 310, 12, 'Bold') + 6
          + address.reduce((sum, line) => sum + height(line, 310, 9) + 3, 0);
        const contactHeight = contact.reduce((sum, line) => sum + height(line, 190, 9) + 3, 0);
        // Use columns for ordinary addresses, falling back to paginated text for
        // unusually long organization details rather than clipping the header.
        if (y + Math.max(addressHeight, contactHeight) < BOTTOM - 160) {
          const top = y;
          flowing(model.organization.name, LEFT, 310, 12, 'Bold'); y += 3;
          for (const line of address) flowing(line, LEFT, 310, 9, 'Regular', MUTED);
          const addressBottom = y; y = top + 2;
          for (const line of contact) flowing(line, 380, 190, 9, 'Regular', MUTED);
          y = Math.max(addressBottom, y);
        } else {
          flowing(model.organization.name, LEFT, 528, 12, 'Bold');
          for (const line of [...address, ...contact]) flowing(line, LEFT, 528, 9, 'Regular', MUTED);
        }
        y += 22;
      }
      function customerDetails() {
        const firstRowHeight = Math.max(height(model.customer, 236, 11, 'Bold'), height(model.project, 236, 11, 'Bold'));
        const secondRowTop = 27 + firstRowHeight + 14;
        const boxHeight = secondRowTop + 16 + Math.max(height(model.location || '-', 236, 11, 'Bold'), height(model.quoteBy || '-', 236, 11, 'Bold')) + 15;
        ensure(boxHeight + 40);
        doc.roundedRect(LEFT, y, RIGHT - LEFT, boxHeight, 5).fill(PALE);
        text('CUSTOMER', LEFT + 14, y + 11, 236, 8, 'Bold', 'left', ACCENT);
        text('PROJECT', 320, y + 11, 236, 8, 'Bold', 'left', ACCENT);
        text(model.customer, LEFT + 14, y + 27, 236, 11, 'Bold');
        text(model.project, 320, y + 27, 236, 11, 'Bold');
        text('JOB LOCATION', LEFT + 14, y + secondRowTop, 236, 8, 'Bold', 'left', ACCENT);
        text('QUOTE BY', 320, y + secondRowTop, 236, 8, 'Bold', 'left', ACCENT);
        text(model.location || '-', LEFT + 14, y + secondRowTop + 16, 236, 11, 'Bold');
        text(model.quoteBy || '-', 320, y + secondRowTop + 16, 236, 11, 'Bold');
        y += boxHeight + 15;
        if (model.draft) flowing('DRAFT - Incomplete quote; prices are estimated.', LEFT, 528, 9, 'Regular', '#80571b');
        y += 9; ensure(32); columns();
      }
      function lineItems() {
        for (const line of model.lines) {
          const rowHeight = Math.max(20, height(line.partNumber, 330, 10)
            + (line.productName ? height(line.productName, 330, 10, 'Bold') + 3 : 0));
          const descriptionHeight = line.description ? height(line.description, 330, 9) + 3 : 0;
          const firstOptionHeight = line.options.length ? height(line.options[0].description, 350, 9) + 8 : 0;
          const groupHeight = rowHeight + descriptionHeight + line.options.reduce((sum, option) => sum + height(option.description, 350, 9) + 3, 0) + 10;
          ensure(Math.min(groupHeight <= 600 ? groupHeight : rowHeight + descriptionHeight + firstOptionHeight + 8, 600));
          const top = y;
          const page = doc.page;
          text(String(line.quantity), 390, top, 60, 10, 'Regular', 'right');
          text(money(line.extendedPrice), 460, top, 110, 10, 'Bold', 'right');
          if (line.productName) flowing(line.productName, LEFT, 330, 10, 'Bold');
          // Part numbers may themselves be long and must wrap naturally.
          flowing(line.partNumber, LEFT, 330, 10);
          if (doc.page === page) y = Math.max(y, top + 20);
          if (line.description) flowing(line.description, LEFT, 330);
          for (const option of line.options) {
            ensure(Math.min(height(option.description, 350, 9) + 6, 60));
            text(money(option.addition), 430, y, 140, 9, 'Regular', 'right');
            flowing(option.description, LEFT + 16, 350);
          }
          y += 10;
        }
      }
      function totals() {
        ensure(62); y += 8;
        doc.roundedRect(LEFT - 8, y, RIGHT - LEFT + 16, 44, 4).fill(PALE);
        text(model.draft ? 'Estimated total (USD)' : 'Total (USD)', LEFT + 4, y + 12, 340, 12, 'Bold', 'left', ACCENT);
        text(money(model.total), 396, y + 11, 170, 13, 'Bold', 'right', ACCENT);
      }
      header(); customerDetails(); lineItems(); totals();
      const range = doc.bufferedPageRange();
      for (let page = 0; page < range.count; page++) {
        doc.switchToPage(page);
        doc.moveTo(LEFT, 747).lineTo(RIGHT, 747).lineWidth(0.5).strokeColor('#dbe3eb').stroke();
        text(`Quote #${model.id} | Page ${page + 1} of ${range.count}`, LEFT, 756, 528, 8, 'Regular', 'right', MUTED);
      }
      doc.end();
    } catch (error) { doc.destroy(); reject(error); }
  });
}
